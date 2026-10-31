import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui.jsx';
import { Field } from '../ui/field.jsx';
import { NewTicketForm } from './Support.jsx';

const apiMock = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: (...args) => apiMock(...args) }));

function renderForm() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/support/new']}>
        <Routes>
          <Route path="/support/new" element={<NewTicketForm apiBase="/support" linkBase="/support" />} />
          <Route path="/support/:id" element={<p>Ticket page</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('form fields', () => {
  it('announces required fields, hints and errors to assistive technology', () => {
    render(
      <Field label="Subject" required hint="A few words" error="Add a subject">
        {(id, a11y) => <input id={id} {...a11y} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Subject/ });
    expect(input).toHaveAccessibleName('Subject');
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Add a subject A few words');
  });
});

describe('support request form', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => {
      if (path === '/support/categories') return { data: ['account', 'booking', 'other'] };
      throw new Error(`unexpected ${path}`);
    });
  });

  it('shows inline errors and sends nothing while invalid', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Choose what your request is about.')).toBeInTheDocument();
    expect(screen.getByText(/Add a short subject/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Subject/ })).toHaveAttribute('aria-invalid', 'true');
    expect(apiMock.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(0);
  });

  it('keeps what was typed after a server error and only navigates once the API confirms', async () => {
    const user = userEvent.setup();
    let fail = true;
    apiMock.mockImplementation(async (path, opts) => {
      if (path === '/support/categories') return { data: ['account', 'booking', 'other'] };
      if (path === '/support/tickets' && opts.method === 'POST') {
        if (fail) {
          fail = false;
          throw Object.assign(new Error('Too many requests. Please wait a moment.'), { status: 429 });
        }
        return { data: { id: 'abc', reference: 'SUP-ABC234' } };
      }
      throw new Error(`unexpected ${path}`);
    });
    renderForm();
    await waitFor(() => expect(screen.getByRole('button', { name: /What is this about/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /What is this about/ }));
    await user.click(await screen.findByRole('option', { name: 'A booking or appointment' }));
    await user.type(screen.getByRole('textbox', { name: /Subject/ }), 'Wrong time on booking');
    await user.type(screen.getByRole('textbox', { name: /Describe the issue/ }), 'The booking shows 3 PM but I chose 2 PM.');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('Too many requests. Please wait a moment.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Subject/ })).toHaveValue('Wrong time on booking');
    expect(screen.queryByText('Ticket page')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.getByText('Ticket page')).toBeInTheDocument());
    const post = apiMock.mock.calls.find(([p, o]) => p === '/support/tickets' && o.method === 'POST');
    expect(post[1].body).toEqual({ category: 'booking', subject: 'Wrong time on booking', body: 'The booking shows 3 PM but I chose 2 PM.' });
  });
});
