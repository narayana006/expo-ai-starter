/**
 * The contract between the app and the proxy.
 *
 * Request:  POST /api/chat  with JSON body { "messages": ChatMessage[] }
 * Response: text/event-stream, where each event's data is one StreamEvent
 *           encoded as JSON. The stream always ends with "done" or "error".
 *
 * Shared by the app and the server, so it must not import anything.
 */

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Decodes the data of one event; returns null for anything unrecognised. */
export function parseStreamEvent(data: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const event = value as { type?: unknown; text?: unknown; message?: unknown };
  if (event.type === 'delta' && typeof event.text === 'string') {
    return { type: 'delta', text: event.text };
  }
  if (event.type === 'done') return { type: 'done' };
  if (event.type === 'error') {
    return { type: 'error', message: typeof event.message === 'string' ? event.message : 'Unknown error' };
  }
  return null;
}

export function encodeStreamEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
