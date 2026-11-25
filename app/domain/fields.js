/** Reusable field parsers: raw value → `{ ok: true, value }` or `{ ok: false, reason }`. */
import { toIsoDate } from './dates.js';

const ok = (value) => ({ ok: true, value });
const fail = (reason) => ({ ok: false, reason });

const isMissing = (value) => value === undefined || value === null || (typeof value === 'string' && !value.trim());
/** A missing value gets one clear message instead of a parser-specific one. */
const required = (parser) => (value) => (isMissing(value) ? fail('is required') : parser(value));

export const requiredString = required((value) => (typeof value === 'string' ? ok(value.trim()) : fail('must be a string')));

// WHATWG "valid email" rule + RFC length limits; full RFC 5322 also allows undeliverable addresses.
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const email = required((value) => {
  if (typeof value !== 'string') return fail('must be a string');
  const trimmed = value.trim();
  const [local, domain] = trimmed.split('@');
  if (!EMAIL.test(trimmed) || local.length > 64 || trimmed.length > 254 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return fail(`"${value}" is not a valid email address`);
  }
  // The domain is case-insensitive; the local part may legally be case-sensitive, so it is kept.
  return ok(`${local}@${domain.toLowerCase()}`);
});

export const date = required((value) => {
  const iso = toIsoDate(value);
  return iso ? ok(iso) : fail(`"${value}" is not a recognizable date`);
});

/** "admin, editor" | ["viewer", " "] | "admin" | null → unique, trimmed, lower-case role names. */
export function roles(value) {
  if (value === null || value === undefined) return ok([]);
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || !list.every((r) => typeof r === 'string')) return fail('must be a comma-separated string or an array of strings');
  return ok([...new Set(list.map((r) => r.trim().toLowerCase()).filter(Boolean))]);
}

/** Wraps a parser so that an absent value (undefined/null) is allowed and omitted. */
export function optional(parser) {
  return (value) => (value === undefined || value === null ? ok(undefined) : parser(value));
}
