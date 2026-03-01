import { z } from "zod";
import { config } from "../config";
import { SOURCE_NAMES, type SourceName } from "../ingestion/types";
import type { SearchRequest } from "../types/api";
import { HttpError } from "./errors";

const sourceEnum = z.enum(SOURCE_NAMES);

const legacySearchSchema = z.object({
  q: z.string().trim().min(1).max(256),
  page: z.coerce.number().int().min(1).default(1),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(config.SEARCH_MAX_LIMIT)
    .default(config.SEARCH_DEFAULT_LIMIT),
});

const v1SearchSchema = z.object({
  q: z.string().trim().min(1).max(256),
  page: z.coerce.number().int().min(1).default(1),
  limit: z
    .coerce.number()
    .int()
    .min(1)
    .max(config.SEARCH_MAX_LIMIT)
    .default(config.SEARCH_DEFAULT_LIMIT),
  source: sourceEnum.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const suggestSchema = z.object({
  q: z.string().trim().min(1).max(256),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

function toValidationError(error: z.ZodError): HttpError {
  return new HttpError(400, "VALIDATION_ERROR", "Invalid request parameters", {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

export function parseLegacySearchParams(params: URLSearchParams): {
  query: string;
  page: number;
  limit: number;
} {
  const parsed = legacySearchSchema.safeParse({
    q: params.get("q"),
    page: params.get("page") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    throw toValidationError(parsed.error);
  }

  return {
    query: parsed.data.q,
    page: parsed.data.page,
    limit: parsed.data.limit,
  };
}

export function parseV1SearchParams(params: URLSearchParams): SearchRequest {
  const parsed = v1SearchSchema.safeParse({
    q: params.get("q"),
    page: params.get("page") ?? undefined,
    limit: params.get("limit") ?? undefined,
    source: params.get("source") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });

  if (!parsed.success) {
    throw toValidationError(parsed.error);
  }

  const from = parsed.data.from ? new Date(parsed.data.from) : undefined;
  const to = parsed.data.to ? new Date(parsed.data.to) : undefined;

  if (from && to && from > to) {
    throw new HttpError(400, "VALIDATION_ERROR", "from must be <= to", {
      from: parsed.data.from,
      to: parsed.data.to,
    });
  }

  return {
    query: parsed.data.q,
    page: parsed.data.page,
    limit: parsed.data.limit,
    filters: {
      source: parsed.data.source as SourceName | undefined,
      from,
      to,
    },
  };
}

export function parseSuggestParams(params: URLSearchParams): {
  query: string;
  limit: number;
} {
  const parsed = suggestSchema.safeParse({
    q: params.get("q"),
    limit: params.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    throw toValidationError(parsed.error);
  }

  return {
    query: parsed.data.q,
    limit: parsed.data.limit,
  };
}
