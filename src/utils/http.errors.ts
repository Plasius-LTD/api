import { HttpResponseInit } from "@azure/functions"

export const badRequestResponse: HttpResponseInit = {
    status: 400,
    body: JSON.stringify({ error: 'Bad Request' }),
}

export const unauthorizedResponse: HttpResponseInit = {
    status: 401,
    body: JSON.stringify({ error: 'Unauthorized' }),
}

export const forbiddenResponse: HttpResponseInit = {
    status: 403,
    body: JSON.stringify({ error: 'Forbidden' }),
}

export const notFoundResponse: HttpResponseInit = {
    status: 404,
    body: JSON.stringify({ error: 'Not Found' }),
}

export const requestTimeoutResponse: HttpResponseInit = {
    status: 408,
    body: JSON.stringify({ error: 'Request Timeout' }),
}

export const tooManyRequestsResponse: HttpResponseInit = {
    status: 429,
    body: JSON.stringify({ error: 'Too Many Requests' }),
}

export const internalServerErrorResponse: HttpResponseInit = {
    status: 500,
    body: JSON.stringify({ error: 'Internal Server Error' }),
}

export const notImplementedResponse: HttpResponseInit = {
    status: 501,
    body: JSON.stringify({ error: 'Not Implemented' }),
}

export const badGatewayResponse: HttpResponseInit = {
    status: 502,
    body: JSON.stringify({ error: 'Bad Gateway' }),
}

export const serviceUnavailableResponse: HttpResponseInit = {
    status: 503,
    body: JSON.stringify({ error: 'Service Unavailable' }),
}

export const gatewayTimeoutResponse: HttpResponseInit = {
    status: 504,
    body: JSON.stringify({ error: 'Gateway Timeout' }),
}