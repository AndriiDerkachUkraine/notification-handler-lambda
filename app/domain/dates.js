/**
 * Strict date parser → ISO 8601 (UTC); zone-less values are UTC. Not `Date.parse`: it is
 * engine-specific and silently "fixes" invalid input (2021-02-30 → March 2).
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Only unambiguous, widely used abbreviations; minutes east of UTC.
const ZONES = {
  Z: 0, UTC: 0, GMT: 0,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  CET: 60, CEST: 120, EET: 120, EEST: 180,
};

const TIME = String.raw`(?:[T\s,]+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?\s*([AaPp][Mm])?)?`;
const ZONE = String.raw`\s*(Z|[+-]\d{2}(?::?\d{2})?|[A-Za-z]{2,5})?`;

const NUMERIC = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}${ZONE}$`);
// "April 5th, 2021 13:45 PST", optionally with a weekday: "Monday, April 5, 2021"
const MONTH_FIRST = new RegExp(String.raw`^(?:([A-Za-z]+),?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${TIME}${ZONE}$`);
// "5th April 2021 10:00 CET"
const DAY_FIRST = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})${TIME}${ZONE}$`);

/** Full name or an abbreviation of 3+ letters ("Sept", "Mon") → index in `names`, or -1. */
function nameIndex(names, name) {
  const lower = name.toLowerCase();
  return lower.length < 3 ? -1 : names.findIndex((n) => n.startsWith(lower));
}

function month(name) {
  const index = nameIndex(MONTHS, name);
  return index === -1 ? null : index + 1;
}

/** "+02:00" | "+0200" | "-05" | "PST" | "Z" → minutes east of UTC; undefined = no zone; null = unknown zone. */
function zoneOffset(token) {
  if (!token) return undefined;
  const numeric = token.match(/^([+-])(\d{2}):?(\d{2})?$/);
  if (numeric) return (numeric[1] === '-' ? -1 : 1) * (Number(numeric[2]) * 60 + Number(numeric[3] ?? 0));
  return ZONES[token.toUpperCase()] ?? null;
}

function build(y, mo, d, h = '0', mi = '0', s = '0', ms = '0', meridiem, zone) {
  let hour = Number(h);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null; // "13:45 PM" is contradictory
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  const offset = zoneOffset(zone);
  if (offset === null || mo === null) return null;

  const [year, monthNo, day, minute, second] = [Number(y), Number(mo), Number(d), Number(mi), Number(s)];
  if (hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, monthNo - 1, day, hour, minute, second, Number(ms.padEnd(3, '0')));
  // Reject overflow such as Feb 30 instead of rolling it into March.
  const check = new Date(local);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== monthNo - 1 || check.getUTCDate() !== day) return null;
  return new Date(local - (offset ?? 0) * 60_000);
}

/**
 * @param {unknown} value  string in a supported format, or a Unix timestamp (seconds or ms)
 * @returns {string | null} ISO 8601 in UTC, or null if the value is not an unambiguous date
 */
export function toIsoDate(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10}(\d{3})?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n < 1e11 ? n * 1000 : n).toISOString();
  }
  if (typeof value !== 'string') return null;

  const text = value.trim().replace(/\s+/g, ' ');
  let m;
  let date = null;
  if ((m = text.match(NUMERIC))) date = build(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9]);
  else if ((m = text.match(MONTH_FIRST))) {
    const [, weekday, monthName, day, year, ...time] = m;
    date = build(year, month(monthName), day, ...time);
    // "Tuesday, June 7, 2021" contradicts itself (June 7 was a Monday): rejected, not guessed.
    if (date && weekday && nameIndex(WEEKDAYS, weekday) !== new Date(Date.UTC(Number(year), month(monthName) - 1, Number(day))).getUTCDay()) {
      date = null;
    }
  }
  else if ((m = text.match(DAY_FIRST))) date = build(m[3], month(m[2]), m[1], m[4], m[5], m[6], m[7], m[8], m[9]);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}
