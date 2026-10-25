import { SUPPORTED_LANGUAGES } from "../i18n/language";
import type { ResponseLanguage } from "../i18n/language";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

if (Intl.RelativeTimeFormat.supportedLocalesOf(SUPPORTED_LANGUAGES).length !== SUPPORTED_LANGUAGES.length) {
  throw new Error("The runtime must support English and Persian Intl relative-time formatting");
}
const formatters = {
  en: new Intl.RelativeTimeFormat("en", { numeric: "always", style: "long" }),
  fa: new Intl.RelativeTimeFormat("fa", { numeric: "always", style: "long" }),
};

const daysInUtcMonth = (year: number, month: number): number => {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
};

/**
 * Display age in the selected language, rounded down to a completed unit. Short units use
 * elapsed time; months/years use UTC calendar anniversaries with month-end
 * clamping. Future dates retain the API's zero-age behavior.
 * Pass one reference time for an entire response; updatedAt remains exact.
 */
export const timeAgo = (date: Date, referenceTime: number = Date.now(), language: ResponseLanguage = "en"): string => {
  if (language !== "en" && language !== "fa") throw new RangeError("Unsupported relative-time language");
  const formatter = formatters[language];
  const past = (count: number, unit: Intl.RelativeTimeFormatUnit): string => formatter.format(-count, unit);
  const timestamp = date.getTime();
  const reference = new Date(referenceTime);
  const now = reference.getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(now)) {
    throw new RangeError("timeAgo requires a valid date and reference time");
  }

  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return past(Math.floor(elapsed / SECOND), "second");
  if (elapsed < HOUR) return past(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return past(Math.floor(elapsed / HOUR), "hour");
  if (elapsed < WEEK) return past(Math.floor(elapsed / DAY), "day");

  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  let months = (year - date.getUTCFullYear()) * 12 + month - date.getUTCMonth();
  if (months > 0) {
    const anniversary = new Date(timestamp);
    anniversary.setUTCFullYear(year, month, Math.min(date.getUTCDate(), daysInUtcMonth(year, month)));
    const anniversaryTime = anniversary.getTime();
    // An anniversary beyond the maximum representable Date is also not due.
    if (!Number.isFinite(anniversaryTime) || anniversaryTime > now) months--;
    if (months >= 12) return past(Math.floor(months / 12), "year");
    if (months >= 1) return past(months, "month");
  }
  return past(Math.floor(elapsed / WEEK), "week");
};
