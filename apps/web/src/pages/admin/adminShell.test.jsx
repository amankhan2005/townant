import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import AdminApp from './AdminApp.jsx';

vi.mock('../../lib/auth.jsx', () => ({ useAuth: () => ({ user: { role: 'super_admin', displayName: 'Ada Admin', email: 'ada@townant.test' }, loading: false, mfaRequired: false, logout: vi.fn() }) }));
vi.mock('../../lib/hooks.js', () => ({ useApi: () => ({ data: null, meta: null, error: null, loading: true, reload: vi.fn(), setData: vi.fn() }), useDocumentTitle: () => {} }));

const at = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Super Admin shell', () => {
  it('marks only the current section as active, including on detail pages', () => {
    at('/admin/companies/abc123');
    const nav = screen.getAllByRole('navigation', { name: 'Admin' })[0];
    const active = within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(active.map((a) => a.textContent)).toEqual(['Companies']);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/admin/companies');
  });

  it('marks the dashboard active on the admin root, with or without a trailing slash', () => {
    for (const path of ['/admin', '/admin/']) {
      const { unmount } = at(path);
      const nav = screen.getAllByRole('navigation', { name: 'Admin' })[0];
      expect(within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['Dashboard']);
      unmount();
    }
  });

  it('does not light up the dashboard on other routes', () => {
    at('/admin/categories');
    const nav = screen.getAllByRole('navigation', { name: 'Admin' })[0];
    expect(within(nav).getByRole('link', { name: /Dashboard/ })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: /Categories/ })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the account menu with profile and sign-out actions', async () => {
    at('/admin');
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Profile & security/ })).toHaveAttribute('href', '/admin/account');
    expect(within(menu).getByRole('menuitem', { name: /Sign out/ })).toBeInTheDocument();
  });

  it('opens and closes the mobile drawer with Escape', async () => {
    at('/admin');
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Admin menu' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Admin menu' })).toBeNull());
  });
});
