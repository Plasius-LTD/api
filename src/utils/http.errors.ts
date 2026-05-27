import type { HttpResponseInit } from "@azure/functions";
import { apiErrorTranslationKeys, createApiErrorResponse } from "./error-messages.js";

export const badRequestResponse: HttpResponseInit = createApiErrorResponse(
  400,
  apiErrorTranslationKeys.badRequest
);

export const unauthorizedResponse: HttpResponseInit = createApiErrorResponse(
  401,
  apiErrorTranslationKeys.unauthorized
);

export const forbiddenResponse: HttpResponseInit = createApiErrorResponse(
  403,
  apiErrorTranslationKeys.forbidden
);

export const notFoundResponse: HttpResponseInit = createApiErrorResponse(
  404,
  apiErrorTranslationKeys.notFound
);

export const requestTimeoutResponse: HttpResponseInit = createApiErrorResponse(
  408,
  apiErrorTranslationKeys.requestTimeout
);

export const tooManyRequestsResponse: HttpResponseInit = createApiErrorResponse(
  429,
  apiErrorTranslationKeys.tooManyRequests
);

export const internalServerErrorResponse: HttpResponseInit = createApiErrorResponse(
  500,
  apiErrorTranslationKeys.internalServerError
);

export const notImplementedResponse: HttpResponseInit = createApiErrorResponse(
  501,
  apiErrorTranslationKeys.notImplemented
);

export const badGatewayResponse: HttpResponseInit = createApiErrorResponse(
  502,
  apiErrorTranslationKeys.badGateway
);

export const serviceUnavailableResponse: HttpResponseInit = createApiErrorResponse(
  503,
  apiErrorTranslationKeys.serviceUnavailable
);

export const gatewayTimeoutResponse: HttpResponseInit = createApiErrorResponse(
  504,
  apiErrorTranslationKeys.gatewayTimeout
);
