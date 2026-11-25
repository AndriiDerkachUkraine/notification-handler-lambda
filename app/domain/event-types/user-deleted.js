import { date, email } from '../fields.js';
import { defineEventType } from './define.js';

export default defineEventType({
  type: 'user_deleted',
  notificationTypeId: 3,
  fields: { email, deleted: date },
});
