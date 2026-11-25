import { createHash } from 'node:crypto';
import { RejectCode } from './errors.js';

/**
 * @typedef {object} NormalizedEvent
 * @property {string} type
 * @property {string | null} eventId
 * @property {Record<string, unknown>} data     only the fields declared by the event type, normalized
 * @property {import('./event-types/define.js').EventType} definition
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} raw  one item of the incoming batch
 * @param {import('./event-types/index.js').Registry} registry
 * @returns {{ ok: true, event: NormalizedEvent, ignoredFields: string[] }
 *         | { ok: false, code: string, details: string[], type?: unknown, eventId?: unknown }}
 */
export function normalizeEvent(raw, registry) {
  if (!isPlainObject(raw)) return { ok: false, code: RejectCode.MALFORMED_EVENT, details: ['event is not an object'] };

  const { type, event_id: rawId, ...rest } = raw;
  if (typeof type !== 'string' || !type.trim()) {
    return { ok: false, code: RejectCode.MALFORMED_EVENT, details: ['"type" is missing'], eventId: rawId };
  }
  const definition = registry.get(type.trim());
  if (!definition) {
    return { ok: false, code: RejectCode.UNSUPPORTED_EVENT_TYPE, details: [`unknown type "${type}"`], type, eventId: rawId };
  }

  const details = [];
  let eventId = null;
  if (rawId !== undefined && rawId !== null) {
    if ((typeof rawId === 'string' && rawId.trim()) || (typeof rawId === 'number' && Number.isFinite(rawId))) eventId = String(rawId).trim();
    else details.push('event_id: must be a non-empty string or a number');
  }

  const data = {};
  for (const [name, parse] of Object.entries(definition.fields)) {
    const result = parse(rest[name]);
    if (!result.ok) details.push(`${name}: ${result.reason}`);
    else if (result.value !== undefined) data[name] = result.value;
  }
  if (details.length) return { ok: false, code: RejectCode.INVALID_FIELDS, details, type: definition.type, eventId: rawId };

  const ignoredFields = Object.keys(rest).filter((k) => !(k in definition.fields));
  return { ok: true, event: { type: definition.type, eventId, data, definition }, ignoredFields };
}

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Content fingerprint: equal for semantically identical events. */
export const fingerprint = (event) => sha256([event.type, event.data]);

/** `event_id` when present, else the content fingerprint (catches redeliveries without an id). */
export const idempotencyKey = (event) => (event.eventId !== null ? `id:${event.eventId}` : `sha256:${fingerprint(event)}`);
