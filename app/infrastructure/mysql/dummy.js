/**
 * Simulated MySQL: the real adapter's statements and parameters, run against in-memory
 * tables. Module scope, so like a real database it survives warm Lambda invocations.
 */
import { idempotencyKey } from '../../domain/event.js';
import { SYSTEM_CREATOR, toNotificationRow } from '../../domain/notification.js';
import { CLAIM_EVENT, INSERT_NOTIFICATION, LINK_EVENT, notificationParams } from './statements.js';

const db = { Notification: [], ProcessedEvent: new Map(), autoIncrement: 0 };

/**
 * The dummy `insertToMySQL(event)` from the assignment. Async on purpose: same contract as a real DB call.
 * @param {import('../../domain/event.js').NormalizedEvent} event
 * @param {{ creator?: import('../../domain/notification.js').Creator,
 *   logger?: import('../../application/ports.js').Logger }} [options]  logger at DEBUG prints the SQL
 * @returns {Promise<{ notificationId: number } | { duplicate: true }>}
 */
export async function insertToMySQL(event, { creator = SYSTEM_CREATOR, logger } = {}) {
  const key = idempotencyKey(event);
  logger?.debug('SQL', { sql: CLAIM_EVENT, params: [key] });
  if (db.ProcessedEvent.has(key)) return { duplicate: true };

  const row = toNotificationRow(event, creator);
  logger?.debug('SQL', { sql: INSERT_NOTIFICATION, params: notificationParams(row) });
  const NotificationID = ++db.autoIncrement;
  db.Notification.push({ NotificationID, Created: new Date().toISOString(), ...row });

  logger?.debug('SQL', { sql: LINK_EVENT, params: [NotificationID, key] });
  db.ProcessedEvent.set(key, NotificationID);
  return { notificationId: NotificationID };
}

/**
 * @param {{ creator: import('../../domain/notification.js').Creator }} config
 * @returns {import('../../application/ports.js').NotificationRepository}
 */
export function createDummyRepository({ creator }) {
  return { name: 'dummy', save: (event, logger) => insertToMySQL(event, { creator, logger }) };
}

/** Test helpers. */
export const dummyRows = () => db.Notification.map((row) => ({ ...row }));
export function resetDummyDatabase() {
  db.Notification.length = 0;
  db.ProcessedEvent.clear();
  db.autoIncrement = 0;
}
