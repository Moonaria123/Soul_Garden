// SU-ITER-089 · P1-8 · Cross-chunk SSE line buffering.
//
// Problem: `Response.body.getReader()` yields binary chunks whose
// boundaries bear no relation to SSE line boundaries.  A single
// `data: { … }\n` event can arrive as `data: { "choices":`, `[{"d…`,
// `elta":{"content":"hello"}}]}\n` — three network reads, one logical
// line.  The previous implementation called `chunk.split('\n')` per
// read which silently dropped (or split) any line that straddled a
// chunk boundary, so streamed LLM output occasionally lost a token
// or broke JSON.parse mid-event.
//
// Fix: a tiny stateful buffer that keeps the trailing partial line
// between reads.  Exposes two pure methods:
//   - `feed(chunk)` returns every **complete** line the new chunk
//     contributed (possibly zero).
//   - `flush()` returns the final partial line after `done`, if any.
//
// Deliberately string-based (not Uint8Array) because the caller owns
// a TextDecoder and always hands us decoded text.  Moving decoding
// in here would couple the buffer to `TextDecoder({ stream: true })`
// for no reuse benefit.

export class SseLineBuffer {
  private buffer = '';

  /**
   * Append a decoded chunk and pop every complete line it closed.
   * Lines are returned **without** their trailing `\n`.  CRLF is
   * normalised so callers never see `\r`.
   */
  feed(chunk: string): string[] {
    if (!chunk) return [];
    this.buffer += chunk;
    const lines: string[] = [];
    let newlineIdx = this.buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      let line = this.buffer.slice(0, newlineIdx);
      // Strip the CR of a CRLF sequence so consumers don't need a
      // second trim; servers that use `\r\n` (rare in SSE but legal)
      // would otherwise leave a trailing `\r` glued to every event.
      if (line.endsWith('\r')) line = line.slice(0, -1);
      lines.push(line);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      newlineIdx = this.buffer.indexOf('\n');
    }
    return lines;
  }

  /**
   * Return any residual partial line after the stream has ended.
   * Returns `null` when the buffer is empty; never throws.  Callers
   * should treat this as best-effort — a provider that fails to emit
   * a terminating `\n\n` would drop the final event otherwise.
   */
  flush(): string | null {
    if (!this.buffer) return null;
    let line = this.buffer;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    this.buffer = '';
    return line;
  }
}
