/**
 * Use case: normalize → deduplicate → store, in input order (so "first one wins" is
 * deterministic). A bad or failing event never stops the rest.
 */
import { fingerprint, idempotencyKey, normalizeEvent } from '../domain/event.js';

export const Status = Object.freeze({ STORED: 'stored', DUPLICATE: 'duplicate', REJECTED: 'rejected', FAILED: 'failed' });

/**
 * @param {{ events: unknown[], registry: import('../domain/event-types/index.js').Registry,
 *   repository: import('./ports.js').NotificationRepository, logger: import('./ports.js').Logger }} args
 */
export async function processEvents({ events, registry, repository, logger }) {
  const seen = new Map(); // key → first occurrence in this batch
  const results = [];
  const totals = { [Status.STORED]: 0, [Status.DUPLICATE]: 0, [Status.REJECTED]: 0, [Status.FAILED]: 0 };
  const record = (result) => {
    results.push(result);
    totals[result.status] += 1;
  };

  for (const [index, raw] of events.entries()) {
    const normalized = normalizeEvent(raw, registry);
    if (!normalized.ok) {
      const { code, details, type, eventId } = normalized;
      logger.warn('event rejected', { index, type, eventId, error: code, details });
      record({ index, type, eventId, status: Status.REJECTED, error: code, details });
      continue;
    }

    const { event, ignoredFields } = normalized;
    const ref = { index, type: event.type, eventId: event.eventId };
    if (ignoredFields.length) logger.debug('unknown fields ignored', { ...ref, ignoredFields });

    const key = idempotencyKey(event);
    const print = fingerprint(event);
    const first = seen.get(key);
    if (first) {
      // First occurrence wins. A different payload under the same id is a producer bug worth flagging.
      const conflict = first.fingerprint !== print;
      logger[conflict ? 'warn' : 'info']('duplicate event skipped', { ...ref, firstIndex: first.index, conflict });
      record({ ...ref, status: Status.DUPLICATE, duplicateOf: first.index, conflict });
      continue;
    }
    seen.set(key, { index, fingerprint: print });

    try {
      const saved = await repository.save(event, logger);
      if (saved.duplicate) {
        // Already stored by an earlier invocation (e.g. a queue redelivery).
        logger.info('duplicate event skipped', { ...ref, alreadyStored: true });
        record({ ...ref, status: Status.DUPLICATE, alreadyStored: true });
      } else {
        logger.info('event stored', { ...ref, notificationId: saved.notificationId });
        record({ ...ref, status: Status.STORED, notificationId: saved.notificationId, data: event.data });
      }
    } catch (error) {
      // Storage errors are usually transient (connection, deadlock): safe to retry later.
      seen.delete(key);
      logger.error('event storage failed', { ...ref, error: error.message });
      record({ ...ref, status: Status.FAILED, error: 'storage_failed', details: [error.message], retryable: true });
    }
  }

  return {
    received: events.length,
    stored: totals[Status.STORED],
    duplicates: totals[Status.DUPLICATE],
    rejected: totals[Status.REJECTED],
    failed: totals[Status.FAILED],
    results,
  };
}
