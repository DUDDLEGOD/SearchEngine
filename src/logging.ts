type LogLevel = "info" | "warn" | "error";

type LogData = {
  [key: string]: unknown;
};

export function log(level: LogLevel, event: string, data: LogData = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function logRequest(data: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  ip: string;
}) {
  log("info", "http.request", data);
}
