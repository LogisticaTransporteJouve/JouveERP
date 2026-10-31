#!/usr/bin/env node
// Recreate a dev user with the `owner` role after `supabase db reset`.
// Idempotent: re-running is a no-op once the user + role row exist.
//
// Usage:
//   pnpm seed:dev                           # tomas@jouve.test / Test1234!
//   pnpm seed:dev otro@jouve.test Pass123   # custom email + password

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", ".env.local");

// CI has no .env.local: the variables come from the environment.
function loadEnv() {
  if (!existsSync(ENV_PATH)) return process.env;
  const raw = readFileSync(ENV_PATH, "utf-8");
  const env = {};
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
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local or the environment",
  );
  process.exit(1);
}

const email = process.argv[2] ?? "tomas@jouve.test";
const password = process.argv[3] ?? "Test1234!";

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserId() {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureUser() {
  const existing = await findUserId();
  if (existing) return existing;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return data.user.id;
}

async function ensureOwnerRole(userId) {
  const { error } = await supabase
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: "owner", granted_by: userId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`assign role failed: ${error.message}`);
}

const userId = await ensureUser();
await ensureOwnerRole(userId);
console.log(`✓ ${email} ready — id=${userId}, role=owner`);
