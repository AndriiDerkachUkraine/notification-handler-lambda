/**
 * Real MySQL adapter (optional). Key claim + insert run in one transaction,
 * so even a concurrent redelivery cannot create a second row.
 */
import { idempotencyKey } from '../../domain/event.js';
import { toNotificationRow } from '../../domain/notification.js';
import { CLAIM_EVENT, INSERT_NOTIFICATION, LINK_EVENT, notificationParams } from './statements.js';

/**
 * @param {{ url: string, creator: import('../../domain/notification.js').Creator }} options
 * @returns {Promise<import('../../application/ports.js').NotificationRepository & { close(): Promise<void> }>}
 */
export async function createMysqlRepository({ url, creator }) {
  if (!url) throw new Error('NOTIFICATION_STORE=mysql requires MYSQL_URL, e.g. mysql://app:app@localhost:3307/notifications');
  const mysql = await import('mysql2/promise');
  // Small pool: one Lambda container handles one batch at a time.
  /** @type {import('mysql2/promise').Pool} promise API (the IDE otherwise infers the callback one) */
  const pool = mysql.createPool({ uri: url, connectionLimit: 2 });

  return {
    name: 'mysql',
    async save(event, logger) {
      const key = idempotencyKey(event);
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [claim] = await conn.execute(CLAIM_EVENT, [key]);
        if (claim.affectedRows === 0) {
          await conn.rollback();
          return { duplicate: true };
        }
        const [insert] = await conn.execute(INSERT_NOTIFICATION, notificationParams(toNotificationRow(event, creator)));
        await conn.execute(LINK_EVENT, [insert.insertId, key]);
        await conn.commit();
        logger?.debug('notification inserted', { notificationId: insert.insertId, key });
        return { notificationId: insert.insertId };
      } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
}
