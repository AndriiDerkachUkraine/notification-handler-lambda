import { date, email } from '../fields.js';
import { defineEventType } from './define.js';

export default defineEventType({
  type: 'password_reset',
  notificationTypeId: 2,
  fields: { email, requested: date },
});
