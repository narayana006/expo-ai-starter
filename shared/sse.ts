/**
 * Incremental parser for Server-Sent Events.
 *
 * Network chunks do not line up with event boundaries: one chunk can hold
 * several events, and one event (or even one line ending) can be split across
 * chunks. Feed the parser text as it arrives and it calls `onEvent` once per
 * complete event.
 *
 * Used by the app (to read the proxy's stream) and by the proxy (to read the
 * upstream model's stream), so it must not import anything.
 */

export interface SSEEvent {
  /** Value of the `event:` field, or "message" when the event has none. */
  event: string;
  /** The `data:` lines of the event joined with newlines. */
  data: string;
}

export interface SSEParser {
  /** Adds a chunk of decoded text. */
  feed(chunk: string): void;
  /** Call when the stream ends, to emit a final event that had no blank line after it. */
  flush(): void;
}

export function createSSEParser(onEvent: (event: SSEEvent) => void): SSEParser {
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0) {
      onEvent({ event: eventName || 'message', data: dataLines.join('\n') });
    }
    eventName = '';
    dataLines = [];
  };

  const handleLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment, often used as a keep-alive

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
    // "id" and "retry" are not needed for one-shot chat streams.
  };

  const drain = (final: boolean) => {
    let start = 0;
    for (;;) {
      const match = /\r\n|\n|\r/.exec(buffer.slice(start));
      if (!match) break;
      const end = start + match.index;
      // A lone "\r" at the very end may be the first half of "\r\n".
      if (match[0] === '\r' && end === buffer.length - 1 && !final) break;
      handleLine(buffer.slice(start, end));
      start = end + match[0].length;
    }
    buffer = buffer.slice(start);
  };

  return {
    feed(chunk) {
      buffer += chunk;
      drain(false);
    },
    flush() {
      drain(true);
      if (buffer !== '') {
        handleLine(buffer);
        buffer = '';
      }
      dispatch();
    },
  };
}
