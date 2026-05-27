import { createI18n } from "@plasius/translations";
import type { HttpResponseInit } from "@azure/functions";
import type { TranslationArgs, TranslationDictionary } from "@plasius/translations";
import { apiEnGbTranslations } from "../translations/en-GB.js";

export const API_ERROR_KEY_HEADER = "x-plasius-error-key";

export const apiErrorTranslationKeys = {
  badGateway: "api.error.badGateway",
  badRequest: "api.error.badRequest",
  csrfInvalid: "api.error.csrf.invalid",
  forbidden: "api.error.forbidden",
  gatewayTimeout: "api.error.gatewayTimeout",
  httpsRequired: "api.error.httpsRequired",
  internalServerError: "api.error.internalServerError",
  mcpModelHeaderMissing: "api.error.mcpModelHeaderMissing",
  notFound: "api.error.notFound",
  notImplemented: "api.error.notImplemented",
  requestTimeout: "api.error.requestTimeout",
  serviceUnavailable: "api.error.serviceUnavailable",
  tooManyRequests: "api.error.tooManyRequests",
  unauthorized: "api.error.unauthorized",
} as const;

export type ApiErrorTranslationKey =
  (typeof apiErrorTranslationKeys)[keyof typeof apiErrorTranslationKeys];

export type ApiErrorTranslate = (
  key: ApiErrorTranslationKey,
  args?: TranslationArgs
) => string | undefined;

export const apiTranslations = {
  "en-GB": apiEnGbTranslations,
} satisfies Partial<Record<string, TranslationDictionary>>;

const apiI18n = createI18n({
  language: "en-GB",
  fallback: "en-GB",
  translations: apiTranslations,
});

export function translateApiErrorText(
  key: ApiErrorTranslationKey,
  args?: TranslationArgs,
  translate?: ApiErrorTranslate
): string {
  const translated = translate?.(key, args);
  if (translated && translated !== key) {
    return translated;
  }

  return apiI18n.t(key, args);
}

export function applyApiErrorKeyHeader(headers: Headers, key: ApiErrorTranslationKey): Headers {
  headers.set(API_ERROR_KEY_HEADER, key);
  return headers;
}

export function createApiErrorBody(
  key: ApiErrorTranslationKey,
  args?: TranslationArgs,
  translate?: ApiErrorTranslate
): { error: string; errorKey: ApiErrorTranslationKey } {
  return {
    error: translateApiErrorText(key, args, translate),
    errorKey: key,
  };
}

export function createApiErrorResponse(
  status: number,
  key: ApiErrorTranslationKey,
  options: {
    headers?: Headers;
    cookies?: HttpResponseInit["cookies"];
    json?: boolean;
    translate?: ApiErrorTranslate;
  } = {}
): HttpResponseInit {
  const headers = applyApiErrorKeyHeader(options.headers ?? new Headers(), key);
  const body = createApiErrorBody(key, undefined, options.translate);

  return {
    status,
    headers,
    cookies: options.cookies,
    body: options.json === false ? body.error : JSON.stringify(body),
  };
}

