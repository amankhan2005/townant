import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui.jsx';
import PublicLayout from './PublicLayout.jsx';

let authState;
vi.mock('../lib/auth.jsx', () => ({ useAuth: () => authState }));
vi.mock('../lib/api.js', () => ({ api: vi.fn(async (path) => ({ data: path === '/notifications/unread-count' ? { unread: 2 } : [] })) }));
vi.mock('../components/Assistant.jsx', () => ({ AssistantLauncher: () => null }));

// Every route the header and menu link to exists in App.jsx.
const KNOWN = ['/', '/search', '/categories', '/join', '/favorites', '/notifications', '/bookings', '/messages', '/support', '/account', '/login'];

const show = (path = '/categories') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="*" element={<p>page</p>} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  authState = { user: null, logout: vi.fn() };
});

describe('public navbar', () => {
  it('links only to real destinations', () => {
    show();
    const header = screen.getByRole('banner');
    for (const a of within(header).getAllByRole('link')) expect(KNOWN).toContain(new URL(a.getAttribute('href'), 'http://x').pathname);
    // jsdom ignores the responsive classes, so all three links are in the DOM.
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Explore', 'Categories', 'For businesses']);
  });

  it('opens an accessible phone menu that closes on Escape and after navigating', async () => {
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    for (const a of within(menu).getAllByRole('link')) expect(KNOWN).toContain(new URL(a.getAttribute('href'), 'http://x').pathname);
    expect(within(menu).getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login?next=%2Fcategories');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(within(await screen.findByRole('navigation', { name: 'Menu' })).getByRole('link', { name: /Explore services/ }));
    await vi.waitFor(() => expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull());
  });

  it('gives signed-in customers their account links and sign-out in the menu', async () => {
    const logout = vi.fn();
    authState = { user: { role: 'customer', displayName: 'Alice' }, logout };
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    expect(within(menu).getByRole('link', { name: /My bookings/ })).toHaveAttribute('href', '/bookings');
    expect(within(menu).queryByRole('link', { name: /Sign in/ })).toBeNull();
    await user.click(within(menu).getByRole('button', { name: /Sign out/ }));
    expect(logout).toHaveBeenCalled();
  });
});
