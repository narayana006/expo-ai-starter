/**
 * The proxy's HTTP handler.
 *
 *   GET  /healthz    -> {"ok": true, "mode": "mock" | "upstream"}
 *   POST /api/chat   -> text/event-stream of StreamEvent objects
 *
 * The app sends only the conversation. The model, the system prompt and the
 * API key are chosen here, on the server.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { encodeStreamEvent, type ChatMessage } from '../shared/chatProtocol.ts';
import type { ProxyConfig } from './config.ts';
import { streamMock } from './mock.ts';
import { openUpstream, UpstreamError, type UpstreamFetch } from './upstream.ts';

const MAX_BODY_BYTES = 256 * 1024;

export interface HandlerDeps {
  fetch?: UpstreamFetch;
  now?: () => number;
  log?: (line: string) => void;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Checks the request body and returns the conversation, or throws a 400. */
export function validateMessages(body: unknown, config: ProxyConfig): ChatMessage[] {
  const list = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(list) || list.length === 0) {
    throw new HttpError(400, 'Body must be JSON with a non-empty "messages" array.');
  }
  if (list.length > config.maxMessages) {
    throw new HttpError(400, `Too many messages (the limit is ${config.maxMessages}).`);
  }
  let total = 0;
  const messages: ChatMessage[] = list.map((item, index) => {
    const { role, content } = (item ?? {}) as { role?: unknown; content?: unknown };
    // "system" is rejected on purpose: the system prompt is set on the server.
    if (role !== 'user' && role !== 'assistant') {
      throw new HttpError(400, `messages[${index}].role must be "user" or "assistant".`);
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw new HttpError(400, `messages[${index}].content must be a non-empty string.`);
    }
    total += content.length;
    return { role, content };
  });
  if (total > config.maxTotalChars) {
    throw new HttpError(400, `Conversation is too long (the limit is ${config.maxTotalChars} characters).`);
  }
  if (messages[messages.length - 1]!.role !== 'user') {
    throw new HttpError(400, 'The last message must be from the user.');
  }
  return messages;
}

/** Fixed-window request counter per client address. */
function createRateLimiter(limit: number, now: () => number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): number => {
    if (limit === 0) return 0;
    const time = now();
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (time - w.start >= 60_000) windows.delete(k);
    }
    const current = windows.get(key);
    if (!current || time - current.start >= 60_000) {
      windows.set(key, { start: time, count: 1 });
      return 0;
    }
    current.count += 1;
    // Seconds until the window resets, when over the limit.
    return current.count > limit ? Math.ceil((current.start + 60_000 - time) / 1000) : 0;
  };
}

export function createHandler(config: ProxyConfig, deps: HandlerDeps = {}) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const fetchImpl: UpstreamFetch =
    deps.fetch ?? ((url, init) => fetch(url, init) as ReturnType<UpstreamFetch>);
  const retryAfter = createRateLimiter(config.rateLimitPerMinute, now);

  const cors = {
    'access-control-allow-origin': config.allowedOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  const sendJson = (
    res: ServerResponse,
    status: number,
    body: unknown,
    extra: Record<string, string> = {},
  ) => {
    res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra });
    res.end(JSON.stringify(body));
  };

  async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const wait = retryAfter(req.socket.remoteAddress ?? 'unknown');
    if (wait > 0) {
      sendJson(res, 429, { error: 'Too many requests. Try again shortly.' }, { 'retry-after': String(wait) });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'Body must be valid JSON.');
    }
    const messages = validateMessages(parsed, config);

    // Stop generating (and paying for) a reply nobody is listening to.
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const stream = config.mock
      ? streamMock(messages, config.mockDelayMs, abort.signal)
      : await openUpstream(config, messages, fetchImpl, abort.signal);

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...cors,
    });
    try {
      for await (const text of stream) {
        if (abort.signal.aborted) return;
        res.write(encodeStreamEvent({ type: 'delta', text }));
      }
      res.write(encodeStreamEvent({ type: 'done' }));
    } catch (err) {
      if (!abort.signal.aborted) {
        log(`stream failed: ${err instanceof Error ? err.message : String(err)}`);
        res.write(encodeStreamEvent({ type: 'error', message: 'The reply was interrupted.' }));
      }
    } finally {
      res.end();
    }
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
      } else if (path === '/healthz' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, mode: config.mock ? 'mock' : 'upstream' });
      } else if (path === '/api/chat' && req.method === 'POST') {
        await chat(req, res);
      } else if (path === '/api/chat') {
        sendJson(res, 405, { error: 'Use POST.' }, { allow: 'POST, OPTIONS' });
      } else {
        sendJson(res, 404, { error: 'Not found.' });
      }
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
      else if (err instanceof UpstreamError) {
        log(`upstream: ${err.message}`);
        sendJson(res, 502, { error: err.message });
      } else {
        log(`unexpected: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        sendJson(res, 500, { error: 'Internal error.' });
      }
    }
  };
}
