type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "api_key",
  "apikey",
  "private_key",
  "privatekey",
  "cert",
  "sign",
];

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return "[Truncated]";
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}

function activeLevel(): LogLevel {
  if (process.env.LOG_LEVEL && process.env.LOG_LEVEL in LEVEL_RANK) {
    return process.env.LOG_LEVEL as LogLevel;
  }
  if (process.env.NODE_ENV === "production") return "info";
  if (process.env.DEBUG === "true") return "debug";
  return "debug";
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[activeLevel()];
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!shouldEmit(level)) return;

  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    emit("debug", message, context);
  },
  info(message: string, context?: Record<string, unknown>) {
    emit("info", message, context);
  },
  warn(message: string, context?: Record<string, unknown>) {
    emit("warn", message, context);
  },
  error(message: string, context?: Record<string, unknown>) {
    emit("error", message, context);
  },
};

export const __test__ = { redact, isSensitiveKey, activeLevel };
