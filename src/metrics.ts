type Labels = Record<string, string | number | boolean>;

type Counter = {
  help: string;
  values: Map<string, number>;
  labelValues: Map<string, Labels>;
};

type Histogram = {
  help: string;
  buckets: number[];
  values: Map<
    string,
    {
      count: number;
      sum: number;
      bucketCounts: number[];
    }
  >;
  labelValues: Map<string, Labels>;
};

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

function labelsKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }

  const body = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(",");
  return `{${body}}`;
}

function ensureCounter(name: string, help: string): Counter {
  const existing = counters.get(name);
  if (existing) {
    return existing;
  }

  const counter: Counter = {
    help,
    values: new Map(),
    labelValues: new Map(),
  };
  counters.set(name, counter);
  return counter;
}

function ensureHistogram(name: string, help: string, buckets: number[]): Histogram {
  const existing = histograms.get(name);
  if (existing) {
    return existing;
  }

  const histogram: Histogram = {
    help,
    buckets: [...buckets].sort((a, b) => a - b),
    values: new Map(),
    labelValues: new Map(),
  };
  histograms.set(name, histogram);
  return histogram;
}

function incCounter(name: string, help: string, labels: Labels = {}, value = 1) {
  const counter = ensureCounter(name, help);
  const key = labelsKey(labels);
  counter.values.set(key, (counter.values.get(key) ?? 0) + value);
  counter.labelValues.set(key, labels);
}

function observeHistogram(
  name: string,
  help: string,
  buckets: number[],
  value: number,
  labels: Labels = {}
) {
  const histogram = ensureHistogram(name, help, buckets);
  const key = labelsKey(labels);
  const existing = histogram.values.get(key) ?? {
    count: 0,
    sum: 0,
    bucketCounts: histogram.buckets.map(() => 0),
  };

  existing.count += 1;
  existing.sum += value;

  for (let index = 0; index < histogram.buckets.length; index += 1) {
    const bucket = histogram.buckets[index];
    if (bucket !== undefined && value <= bucket) {
      const current = existing.bucketCounts[index] ?? 0;
      existing.bucketCounts[index] = current + 1;
    }
  }

  histogram.values.set(key, existing);
  histogram.labelValues.set(key, labels);
}

export function recordSearchRequest(endpoint: string, status: number) {
  incCounter(
    "search_requests_total",
    "Total number of search requests",
    { endpoint, status }
  );
}

export function recordSearchLatency(endpoint: string, latencyMs: number) {
  observeHistogram(
    "search_latency_ms",
    "Search latency in milliseconds",
    [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    latencyMs,
    { endpoint }
  );
}

export function recordIngestionJob(source: string, status: string) {
  incCounter(
    "ingestion_jobs_total",
    "Total ingestion jobs by source and status",
    { source, status }
  );
}

export function recordIngestionDuration(source: string, durationMs: number) {
  observeHistogram(
    "ingestion_duration_ms",
    "Ingestion duration in milliseconds",
    [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000],
    durationMs,
    { source }
  );
}

export function recordRateLimitRejection() {
  incCounter(
    "rate_limit_rejections_total",
    "Total number of rate limit rejections"
  );
}

export function recordCacheHit() {
  incCounter("cache_hits_total", "Total cache hits");
}

export function recordCacheMiss() {
  incCounter("cache_misses_total", "Total cache misses");
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  for (const [name, counter] of counters.entries()) {
    lines.push(`# HELP ${name} ${counter.help}`);
    lines.push(`# TYPE ${name} counter`);

    for (const [key, value] of counter.values.entries()) {
      const labels = counter.labelValues.get(key) ?? {};
      lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
  }

  for (const [name, histogram] of histograms.entries()) {
    lines.push(`# HELP ${name} ${histogram.help}`);
    lines.push(`# TYPE ${name} histogram`);

    for (const [key, value] of histogram.values.entries()) {
      const baseLabels = histogram.labelValues.get(key) ?? {};

      for (let index = 0; index < histogram.buckets.length; index += 1) {
        const bucket = histogram.buckets[index];
        if (bucket === undefined) {
          continue;
        }

        const bucketLabels = {
          ...baseLabels,
          le: bucket,
        };
        const bucketCount = value.bucketCounts[index] ?? 0;
        lines.push(
          `${name}_bucket${formatLabels(bucketLabels)} ${bucketCount}`
        );
      }

      lines.push(`${name}_sum${formatLabels(baseLabels)} ${value.sum}`);
      lines.push(`${name}_count${formatLabels(baseLabels)} ${value.count}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
