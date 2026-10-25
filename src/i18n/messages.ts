import type { ResponseLanguage } from "./language";

const messages = {
  upserted: { en: "Location upserted successfully", fa: "موقعیت با موفقیت ذخیره شد" },
  invalidBody: { en: "Invalid request body", fa: "بدنه درخواست نامعتبر است" },
  invalidData: { en: "Invalid request data", fa: "اطلاعات درخواست نامعتبر است" },
  internalError: { en: "Internal server error", fa: "خطای داخلی سرور" },
  unexpectedError: { en: "Internal Server Error", fa: "خطای داخلی سرور" },
  notFound: { en: "Not found", fa: "یافت نشد" },
  invalidJson: { en: "Invalid JSON body", fa: "بدنه JSON نامعتبر است" },
  bodyTooLarge: { en: "Request body too large", fa: "حجم بدنه درخواست بیش از حد مجاز است" },
  unsupportedEncoding: { en: "Unsupported request body encoding", fa: "کدگذاری بدنه درخواست پشتیبانی نمی‌شود" },
  unauthorized: { en: "Unauthorized", fa: "دسترسی غیرمجاز است" },
  requiredUserId: { en: "Required user id", fa: "شناسه کاربر الزامی است" },
  invalidUserId: { en: "Invalid user id", fa: "شناسه کاربر نامعتبر است" },
  emptyUserId: { en: "User id cannot be empty", fa: "شناسه کاربر نمی‌تواند خالی باشد" },
  longUserId: { en: "User id cannot exceed 255 characters", fa: "شناسه کاربر نباید بیش از ۲۵۵ نویسه باشد" },
  nulUserId: { en: "User id cannot contain a NUL character", fa: "شناسه کاربر نمی‌تواند دارای نویسه تهی باشد" },
  unicodeUserId: { en: "User id must contain valid Unicode", fa: "شناسه کاربر باید دارای نویسه‌های معتبر یونیکد باشد" },
  requiredLatitude: { en: "Required latitude", fa: "عرض جغرافیایی الزامی است" },
  invalidLatitude: { en: "Invalid latitude", fa: "عرض جغرافیایی نامعتبر است" },
  minimumLatitude: { en: "The minimum latitude is -90", fa: "حداقل عرض جغرافیایی منفی ۹۰ است" },
  maximumLatitude: { en: "The maximum latitude is 90.", fa: "حداکثر عرض جغرافیایی ۹۰ است" },
  requiredLongitude: { en: "Required longitude", fa: "طول جغرافیایی الزامی است" },
  invalidLongitude: { en: "Invalid longitude", fa: "طول جغرافیایی نامعتبر است" },
  minimumLongitude: { en: "The minimum longitude is -180", fa: "حداقل طول جغرافیایی منفی ۱۸۰ است" },
  maximumLongitude: { en: "The maximum longitude is 180", fa: "حداکثر طول جغرافیایی ۱۸۰ است" },
  invalidDistance: { en: "Invalid max distance", fa: "شعاع جست‌وجو نامعتبر است" },
  positiveDistance: { en: "Max distance must be a positive number", fa: "شعاع جست‌وجو باید عددی مثبت باشد" },
  invalidPage: { en: "Invalid page", fa: "شماره صفحه نامعتبر است" },
  integerPage: { en: "Page must be an integer", fa: "شماره صفحه باید عددی صحیح باشد" },
  positivePage: { en: "Page must be a positive number", fa: "شماره صفحه باید عددی مثبت باشد" },
  safePage: { en: "Page exceeds the safe integer range", fa: "شماره صفحه خارج از محدوده عدد صحیح ایمن است" },
  safeOffset: { en: "Pagination offset exceeds the safe integer range", fa: "مقدار جابه‌جایی صفحه‌بندی خارج از محدوده عدد صحیح ایمن است" },
  invalidPageSize: { en: "Invalid page size", fa: "اندازه صفحه نامعتبر است" },
  integerPageSize: { en: "Page size must be an integer", fa: "اندازه صفحه باید عددی صحیح باشد" },
  positivePageSize: { en: "Page size must be a positive number", fa: "اندازه صفحه باید عددی مثبت باشد" },
  maximumPageSize: { en: "Page size cannot exceed 100", fa: "اندازه صفحه نباید بیش از ۱۰۰ باشد" },
} as const;

export type MessageKey = keyof typeof messages;
export const message = (language: ResponseLanguage, key: MessageKey): string => messages[key][language];
export const maximumDistanceMessage = (language: ResponseLanguage, maximum: number): string =>
  language === "fa" ? `شعاع جست‌وجو نباید بیش از ${maximum} متر باشد` : `Max distance cannot exceed ${maximum} meters`;
