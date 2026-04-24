// SU-ITER-089 · P1-3 · Password strength validation for the registration
// and change-password flows.
//
// The server only ever sees an Argon2id hash (the plaintext never leaves
// the client).  That makes server-side strength enforcement impossible
// without weakening the protocol, so this check lives at both:
//   1. the register / change-password React form (immediate feedback); and
//   2. the auth store `register` / `changePassword` actions (defence in
//      depth against a tampered form).
//
// Rules chosen to satisfy the report's P1-3 brief without being hostile:
//  - Minimum length: 10 (up from 8).  At 10 chars an Argon2id m=64MB
//    t=3 attacker needs ~10^12 guesses even with a narrow character set,
//    which matches our threat assumption of local + single-user.
//  - Character diversity: at least 3 of {lower, upper, digit, symbol}.
//  - Reject the most common passwords that show up in every credential
//    stuffing list so a distracted user cannot accidentally pick them.
//  - Reject passwords that are just the username (with optional digits).
//
// Output shape is deliberately `{ ok, reasons }` instead of throwing,
// so the UI can render multiple bullet points at once.

export const MIN_PASSWORD_LENGTH = 10;
export const MIN_CATEGORIES = 3;

export type PasswordStrengthReason =
  | 'too_short'
  | 'not_enough_categories'
  | 'too_common'
  | 'equals_username';

export interface PasswordStrengthOk {
  ok: true;
}

export interface PasswordStrengthFailure {
  ok: false;
  reasons: PasswordStrengthReason[];
}

export type PasswordStrengthResult = PasswordStrengthOk | PasswordStrengthFailure;

// Curated from the public SecLists top-100 + vendor breach lists.  Kept
// short so the check stays O(1) and the list is auditable at a glance.
// Case-insensitive match.
const COMMON_PASSWORDS = new Set(
  [
    'password', 'password1', 'password123', 'passw0rd',
    '12345678', '123456789', '1234567890',
    'qwertyuiop', 'qwerty123', 'qwertyui',
    'letmein123', 'welcome123', 'admin1234', 'administrator',
    'iloveyou123', '1q2w3e4r5t', '1qaz2wsx3edc',
    'abc12345', 'abcdefgh', 'monkey123',
    'changeme1', 'default1234', 'password!1',
  ].map((p) => p.toLowerCase()),
);

function countCategories(password: string): number {
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  // Anything that is not alnum and not whitespace counts as a symbol.
  // Whitespace-only passwords are rejected by length anyway, but treating
  // space as non-symbol avoids encouraging `"          "` as "strong".
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);
  return (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSymbol ? 1 : 0);
}

function isDerivedFromUsername(password: string, username: string): boolean {
  if (!username || username.length < 2) return false;
  const p = password.toLowerCase();
  const u = username.toLowerCase();
  // Match "username", "username123", "username!", or "123username".
  return p === u || p.startsWith(u) || p.endsWith(u);
}

export interface ValidatePasswordOptions {
  username?: string;
}

/**
 * Evaluate password strength.  Returns `{ ok: true }` if every rule
 * passes, otherwise a stable list of machine-readable reasons for the
 * UI to translate into human-friendly bullets.
 */
export function validatePasswordStrength(
  password: string,
  options: ValidatePasswordOptions = {},
): PasswordStrengthResult {
  const reasons: PasswordStrengthReason[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    reasons.push('too_short');
  }

  if (countCategories(password) < MIN_CATEGORIES) {
    reasons.push('not_enough_categories');
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    reasons.push('too_common');
  }

  if (options.username && isDerivedFromUsername(password, options.username)) {
    reasons.push('equals_username');
  }

  if (reasons.length === 0) {
    return { ok: true };
  }
  return { ok: false, reasons };
}
