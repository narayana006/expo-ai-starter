import { encodeStreamEvent } from '../../../shared/chatProtocol';
import { ChatError, streamChat, type StreamingFetch, type StreamingResponse } from '../chatClient';

const encoder = new TextEncoder();

/** A response whose body yields the given chunks, one per read. */
function streamResponse(chunks: (string | Uint8Array)[], status = 200): StreamingResponse {
  const queue = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () => {
          const value = queue.shift();
          return value ? { done: false, value } : { done: true };
        },
      }),
    },
    text: async () => '',
  };
}

function setup(response: StreamingResponse) {
  const calls: { url: string; init: Parameters<StreamingFetch>[1] }[] = [];
  const fetch: StreamingFetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  const deltas: string[] = [];
  const run = (signal?: AbortSignal) =>
    streamChat({
      baseUrl: 'https://chat.example.com/',
      messages: [{ role: 'user', content: 'Hi' }],
      fetch,
      onDelta: (text) => deltas.push(text),
      signal,
    });
  return { calls, deltas, run };
}

const delta = (text: string) => encodeStreamEvent({ type: 'delta', text });
const done = encodeStreamEvent({ type: 'done' });

describe('streamChat', () => {
  it('posts the conversation to /api/chat and reports deltas in order', async () => {
    const { calls, deltas, run } = setup(streamResponse([delta('Hel'), delta('lo') + delta('!'), done]));
    await run();
    expect(deltas).toEqual(['Hel', 'lo', '!']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://chat.example.com/api/chat');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ messages: [{ role: 'user', content: 'Hi' }] });
  });

  it('handles events and multi-byte characters split across network chunks', async () => {
    const bytes = encoder.encode(delta('café ☕ 你好') + done);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 5) chunks.push(bytes.slice(i, i + 5));
    const { deltas, run } = setup(streamResponse(chunks));
    await run();
    expect(deltas).toEqual(['café ☕ 你好']);
  });

  it('ignores anything after the done event', async () => {
    const { deltas, run } = setup(streamResponse([delta('a') + done + delta('late')]));
    await run();
    expect(deltas).toEqual(['a']);
  });

  it('rejects with the message of an error event, keeping earlier deltas', async () => {
    const { deltas, run } = setup(
      streamResponse([delta('partial'), encodeStreamEvent({ type: 'error', message: 'The reply was interrupted.' })]),
    );
    await expect(run()).rejects.toThrow(new ChatError('The reply was interrupted.'));
    expect(deltas).toEqual(['partial']);
  });

  it('rejects when the stream ends without a done event', async () => {
    const { run } = setup(streamResponse([delta('cut off')]));
    await expect(run()).rejects.toThrow('The connection closed before the reply was complete.');
  });

  it('uses the error from a JSON error response, or the status code', async () => {
    const withBody = streamResponse([], 429);
    withBody.text = async () => JSON.stringify({ error: 'Too many requests. Try again shortly.' });
    await expect(setup(withBody).run()).rejects.toThrow('Too many requests. Try again shortly.');

    const html = streamResponse([], 502);
    html.text = async () => '<html>Bad gateway</html>';
    await expect(setup(html).run()).rejects.toThrow('The chat server returned HTTP 502.');
  });

  it('passes the abort signal to fetch', async () => {
    const controller = new AbortController();
    const { calls, run } = setup(streamResponse([done]));
    await run(controller.signal);
    expect(calls[0]!.init.signal).toBe(controller.signal);
  });
});
