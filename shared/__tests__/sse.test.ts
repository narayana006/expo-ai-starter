import { encodeStreamEvent, parseStreamEvent } from '../chatProtocol';
import { createSSEParser, type SSEEvent } from '../sse';

function parse(chunks: string[], flush = true): SSEEvent[] {
  const events: SSEEvent[] = [];
  const parser = createSSEParser((event) => events.push(event));
  for (const chunk of chunks) parser.feed(chunk);
  if (flush) parser.flush();
  return events;
}

describe('createSSEParser', () => {
  it('emits one event per blank-line-terminated block', () => {
    expect(parse(['data: one\n\ndata: two\n\n'])).toEqual([
      { event: 'message', data: 'one' },
      { event: 'message', data: 'two' },
    ]);
  });

  it('gives the same events no matter how the text is split into chunks', () => {
    const text = 'event: note\ndata: {"a":1}\n\ndata: first line\ndata: second line\n\n: ping\n\ndata: last\n\n';
    const whole = parse([text]);
    expect(whole).toEqual([
      { event: 'note', data: '{"a":1}' },
      { event: 'message', data: 'first line\nsecond line' },
      { event: 'message', data: 'last' },
    ]);
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
      expect(parse(chunks)).toEqual(whole);
    }
  });

  it('accepts CRLF and CR line endings, including a CRLF split across chunks', () => {
    expect(parse(['data: a\r\n\r\ndata: b\r\rdata: c\n\n'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
      { event: 'message', data: 'c' },
    ]);
    expect(parse(['data: a\r', '\n\r', '\ndata: b\r\n\r\n'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'message', data: 'b' },
    ]);
  });

  it('strips only one leading space and keeps colons inside the value', () => {
    expect(parse(['data:  two spaces\n\ndata:none\n\ndata: a: b\n\n']).map((e) => e.data)).toEqual([
      ' two spaces',
      'none',
      'a: b',
    ]);
  });

  it('ignores comments, unknown fields and blocks without data', () => {
    expect(parse([': keep-alive\n\nid: 7\nretry: 1000\n\nevent: empty\n\ndata\n\n'])).toEqual([
      { event: 'message', data: '' },
    ]);
  });

  it('holds an unterminated event until flush', () => {
    const events: SSEEvent[] = [];
    const parser = createSSEParser((event) => events.push(event));
    parser.feed('data: partial');
    expect(events).toEqual([]);
    parser.flush();
    expect(events).toEqual([{ event: 'message', data: 'partial' }]);
    parser.flush();
    expect(events).toHaveLength(1);
  });
});

describe('stream events', () => {
  it('round-trips through encode, the SSE parser and parse', () => {
    const wire =
      encodeStreamEvent({ type: 'delta', text: 'line one\nline "two"' }) +
      encodeStreamEvent({ type: 'error', message: 'boom' }) +
      encodeStreamEvent({ type: 'done' });
    expect(parse([wire]).map((e) => parseStreamEvent(e.data))).toEqual([
      { type: 'delta', text: 'line one\nline "two"' },
      { type: 'error', message: 'boom' },
      { type: 'done' },
    ]);
  });

  it('returns null for anything it does not recognise', () => {
    for (const data of ['not json', '42', 'null', '{"type":"delta"}', '{"type":"other"}', '[DONE]']) {
      expect(parseStreamEvent(data)).toBeNull();
    }
    expect(parseStreamEvent('{"type":"error"}')).toEqual({ type: 'error', message: 'Unknown error' });
  });
});
