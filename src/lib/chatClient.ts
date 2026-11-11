import { parseStreamEvent, type ChatMessage } from '../../shared/chatProtocol';
import { createSSEParser } from '../../shared/sse';

/** The part of a streaming `fetch` this client relies on. */
export interface StreamingResponse {
  ok: boolean;
  status: number;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
  text(): Promise<string>;
}

export type StreamingFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<StreamingResponse>;

export interface StreamChatOptions {
  /** Base URL of the proxy, for example http://localhost:8787 */
  baseUrl: string;
  messages: ChatMessage[];
  fetch: StreamingFetch;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatError';
  }
}

async function errorFromResponse(response: StreamingResponse): Promise<ChatError> {
  let detail = '';
  try {
    const body = JSON.parse(await response.text()) as { error?: unknown };
    if (typeof body.error === 'string') detail = body.error;
  } catch {
    // Not JSON; the status code is all we have.
  }
  return new ChatError(detail || `The chat server returned HTTP ${response.status}.`);
}

/**
 * Sends the conversation to the proxy and calls `onDelta` for each piece of
 * the reply as it arrives. Resolves when the proxy signals the end of the
 * reply; rejects on HTTP errors, error events, or a stream that stops early.
 */
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const response = await options.fetch(`${options.baseUrl.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ messages: options.messages }),
    signal: options.signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new ChatError('The chat server sent an empty response.');

  let finished = false;
  let failure: ChatError | null = null;
  const parser = createSSEParser(({ data }) => {
    if (finished || failure) return;
    const event = parseStreamEvent(data);
    if (!event) return;
    if (event.type === 'delta') options.onDelta(event.text);
    else if (event.type === 'done') finished = true;
    else failure = new ChatError(event.message);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (!finished && !failure) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parser.feed(decoder.decode(value, { stream: true }));
  }
  parser.feed(decoder.decode());
  parser.flush();

  if (failure) throw failure;
  if (!finished) throw new ChatError('The connection closed before the reply was complete.');
}
