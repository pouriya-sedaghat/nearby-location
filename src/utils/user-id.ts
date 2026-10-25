export const MAX_USER_ID_LENGTH = 255;
export const USER_ID_PATTERN = /^[^\u0000-\u001f\u007f-\u009f]*$/u;
// A lone UTF-16 surrogate is not valid Unicode. The UTF-8 encoder replaces it
// with U+FFFD, so distinct API identifiers would collide in PostgreSQL.
export const WELL_FORMED_USER_ID_PATTERN = /^\P{Cs}*$/u;

/**
 * Identifier that PostgreSQL may already hold: nonblank and length-bounded,
 * without NUL (PostgreSQL text cannot hold it) and well-formed (its UTF-8
 * storage always is). Versions before 2.13.1 did not reject other control
 * characters, so cursor tuples must still accept such stored identifiers
 * until their rows expire.
 */
export const isStoredUserId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= MAX_USER_ID_LENGTH &&
  !value.includes("\u0000") &&
  WELL_FORMED_USER_ID_PATTERN.test(value);
