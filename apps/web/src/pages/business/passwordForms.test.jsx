import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForcedPasswordChange } from './PasswordForms.jsx';

const apiMock = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: (...args) => apiMock(...args) }));
const refresh = vi.fn();
vi.mock('../../lib/auth.jsx', () => ({ useAuth: () => ({ user: { email: 'owner@vendor.test', passwordChangeRequired: true }, refresh, logout: vi.fn() }) }));

beforeEach(() => apiMock.mockReset());

describe('first sign-in with a temporary password', () => {
  it('requires a valid, confirmed new password before submitting', async () => {
    render(<ForcedPasswordChange />);
    const user = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save and continue' });
    await user.type(screen.getByLabelText(/Temporary password/), 'Temp1234abcdXYZ9');
    await user.type(screen.getByLabelText(/^New password/), 'my own long secret 9');
    await user.type(screen.getByLabelText(/Confirm new password/), 'my own long secret 8');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText(/Confirm new password/));
    await user.type(screen.getByLabelText(/Confirm new password/), 'my own long secret 9');
    expect(save).toBeEnabled();
    apiMock.mockResolvedValueOnce({ data: { message: 'Password changed.', user: { passwordChangeRequired: false } } });
    await user.click(save);
    expect(apiMock).toHaveBeenCalledWith('/staff-auth/password/change', { method: 'POST', body: { currentPassword: 'Temp1234abcdXYZ9', newPassword: 'my own long secret 9', confirmPassword: 'my own long secret 9' } });
    expect(refresh).toHaveBeenCalled();
  });
});
