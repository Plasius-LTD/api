import { describe, expect, it } from "vitest";

import {
  API_ERROR_KEY_HEADER,
  apiEnGbTranslations,
  apiErrorTranslationKeys,
  badRequestResponse,
  createApiErrorBody,
  createApiErrorResponse,
  internalServerErrorResponse,
  notFoundResponse,
  translateApiErrorText,
} from "../index.js";

describe("API error messages", () => {
  it("resolves default en-GB text through the shared translation runtime", () => {
    expect(translateApiErrorText(apiErrorTranslationKeys.badRequest)).toBe("Bad Request");
    expect(apiEnGbTranslations[apiErrorTranslationKeys.httpsRequired]).toBe(
      "HTTPS is required."
    );
  });

  it("falls back to package translations when a supplied translator misses a key", () => {
    expect(
      translateApiErrorText(apiErrorTranslationKeys.notFound, undefined, (key) => key)
    ).toBe("Not Found");
  });

  it("builds JSON error bodies with stable translation keys", () => {
    expect(createApiErrorBody(apiErrorTranslationKeys.internalServerError)).toEqual({
      error: "Internal Server Error",
      errorKey: apiErrorTranslationKeys.internalServerError,
    });
  });

  it("adds error keys to standard HTTP helper responses without changing statuses", () => {
    expect(badRequestResponse.status).toBe(400);
    expect(JSON.parse(String(badRequestResponse.body))).toEqual({
      error: "Bad Request",
      errorKey: apiErrorTranslationKeys.badRequest,
    });
    expect((badRequestResponse.headers as Headers).get(API_ERROR_KEY_HEADER)).toBe(
      apiErrorTranslationKeys.badRequest
    );

    expect(notFoundResponse.status).toBe(404);
    expect(JSON.parse(String(notFoundResponse.body))).toMatchObject({
      error: "Not Found",
      errorKey: apiErrorTranslationKeys.notFound,
    });

    expect(internalServerErrorResponse.status).toBe(500);
    expect(JSON.parse(String(internalServerErrorResponse.body))).toMatchObject({
      error: "Internal Server Error",
      errorKey: apiErrorTranslationKeys.internalServerError,
    });
  });

  it("keeps text responses compatible while exposing the error key in headers", () => {
    const response = createApiErrorResponse(426, apiErrorTranslationKeys.httpsRequired, {
      json: false,
    });

    expect(response.body).toBe("HTTPS is required.");
    expect((response.headers as Headers).get(API_ERROR_KEY_HEADER)).toBe(
      apiErrorTranslationKeys.httpsRequired
    );
  });
});

