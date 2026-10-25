export const SUPPORTED_LANGUAGES = ["en", "fa"] as const;
export type ResponseLanguage = typeof SUPPORTED_LANGUAGES[number];
export const DEFAULT_LANGUAGE: ResponseLanguage = "en";
