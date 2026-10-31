import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.jsx';
import Home from './Home.jsx';

let responses;
let authState = { user: null, mfaRequired: false };
vi.mock('../../lib/auth.jsx', () => ({ useAuth: () => authState }));
vi.mock('../../lib/hooks.js', () => ({
  useApi: (path) => ({ data: responses[path] ?? null, meta: null, error: null, loading: false, reload: vi.fn() }),
  useDocumentTitle: () => {},
  usePageMeta: () => {},
}));
vi.mock('../../lib/favorites.js', () => ({ useFavorites: () => ({ ids: new Set(), toggle: vi.fn() }) }));
vi.mock('../../lib/api.js', () => ({ api: vi.fn(async () => ({ data: [] })) }));

const company = (i) => ({ id: `c${i}`, slug: `shop-${i}`, name: `Shop ${i}`, category: { name: 'Cleaning' }, rating: { average: 0, count: 0 }, location: { city: 'Austin' }, serviceMode: 'fixed', isNew: true });
const banner = { image: { url: 'https://res.cloudinary.com/demo/image/upload/b.jpg', width: 1200, height: 400 }, alt: 'Spring', title: null, description: null, link: null };

beforeEach(() => {
  authState = { user: null, mfaRequired: false };
  responses = {
    '/catalog/site': { hero: null, banner },
    '/catalog/categories': [
      { id: 'a', name: 'Cleaning', slug: 'cleaning', parentId: null, icon: 'sparkles', image: null },
      { id: 'b', name: 'Deep clean', slug: 'deep-clean', parentId: 'a', icon: null, image: null },
      { id: 'c', name: 'Pet Care', slug: 'pet-care', parentId: null, icon: 'paw-print', image: null },
    ],
    '/catalog/spotlight': [],
    '/catalog/most-booked': [],
    '/catalog/companies': [company(1), company(2)],
  };
});

const show = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Home />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('public homepage', () => {
  it('shows the prominent search and only real top-level categories, in API order', () => {
    show();
    expect(screen.getAllByRole('search', { name: 'Find a local service' }).length).toBeGreaterThan(0);
    const band = screen.getByRole('region', { name: 'Explore services by category' });
    const tiles = within(band).getAllByRole('link').filter((a) => a.getAttribute('href').startsWith('/search?category='));
    expect(tiles.map((a) => a.textContent)).toEqual(['Cleaning', 'Pet Care']);
    expect(within(band).getByRole('link', { name: /All categories/ })).toHaveAttribute('href', '/categories');
  });

  it('places the published banner directly after “New and noteworthy” and omits it when there is none', () => {
    const { container, unmount } = show();
    const sections = [...container.querySelectorAll('section')].filter((s) => !s.parentElement.closest('section'));
    const names = sections.map((s) => s.getAttribute('aria-label') || s.querySelector('h1, h2')?.textContent.trim());
    expect(names[names.indexOf('New and noteworthy') + 1]).toBe('Promotion');
    expect(screen.getByRole('img', { name: 'Spring' })).toHaveClass('aspect-[3/1]');
    unmount();
    responses['/catalog/site'] = { hero: null, banner: null };
    show();
    expect(screen.queryByRole('region', { name: 'Promotion' })).toBeNull();
  });

  it('shows no invented figures on business cards', () => {
    show();
    // The section and its carousel share the name; the outer one holds the cards.
    const [row] = screen.getAllByRole('region', { name: 'New and noteworthy' });
    expect(within(row).getAllByText(/No reviews yet/).length).toBe(2);
    expect(row.textContent).not.toMatch(/\$|%|★\s*\d/);
  });
});

describe('homepage hero', () => {
  it('uses the hero image record, never the promotional banner', () => {
    responses['/catalog/site'] = { hero: { image: { url: 'https://res.cloudinary.com/demo/image/upload/hero.jpg', width: 1600, height: 1200 }, alt: 'A cleaner at work', focal: { x: 50, y: 50 } }, banner };
    show();
    const heroImg = within(screen.getByRole('region', { name: /Find local/ })).getByRole('img', { name: 'A cleaner at work' });
    expect(heroImg.getAttribute('src')).toContain('hero.jpg');
    expect(heroImg.getAttribute('src')).not.toContain('b.jpg');
  });

  it('falls back to the bundled photo (not the banner) when no hero is published', () => {
    responses['/catalog/site'] = { hero: null, banner };
    show();
    const heroImg = within(screen.getByRole('region', { name: /Find local/ })).getAllByRole('img')[0];
    expect(heroImg.getAttribute('src')).toMatch(/\/images\/hero\/sofa-phone-/);
  });

  it('offers the in-place hero editor only to a verified Super Admin', () => {
    show();
    expect(screen.queryByRole('button', { name: /Edit hero image/ })).toBeNull();
    authState = { user: { role: 'customer' }, mfaRequired: false };
    show();
    expect(screen.queryByRole('button', { name: /Edit hero image/ })).toBeNull();
    authState = { user: { role: 'super_admin' }, mfaRequired: true };
    show();
    expect(screen.queryByRole('button', { name: /Edit hero image/ })).toBeNull();
    authState = { user: { role: 'super_admin' }, mfaRequired: false };
    show();
    expect(screen.getByRole('button', { name: /Edit hero image/ })).toBeInTheDocument();
  });
});
