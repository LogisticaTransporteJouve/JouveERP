"use server";

import { consultarPadron } from "@/lib/afip/padron";
import type { ContributorInfo } from "@/lib/afip/types";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import type { Database } from "@/lib/db/database.types";
import { logger } from "@/lib/logger";
import { RateLimitError, enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase/service";

import { VerifyCuitSchema } from "../schema";

type Json = Database["public"]["Tables"]["padron_cache"]["Row"]["data"];

const CACHE_TTL_HOURS = 24;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type VerifyCuitResult =
  | { ok: true; data: ContributorInfo; fromCache: boolean; stale?: boolean }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function verifyCuitAction(
  input: unknown,
): Promise<VerifyCuitResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "padron:lookup")) {
    return { ok: false, error: "No tenés permiso para consultar el padrón." };
  }

  const parsed = VerifyCuitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "CUIT inválido.",
    };
  }
  const { cuit } = parsed.data;

  try {
    await enforceRateLimit({
      userId: ctx.userId,
      key: "padron_lookup",
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return {
        ok: false,
        error: err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    throw err;
  }

  const supabase = getServiceClient();

  const { data: cached, error: cacheErr } = await supabase
    .from("padron_cache")
    .select("data, cached_at")
    .eq("cuit", cuit)
    .maybeSingle();

  if (cacheErr) {
    logger.warn("padron_cache.read_failed", {
      userId: ctx.userId,
      cuit,
      err: cacheErr.message,
    });
  }

  if (cached) {
    const ageHours =
      (Date.now() - new Date(cached.cached_at).getTime()) / 3_600_000;
    if (ageHours < CACHE_TTL_HOURS) {
      return {
        ok: true,
        data: cached.data as unknown as ContributorInfo,
        fromCache: true,
      };
    }
  }

  try {
    const data = await consultarPadron(cuit);

    const { error: upsertErr } = await supabase
      .from("padron_cache")
      .upsert(
        {
          cuit,
          data: data as unknown as Json,
          cached_at: new Date().toISOString(),
        },
        { onConflict: "cuit" },
      );
    if (upsertErr) {
      logger.warn("padron_cache.write_failed", {
        userId: ctx.userId,
        cuit,
        err: upsertErr.message,
      });
    }

    return { ok: true, data, fromCache: false };
  } catch (err) {
    if (cached) {
      logger.warn("padron.live_failed_serving_stale", {
        userId: ctx.userId,
        cuit,
        err: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: true,
        data: cached.data as unknown as ContributorInfo,
        fromCache: true,
        stale: true,
      };
    }
    logger.warn("padron.lookup_failed", {
      userId: ctx.userId,
      cuit,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error consultando padrón.",
    };
  }
}
