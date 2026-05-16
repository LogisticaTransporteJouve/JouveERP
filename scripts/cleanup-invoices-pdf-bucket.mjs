// M.0 cleanup — vaciar el bucket invoices-pdf (deprecated tras
// regeneración on-demand). Después de correr esto, el bucket queda
// vacío y se puede borrar manualmente desde Supabase Studio.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-invoices-pdf-bucket.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY requeridos.");
  process.exit(1);
}

const BUCKET = "invoices-pdf";

const supabase = createClient(url, key);

let total = 0;
let cursor = null;

while (true) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });

  if (error) {
    if (error.message?.toLowerCase().includes("not found")) {
      console.log(`Bucket "${BUCKET}" no existe — nada que limpiar.`);
      process.exit(0);
    }
    console.error("Error listando:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  const names = data.map((f) => f.name);
  const { error: delErr } = await supabase.storage.from(BUCKET).remove(names);
  if (delErr) {
    console.error("Error borrando:", delErr.message);
    process.exit(1);
  }
  total += names.length;
  console.log(`Borrados ${names.length} (total ${total})`);
  if (data.length < 1000) break;
  cursor = names[names.length - 1];
}

console.log(`\n✓ Bucket "${BUCKET}" vacío. Total borrados: ${total}`);
console.log(`Borralo manualmente desde Supabase Studio → Storage → Buckets.`);
