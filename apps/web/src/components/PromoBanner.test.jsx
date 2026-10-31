import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PromoBanner } from './PromoBanner.jsx';

const image = { url: 'https://res.cloudinary.com/demo/image/upload/townant/platform/site/banner/a.jpg', width: 1600, height: 400 };
const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('PromoBanner', () => {
  it('renders nothing until a banner is published', () => {
    const { container } = wrap(<PromoBanner banner={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an image-only banner with no empty text area, a reserved 3:1 frame and responsive sources', () => {
    const { container } = wrap(<PromoBanner banner={{ image, alt: 'Spring cleaning', title: null, description: null, link: null }} />);
    const img = screen.getByRole('img', { name: 'Spring cleaning' });
    expect(img).toHaveAttribute('srcset', expect.stringContaining('w_1920,c_limit'));
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveClass('aspect-[3/1]', 'object-cover');
    expect(img).toHaveAttribute('width', '1200');
    expect(img).toHaveAttribute('height', '400');
    expect(container.querySelector('h2')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('makes the whole image the link when there is no button text', () => {
    wrap(<PromoBanner banner={{ image, alt: '', title: null, description: null, link: { url: '/search?category=cleaning', label: null } }} />);
    expect(screen.getByRole('link', { name: 'Promotion' })).toHaveAttribute('href', '/search?category=cleaning');
  });

  it('shows title, text and an external button that opens safely', () => {
    wrap(<PromoBanner banner={{ image, alt: '', title: 'New in town', description: 'Meet local pros.', link: { url: 'https://example.com/x', label: 'Learn more' } }} />);
    expect(screen.getByRole('heading', { name: 'New in town' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Learn more/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('removes itself if the image fails to load', () => {
    const { container } = wrap(<PromoBanner banner={{ image, alt: 'x', title: null, description: null, link: null }} />);
    fireEvent.error(screen.getByRole('img'));
    expect(container).toBeEmptyDOMElement();
  });
});
