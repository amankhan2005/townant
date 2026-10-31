import writeExcelFile from 'write-excel-file/node';

// Super Admin spreadsheet exports (.xlsx). Built on the server from the same filters as the list
// screens, so an export contains every matching record rather than the page on screen, and only
// data the admin API already exposes. Large exports are capped; the response says when it was.
export const EXPORT_MAX_ROWS = 10000;
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADER = { fontWeight: 'bold', backgroundColor: '#E8EEF4', textColor: '#14243A', bottomBorderStyle: 'thin', bottomBorderColor: '#CDD5DF' };

// Calendar date of an instant in UTC, as an Excel date shown MM/DD/YYYY (the project convention).
const utcDay = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// Spreadsheet apps execute cells that start with = + - @ (and tab/CR) as formulas. Exported text
// comes from users (business names, reasons), so such values are prefixed with an apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;
export const safeText = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  return FORMULA_START.test(s) ? `'${s}` : s;
};

function cell(column, row) {
  const raw = column.value(row);
  if (raw === null || raw === undefined || raw === '') return null;
  // Columns without a declared type (e.g. a summary's mixed "Value" column) take the value's own type.
  const type = column.type ?? (raw instanceof Date ? 'date' : typeof raw === 'number' ? 'number' : typeof raw === 'boolean' ? 'boolean' : 'string');
  if (type === 'date') {
    const day = utcDay(raw);
    return day ? { value: day, type: Date, format: 'mm/dd/yyyy' } : null;
  }
  if (type === 'number') return typeof raw === 'number' && Number.isFinite(raw) ? { value: raw, type: Number, format: column.format ?? '#,##0' } : null;
  if (type === 'boolean') return { value: raw ? 'Yes' : 'No', type: String };
  return { value: safeText(raw), type: String };
}

// sheets: [{ name, columns: [{ header, width, type?, value(row) }], rows }]
export async function buildWorkbook(sheets) {
  const data = sheets.map((s) => ({
    sheet: s.name.slice(0, 31),
    columns: s.columns.map((c) => ({ width: c.width ?? Math.min(48, Math.max(12, c.header.length + 4)) })),
    stickyRowsCount: 1,
    data: [s.columns.map((c) => ({ value: c.header, type: String, ...HEADER })), ...s.rows.map((r) => s.columns.map((c) => cell(c, r)))],
  }));
  return writeExcelFile(data, { fontFamily: 'Calibri', fontSize: 11 }).toBuffer();
}

// Safe download name: report slug plus the export date, e.g. townant-companies-10-29-2026.xlsx.
export function exportFilename(report, now = new Date()) {
  const slug = report.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `townant-${slug}-${mm}-${dd}-${now.getUTCFullYear()}.xlsx`;
}

export async function sendWorkbook(res, report, sheets, { truncated = false, total } = {}) {
  const buffer = await buildWorkbook(sheets);
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(report)}"`);
  res.setHeader('X-Export-Rows', String(sheets[0]?.rows.length ?? 0));
  if (total !== undefined) res.setHeader('X-Export-Total', String(total));
  if (truncated) res.setHeader('X-Export-Truncated', 'true');
  res.send(buffer);
}
