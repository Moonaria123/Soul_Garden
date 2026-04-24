'use client';

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { UserAccount } from '@/types';
import {
  hashPassword,
  initSession,
  clearSession,
  isSessionActive,
  exportDEKHex,
  importDEKFromHex,
} from '@/lib/crypto';
import * as dbClient from '@/lib/db/db-client';
import { DbClientError } from '@/lib/db/db-client';
import type { LoginMaterial, PublicAccount } from '@/lib/db/accounts-schema';
import { translate } from '@/lib/i18n';
import {
  validatePasswordStrength,
  type PasswordStrengthReason,
} from '@/lib/auth/password-strength';
import { mapLoginFlowError, mapOpenSessionError } from '@/lib/auth/login-error-map';

function isMigrationRequired(err: unknown): boolean {
  return err instanceof DbClientError && err.code === 'migration_required';
}

// Storage keys (SU-087)
const SS_USER_ID = 'su_userId';
const SS_LAST_ACTIVITY = 'su_lastActivity';
const SS_DEK_RAW = 'su_dek_raw';
// localStorage mirror — written by session-settings-store so the
// auth-store can consult it at login time (before db is unlocked).
const LS_PERSIST_DEK = 'su_persist_dek';

/**
 * SU-ITER-090a · P2-03 — XSS residual-risk notice.
 *
 * `su_dek_raw` stores the raw Client KEK hex in `sessionStorage` so the
 * user can refresh a logged-in tab without re-entering the password.
 * We evaluated removing this feature entirely and kept it for the
 * following reasons:
 *
 *   1. The feature is **opt-in**, default OFF, guarded by the
 *      `persistDEKThisTab` setting (see session-settings-card.tsx).
 *   2. The refresh-without-re-prompt UX is part of the SU-087 auto-logout
 *      contract — removing it forces a password prompt on every tab
 *      refresh, which we classified as a bigger usability regression
 *      than the residual XSS exposure.
 *   3. An attacker able to run arbitrary JavaScript in this origin
 *      already has in-memory access to the Client KEK (and therefore
 *      to every DB row) via the loaded WebCrypto key; stealing the
 *      sessionStorage copy is not materially worse than what they can
 *      already achieve.  The storage copy is a defence-in-depth *cost*,
 *      not the primary weakness.
 *   4. The sessionStorage entry is scoped to the tab and cleared on
 *      logout, on `persistDEKThisTab → false`, and on session TTL
 *      expiry (session-settings-store.ts, clearDEKPersistence).
 *
 * Mitigations we rely on and MUST keep working:
 *   - React output escaping (no `dangerouslySetInnerHTML` on untrusted
 *     text paths; markdown renderer configured with safe defaults).
 *   - CSP / response-header hardening (to be added in SU-092).
 *   - Explicit UI warning on the setting toggle (i18n
 *     `settings.session.persistTabRisk`).
 *
 * Escalation trigger: if SU-092 enables stricter CSP and we find the
 * refresh UX no longer needs this storage (e.g. httpOnly cookie-based
 * DEK refresh lands), this block MUST be reconsidered for removal.
 */
function shouldPersistDEK(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LS_PERSIST_DEK) === '1';
  } catch {
    return false;
  }
}

async function maybePersistDEK(): Promise<void> {
  if (!shouldPersistDEK()) return;
  try {
    const hex = await exportDEKHex();
    if (hex && typeof sessionStorage !== 'undefined') {
      // NOTE(SU-ITER-090a · P2-03): raw DEK hex — see XSS notice above.
      sessionStorage.setItem(SS_DEK_RAW, hex);
    }
  } catch (e) {
    console.warn('[auth] persist DEK failed:', e);
  }
}

function clearDEKPersistence(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SS_DEK_RAW);
  }
}

// ============================================================
// Auth Store — Zustand (FR-410)
// Pure SQLite architecture. Accounts in accounts.json,
// all other data in encrypted SQLite via db-client.
// ============================================================

interface AuthState {
  isAuthenticated: boolean;
  currentUser: UserAccount | null;
  isLoading: boolean;
  error: string | null;
  /**
   * SU-ITER-089 · P1-1 · B8-3.  Set to `{ userId, username }` when the
   * server reports the on-disk database is still v1 and needs a
   * dump-and-restore before the current login can proceed.  UI layer
   * should render MigrationWizard when this is non-null and clear it
   * via `clearMigrationRequirement()` once migration succeeds or is
   * cancelled.
   */
  migrationRequirement: {
    userId: string;
    username: string;
    password: string;
    /** From `session/open` 409 body when `reason` is set (e.g. auto-run v1→v2). */
    openReason?: string;
  } | null;

