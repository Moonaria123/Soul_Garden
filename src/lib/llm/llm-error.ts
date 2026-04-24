// ============================================================
// SU-088 · P0-G: unified LLM error taxonomy.
//
// Every LLM call-site used to render raw server strings ("HTTP 500",
// "fetch failed", "LLM 调用失败") which both leaked internals and
// offered no recovery hint.  This module collapses every failure mode
// into five actionable categories plus an i18n-keyed, warmly worded
// user message.  The hook in chat/page + settings uses this to drive
// toast content + a retry affordance.
// ============================================================

export type LlmErrorCategory =
  /** Transport / DNS / connection reset / browser offline. */
  | 'network'
  /** 401 / 403 — invalid API key or revoked credential. */
  | 'auth'
  /** 429 / usage caps — upstream rate-limited us. */
  | 'rate_limit'
  /** Model not found / unsupported / 404 / 400 bad-model. */
  | 'model_unavailable'
  /** 5xx / parse errors / anything else — "upstream having a bad day". */
  | 'upstream';

export interface LlmErrorInfo {
  category: LlmErrorCategory;
  /** i18n key for the warmly worded, non-technical message. */
  messageKey: string;
  /** Raw status / code / transport-level hint for diagnostics only. */
  detail?: string;
  /** Whether the caller should offer a single-click retry. */
  retryable: boolean;
}

/**
 * Classify an arbitrary thrown value or an HTTP `Response` status.
 * Callers on the streaming path can wrap a `new Error('HTTP 429: ...')`
 * or pass `{ status: 429 }` shaped detail — both funnel through here.
 */
export function classifyLlmError(err: unknown): LlmErrorInfo {
  // 1) Pre-classified info surviving a retry round-trip.
  if (isLlmErrorInfo(err)) return err;

  // 2) Parse HTTP status if embedded in an Error message.
  const status = extractHttpStatus(err);
  if (status !== null) {
    if (status === 401 || status === 403) {
      return {
        category: 'auth',
        messageKey: 'llm.error.auth',
        detail: `HTTP ${status}`,
        retryable: false,
      };
    }
    if (status === 429) {
      return {
        category: 'rate_limit',
        messageKey: 'llm.error.rateLimit',
        detail: `HTTP ${status}`,
        retryable: true,
      };
    }
    if (status === 404 || status === 400) {
      return {
        category: 'model_unavailable',
        messageKey: 'llm.error.modelUnavailable',
        detail: `HTTP ${status}`,
        retryable: false,
      };
    }
    if (status >= 500 && status < 600) {
      return {
        category: 'upstream',
        messageKey: 'llm.error.upstream',
        detail: `HTTP ${status}`,
        retryable: true,
      };
    }
  }

  // 3) TypeError from fetch → network.  Most browsers surface failed
  //    fetches as `TypeError`s with messages like "Failed to fetch".
  if (err instanceof TypeError || isNetworkErrorMessage(err)) {
    return {
      category: 'network',
      messageKey: 'llm.error.network',
      detail: summariseErr(err),
      retryable: true,
    };
  }

  // 4) Fallback — keep the detail for logs but show the warm copy.
  return {
    category: 'upstream',
    messageKey: 'llm.error.upstream',
    detail: summariseErr(err),
    retryable: true,
  };
}

function isLlmErrorInfo(err: unknown): err is LlmErrorInfo {
  return (
    typeof err === 'object' &&
    err !== null &&
    'category' in err &&
    'messageKey' in err &&
    'retryable' in err
  );
}

function extractHttpStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number' && s >= 100 && s < 600) return s;
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  // RLX-ESL-02 (SU-092-batch1): fixed-length \d{3} + anchored \b; safe-regex false positive.
  // eslint-disable-next-line security/detect-unsafe-regex
  const m = msg.match(/\b(?:HTTP\s*)?(\d{3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 100 && n < 600 ? n : null;
}

function isNetworkErrorMessage(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /failed to fetch|network|offline|ECONN|ENOTFOUND|ETIMEDOUT/i.test(msg);
}

function summariseErr(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 240);
  if (typeof err === 'string') return err.slice(0, 240);
  try {
    return JSON.stringify(err).slice(0, 240);
  } catch {
    return 'unknown';
  }
}

// ============================================================
// Retry helper — single retry with linear backoff.  The chat UI
// offers a button that calls this; extraction / summary jobs can
// wrap themselves with `retryOnce`.
// ============================================================

export interface RetryOptions {
  /** Default: 800ms — keeps the UI responsive. */
  backoffMs?: number;
  /** Category filter; defaults to the LlmErrorInfo.retryable flag. */
  shouldRetry?: (info: LlmErrorInfo) => boolean;
}

export async function retryOnce<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const info = classifyLlmError(err);
    const retry = options.shouldRetry ? options.shouldRetry(info) : info.retryable;
    if (!retry) throw err;
    await new Promise((r) => setTimeout(r, options.backoffMs ?? 800));
    return fn();
  }
}
