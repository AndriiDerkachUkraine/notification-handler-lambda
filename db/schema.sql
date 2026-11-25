-- Schema for the optional real-MySQL mode (docker compose runs this on first start).

CREATE TABLE IF NOT EXISTS `NotificationType` (
  `NotificationTypeID` TINYINT UNSIGNED NOT NULL,
  `Name` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`NotificationTypeID`),
  UNIQUE KEY `uq_name` (`Name`)
);

-- Must match notificationTypeId in app/domain/event-types/*.js
INSERT IGNORE INTO `NotificationType` (`NotificationTypeID`, `Name`) VALUES
  (1, 'user_registered'),
  (2, 'password_reset'),
  (3, 'user_deleted');

-- As given in the assignment.
CREATE TABLE IF NOT EXISTS `Notification` (
  `NotificationID` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `Created` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `Status` TINYINT UNSIGNED NOT NULL DEFAULT '0' COMMENT '0 = inbox, 1 = archived, 2 = deleted',
  `NotificationTypeID` TINYINT UNSIGNED NOT NULL COMMENT 'Global values. See NotificationType table',
  `NotificationData` JSON DEFAULT NULL,
  `CreatedByType` TINYINT UNSIGNED NOT NULL,
  `CreatedByID` INT UNSIGNED NOT NULL,
  `Seen` TINYINT UNSIGNED NOT NULL DEFAULT '0' COMMENT '0 = unseen, 1 = seen',
  `IsBookmarked` TINYINT UNSIGNED NOT NULL DEFAULT '0' COMMENT '0 = no, 1 = yes',
  PRIMARY KEY (`NotificationID`)
);

-- Added: idempotency. One row per processed event, so redelivered events are not stored twice.
CREATE TABLE IF NOT EXISTS `ProcessedEvent` (
  `EventKey` VARCHAR(255) NOT NULL COMMENT 'id:<event_id> or sha256:<content hash>',
  `NotificationID` INT UNSIGNED DEFAULT NULL,
  `ProcessedAt` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`EventKey`)
);
