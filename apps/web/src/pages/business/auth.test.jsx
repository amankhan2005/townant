import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffLogin } from './Auth.jsx';

const apiMock = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: (...args) => apiMock(...args) }));
const signedIn = vi.fn();
vi.mock('../../lib/auth.jsx', () => ({ useAuth: () => ({ user: null, mfaRequired: false, signedIn, refresh: vi.fn() }) }));

const apiError = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

async function submit() {
  render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <StaffLogin area="admin" />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Email/), 'admin@townant.test');
  await user.type(screen.getByLabelText(/Password/), 'a-password-for-tests');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  apiMock.mockReset();
  signedIn.mockReset();
});

describe('Super Admin sign-in page', () => {
  it('says a code follows the password', () => {
    render(
      <MemoryRouter>
        <StaffLogin area="admin" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/confirm with a six-digit code sent to your email/)).toBeInTheDocument();
  });

  it('shows the generic message for wrong credentials', async () => {
    apiMock.mockRejectedValueOnce(apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'));
    await submit();
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('tells the user how long to wait after too many attempts', async () => {
    apiMock.mockRejectedValueOnce(apiError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes and try again.', { retryAfter: 420 }));
    await submit();
    expect(await screen.findByText('Too many sign-in attempts. Please wait a few minutes and try again. You can try again in 7 minutes.')).toBeInTheDocument();
  });

  it('asks for the emailed code after a correct password', async () => {
    apiMock.mockResolvedValueOnce({ data: { user: { role: 'super_admin' }, mfaRequired: true, mfa: { challengeId: 'c'.repeat(32), maskedDestination: 'a***@townant.test' } } });
    await submit();
    expect(await screen.findByLabelText('Code')).toBeInTheDocument();
    expect(screen.getByText('Enter the code we emailed to a***@townant.test.')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/staff-auth/login', { method: 'POST', body: { email: 'admin@townant.test', password: 'a-password-for-tests' } });
  });
});
