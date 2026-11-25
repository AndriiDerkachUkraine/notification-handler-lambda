/**
 * @typedef {(value: unknown) => ({ ok: true, value: unknown } | { ok: false, reason: string })} FieldParser
 *
 * @typedef {object} EventType
 * @property {string} type                          value of the `type` field in incoming events
 * @property {number} notificationTypeId            row in the NotificationType table
 * @property {Record<string, FieldParser>} fields   every field the type keeps; anything else is dropped
 */

/** Validates a definition at load time, so a typo fails at startup rather than on the first event. */
export function defineEventType(definition) {
  const { type, notificationTypeId, fields } = definition;
  if (typeof type !== 'string' || !/^[a-z][a-z0-9_]*$/.test(type)) throw new Error(`invalid event type name: ${type}`);
  if (!Number.isInteger(notificationTypeId) || notificationTypeId < 1 || notificationTypeId > 255) {
    throw new Error(`${type}: notificationTypeId must fit TINYINT UNSIGNED (1-255)`);
  }
  if (!fields || !Object.values(fields).length || !Object.values(fields).every((f) => typeof f === 'function')) {
    throw new Error(`${type}: fields must map names to parser functions`);
  }
  return Object.freeze({ type, notificationTypeId, fields: Object.freeze({ ...fields }) });
}
