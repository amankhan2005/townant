import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.jsx';
import HeroEditor from './HeroEditor.jsx';

const uploadForm = vi.fn();
vi.mock('../../lib/upload.js', () => ({
  uploadForm: (...args) => uploadForm(...args),
  prepareImage: async (file) => ({ file, bytes: file.size, originalBytes: file.size, resized: false }),
  formatBytes: (n) => `${n} B`,
}));

beforeEach(() => {
  uploadForm.mockReset();
  URL.createObjectURL ??= () => 'blob:preview';
  URL.revokeObjectURL ??= () => {};
});

const setup = () => {
  const onPublished = vi.fn();
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <HeroEditor hero={null} onPublished={onPublished} onClose={onClose} />
    </ToastProvider>,
  );
  return { onPublished, onClose };
};

const choose = async () => {
  const input = document.querySelector('input[type=file]');
  await userEvent.upload(input, new File([new Uint8Array(1024)], 'hero.jpg', { type: 'image/jpeg' }));
};

describe('homepage hero editor', () => {
  it('publishes through the hero endpoint only, with the description, and reports success after the API saves', async () => {
    const { onPublished, onClose } = setup();
    await choose();
    const publish = screen.getByRole('button', { name: 'Publish to homepage' });
    expect(publish).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Image description/), { target: { value: 'A cleaner wiping a kitchen counter' } });
    const published = { image: { url: 'https://res.cloudinary.com/x/hero.jpg' }, alt: 'A cleaner wiping a kitchen counter', focal: { x: 50, y: 50 } };
    uploadForm.mockResolvedValueOnce({ data: { hero: { published } } });
    await userEvent.click(publish);
    const [path, form] = uploadForm.mock.calls[0];
    expect(path).toBe('/admin/site/hero/draft');
    expect(form.get('publish')).toBe('true');
    expect(form.get('alt')).toBe('A cleaner wiping a kitchen counter');
    expect(onPublished).toHaveBeenCalledWith(published);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the real error when the upload fails', async () => {
    const { onPublished, onClose } = setup();
    await choose();
    fireEvent.change(screen.getByLabelText(/Image description/), { target: { value: 'Kitchen' } });
    uploadForm.mockRejectedValueOnce(Object.assign(new Error("The image couldn't be uploaded right now. Nothing was changed — please try again."), { status: 502, code: 'UPLOAD_FAILED' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish to homepage' }));
    // Generous wait: the full suite runs files in parallel and can be slow on a busy machine.
    expect(await screen.findByText(/Nothing was changed/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(onPublished).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
