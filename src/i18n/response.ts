import z from "zod";
import type { Response } from "express";
import type { ResponseLanguage } from "./language";
import { message, maximumDistanceMessage } from "./messages";
import { responseLanguage } from "../middleware/request-context.middleware";

// Human text is localized at serialization; keys, identifiers and codes never are.
const translations = {
  "Location upserted successfully": message("fa", "upserted"),
  "Invalid request body": message("fa", "invalidBody"),
  "Invalid request data": message("fa", "invalidData"),
  "Internal server error": message("fa", "internalError"),
  "Internal Server Error": message("fa", "unexpectedError"),
  "Not found": message("fa", "notFound"),
  "Invalid JSON body": message("fa", "invalidJson"),
  "Request body too large": message("fa", "bodyTooLarge"),
  "Unsupported request encoding or charset": message("fa", "unsupportedEncoding"),
  "Unauthorized": message("fa", "unauthorized"),
  "Required user id": message("fa", "requiredUserId"),
  "Invalid user id": message("fa", "invalidUserId"),
  "User id cannot be empty": message("fa", "emptyUserId"),
  "User id cannot be blank": "شناسه کاربر نمی‌تواند خالی باشد",
  "User id cannot exceed 255 characters": message("fa", "longUserId"),
  "User id cannot contain NUL characters": message("fa", "nulUserId"),
  "User id cannot contain control characters": "شناسه کاربر نمی‌تواند دارای نویسه‌های کنترلی باشد",
  "User id must be well-formed Unicode text": message("fa", "unicodeUserId"),
  "Required latitude": message("fa", "requiredLatitude"),
  "Invalid latitude": message("fa", "invalidLatitude"),
  "The minimum latitude is -90": message("fa", "minimumLatitude"),
  "The maximum latitude is 90.": message("fa", "maximumLatitude"),
  "Required longitude": message("fa", "requiredLongitude"),
  "Invalid longitude": message("fa", "invalidLongitude"),
  "The minimum longitude is -180": message("fa", "minimumLongitude"),
  "The maximum longitude is 180": message("fa", "maximumLongitude"),
  "Invalid max distance": message("fa", "invalidDistance"),
  "Max distance must be a positive number": message("fa", "positiveDistance"),
  "Invalid page": message("fa", "invalidPage"),
  "Page must be an integer": message("fa", "integerPage"),
  "Page must be a positive number": message("fa", "positivePage"),
  "Page exceeds the safe integer range": message("fa", "safePage"),
  "Pagination offset exceeds the safe integer range": message("fa", "safeOffset"),
  "Invalid page size": message("fa", "invalidPageSize"),
  "Page size must be an integer": message("fa", "integerPageSize"),
  "Page size must be a positive number": message("fa", "positivePageSize"),
  "Page size cannot exceed 100": message("fa", "maximumPageSize"),
  "Invalid cursor": "نشانگر صفحه‌بندی نامعتبر است",
  "Cursor cannot be empty": "نشانگر صفحه‌بندی نمی‌تواند خالی باشد",
  "Cursor is too long": "نشانگر صفحه‌بندی بیش از حد طولانی است",
  "Cursor expired": "نشانگر صفحه‌بندی منقضی شده است",
  "Cursor has an invalid timestamp": "زمان نشانگر صفحه‌بندی نامعتبر است",
  "Cursor was created for a different ranking profile": "نشانگر صفحه‌بندی برای تنظیمات رتبه‌بندی دیگری ایجاد شده است",
  "Cursor does not match the current nearby search": "نشانگر صفحه‌بندی با جست‌وجوی فعلی مطابقت ندارد",
  "page cannot be used with cursor pagination": "شماره صفحه با صفحه‌بندی نشانگر قابل استفاده نیست",
  "pagination=offset cannot be used together with cursor": "صفحه‌بندی offset با نشانگر قابل استفاده نیست",
  "match is not supported; send exact stored identifiers to POST /privacy/location/delete-exact": "گزینه match پشتیبانی نمی‌شود؛ برای حذف شناسه دقیق از POST /privacy/location/delete-exact استفاده کنید",
  "Service temporarily unavailable": "سرویس موقتا در دسترس نیست",
  "Service temporarily overloaded": "ظرفیت سرویس موقتا تکمیل است",
  "Service is draining": "سرویس در حال پایان دادن به درخواست‌ها است",
  "Too many requests": "تعداد درخواست‌ها بیش از حد مجاز است",
} as const satisfies Readonly<Record<string, string>>;
export type PublicMessage = keyof typeof translations;

const translate = (language: ResponseLanguage, text: string): string => {
  if (language === "en") return text;
  const radius = /^Max distance cannot exceed ([\d.e+-]+) meters$/.exec(text);
  return (translations as Readonly<Record<string, string>>)[text] ?? (radius ? maximumDistanceMessage(language, Number(radius[1])) : text);
};
export const apiMessage = (res: Response, text: PublicMessage): string => translate(responseLanguage(res), text);

const persian = z.locales.fa().localeError;
export const validationOptions = (res: Response) => ({ error: responseLanguage(res) === "fa"
  ? ((issue: Parameters<typeof persian>[0]) => issue.code === "invalid_type" && issue.expected === "object"
    ? issue.input === undefined ? "این بخش از درخواست الزامی است" : "مقدار باید یک شیء JSON باشد"
    : persian(issue))
  : z.locales.en().localeError });

/** Keep the public formatted tree while translating only its message arrays. */
export const validationErrors = (res: Response, error: z.ZodError): unknown => {
  const language = responseLanguage(res);
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      result[key] = key === "_errors" && Array.isArray(child)
        ? child.map(text => translate(language, String(text))) : visit(child);
    }
    return result;
  };
  return visit(error.format());
};
