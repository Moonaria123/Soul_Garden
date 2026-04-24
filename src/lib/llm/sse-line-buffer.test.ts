import { describe, expect, it } from 'vitest';
import { SseLineBuffer } from './sse-line-buffer';

// SU-ITER-089 · P1-8 — the SSE parser used to call `chunk.split('\n')`
// per read, dropping or mis-splitting any line that straddled a chunk
// boundary.  These tests pin the new buffered behaviour.

describe('SseLineBuffer', () => {
  it('returns a single complete line when the whole line arrives at once', () => {
    const buf = new SseLineBuffer();
    expect(buf.feed('data: hello\n')).toEqual(['data: hello']);
  });

  it('returns zero lines when the chunk contains no newline', () => {
    const buf = new SseLineBuffer();
    expect(buf.feed('data: par')).toEqual([]);
  });

  it('glues a line across two chunks instead of splitting it', () => {
    const buf = new SseLineBuffer();
    expect(buf.feed('data: {"choi')).toEqual([]);
    expect(buf.feed('ces":[{"delta":"hi"}]}\n')).toEqual([
      'data: {"choices":[{"delta":"hi"}]}',
    ]);
  });

  it('emits multiple lines if the chunk closes several newlines', () => {
    const buf = new SseLineBuffer();
    expect(buf.feed('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('retains the trailing partial line for the next feed', () => {
    const buf = new SseLineBuffer();
    expect(buf.feed('a\nbb')).toEqual(['a']);
    expect(buf.feed('b\n')).toEqual(['bbb']);
  });

  it('normalises CRLF endings so callers never see a trailing \\r', () => {
    const buf = new SseLineBuffer();
    expect(buf.feed('data: hello\r\n')).toEqual(['data: hello']);
  });

  it('flush() returns the residual partial line and clears the buffer', () => {
    const buf = new SseLineBuffer();
    buf.feed('data: final'); // no newline
    expect(buf.flush()).toBe('data: final');
    expect(buf.flush()).toBeNull();
  });

  it('flush() returns null on an empty buffer', () => {
    expect(new SseLineBuffer().flush()).toBeNull();
  });

  it('handles byte-by-byte delivery deterministically', () => {
    const buf = new SseLineBuffer();
    const target = 'data: {"choices":[{"delta":"✔"}]}\n';
    const collected: string[] = [];
    for (const ch of target) {
      collected.push(...buf.feed(ch));
    }
    expect(collected).toEqual(['data: {"choices":[{"delta":"✔"}]}']);
  });

  it('does not surface empty lines (SSE terminators) as lost data', () => {
    // SSE separates events with a blank line: "data: x\n\n".
    // Consumers expect to see the blank string so they can treat it
    // as a flush signal.  We keep it — stripping is a caller concern.
    const buf = new SseLineBuffer();
    expect(buf.feed('data: x\n\n')).toEqual(['data: x', '']);
  });
});
