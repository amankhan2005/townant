import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePageMeta } from './hooks.js';

function Page(props) {
  usePageMeta(props);
  return null;
}

describe('usePageMeta', () => {
  it('sets the description, social tags and a canonical URL without tracking parameters', () => {
    window.history.replaceState(null, '', '/search?category=cleaning&q=deep&utm_source=x');
    render(<Page title="Cleaning" description="Find and book cleaning businesses on TownAnt." keep={['category']} />);
    expect(document.head.querySelector('meta[name="description"]').content).toBe('Find and book cleaning businesses on TownAnt.');
    expect(document.head.querySelector('link[rel="canonical"]').href).toBe(`${window.location.origin}/search?category=cleaning`);
    expect(document.head.querySelector('meta[property="og:title"]').content).toBe('Cleaning · TownAnt');
  });

  it('falls back to the site description', () => {
    window.history.replaceState(null, '', '/');
    render(<Page />);
    expect(document.head.querySelector('meta[name="description"]').content).toMatch(/find trusted local services/i);
    expect(document.head.querySelector('link[rel="canonical"]').href).toBe(`${window.location.origin}/`);
  });
});
