import "server-only";

// Per-user rate limiting backed by Postgres.
//
// `enforceRateLimit` is the only public API. It tracks request counts in
// fixed time windows aligned to UTC epoch (e.g. for a 1h window, all rows
// fall on hour boundaries). The atomic insert-or-increment runs inside the
// `bump_rate_limit_bucket` RPC so concurrent calls never lose increments.
//
// Buckets are keyed by (user_id, bucket_key, window_start). Stale rows
// accumulate harmlessly — periodic cleanup is welcome but not required.

import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface EnforceRateLimitArgs {
  userId: string;
  key: string;
  max: number;
  windowMs: number;
}

function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

export async function enforceRateLimit({
  userId,
  key,
  max,
  windowMs,
}: EnforceRateLimitArgs): Promise<void> {
  const supabase = getServiceClient();
  const now = Date.now();
  const start = windowStart(now, windowMs);

  const { data, error } = await supabase.rpc("bump_rate_limit_bucket", {
    p_user_id: userId,
    p_bucket_key: key,
    p_window_start: start.toISOString(),
  });

  if (error) {
    logger.error("rate_limit.rpc_failed", {
      key,
      err: error.message,
    });
    // Fail-closed: if we can't track the limit, deny the request rather than
    // letting unlimited traffic through.
    throw new RateLimitError(
      `Rate limit check failed for ${key}.`,
      Math.ceil(windowMs / 1000),
    );
  }

  const count = typeof data === "number" ? data : Number(data);
  if (count > max) {
    const retryAfter = Math.max(
      1,
      Math.ceil((start.getTime() + windowMs - now) / 1000),
    );
    throw new RateLimitError(
      `Rate limit exceeded for ${key}. Try again in ${retryAfter}s.`,
      retryAfter,
    );
  }
}
