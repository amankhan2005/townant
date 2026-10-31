import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.jsx';
import { ColumnChart, DataPanel, DonutChart, ExportButton, KpiCard, PanelEmpty, statusLabel, StatusPill, TrendChart } from './kit.jsx';

const downloadMock = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: vi.fn(), downloadFile: (...args) => downloadMock(...args) }));
import { ADMIN_BOOKING_LABELS, describeAudit } from './labels.js';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('admin status vocabulary', () => {
  it('labels only states that exist in the data model, with readable fallbacks', () => {
    expect(statusLabel('company', 'published')).toBe('Live');
    expect(statusLabel('application', 'info_requested')).toBe('Info requested');
    expect(statusLabel('account', 'some_new_state')).toBe('some new state');
    render(<StatusPill kind="company" status="suspended" />);
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('names who cancelled a booking instead of "you"', () => {
    expect(ADMIN_BOOKING_LABELS.cancelled_by_vendor).toBe('Cancelled by business');
    expect(ADMIN_BOOKING_LABELS.cancelled_by_admin).toBe('Cancelled by TownAnt');
  });

  it('describes audit actions in plain language', () => {
    expect(describeAudit('company.suspend')).toBe('Business suspended');
    expect(describeAudit('vendor_application.request_info')).toBe('Application more information requested');
    expect(describeAudit('site.hero_publish')).toBe('Homepage hero publish');
  });
});

describe('KpiCard', () => {
  it('shows the real value and links to the filtered list with an accessible name', () => {
    wrap(<KpiCard label="Live businesses" value={7} hint="2 draft" to="/admin/companies?status=published" />);
    const link = screen.getByRole('link', { name: 'Live businesses: 7. View' });
    expect(link).toHaveAttribute('href', '/admin/companies?status=published');
  });

  it('never shows a number while loading or after an error', () => {
    const { container, rerender } = wrap(<KpiCard label="Customers" value={null} loading />);
    expect(container.textContent).not.toMatch(/\d/);
    rerender(
      <MemoryRouter>
        <KpiCard label="Customers" value={null} error />
      </MemoryRouter>,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('DataPanel', () => {
  const rows = (data) => <ul>{data.map((r) => <li key={r.id}>{r.name}</li>)}</ul>;

  it('renders loading, error with retry, empty and data states from a useApi result', async () => {
    const reload = vi.fn();
    const { rerender } = wrap(<DataPanel state={{ data: null, error: null, reload }}>{rows}</DataPanel>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading table');

    rerender(<MemoryRouter><DataPanel state={{ data: null, error: { message: 'Nope' }, reload }}>{rows}</DataPanel></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalled();

    rerender(<MemoryRouter><DataPanel state={{ data: [], error: null, reload }} empty={<PanelEmpty title="No companies yet" />}>{rows}</DataPanel></MemoryRouter>);
    expect(screen.getByText('No companies yet')).toBeInTheDocument();

    rerender(<MemoryRouter><DataPanel state={{ data: [{ id: 1, name: 'Northside' }], meta: { total: 1, page: 1, pages: 1 }, error: null, reload }} filters={<span>filters</span>}>{rows}</DataPanel></MemoryRouter>);
    expect(screen.getByText('Northside')).toBeInTheDocument();
    expect(screen.getByText('1 result')).toBeInTheDocument();
  });
});

describe('TrendChart', () => {
  it('states plainly when no events were recorded instead of drawing a flat placeholder', () => {
    render(<TrendChart label="Events" days={['2026-10-01', '2026-10-02']} series={[{ key: 'a', label: 'Profile views', color: '#147D73', values: [0, 0] }]} />);
    expect(screen.getByText('No events recorded in this period yet.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Events' })).not.toBeInTheDocument();
  });
});

describe('DonutChart and ColumnChart', () => {
  it('prints every value and share in the legend, with the total in the middle', () => {
    wrap(<DonutChart label="Businesses by status" items={[{ label: 'Live', value: 3, color: '#000' }, { label: 'Draft', value: 1, color: '#111', to: '/admin/companies?status=draft' }]} />);
    expect(screen.getByRole('img', { name: 'Businesses by status: Live 3, Draft 1' })).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Draft/ })).toHaveAttribute('href', '/admin/companies?status=draft');
  });

  it('shows an explicit empty state instead of a zero-height chart', () => {
    render(<DonutChart label="x" items={[{ label: 'Live', value: 0, color: '#000' }]} emptyLabel="No businesses yet." />);
    expect(screen.getByText('No businesses yet.')).toBeInTheDocument();
    render(<ColumnChart label="New customers per day" days={['2026-10-01']} values={[0]} />);
    expect(screen.getByText('Nothing recorded in this period yet.')).toBeInTheDocument();
  });
});

describe('ExportButton', () => {
  it('downloads the server export with the current filters and reports the row count', async () => {
    downloadMock.mockResolvedValueOnce({ name: 'townant-companies-10-29-2026.xlsx', rows: 42, total: 42, truncated: false });
    render(
      <ToastProvider>
        <ExportButton path="/admin/companies/export" query={{ status: 'published', q: 'clean' }} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
    expect(downloadMock).toHaveBeenCalledWith('/admin/companies/export', expect.objectContaining({ query: { status: 'published', q: 'clean' } }));
    expect(await screen.findByText('Exported 42 rows to townant-companies-10-29-2026.xlsx')).toBeInTheDocument();
  });

  it('shows the API error when an export fails', async () => {
    downloadMock.mockRejectedValueOnce(Object.assign(new Error('Too many exports. Please wait a few minutes and try again.'), { status: 429 }));
    render(
      <ToastProvider>
        <ExportButton path="/admin/categories/export" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));
    expect(await screen.findByText('Too many exports. Please wait a few minutes and try again.')).toBeInTheDocument();
  });
});
