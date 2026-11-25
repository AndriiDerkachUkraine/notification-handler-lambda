/**
 * Event → `Notification` row. `Created` is left to the column default;
 * the event's own dates stay in `NotificationData`.
 */
export const NotificationStatus = Object.freeze({ INBOX: 0, ARCHIVED: 1, DELETED: 2 });

/** @typedef {{ createdByType: number, createdById: number }} Creator */

/** Author of notifications created by the system (events carry no author). */
export const SYSTEM_CREATOR = Object.freeze({ createdByType: 0, createdById: 0 });

/**
 * @param {import('./event.js').NormalizedEvent} event
 * @param {Creator} creator
 */
export function toNotificationRow(event, { createdByType, createdById }) {
  return {
    NotificationTypeID: event.definition.notificationTypeId,
    NotificationData: { type: event.type, eventId: event.eventId, ...event.data },
    CreatedByType: createdByType,
    CreatedByID: createdById,
    Status: NotificationStatus.INBOX,
    Seen: 0,
    IsBookmarked: 0,
  };
}
