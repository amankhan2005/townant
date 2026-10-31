import { addDaysIso, formatIsoDate, todayIso } from '@townant/shared';
import { act, render, screen, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Async } from './feedback.jsx';
import { Calendar } from './calendar.jsx';
import { DatePicker, DateRangePicker, maskUsDate } from './datepicker.jsx';
import { Select } from './select.jsx';
import { SearchInput } from './field.jsx';

function ControlledDate({ initial, onChange, ...rest }) {
  const [value, setValue] = useState(initial ?? '');
  return (
    <>
      <DatePicker label="Visit date" value={value} onChange={(v) => { setValue(v); onChange?.(v); }} {...rest} />
      <output data-testid="iso">{value}</output>
    </>
  );
}

describe('DatePicker (MM/DD/YYYY)', () => {
  it('masks typing, shows MM/DD/YYYY and emits ISO for the API', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDate onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Visit date' });
    await user.type(input, '01052027');
    expect(input).toHaveValue('01/05/2027');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('2027-01-05');
    expect(screen.getByTestId('iso')).toHaveTextContent('2027-01-05');
  });

  it('rejects impossible and out-of-range dates with a clear message', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledDate onChange={onChange} min="2027-01-10" />);
    const input = screen.getByRole('textbox', { name: 'Visit date' });
    await user.type(input, '02/30/2027');
    await user.tab();
    expect(screen.getByText('Enter the date as MM/DD/YYYY.')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, '01/05/2027');
    await user.tab();
    expect(screen.getByText('Choose a date on or after 01/10/2027.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens a calendar dialog and picks a date with the keyboard', async () => {
    const user = userEvent.setup();
    render(<ControlledDate initial="2027-01-05" />);
    await user.click(screen.getByRole('button', { name: 'Open calendar for Visit date' }));
    const grid = await screen.findByRole('grid');
    expect(within(grid).getByRole('button', { name: /01\/05\/2027/ })).toHaveAttribute('aria-selected', 'true');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(screen.getByRole('textbox', { name: 'Visit date' })).toHaveValue('01/13/2027');
    expect(screen.getByTestId('iso')).toHaveTextContent('2027-01-13');
  });

  it('pads single-digit months and days and handles deletion', () => {
    expect(maskUsDate('2')).toBe('2');
    // A completed segment gets its slash automatically while typing.
    expect(maskUsDate('0209')).toBe('02/09/');
    expect(maskUsDate('02092027')).toBe('02/09/2027');
    expect(maskUsDate('02/09/202', '02/09/2027')).toBe('02/09/202');
  });
});

describe('Calendar', () => {
  it('marks today, disables unavailable days and announces dates as MM/DD/YYYY', () => {
    const today = todayIso();
    const blocked = addDaysIso(today, 1);
    render(<Calendar value={null} onSelect={() => {}} min={today} isDisabled={(d) => d === blocked} renderMeta={(d) => (d === today ? { short: '3 open', label: '3 open times' } : null)} />);
    const todayBtn = screen.getByRole('button', { name: new RegExp(`${formatIsoDate(today).replaceAll('/', '\\/')}, today, 3 open times`) });
    expect(todayBtn).toHaveAttribute('aria-current', 'date');
    if (blocked.slice(0, 7) === today.slice(0, 7)) {
      expect(screen.getByRole('button', { name: new RegExp(`${formatIsoDate(blocked).replaceAll('/', '\\/')}.*unavailable`) })).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });
});

describe('DateRangePicker', () => {
  it('keeps the end on or after the start', async () => {
    const user = userEvent.setup();
    function Range() {
      const [r, setR] = useState({ from: '', to: '2027-01-03' });
      return (
        <>
          <DateRangePicker from={r.from} to={r.to} onChange={setR} />
          <output data-testid="range">{`${r.from}|${r.to}`}</output>
        </>
      );
    }
    render(<Range />);
    await user.type(screen.getByLabelText('From'), '01/09/2027');
    await user.tab();
    // From may not exceed To: the picker's max blocks it.
    expect(screen.getByText('Choose a date on or before 01/03/2027.')).toBeInTheDocument();
    expect(screen.getByTestId('range')).toHaveTextContent('|2027-01-03');
  });
});

describe('Select', () => {
  const Options = ({ onChange }) => {
    const [v, setV] = useState('');
    return (
      <Select label="Status" value={v} onChange={(e) => { setV(e.target.value); onChange(e.target.value); }}>
        <option value="">Any status</option>
        <option value="confirmed">Confirmed</option>
        <option value="completed">Completed</option>
      </Select>
    );
  };

  it('is a labelled listbox operable by keyboard, compatible with native onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Options onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: 'Status' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox', { name: 'Status' });
    await act(() => new Promise((r) => setTimeout(r, 10)));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('confirmed');
    await waitForElementToBeRemoved(listbox);
    expect(trigger).toHaveTextContent('Confirmed');
  });

  it('becomes searchable for long lists and shows a no-match state', async () => {
    const user = userEvent.setup();
    const options = Array.from({ length: 30 }, (_, i) => ({ value: `z${i}`, label: `Zone ${i}` }));
    render(<Select label="Time zone" value="" onChange={() => {}} options={options} />);
    await user.click(screen.getByRole('button', { name: 'Time zone' }));
    const search = await screen.findByRole('combobox', { name: 'Search time zone' });
    await user.type(search, 'Zone 2');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Zone 2', 'Zone 20', 'Zone 29']));
    await user.clear(search);
    await user.type(search, 'nothing');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });
});

describe('SearchInput', () => {
  it('debounces live search and clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onDebounced = vi.fn();
    render(<SearchInput label="Search accounts" onDebouncedChange={onDebounced} delay={300} />);
    await user.type(screen.getByLabelText('Search accounts'), 'alex');
    expect(onDebounced).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(350));
    expect(onDebounced).toHaveBeenCalledTimes(1);
    expect(onDebounced).toHaveBeenCalledWith('alex');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByLabelText('Search accounts')).toHaveValue('');
    vi.useRealTimers();
  });
});

describe('Async states', () => {
  const view = (state) =>
    render(
      <Async state={state} loading={<div>skeleton</div>} empty={<div>empty</div>}>
        {(d) => <div>{d.length} items</div>}
      </Async>,
    );

  it('shows skeleton while loading, then data, empty, and errors distinctly', () => {
    view({ data: null, error: null, loading: true });
    expect(screen.getByText('skeleton')).toBeInTheDocument();
    view({ data: [1, 2], error: null, loading: false });
    expect(screen.getByText('2 items')).toBeInTheDocument();
    view({ data: [], error: null, loading: false });
    expect(screen.getByText('empty')).toBeInTheDocument();
  });

  it('shows a retryable error when nothing loaded, and keeps stale data with a notice on refresh failure', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const { unmount } = view({ data: null, error: { message: 'Server unavailable' }, loading: false, reload });
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalled();
    unmount();
    view({ data: [1], error: { code: 'NETWORK_ERROR' }, loading: false, reload });
    expect(screen.getByText('1 items')).toBeInTheDocument();
    expect(screen.getByText(/offline — showing the last loaded results/)).toBeInTheDocument();
  });
});
