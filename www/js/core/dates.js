// Small date helpers. All dates are handled as UTC calendar days so results
// never shift with the phone's time zone.
export const DAY_MS = 86400000;

/** 'YYYY-MM-DD' -> integer day number (days since 1970-01-01, UTC). */
export function toDay(s) {
  return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS);
}

/** integer day number -> 'YYYY-MM-DD'. */
export function fromDay(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** today as an integer day number (UTC). */
export function todayDay() {
  return Math.floor(Date.now() / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

/** 12345 -> '6 Jan 2024' */
export function fmtDay(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 12345 -> 'Jan 2024' */
export function fmtMonth(n) {
  const d = new Date(n * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function monthShort(m) { return MONTHS[m]; }

/** day number -> { y, m (0-11), d, doy (0-365) } */
export function parts(n) {
  const d = new Date(n * DAY_MS);
  const y = d.getUTCFullYear();
  const doy = Math.round((n * DAY_MS - Date.UTC(y, 0, 1)) / DAY_MS);
  return { y, m: d.getUTCMonth(), d: d.getUTCDate(), doy };
}

/** day number -> decimal year, e.g. 2024.5 */
export function decimalYear(n) {
  const p = parts(n);
  return p.y + p.doy / 365.25;
}
