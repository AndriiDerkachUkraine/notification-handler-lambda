/** Per-event rejection codes; human-readable details go to `details` and the logs. */
export const RejectCode = Object.freeze({
  MALFORMED_EVENT: 'malformed_event',
  UNSUPPORTED_EVENT_TYPE: 'unsupported_event_type',
  INVALID_FIELDS: 'invalid_fields',
});

/** Rejects the whole request (wrong payload shape). */
export class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
    this.code = 'bad_request';
  }
}
