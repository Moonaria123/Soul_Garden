/**
 * Maps login-related failures (openSession + surrounding flow) to user-facing i18n strings.
 * Keeps {@link DbClientError} codes in sync with `/api/db/*` route handlers.
 */
import { DbClientError } from '@/lib/db/db-client';
import { translate } from '@/lib/i18n';

function appendDevDetail(base: string, data: Record<string, unknown>): string {
  if (
    process.env.NODE_ENV === 'development' &&
    typeof data.detail === 'string' &&
    data.detail.length > 0
  ) {
    return `${base}\n[dev] ${data.detail.trim().slice(0, 800)}`;
  }
  return base;
}

/**
 * Maps structured `session/open` failures to localized messages.
 */
export function mapOpenSessionError(err: unknown): string {
  if (!(err instanceof DbClientError)) {
    return translate('auth.error.loginUnexpected');
  }
  const { code, data, status } = err;
  const remaining = typeof data.remaining === 'number' ? data.remaining : undefined;
  const remainingMinutes = typeof data.remainingMinutes === 'number' ? data.remainingMinutes : undefined;
  const retryAfterSec = typeof data.retryAfterSec === 'number' ? data.retryAfterSec : undefined;

  switch (code) {
    case 'invalid_credentials':
      return typeof remaining === 'number' && remaining > 0
        ? translate('auth.error.passwordAttempts', { remaining })
        : translate('auth.error.invalidCredentials');
    case 'account_locked':
      return typeof remainingMinutes === 'number'
        ? translate('auth.error.tryLaterMinutes', { minutes: remainingMinutes })
        : translate('auth.error.accountLocked');
    case 'single_user_mode':
      return translate('auth.error.singleUserMode');
    case 'rate_limited':
      return typeof retryAfterSec === 'number'
        ? translate('auth.error.loginRateLimited', { seconds: retryAfterSec })
        : translate('auth.error.loginRateLimitedGeneric');
    case 'verify_failed':
      return translate('auth.error.loginVerifyFailed');
    case 'derive_failed':
      return translate('auth.error.loginDeriveFailed');
    case 'database_locked':
      return translate('auth.error.loginDbLocked');
    case 'database_corrupt':
      return translate('auth.error.loginDbCorrupt');
    case 'database_io_denied':
      return translate('auth.error.loginDbIoDenied');
    case 'database_decrypt_failed':
      return translate('auth.error.loginDbDecryptFailed');
    case 'Failed to open database':
      return appendDevDetail(
        translate('auth.error.loginDbOpenFailed'),
        data,
      );
    case 'accounts_write_failed':
      return appendDevDetail(translate('auth.error.loginAccountsWriteFailed'), data);
    case 'session_open_uncaught':
      return appendDevDetail(translate('auth.error.loginSessionOpenUncaught'), data);
    default:
      if (typeof code === 'string' && code.startsWith('http_')) {
        return translate('auth.error.loginHttpError', { status: String(status) });
      }
      return appendDevDetail(translate('auth.error.loginUnexpected'), data);
  }
}

/**
 * Maps any error thrown during the full login flow (username lookup, session/open,
 * client KEK init, profile fetch) to a localized message.
 */
export function mapLoginFlowError(err: unknown): string {
  if (err instanceof DbClientError) {
    return mapOpenSessionError(err);
  }

  if (
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  ) {
    return translate('auth.error.loginTimeout');
  }

  if (err instanceof TypeError) {
    const m = String(err.message);
    if (/fetch|network|Failed to fetch|Load failed|NETWORK_ERROR/i.test(m)) {
      return translate('auth.error.loginNetwork');
    }
  }

  if (err instanceof Error && /Invalid salt hex/i.test(err.message)) {
    return translate('auth.error.loginSaltInvalid');
  }

  return translate('auth.error.loginUnexpected');
}
