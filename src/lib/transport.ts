import { fetch as expoFetch } from 'expo/fetch';

import type { ChatTransport } from '../hooks/useChat';
import { streamChat, type StreamingFetch } from './chatClient';

/**
 * Builds the transport the app uses: a streaming request to the proxy.
 * `expo/fetch` is used because it exposes the response body as a stream on
 * iOS and Android; React Native's built-in fetch does not.
 */
export function createProxyTransport(baseUrl: string): ChatTransport {
  const streamingFetch: StreamingFetch = (url, init) => expoFetch(url, init);
  return (messages, { signal, onDelta }) =>
    streamChat({ baseUrl, messages, fetch: streamingFetch, onDelta, signal });
}
