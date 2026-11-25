/** Config from env vars (full list: README → Configuration). */
import { SYSTEM_CREATOR } from './domain/notification.js';

const nonNegativeInt = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isInteger(n) && n >= 0 ? n : fallback;
};

/** A function rather than a constant, so tests can pass their own env. */
export function loadConfig(env = process.env) {
  return {
    store: (env.NOTIFICATION_STORE || 'dummy').toLowerCase(), // dummy | mysql
    mysqlUrl: env.MYSQL_URL,
    creator: {
      createdByType: nonNegativeInt(env.CREATED_BY_TYPE, SYSTEM_CREATOR.createdByType),
      createdById: nonNegativeInt(env.CREATED_BY_ID, SYSTEM_CREATOR.createdById),
    },
  };
}
