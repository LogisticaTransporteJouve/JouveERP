import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

type Supabase = SupabaseClient<Database>;

export type ArcaWebAccountState = "missing" | "ok" | "rejected";

export type ArcaWebAccountStatus = {
  state: ArcaWebAccountState;
  cuit: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
};

/** The single reader of the ARCA web account: its state, never the clave.
 *  Null when the read failed. */
export async function getArcaWebAccountStatus(
  supabase: Supabase,
): Promise<ArcaWebAccountStatus | null> {
  const { data, error } = await supabase
    .from("arca_web_account")
    .select("cuit, status, secret_id, last_success_at, last_error_code")
    .maybeSingle();
  if (error) return null;
  if (!data || data.secret_id === null) {
    return {
      state: "missing",
      cuit: data?.cuit ?? null,
      lastSuccessAt: null,
      lastErrorCode: null,
    };
  }
  return {
    state: data.status === "sign_in_failing" ? "rejected" : "ok",
    cuit: data.cuit,
    lastSuccessAt: data.last_success_at,
    lastErrorCode: data.last_error_code,
  };
}

/** The clave fiscal, for the job step that signs in (service role only).
 *  Null when not configured, rejected by ARCA, or the read failed. */
export async function readArcaWebPassword(
  supabase: Supabase,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_arca_web_password");
  if (error || typeof data !== "string" || data === "") return null;
  return data;
}
