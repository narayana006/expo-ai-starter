/** Streaming client for an OpenAI-compatible chat completions API. */

import type { ChatMessage } from '../shared/chatProtocol.ts';
import { createSSEParser } from '../shared/sse.ts';
import type { ProxyConfig } from './config.ts';

export type UpstreamFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  body: AsyncIterable<Uint8Array> | null;
}>;

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** Extracts the text of one streamed chunk, or "" when it carries none. */
function deltaText(data: string): string {
  try {
    const chunk = JSON.parse(data) as { choices?: { delta?: { content?: unknown } }[] };
    const content = chunk.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/**
 * Opens the upstream request and returns the reply as a stream of text.
 * Rejects before returning if the upstream refuses the request, so the proxy
 * can still answer with a normal HTTP error.
 */
export async function openUpstream(
  config: ProxyConfig,
  messages: ChatMessage[],
  fetchImpl: UpstreamFetch,
  signal: AbortSignal,
): Promise<AsyncGenerator<string>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
  };
  if (config.upstreamApiKey !== '') headers.authorization = `Bearer ${config.upstreamApiKey}`;
  const allMessages = config.systemPrompt
    ? [{ role: 'system', content: config.systemPrompt }, ...messages]
    : messages;

  let response: Awaited<ReturnType<UpstreamFetch>>;
  try {
    response = await fetchImpl(`${config.upstreamBaseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, messages: allMessages, stream: true }),
      signal,
    });
  } catch {
    throw new UpstreamError('Could not reach the model service.');
  }
  if (!response.ok) {
    // The upstream's error body can contain account details; keep it out of the app.
    throw new UpstreamError(`The model service returned HTTP ${response.status}.`);
  }
  const body = response.body;
  if (!body) throw new UpstreamError('The model service sent an empty response.');

  return (async function* () {
    const pending: string[] = [];
    let finished = false;
    const parser = createSSEParser(({ data }) => {
      if (data.trim() === '[DONE]') finished = true;
      else if (!finished) {
        const text = deltaText(data);
        if (text !== '') pending.push(text);
      }
    });
    const decoder = new TextDecoder();
    for await (const bytes of body) {
      parser.feed(decoder.decode(bytes, { stream: true }));
      while (pending.length > 0) yield pending.shift()!;
      if (finished) return;
    }
    parser.feed(decoder.decode());
    parser.flush();
    while (pending.length > 0) yield pending.shift()!;
  })();
}
