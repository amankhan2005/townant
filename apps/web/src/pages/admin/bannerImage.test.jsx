import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BannerDropZone, BannerRequirements, bannerSizeProblem } from './BannerImage.jsx';

// jsdom can't decode images; stand in for the browser decoder with the size under test.
const decodeAs = (width, height) => {
  window.createImageBitmap = vi.fn(async () => ({ width, height, close() {} }));
};
afterEach(() => delete window.createImageBitmap);

const file = (name = 'banner.jpg', type = 'image/jpeg') => new File([new Uint8Array(2048)], name, { type });

describe('promotional banner image rules', () => {
  it('accepts 3:1 images (with a pixel of rounding) and explains anything else', () => {
    expect(bannerSizeProblem({ width: 1200, height: 400 })).toBeNull();
    expect(bannerSizeProblem({ width: 1800, height: 600 })).toBeNull();
    expect(bannerSizeProblem({ width: 1201, height: 400 })).toBeNull();
    expect(bannerSizeProblem({ width: 1000, height: 1000 })).toMatch(/1000 × 1000 px \(1\.00:1\).*3:1.*1200 × 400/);
    expect(bannerSizeProblem({ width: 400, height: 1200 })).toMatch(/0\.33:1/);
    expect(bannerSizeProblem({ width: 1920, height: 1080 })).toMatch(/1\.78:1/);
    expect(bannerSizeProblem({ width: 300, height: 100 })).toMatch(/minimum is 600 × 200/);
  });

  it('shows the requirements before any image is chosen', () => {
    render(<BannerRequirements maxBytes={5 * 1024 * 1024} />);
    expect(screen.getByText('Promotional banner requirements')).toBeInTheDocument();
    expect(screen.getByText('1200 × 400 px')).toBeInTheDocument();
    expect(screen.getByText(/^3:1/)).toBeInTheDocument();
    expect(screen.getByText('JPEG, PNG or WebP')).toBeInTheDocument();
    expect(screen.getByText(/5 MB/)).toBeInTheDocument();
  });

  it('refuses a wrongly shaped image before upload, whatever its name says, and offers a crop', async () => {
    decodeAs(760, 760);
    const onAccept = vi.fn();
    const { container } = render(<BannerDropZone onAccept={onAccept} />);
    await userEvent.upload(container.querySelector('input[type=file]'), file('banner-1200x400.jpg'));
    expect(await screen.findByText(/This image is 760 × 760 px/)).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Crop to 3:1' })).toBeInTheDocument();
  });

  it('passes a 3:1 image on for publishing', async () => {
    decodeAs(1200, 400);
    const onAccept = vi.fn();
    const { container } = render(<BannerDropZone onAccept={onAccept} />);
    await userEvent.upload(container.querySelector('input[type=file]'), file());
    await vi.waitFor(() => expect(onAccept).toHaveBeenCalled());
    expect(onAccept.mock.calls[0][1]).toMatchObject({ width: 1200, height: 400 });
  });

  it('rejects unsupported formats without decoding them', async () => {
    decodeAs(1200, 400);
    const onAccept = vi.fn();
    const { container } = render(<BannerDropZone onAccept={onAccept} />);
    const input = container.querySelector('input[type=file]');
    input.removeAttribute('accept');
    await userEvent.upload(input, file('banner.gif', 'image/gif'));
    expect(await screen.findByText('Choose a JPEG, PNG or WebP image.')).toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
