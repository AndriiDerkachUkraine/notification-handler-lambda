import { date, email, requiredString, roles } from '../fields.js';
import { defineEventType } from './define.js';

export default defineEventType({
  type: 'user_registered',
  notificationTypeId: 1,
  fields: { name: requiredString, email, roles, joined: date },
});
