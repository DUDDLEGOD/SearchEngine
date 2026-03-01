export type ErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toErrorPayload(
  requestId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>
): ErrorPayload {
  return {
    error: {
      code,
      message,
      details,
    },
    requestId,
  };
}

export function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): Response {
  return Response.json(toErrorPayload(requestId, code, message, details), {
    status,
  });
}

export function unknownErrorResponse(requestId: string): Response {
  return errorResponse(
    requestId,
    500,
    "INTERNAL_SERVER_ERROR",
    "Internal server error"
  );
}
