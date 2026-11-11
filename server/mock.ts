/** Canned replies, so the app can be developed without a model or a key. */

import type { ChatMessage } from '../shared/chatProtocol.ts';

const CANNED =
  'This is a canned reply from the proxy running in mock mode. No model was called. ' +
  'Set UPSTREAM_BASE_URL, UPSTREAM_API_KEY and UPSTREAM_MODEL on the server to get real answers. ' +
  'The text is streamed a few words at a time so you can see the chat screen update as it arrives.';

export function mockReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const quoted = last ? last.content.replace(/\s+/g, ' ').slice(0, 80) : '';
  return quoted ? `You said: "${quoted}". ${CANNED}` : CANNED;
}

/** Splits text into small chunks that keep their trailing spaces. */
export function chunkText(text: string, wordsPerChunk = 3): string[] {
  const words = text.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(''));
  }
  return chunks;
}

export async function* streamMock(
  messages: ChatMessage[],
  delayMs: number,
  signal: AbortSignal,
): AsyncGenerator<string> {
  for (const chunk of chunkText(mockReply(messages))) {
    if (signal.aborted) return;
    yield chunk;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
