/**
 * Contracts the use case depends on; adapters in infrastructure/ implement them.
 *
 * @typedef {object} NotificationRepository
 * @property {string} name
 * @property {(event: import('../domain/event.js').NormalizedEvent, logger?: Logger) =>
 *   Promise<{ notificationId: number } | { duplicate: true }>} save
 *   Must be idempotent: an event whose idempotency key was already stored returns `{ duplicate: true }`.
 *
 * @typedef {Record<'debug' | 'info' | 'warn' | 'error', (msg: string, fields?: object) => void>} Logger
 */

export {};
