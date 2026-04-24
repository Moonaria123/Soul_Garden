/**
 * @vitest-environment jsdom
 *
 * SU-ITER-092-batch2 · RTL smoke for `AccountSecurityCard`.
 *
 * Scope: the card exposes the Stage B `changePassword` server route
 * behind a dialog.  We verify the dialog opens on click, all three
 * password inputs render, and the submit button is kept disabled until
 * every client-side pre-condition (presence + strength + match +
 * differs-from-current) is satisfied.  We do *not* fire the real
 * `dbClient.changePassword` — the whole point of this smoke is to lock
 * in the gating behaviour above the network boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      currentUser: { id: 'u1', username: 'alice' },
      logout: vi.fn(),
    }),
}));

vi.mock('@/lib/db/db-client', () => ({
  changePassword: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AccountSecurityCard } from './account-security-card';

describe('<AccountSecurityCard />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the dialog and keeps submit disabled until all three fields + strength + match pass', async () => {
    const user = userEvent.setup();
    render(<AccountSecurityCard />);

    // Entry point button renders (i18n key fallback is rendered literally —
    // that's fine, we look up by role, not by text).
    const triggers = screen.getAllByRole('button');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    await user.click(triggers[0]);

    // Dialog is open: all three password inputs are present.
    const passwordInputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(passwordInputs).toHaveLength(3);
    const [currentInput, newInput, confirmInput] = Array.from(passwordInputs);

    // Submit button disabled when inputs are empty — target by the
    // rendered zh-CN label (default locale in a fresh jsdom session).
    const submitBtn = screen.getByRole('button', { name: '更新密码' });
    expect(submitBtn).toBeDisabled();

    // A weak new password (too short) should keep submit disabled.
    await user.type(currentInput, 'OldPassw0rd!');
    await user.type(newInput, 'abc');
    await user.type(confirmInput, 'abc');
    expect(submitBtn).toBeDisabled();

    // Strong new password but mismatched confirm → still disabled.
    await user.clear(newInput);
    await user.clear(confirmInput);
    await user.type(newInput, 'BrandNewPass42!');
    await user.type(confirmInput, 'BrandNewPass43!');
    expect(submitBtn).toBeDisabled();

    // Strong + matching + differs from current → enabled.
    await user.clear(confirmInput);
    await user.type(confirmInput, 'BrandNewPass42!');
    expect(submitBtn).not.toBeDisabled();
  });
});
