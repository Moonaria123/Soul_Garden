// SU-ITER-094 · Phase D — lightweight token estimation + context-window
// truncation helpers.
//
// Rationale
// ---------
// Free-running chat sessions accumulate history indefinitely.  Once the
// prompt exceeds the model's context window the upstream call either
// returns a 400 (OpenAI / Anthropic) or silently truncates in an
// unpredictable way (DashScope, gateway proxies).  Both failure modes
// are opaque to the user.
//
// We can't ship a full BPE tokenizer to the browser (tens of MB and
// vendor-specific).  Instead, we apply a conservative character-based
// heuristic:
//
//   tokens ≈ ceil(chars * 0.45)
//
// The 0.45 coefficient is a deliberate over-estimate — empirically,
// CJK text tokenizes at ~1 token/char and English at ~0.25 token/char,
// so a mixed corpus falls between 0.25 and 0.6.  We pick 0.45 so we
// trigger truncation slightly *earlier* than strictly necessary, which
// is the safer failure mode (dropping oldest history beats a 400).
//
// The helpers are intentionally pure + synchronous so they are cheap
// to call on every send and trivial to unit-test.

/** Heuristic token count for a single string.  Empty → 0. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length * 0.45);
}

/**
 * Estimate total tokens for a chat-style message array.  Includes a
 * small per-message envelope (role + delimiters, ~4 tokens) plus a
 * 2-token priming overhead the major vendors all bake in.
 */
export function estimateMessagesTokens(
  messages: ReadonlyArray<{ role: string; content: string }>,
): number {
  let total = 2; // priming
  for (const m of messages) {
    total += 4 + estimateTokens(m.content);
  }
  return total;
}

/**
 * Fraction of the model's context window we allow the **input** side
 * (system + history + current user turn) to occupy.  The remainder is
 * reserved for the model's reply + any reasoning tokens.
 */
export const INPUT_TOKEN_BUDGET_RATIO = 0.7;

/**
 * Compute the input-side token budget for a given context window.
 * Returns `null` when the caller doesn't know the window size — the
 * truncator treats `null` as "no truncation" so unknown models keep
 * today's pass-through behaviour.
 */
export function computeInputTokenBudget(
  contextWindow: number | null | undefined,
): number | null {
  if (
    contextWindow == null ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return null;
  }
  return Math.floor(contextWindow * INPUT_TOKEN_BUDGET_RATIO);
}

/**
 * Truncate a chat message array to fit within `budget` tokens, oldest
 * history-first.
 *
 * Contract:
 *   • First message (index 0) is treated as the system prompt and
 *     always kept.
 *   • Last message (index n-1) is treated as the current user turn
 *     and always kept.
 *   • Middle messages are dropped oldest-first until the estimated
 *     total fits inside `budget`.
 *   • If the required pair alone already exceeds `budget`, they are
 *     still returned (the caller must at least attempt the upstream
 *     call — it's the only way the user learns the prompt is too
 *     large).
 *
 * `budget` of `null` short-circuits to a pass-through — callers use
 * this when the model's context window is unknown.
 */
export function truncateMessagesToBudget<
  M extends { role: string; content: string },
>(
  messages: M[],
  budget: number | null,
): { kept: M[]; droppedCount: number; estimatedTokens: number } {
  const full = estimateMessagesTokens(messages);
  if (budget == null || messages.length <= 2 || full <= budget) {
    return { kept: messages.slice(), droppedCount: 0, estimatedTokens: full };
  }

  const system = messages[0];
  const lastUser = messages[messages.length - 1];
  const middle = messages.slice(1, -1);

  const fixedTokens = estimateMessagesTokens([system, lastUser]);
  let available = budget - fixedTokens;

  if (available <= 0) {
    // Required pair alone overshoots — hand them back anyway.  The
    // caller's upstream error handler is the right place to surface
    // "prompt too long"; silently dropping the user's turn would be
    // worse.
    return {
      kept: [system, lastUser],
      droppedCount: middle.length,
      estimatedTokens: fixedTokens,
    };
  }

  const keptMiddle: M[] = [];
  for (let i = middle.length - 1; i >= 0; i--) {
    const m = middle[i];
    const cost = 4 + estimateTokens(m.content);
    if (cost > available) break;
    keptMiddle.unshift(m);
    available -= cost;
  }

  const kept = [system, ...keptMiddle, lastUser];
  return {
    kept,
    droppedCount: middle.length - keptMiddle.length,
    estimatedTokens: estimateMessagesTokens(kept),
  };
}
