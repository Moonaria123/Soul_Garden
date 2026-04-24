import { describe, it, expect, vi } from 'vitest';
import { handleLlmErrorImpl, type ToastLike, type Translator } from './use-llm-call';

// ------------------------------------------------------------
// Test scaffolding — a mock toast + identity translator.
// ------------------------------------------------------------

function makeToastMock(): ToastLike & {
  calls: {
    error: Array<{ msg: string; opts?: Parameters<ToastLike['error']>[1] }>;
    info: string[];
    success: string[];
  };
} {
  const calls = {
    error: [] as Array<{ msg: string; opts?: Parameters<ToastLike['error']>[1] }>,
    info: [] as string[],
    success: [] as string[],
  };
  return {
    calls,
    error: (msg, opts) => {
      calls.error.push({ msg, opts });
    },
    info: (msg) => {
      calls.info.push(msg);
    },
    success: (msg) => {
      calls.success.push(msg);
    },
  };
}

const t: Translator = (key) => key; // identity — easier to assert keys

// ------------------------------------------------------------

describe('handleLlmErrorImpl — classification → toast mapping', () => {
  it('renders the warmly worded key for each of the five categories', () => {
    const cases: Array<[unknown, string]> = [
      [new Error('HTTP 401: unauthorized'), 'llm.error.auth'],
      [new Error('HTTP 429: too many'), 'llm.error.rateLimit'],
      [new Error('HTTP 404: model gone'), 'llm.error.modelUnavailable'],
      [new Error('HTTP 502: bad gateway'), 'llm.error.upstream'],
      [new TypeError('Failed to fetch'), 'llm.error.network'],
    ];
    for (const [err, expectedKey] of cases) {
      const toast = makeToastMock();
      const info = handleLlmErrorImpl(err, t, toast);
      expect(info.messageKey).toBe(expectedKey);
      expect(toast.calls.error).toHaveLength(1);
      expect(toast.calls.error[0].msg).toBe(expectedKey);
    }
  });

  it('attaches a retry action only when the category is retryable', () => {
    const toast = makeToastMock();
    // auth → non-retryable, should NOT wire an action even with onRetry
    handleLlmErrorImpl(
      new Error('HTTP 403: forbidden'),
      t,
      toast,
      { onRetry: () => undefined },
    );
    expect(toast.calls.error[0].opts?.action).toBeUndefined();

    // rate_limit → retryable; WITH onRetry should wire one
    const toast2 = makeToastMock();
    handleLlmErrorImpl(
      new Error('HTTP 429: too many'),
      t,
      toast2,
      { onRetry: () => undefined },
    );
    expect(toast2.calls.error[0].opts?.action?.label).toBe('llm.error.retry');
  });

  it('omits the retry action when no onRetry is provided, even for retryable categories', () => {
    const toast = makeToastMock();
    handleLlmErrorImpl(new TypeError('Failed to fetch'), t, toast);
    expect(toast.calls.error[0].opts?.action).toBeUndefined();
  });

  it('silent: true classifies but does not render any toast', () => {
    const toast = makeToastMock();
    const info = handleLlmErrorImpl(
      new Error('HTTP 500'),
      t,
      toast,
      { silent: true },
    );
    expect(info.category).toBe('upstream');
    expect(toast.calls.error).toHaveLength(0);
  });
});

describe('handleLlmErrorImpl — retry coroutine', () => {
  it('shows pending + success toasts when the retry callback resolves', async () => {
    const toast = makeToastMock();
    const retry = vi.fn(async () => undefined);
    handleLlmErrorImpl(
      new Error('HTTP 502'),
      t,
      toast,
      { onRetry: retry },
    );

    // Fire the retry action like a user click.
    const action = toast.calls.error[0].opts?.action;
    expect(action).toBeDefined();
    action!.onClick();
    // Let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 0));

    expect(retry).toHaveBeenCalledOnce();
    expect(toast.calls.info).toContain('llm.error.retryPending');
    expect(toast.calls.success).toContain('llm.error.retrySucceeded');
  });

  it('shows the retry-failed toast with description when the retry itself errors', async () => {
    const toast = makeToastMock();
    const retry = vi.fn(async () => {
      throw new Error('HTTP 429: still limited');
    });
    handleLlmErrorImpl(
      new Error('HTTP 502'),
      t,
      toast,
      { onRetry: retry },
    );

    toast.calls.error[0].opts?.action?.onClick();
    await new Promise((r) => setTimeout(r, 0));

    expect(retry).toHaveBeenCalledOnce();
    // Two error toasts: initial upstream + retry's rate_limit.
    expect(toast.calls.error).toHaveLength(2);
    expect(toast.calls.error[1].msg).toBe('llm.error.rateLimit');
    expect(toast.calls.error[1].opts?.description).toBe('llm.error.retryFailed');
  });
});