  register: (username: string, password: string, email?: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkExistingSession: () => Promise<boolean>;
  clearError: () => void;
  clearMigrationRequirement: () => void;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  isAuthenticated: false,
  currentUser: null,
  isLoading: false,
  error: null,
  migrationRequirement: null,

  register: async (username: string, password: string, email?: string) => {
    set({ isLoading: true, error: null });
    try {
      // SU-ITER-089 · P1-3 — belt-and-braces strength check.  The register
      // form already blocks weak passwords, but a tampered page or a
      // direct `useAuthStore.getState().register(...)` call would bypass
      // it.  Fail closed before we ever call `hashPassword`.
      const strength = validatePasswordStrength(password, { username });
      if (!strength.ok) {
        const reasonKeys: Record<PasswordStrengthReason, string> = {
          too_short: 'register.passwordWeak.too_short',
          not_enough_categories: 'register.passwordWeak.not_enough_categories',
          too_common: 'register.passwordWeak.too_common',
          equals_username: 'register.passwordWeak.equals_username',
        };
        set({
          isLoading: false,
          error: strength.reasons.map((r) => translate(reasonKeys[r])).join(' '),
        });
        return;
      }

      const existing = await dbClient.getAccount({ username });
      if (existing) {
        set({ isLoading: false, error: translate('auth.error.usernameTaken') });
        return;
      }

      const { hash, salt } = await hashPassword(password);
      const createdAt = new Date().toISOString();
      const account: UserAccount = {
        id: uuid(),
        username,
        passwordHash: hash,
        salt,
        email,
        failedAttempts: 0,
        lockUntil: null,
        createdAt,
      };

      try {
        // SU-088 · P0-D: only send the strict create-whitelist fields;
        // server initialises failedAttempts / lockUntil itself.  We
        // reference the local `hash` / `salt` rather than `account.*`
        // because those fields are now optional on `UserAccount`
        // (Stage B Gate · R-C5) — here we're still inside the register
        // frame so the bindings are guaranteed present.
        await dbClient.putAccount({
          id: account.id,
          username: account.username,
          passwordHash: hash,
          salt,
          email: account.email,
          createdAt: account.createdAt,
        });
      } catch (err) {
        // SU-088 · P0-A (option C): single-user-mode rejection surfaces as 409.
        if (err instanceof DbClientError && err.code === 'single_user_mode') {
          set({ isLoading: false, error: translate('auth.error.singleUserMode') });
          return;
        }
        throw err;
      }
      // SU-ITER-089 · P1-1 · B8-2: server derives the DB DEK and returns
      // `salt` in the response; we only need the salt for the Client KEK.
      let openResult: { salt: string };
      try {
        openResult = await dbClient.openSession(account.id, password);
      } catch (err) {
        // Post-registration verify should always succeed; surface a
        // meaningful error if it doesn't instead of a blank session.
        set({ isLoading: false, error: mapOpenSessionError(err) });
        return;
      }
      await initSession(password, openResult.salt);

      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SS_LAST_ACTIVITY, Date.now().toString());
        sessionStorage.setItem(SS_USER_ID, account.id);
      }
      await maybePersistDEK();

      set({ isAuthenticated: true, currentUser: account, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: translate('auth.error.registerUnexpected') });
      console.error('Registration error:', e);
    }
  },

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      // SU-088 · P0-B / SU-ITER-089 · P1-1 · B8-4.
      //
      // The username-lookup now returns the minimum login-gate surface
      // only (id + lockUntil).  Everything else — salt (moved to
      // server-side DEK derivation), failedAttempts (internal), email
      // (PII) — is no longer shipped to the browser on this path.
      const loginMaterial = (await dbClient.getAccount({ username })) as LoginMaterial | null;
      if (!loginMaterial) {
        set({ isLoading: false, error: translate('auth.error.invalidCredentials') });
        return;
      }

      // Surface a currently active lockout immediately so the user does
      // not re-trigger a server round-trip just to be told again.
      if (loginMaterial.lockUntil) {
        const lockUntil = Date.parse(loginMaterial.lockUntil);
        if (Number.isFinite(lockUntil) && Date.now() < lockUntil) {
          const remainingMin = Math.ceil((lockUntil - Date.now()) / 60000);
          set({ isLoading: false, error: translate('auth.error.tryLaterMinutes', { minutes: remainingMin }) });
          return;
        }
      }

      // SU-ITER-089 · P1-1 · B8-2: session/open v2 returns `{ token, salt }`;
      // we use that salt (instead of a stored `account.salt`) for Client
      // KEK derivation so the login path stays single-source-of-truth.
      let openResult: { salt: string };
      try {
        openResult = await dbClient.openSession(loginMaterial.id, password);
      } catch (err) {
        // SU-ITER-089 · P1-1 · B8-3: if the server detects a v1 database
        // that still needs migration it returns 409 migration_required.
        // Pivot the UI into the upgrade wizard instead of showing a
        // login-style error.  We stash the (already-verified-by-the-user)
        // credentials so the wizard can reuse them without re-prompting;
        // they are cleared as soon as the wizard finishes or is cancelled.
        if (isMigrationRequired(err)) {
          await dbClient.closeSession().catch(() => {});
          const openReason =
            err instanceof DbClientError &&
            err.data &&
            typeof (err.data as { reason?: unknown }).reason === 'string'
              ? (err.data as { reason: string }).reason
              : undefined;
          set({
            isLoading: false,
            error: null,
            currentUser: null,
            migrationRequirement: {
              userId: loginMaterial.id,
              // `username` here is the form input — server no longer
              // echoes it back on the username-lookup path (B8-4).
              username,
              password,
              ...(openReason ? { openReason } : {}),
            },
          });
          return;
        }
        set({ isLoading: false, error: mapOpenSessionError(err), currentUser: null });
        return;
      }

      // Server-side verify succeeded — safe to initialise the in-memory Client KEK.
      // Trim in case accounts.json salt was accidentally saved with surrounding whitespace.
      await initSession(password, openResult.salt.trim());

      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SS_LAST_ACTIVITY, Date.now().toString());
        sessionStorage.setItem(SS_USER_ID, loginMaterial.id);
      }
      await maybePersistDEK();

      // Fetch the public profile (id/username/email/createdAt) to populate
      // `currentUser`.  This lookup is keyed by id, so the server returns
      // PublicAccount — no salt/hash leakage.
      const profile = (await dbClient.getAccount({ id: loginMaterial.id })) as PublicAccount | null;
      if (!profile) {
        // Extremely unlikely — account existed for username lookup but
        // vanished between calls.  Fail closed.
        set({ isLoading: false, error: translate('auth.error.loginUnexpected') });
        return;
      }

      // Assemble the UserAccount shape the rest of the app expects.
      // `passwordHash` / `salt` are intentionally omitted — they were
      // made optional on UserAccount (2026-04-19, Stage B Gate · R-C5)
      // so the client-side `currentUser` never has to carry stale or
      // empty sensitive material.
      const currentUser: UserAccount = {
        id: profile.id,
        username: profile.username,
        email: profile.email,
        createdAt: profile.createdAt,
        failedAttempts: 0,
        lockUntil: null,
      };

      set({ isAuthenticated: true, currentUser, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: mapLoginFlowError(e), currentUser: null });
      console.error('Login error:', e);
    }
  },

  logout: () => {
    clearSession();
    dbClient.closeSession().catch(() => {});
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(SS_LAST_ACTIVITY);
      sessionStorage.removeItem(SS_USER_ID);
    }
    clearDEKPersistence();
    set({ isAuthenticated: false, currentUser: null, error: null });
  },

  // SU-087: resilient refresh.
  // Rebuild auth state without requiring the in-memory DEK.
  //   1) Try to restore DEK from sessionStorage (if user opted into "Remember this tab").
  //   2) Verify the server-side DB session via getSessionStatus (httpOnly cookie).
  //   3) Load the account by id and mark the user authenticated.
  // DEK may still be null when this returns true; callers that need it
  // should go through requireDEK() which prompts re-unlock on demand.
  checkExistingSession: async () => {
    if (typeof sessionStorage === 'undefined') return false;

    const userId = sessionStorage.getItem(SS_USER_ID);
    if (!userId) return false;

    // Best-effort DEK restore (opt-in only).
    if (!isSessionActive()) {
      const dekHex = sessionStorage.getItem(SS_DEK_RAW);
      if (dekHex) {
        try {
          await importDEKFromHex(dekHex);
        } catch (e) {
          console.warn('[auth] DEK restore failed; clearing persisted copy:', e);
          sessionStorage.removeItem(SS_DEK_RAW);
        }
      }
    }

    try {
      const { active } = await dbClient.getSessionStatus();
      if (!active) return false;
      // SU-ITER-089 · P1-1 · B8-4: id-path returns PublicAccount;
      // compose a UserAccount shell for the rest of the app.
      const profile = (await dbClient.getAccount({ id: userId })) as PublicAccount | null;
      if (!profile) return false;
      const currentUser: UserAccount = {
        id: profile.id,
        username: profile.username,
        email: profile.email,
        createdAt: profile.createdAt,
        failedAttempts: 0,
        lockUntil: null,
      };
      set({ isAuthenticated: true, currentUser });
      return true;
    } catch {
      return false;
    }
  },

  clearError: () => set({ error: null }),

  clearMigrationRequirement: () => set({ migrationRequirement: null }),
}));
