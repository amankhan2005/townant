// Fails if user-facing code formats dates outside @townant/shared (which always prints
// MM/DD/YYYY). Lines may opt out with a trailing "// date-format-ok: <reason>" comment.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['apps/web/src', 'apps/mobile/app', 'apps/mobile/src', 'apps/api/src'];
const RULES = [
  [/toLocale(Date|Time)String\(/, 'Use formatDate/formatTime from @townant/shared'],
  [/new Date\([^)]*\)\.toLocaleString\(/, 'Use formatDateTime from @townant/shared'],
  [/\.toLocaleString\(\)/, 'Locale-dependent output; use shared date helpers or toLocaleString("en-US") for numbers'],
  [/Intl\.DateTimeFormat/, 'Date formatting belongs in packages/shared/src/dates.js'],
  [/toISOString\(\)\.slice\(0,\s*10\)/, 'Use todayIso/isoDateInZone (time-zone aware) from @townant/shared'],
  [/type="(date|time|datetime-local)"/, 'Use DatePicker / time Select; native inputs follow the OS locale'],
  [/\.toFormat\(/, 'Luxon formatting in user-facing text; use @townant/shared'],
  [/(>|^)\s*\{[\w.?]*\.date\}/, 'Raw ISO date rendered as JSX text; wrap with formatIsoDate()'],
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) files.push(p);
  }
};
SCAN.forEach((d) => walk(join(ROOT, d)));

const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('date-format-ok')) return;
      for (const [re, why] of RULES) if (re.test(line)) problems.push(`${relative(ROOT, file)}:${i + 1}  ${why}\n    ${line.trim().slice(0, 140)}`);
    });
}
if (problems.length) {
  console.error(`Date format check failed (${problems.length}):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Date format check passed: ${files.length} files scanned.`);
