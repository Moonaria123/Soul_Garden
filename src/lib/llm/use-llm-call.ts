'use client';

// ============================================================
// SU-088 · P0-G: React integration for the unified LLM error
// taxonomy.  Components catch an LLM failure, hand the raw error
// to `handleError`, and a warmly worded toast (plus a single
// retry affordance for retryable categories) is rendered.
//
// The implementation is split so the bulk of the logic lives in
// a pure, injectable function (`handleLlmErrorImpl`) that is
// covered by unit tests under the existing `node` vitest env.
// React-Testing-Library coverage of the hook itself is deferred
// to SU-092 (jsdom setup tracked there).
// ============================================================

import { useCallback } from 'react';
import { toast as sonnerToast } from 'sonner';
import { useT } from '@/lib/i18n';
import { classifyLlmError, type LlmErrorInfo } from './llm-error';

export interface ToastLike {
  error: (
    msg: string,
    opts?: {
      description?: string;
      action?: { label: string; onClick: () => void };
    },
  ) => void;
  info: (msg: string) => void;
  success: (msg: string) => void;
}

export type Translator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export interface HandleLlmErrorOptions {
  /**
   * Callback invoked when the user clicks the toast retry action.
   * Only attached when `LlmErrorInfo.retryable` is true.
   */
  onRetry?: () => void | Promise<void>;
  /** Skip the toast UI but still classify and return the info. */
  silent?: boolean;
  /** Extra diagnostic text placed under the toast body. */
  description?: string;
}

/**
 * Pure, dependency-injected error handler.  Exposed separately so
 * unit tests can assert behaviour without jsdom / RTL.
 */
export function handleLlmErrorImpl(
  err: unknown,
  t: Translator,
  toastImpl: ToastLike,
  options: HandleLlmErrorOptions = {},
): LlmErrorInfo {
  const info = classifyLlmError(err);
  if (options.silent) return info;

  const retry = options.onRetry;
  const canRetry = info.retryable && typeof retry === 'function';

  const runRetry = async (): Promise<void> => {
    toastImpl.info(t('llm.error.retryPending'));
    try {
      // SU-ITER-092-batch3 · A4-MEDIUM — `canRetry` (checked at the
      // call site below) guarantees `retry` is a function before
      // `runRetry` runs, but the type system can't follow that across
      // the closure.  A tight guard here replaces the previous
      // `retry!()` non-null assertion.
      if (typeof retry !== 'function') return;
      await retry();
      toastImpl.success(t('llm.error.retrySucceeded'));
    } catch (retryErr) {
      const retryInfo = classifyLlmError(retryErr);
      toastImpl.error(t(retryInfo.messageKey), {
        description: t('llm.error.retryFailed'),
      });
    }
  };

  toastImpl.error(t(info.messageKey), {
    description: options.description,
    action: canRetry
      ? {
          label: t('llm.error.retry'),
          onClick: () => {
            void runRetry();
          },
        }
      : undefined,
  });

  return info;
}

/**
 * React hook that wires `handleLlmErrorImpl` to sonner + the app's
 * i18n translator.  Components should destructure `handleError` and
 * call it inside their catch blocks.
 */
export function useLlmCall() {
  const t = useT();

  const handleError = useCallback(
    (err: unknown, options?: HandleLlmErrorOptions) => {
      return handleLlmErrorImpl(err, t, sonnerToast as unknown as ToastLike, options);
    },
    [t],
  );

  return { handleError };
}
