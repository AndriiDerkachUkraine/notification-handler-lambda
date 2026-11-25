/** Event type registry. A new type = one file in this folder + one line in DEFAULT_TYPES. */
import passwordReset from './password-reset.js';
import userDeleted from './user-deleted.js';
import userRegistered from './user-registered.js';

const DEFAULT_TYPES = [userRegistered, passwordReset, userDeleted];

/**
 * @typedef {{ get(type: string): import('./define.js').EventType | undefined,
 *   all(): import('./define.js').EventType[] }} Registry
 */

/**
 * @param {import('./define.js').EventType[]} types
 * @returns {Registry}
 */
export function createRegistry(types) {
  const byName = new Map();
  const ids = new Set();
  for (const t of types) {
    if (byName.has(t.type)) throw new Error(`duplicate event type: ${t.type}`);
    if (ids.has(t.notificationTypeId)) throw new Error(`duplicate notificationTypeId: ${t.notificationTypeId}`);
    byName.set(t.type, t);
    ids.add(t.notificationTypeId);
  }
  return {
    get: (type) => byName.get(type),
    all: () => [...byName.values()],
  };
}

export const defaultRegistry = createRegistry(DEFAULT_TYPES);
