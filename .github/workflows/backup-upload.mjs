// Script auxiliar del workflow backup-daily.yml.
// Sube el dump al bucket `backups-daily` y borra los > RETENTION_DAYS.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.BUCKET ?? "backups-daily";
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? "30");
const DUMP_FILE = process.env.DUMP_FILE;
const DUMP_SIZE = process.env.DUMP_SIZE;
const DUMP_SHA = process.env.DUMP_SHA;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!DUMP_FILE) {
  console.error("Falta DUMP_FILE en env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 1. Upload
const buffer = readFileSync(DUMP_FILE);
console.log(`Subiendo ${DUMP_FILE} (${buffer.length} bytes) a ${BUCKET}/ ...`);
const { error: upErr } = await supabase.storage
  .from(BUCKET)
  .upload(DUMP_FILE, buffer, {
    contentType: "application/octet-stream",
    upsert: true,
    metadata: { sha256: DUMP_SHA, size: DUMP_SIZE },
  });
if (upErr) {
  console.error("Upload failed:", upErr.message);
  process.exit(1);
}
console.log("Upload OK.");

// 2. Prune older than RETENTION_DAYS
console.log(`Listando para prune (> ${RETENTION_DAYS} días) ...`);
const { data: files, error: listErr } = await supabase.storage
  .from(BUCKET)
  .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });

if (listErr) {
  console.error("List failed:", listErr.message);
  process.exit(1);
}

const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
const toDelete = (files ?? [])
  .filter((f) => {
    // Nombres tipo backup-YYYY-MM-DD.dump → extraemos fecha
    const m = f.name.match(/^backup-(\d{4}-\d{2}-\d{2})\.dump$/);
    if (!m) return false;
    const t = Date.parse(`${m[1]}T00:00:00Z`);
    return Number.isFinite(t) && t < cutoff;
  })
  .map((f) => f.name);

if (toDelete.length > 0) {
  console.log(`Borrando ${toDelete.length} archivos antiguos:`, toDelete);
  const { error: delErr } = await supabase.storage.from(BUCKET).remove(toDelete);
  if (delErr) {
    console.error("Delete failed:", delErr.message);
    process.exit(1);
  }
  console.log("Prune OK.");
} else {
  console.log("No hay archivos para podar.");
}

console.log(`\n✓ Backup ${DUMP_FILE} subido. Retenidos en bucket: ${(files ?? []).length - toDelete.length + 1}`);
