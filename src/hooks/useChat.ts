import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { ChatMessage, ChatRole } from '../../shared/chatProtocol';

export interface UIMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export type ChatStatus = 'idle' | 'streaming' | 'error';

export interface ChatState {
  messages: UIMessage[];
  status: ChatStatus;
  error: string | null;
}

/**
 * Delivers one assistant reply. Implementations call `onDelta` as text
 * arrives and resolve when the reply is complete. The app's transport calls
 * the proxy; tests pass a fake.
 */
export type ChatTransport = (
  messages: ChatMessage[],
  options: { signal: AbortSignal; onDelta: (text: string) => void },
) => Promise<void>;

export type ChatAction =
  | { type: 'send'; user: UIMessage; assistant: UIMessage }
  | { type: 'delta'; id: string; text: string }
  | { type: 'finish'; id: string }
  | { type: 'fail'; id: string; error: string }
  | { type: 'reset' };

export const initialChatState: ChatState = { messages: [], status: 'idle', error: null };

/** Removes the assistant placeholder if nothing was streamed into it. */
function dropIfEmpty(messages: UIMessage[], id: string): UIMessage[] {
  return messages.filter((m) => m.id !== id || m.content !== '');
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return {
        messages: [...state.messages, action.user, action.assistant],
        status: 'streaming',
        error: null,
      };
    case 'delta':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, content: m.content + action.text } : m,
        ),
      };
    case 'finish':
      return { ...state, messages: dropIfEmpty(state.messages, action.id), status: 'idle' };
    case 'fail':
      return {
        messages: dropIfEmpty(state.messages, action.id),
        status: 'error',
        error: action.error,
      };
    case 'reset':
      return initialChatState;
  }
}

export interface UseChatResult extends ChatState {
  /** Sends a user message and streams the reply. Ignored while a reply is streaming. */
  send: (text: string) => void;
  /** Stops the reply in progress and keeps what has arrived so far. */
  stop: () => void;
  /** Clears the conversation. */
  reset: () => void;
}

let nextId = 0;
const newId = () => `m${Date.now().toString(36)}-${nextId++}`;

export function useChat(transport: ChatTransport): UseChatResult {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef(state);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Stop streaming if the screen goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (content === '' || abortRef.current) return;

      const user: UIMessage = { id: newId(), role: 'user', content };
      const assistant: UIMessage = { id: newId(), role: 'assistant', content: '' };
      const history: ChatMessage[] = [...stateRef.current.messages, user].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: 'send', user, assistant });

      const isCurrent = () => abortRef.current === controller;
      transport(history, {
        signal: controller.signal,
        onDelta: (delta) => {
          if (isCurrent() && !controller.signal.aborted) {
            dispatch({ type: 'delta', id: assistant.id, text: delta });
          }
        },
      }).then(
        () => {
          if (!isCurrent()) return;
          abortRef.current = null;
          dispatch({ type: 'finish', id: assistant.id });
        },
        (err: unknown) => {
          if (!isCurrent()) return;
          abortRef.current = null;
          if (controller.signal.aborted) {
            // The user pressed stop: that is not an error.
            dispatch({ type: 'finish', id: assistant.id });
          } else {
            const message = err instanceof Error ? err.message : 'Something went wrong.';
            dispatch({ type: 'fail', id: assistant.id, error: message });
          }
        },
      );
    },
    [transport],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    dispatch({ type: 'reset' });
  }, []);

  return { ...state, send, stop, reset };
}
