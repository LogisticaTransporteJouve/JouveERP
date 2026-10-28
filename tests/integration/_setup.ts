// Helpers de integration tests contra una instancia local de Supabase.
// Cargan .env.local y exponen un service client + anon client + fábrica
// de users descartables. Las suites integran via beforeAll/afterAll
// para limpiar lo que crearon.
//
// Gated por RUN_INTEGRATION=1 en cada suite. Si no está, la suite se
// skipea y los tests pasan.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", "..", ".env.local");

function loadEnv(): Record<string, string> {
  try {
    const raw = readFileSync(ENV_PATH, "utf-8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

const env = loadEnv();
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  "http://127.0.0.1:54321";
export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

// The service client creates and deletes auth users, so a URL pointing at a
// cloud project would write there. Checked when a client is built (not at
// import) because plain `pnpm test` collects these files with the suites
// skipped.
function assertLocalSupabase(url: string): void {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(
      "Integration tests run only against a local Supabase (127.0.0.1/localhost).",
    );
  }
}

export function makeServiceClient(): SupabaseClient {
  assertLocalSupabase(SUPABASE_URL);
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function makeAuthedClient(accessToken: string): SupabaseClient {
  assertLocalSupabase(SUPABASE_URL);
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type TestUser = {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  client: SupabaseClient;
};

const TEST_USER_TAG = "+jouveerp-integration";

export async function createTestUser(suffix: string): Promise<TestUser> {
  const service = makeServiceClient();
  const email = `int-${suffix}-${Date.now()}${TEST_USER_TAG}@jouve.test`;
  const password = "Integration1234!";

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
  }

  // El trigger on_auth_user_created_profile crea el profile auto;
  // si por algo no, lo hacemos best-effort.
  await service
    .from("user_profiles")
    .upsert({ user_id: data.user.id }, { onConflict: "user_id" });

  // Sign in for an access token.
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sessionData, error: signInErr } =
    await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !sessionData.session) {
    throw new Error(`signIn failed: ${signInErr?.message}`);
  }

  return {
    id: data.user.id,
    email,
    password,
    accessToken: sessionData.session.access_token,
    client: makeAuthedClient(sessionData.session.access_token),
  };
}

export async function deleteTestUser(userId: string): Promise<void> {
  const service = makeServiceClient();
  await service.auth.admin.deleteUser(userId);
}

export async function cleanupOrphanTestUsers(): Promise<void> {
  // Borra users que terminan en el tag — útil cuando una suite se
  // cuelga y deja basura.
  const service = makeServiceClient();
  let page = 1;
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) return;
    for (const u of data.users) {
      if (u.email?.includes(TEST_USER_TAG)) {
        await service.auth.admin.deleteUser(u.id);
      }
    }
    if (data.users.length < 200) return;
    page += 1;
  }
}
