// SU-ITER-091-batch2 · P3-09 — shared helpers for IM chat parsers.
//
// Previous behaviour across wechat/qq/dingtalk/feishu/whatsapp parsers
// computed the earliest/latest timestamps via
//   Math.min(...timestamps.map(t => t.getTime()))
//   Math.max(...timestamps.map(t => t.getTime()))
// which passes every timestamp as a separate argument to `apply`.
// On V8 the argument list is bounded (~65k on modern builds, lower on
// older ones); feeding a multi-year chat archive with hundreds of
// thousands of lines therefore risks either `Maximum call stack size
// exceeded` or silently wrong results when the engine truncates the
// list.
//
// `computeTimeRange` walks the array with a single `reduce`, so memory
// stays O(1) and we never hit the spread-argument ceiling.

import type { IMChatMessage } from './chat-parser-types';

/**
 * Compute the earliest and latest `Date` across a list of messages in a
 * single pass, without spreading into `Math.min` / `Math.max`.
 *
 * Messages whose `timestamp` is `null` are ignored.  Returns
 * `{ earliest: null, latest: null }` when no valid timestamps exist.
 */
export function computeTimeRange(messages: IMChatMessage[]): {
  earliest: Date | null;
  latest: Date | null;
} {
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  let seen = 0;

  for (const msg of messages) {
    const ts = msg.timestamp;
    if (!ts) continue;
    const ms = ts.getTime();
    if (Number.isNaN(ms)) continue;
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
    seen += 1;
  }

  if (seen === 0) {
    return { earliest: null, latest: null };
  }
  return { earliest: new Date(minMs), latest: new Date(maxMs) };
}
