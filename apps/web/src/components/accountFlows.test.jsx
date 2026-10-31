import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OtpSignIn } from './OtpSignIn.jsx';
import { ToastProvider } from './ui.jsx';

const apiMock = vi.fn();
vi.mock('../lib/api.js', () => ({ api: (...args) => apiMock(...args) }));
const signedIn = vi.fn();
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => ({ user: null, channels: { email: true, whatsapp: false }, signedIn, refresh: vi.fn() }) }));

const apiError = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });

async function enterCode() {
  const onDone = vi.fn();
  render(
    <MemoryRouter>
      <ToastProvider>
        <OtpSignIn onDone={onDone} />
      </ToastProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  apiMock.mockResolvedValueOnce({ data: { challengeId: 'c'.repeat(32), maskedDestination: 'a***@example.com', resendAvailableAt: new Date(Date.now() + 60000).toISOString() } });
  await user.type(screen.getByLabelText(/Email address/), 'alice@example.com');
  await user.click(screen.getByRole('button', { name: 'Send code' }));
  await user.type(await screen.findByLabelText(/Verification code/), '123456');
  return { user, onDone };
}

beforeEach(() => {
  apiMock.mockReset();
  signedIn.mockReset();
});

describe('signing in to an account pending deletion', () => {
  it('offers a restore only after a correct code, and restores only on confirmation', async () => {
    const { user, onDone } = await enterCode();
    apiMock.mockRejectedValueOnce(apiError(409, 'ACCOUNT_PENDING_DELETION', 'This account is scheduled for deletion.', { restoreToken: 't'.repeat(43), recoverUntil: '2026-11-13T12:00:00.000Z' }));
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByRole('heading', { name: 'This account is scheduled for deletion' })).toBeInTheDocument();
    expect(screen.getByText(/permanently deleted on 11\/13\/2026/)).toBeInTheDocument();
    expect(signedIn).not.toHaveBeenCalled();

    apiMock.mockResolvedValueOnce({ data: { user: { id: 'u1', role: 'customer' }, csrfToken: 'x', restored: true } });
    await user.click(screen.getByRole('button', { name: 'Restore my account' }));
    expect(apiMock).toHaveBeenLastCalledWith('/auth/account/restore', { method: 'POST', body: { restoreToken: 't'.repeat(43), confirm: 'RESTORE' } });
    expect(signedIn).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ id: 'u1', role: 'customer' });
  });

  it('a wrong code shows the error and never offers a restore', async () => {
    const { user } = await enterCode();
    apiMock.mockRejectedValueOnce(apiError(400, 'OTP_INVALID', 'That code is incorrect or has expired.'));
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(await screen.findByText('That code is incorrect or has expired.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore my account' })).toBeNull();
  });

  it('declining leaves the deletion scheduled and returns to sign-in', async () => {
    const { user } = await enterCode();
    apiMock.mockRejectedValueOnce(apiError(409, 'ACCOUNT_PENDING_DELETION', 'Scheduled.', { restoreToken: 't'.repeat(43) }));
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it scheduled for deletion' }));
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith('/auth/account/restore', expect.anything());
  });
});
