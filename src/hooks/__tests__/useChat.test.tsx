import { act, renderHook } from '@testing-library/react-native';

import type { ChatMessage } from '../../../shared/chatProtocol';
import { chatReducer, initialChatState, useChat, type ChatTransport } from '../useChat';

/** A transport the test drives by hand: push deltas, then finish or fail. */
function controlledTransport() {
  const requests: {
    messages: ChatMessage[];
    signal: AbortSignal;
    onDelta: (text: string) => void;
    finish: () => void;
    fail: (error: Error) => void;
  }[] = [];
  const transport: ChatTransport = (messages, { signal, onDelta }) =>
    new Promise<void>((resolve, reject) => {
      requests.push({ messages, signal, onDelta, finish: resolve, fail: reject });
      signal.addEventListener('abort', () => reject(new Error('Aborted')));
    });
  return { transport, requests };
}

const view = (messages: { role: string; content: string }[]) =>
  messages.map((m) => `${m.role}: ${m.content}`);

describe('useChat', () => {
  it('streams a reply into the assistant message', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('idle');

    await act(async () => result.current.send('  Hello  '));
    expect(result.current.status).toBe('streaming');
    expect(view(result.current.messages)).toEqual(['user: Hello', 'assistant: ']);
    expect(requests[0]!.messages).toEqual([{ role: 'user', content: 'Hello' }]);

    await act(async () => requests[0]!.onDelta('Hi'));
    await act(async () => requests[0]!.onDelta(' there'));
    expect(view(result.current.messages)).toEqual(['user: Hello', 'assistant: Hi there']);
    expect(result.current.status).toBe('streaming');

    await act(async () => requests[0]!.finish());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('sends the whole conversation on the next turn', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('One'));
    await act(async () => {
      requests[0]!.onDelta('First reply');
      requests[0]!.finish();
    });
    await act(async () => result.current.send('Two'));
    expect(requests[1]!.messages).toEqual([
      { role: 'user', content: 'One' },
      { role: 'assistant', content: 'First reply' },
      { role: 'user', content: 'Two' },
    ]);
  });

  it('ignores empty messages and sends made while a reply is streaming', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('   '));
    expect(requests).toHaveLength(0);
    await act(async () => result.current.send('First'));
    await act(async () => result.current.send('Second'));
    expect(requests).toHaveLength(1);
    expect(result.current.messages).toHaveLength(2);
  });

  it('reports a failure, keeps partial text and allows another try', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('Hello'));
    await act(async () => requests[0]!.onDelta('Half an ans'));
    await act(async () => requests[0]!.fail(new Error('The reply was interrupted.')));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('The reply was interrupted.');
    expect(view(result.current.messages)).toEqual(['user: Hello', 'assistant: Half an ans']);

    await act(async () => result.current.send('Again'));
    expect(result.current.status).toBe('streaming');
    expect(result.current.error).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it('removes the empty assistant placeholder when the request fails outright', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('Hello'));
    await act(async () => requests[0]!.fail(new Error('The chat server returned HTTP 502.')));
    expect(view(result.current.messages)).toEqual(['user: Hello']);
    expect(result.current.error).toBe('The chat server returned HTTP 502.');
  });

  it('stop aborts the request, keeps what arrived and is not an error', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('Tell me a long story'));
    await act(async () => requests[0]!.onDelta('Once upon'));
    await act(async () => result.current.stop());
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(view(result.current.messages)).toEqual(['user: Tell me a long story', 'assistant: Once upon']);

    await act(async () => requests[0]!.onDelta(' a time'));
    expect(result.current.messages[1]!.content).toBe('Once upon');
  });

  it('reset clears the conversation and cancels a reply in progress', async () => {
    const { transport, requests } = controlledTransport();
    const { result } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('Hello'));
    await act(async () => requests[0]!.onDelta('Hi'));
    await act(async () => result.current.reset());
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('idle');

    await act(async () => result.current.send('Fresh start'));
    expect(requests[1]!.messages).toEqual([{ role: 'user', content: 'Fresh start' }]);
  });

  it('aborts the request when the component unmounts', async () => {
    const { transport, requests } = controlledTransport();
    const { result, unmount } = await renderHook(() => useChat(transport));
    await act(async () => result.current.send('Hello'));
    await unmount();
    expect(requests[0]!.signal.aborted).toBe(true);
  });
});

describe('chatReducer', () => {
  const user = { id: 'u1', role: 'user' as const, content: 'Hi' };
  const assistant = { id: 'a1', role: 'assistant' as const, content: '' };

  it('appends deltas only to the matching message', () => {
    let state = chatReducer(initialChatState, { type: 'send', user, assistant });
    state = chatReducer(state, { type: 'delta', id: 'a1', text: 'Hel' });
    state = chatReducer(state, { type: 'delta', id: 'a1', text: 'lo' });
    state = chatReducer(state, { type: 'delta', id: 'missing', text: 'x' });
    expect(state.messages).toEqual([user, { ...assistant, content: 'Hello' }]);
  });

  it('drops an empty assistant message on finish', () => {
    const sent = chatReducer(initialChatState, { type: 'send', user, assistant });
    expect(chatReducer(sent, { type: 'finish', id: 'a1' })).toEqual({
      messages: [user],
      status: 'idle',
      error: null,
    });
  });
});
