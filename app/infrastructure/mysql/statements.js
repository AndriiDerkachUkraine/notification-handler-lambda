/** SQL shared by the simulated and the real MySQL adapters (parameterized: no string-built SQL). */

// ProcessedEvent.EventKey is the PRIMARY KEY, so a redelivered event is ignored atomically.
export const CLAIM_EVENT = 'INSERT IGNORE INTO ProcessedEvent (EventKey) VALUES (?)';

export const INSERT_NOTIFICATION =
  'INSERT INTO Notification (NotificationTypeID, NotificationData, CreatedByType, CreatedByID, Status, Seen, IsBookmarked) VALUES (?, ?, ?, ?, ?, ?, ?)';

export const LINK_EVENT = 'UPDATE ProcessedEvent SET NotificationID = ? WHERE EventKey = ?';

/** @param {ReturnType<import('../../domain/notification.js').toNotificationRow>} row */
export const notificationParams = (row) => [
  row.NotificationTypeID,
  JSON.stringify(row.NotificationData),
  row.CreatedByType,
  row.CreatedByID,
  row.Status,
  row.Seen,
  row.IsBookmarked,
];
