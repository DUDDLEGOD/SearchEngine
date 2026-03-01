import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    ENABLE_SCHEDULER: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    SCHED_INTERVAL_MS: z.coerce.number().int().positive().default(300000),
    SEARCH_DEFAULT_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
    SEARCH_MAX_LIMIT: z.coerce.number().int().min(1).max(200).default(50),
    RATE_LIMIT_CAPACITY: z.coerce.number().positive().default(60),
    RATE_LIMIT_REFILL_PER_SEC: z.coerce.number().positive().default(1),
    API_KEY_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    API_KEY_VALUE: z.string().default(""),
    CORS_ALLOW_ORIGINS: z.string().default("*"),
    CACHE_TTL_MS: z.coerce.number().int().positive().default(30000),
    CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
    SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    SOURCE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    RECRAWL_STALE_MS: z.coerce.number().int().positive().default(86400000),
    QUALITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.35),
    RSS_FEEDS: z
      .string()
      .default("https://hnrss.org/newest,https://feeds.arstechnica.com/arstechnica/index"),
  })
  .superRefine((value, ctx) => {
    if (value.API_KEY_ENABLED && value.API_KEY_VALUE.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["API_KEY_VALUE"],
        message: "API_KEY_VALUE is required when API_KEY_ENABLED=true",
      });
    }
  });

const parsed = envSchema.parse(process.env);

export const config = {
  ...parsed,
  CORS_ALLOW_ORIGIN_LIST:
    parsed.CORS_ALLOW_ORIGINS === "*"
      ? ["*"]
      : parsed.CORS_ALLOW_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
  RSS_FEED_LIST: parsed.RSS_FEEDS.split(",")
    .map((feed) => feed.trim())
    .filter(Boolean),
} as const;

export type AppConfig = typeof config;
