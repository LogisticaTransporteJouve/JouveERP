#!/usr/bin/env node
// Bulk import de comprobantes recibidos exportados desde AFIP "Mis
// Comprobantes". El archivo es TSV con encoding latin1 (acentos).
//
// Uso:
//   pnpm import:afip-purchases <archivo.txt> [--channel jouve_fiscal] [--dry-run]
//
// Idempotente: el UNIQUE constraint sobre
// (supplier_id, kind, letter, punto_venta, numero) evita duplicados al
// re-correr. Los suppliers se upsertean por CUIT.
//
// Flow:
//   1. Parsea TSV
//   2. Por cada CUIT único: si no existe en `suppliers`, lo crea con
//      razón social + IVA condition inferido del tipo (A/B/C)
//   3. Inserta cada row en `purchase_invoices`. Skipea AFIP tipos que no
//      son facturas (recibos, comprobantes de honorarios, etc.)
//   4. Imprime reporte: creadas / saltadas / errores

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", ".env.local");

// AFIP tipo → { kind, letter } ó null si hay que saltar.
const AFIP_TIPO_MAP = {
  1: { kind: "factura", letter: "A" },
  6: { kind: "factura", letter: "B" },
  11: { kind: "factura", letter: "C" },
  2: { kind: "nd", letter: "A" },
  7: { kind: "nd", letter: "B" },
  12: { kind: "nd", letter: "C" },
  3: { kind: "nc", letter: "A" },
  8: { kind: "nc", letter: "B" },
  13: { kind: "nc", letter: "C" },
  // 4, 5, 9, 10, 15 = recibos (no son facturas) → skip
  // 51, 52, 53 = Factura M / NC M / ND M → letter A si quisiéramos, por
  //              ahora skip (no son frecuentes en el dataset)
};

// Letter → IVA condition default cuando creamos un proveedor nuevo. El
// contador puede ajustar después.
const IVA_BY_LETTER = {
  A: "responsable_inscripto",
  B: "consumidor_final",
  C: "monotributo",
};

function loadEnv() {
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

function parseArgs(argv) {
  const args = { file: null, channel: "jouve_fiscal", dryRun: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--channel") args.channel = argv[++i];
    else positional.push(arg);
  }
  if (positional.length > 0) args.file = positional[0];
  return args;
}

function parseDate(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseNumber(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (s === "") return 0;
  // Argentine format: "1.234,56" → 1234.56. También maneja "1,00" → 1.
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function inferIvaCondition(letter) {
  return IVA_BY_LETTER[letter] ?? "responsable_inscripto";
}

function parseFile(path) {
  // El export de AFIP suele ser latin1; intentamos latin1 primero.
  let raw;
  try {
    raw = readFileSync(path, "latin1");
  } catch {
    raw = readFileSync(path, "utf-8");
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Saltar la header.
  const header = lines[0];
  if (!header.toLowerCase().includes("fecha")) {
    throw new Error("Header inesperado en TSV. ¿El archivo es correcto?");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < 30) continue;
    const fecha = parseDate(cols[0]);
    const tipo = Number.parseInt(cols[1], 10);
    const punto_venta = Number.parseInt(cols[2], 10);
    const numero = Number.parseInt(cols[3], 10);
    const cae = (cols[5] ?? "").trim() || null;
    const supplier_cuit = (cols[7] ?? "").replace(/[^0-9]/g, "");
    const supplier_name = (cols[8] ?? "").trim();
    const moneda_raw = (cols[12] ?? "").trim();
    const imp_neto = parseNumber(cols[24]);
    const otros_trib = parseNumber(cols[27]);
    const total_iva = parseNumber(cols[28]);
    const imp_total = parseNumber(cols[29]);

    rows.push({
      lineNumber: i + 1,
      fecha,
      tipo,
      punto_venta,
      numero,
      cae,
      supplier_cuit,
      supplier_name,
      moneda: moneda_raw === "$" ? "PES" : "DOL",
      imp_neto,
      imp_iva: total_iva,
      imp_trib: otros_trib,
      imp_total,
    });
  }
  return rows;
}

async function ensureSupplier(supabase, cuit, legalName, ivaCondition, cache) {
  if (cache.has(cuit)) return cache.get(cuit);

  const { data: existing } = await supabase
    .from("suppliers")
    .select("id, iva_condition")
    .eq("cuit", cuit)
    .maybeSingle();

  if (existing) {
    cache.set(cuit, existing.id);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      cuit,
      legal_name: legalName.slice(0, 120),
      iva_condition: ivaCondition,
    })
    .select("id")
    .single();

  if (error) throw new Error(`createSupplier(${cuit}): ${error.message}`);
  cache.set(cuit, data.id);
  return data.id;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error(
      "Uso: pnpm import:afip-purchases <archivo.txt> [--channel jouve_fiscal] [--dry-run]",
    );
    process.exit(1);
  }

  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Validar canal
  const { data: channel, error: chErr } = await supabase
    .from("invoicing_channels")
    .select("id, is_active")
    .eq("id", args.channel)
    .maybeSingle();
  if (chErr || !channel) {
    console.error(`Canal ${args.channel} no encontrado.`);
    process.exit(1);
  }
  if (!channel.is_active) {
    console.error(`Canal ${args.channel} está inactivo.`);
    process.exit(1);
  }

  console.log(`→ Parseando ${args.file}…`);
  const rows = parseFile(resolve(args.file));
  console.log(`  ${rows.length} filas leídas`);

  const stats = {
    suppliersCreated: 0,
    suppliersReused: 0,
    invoicesCreated: 0,
    invoicesSkippedDup: 0,
    invoicesSkippedType: 0,
    invoicesSkippedBadData: 0,
    errors: 0,
  };

  const supplierCache = new Map(); // cuit → id

  for (const row of rows) {
    const mapping = AFIP_TIPO_MAP[row.tipo];
    if (!mapping) {
      stats.invoicesSkippedType += 1;
      continue;
    }
    if (
      !row.fecha ||
      !row.punto_venta ||
      !row.numero ||
      !row.supplier_cuit ||
      row.supplier_cuit.length !== 11
    ) {
      stats.invoicesSkippedBadData += 1;
      console.warn(
        `[línea ${row.lineNumber}] saltada: datos faltantes / CUIT inválido (${row.supplier_cuit})`,
      );
      continue;
    }

    if (args.dryRun) {
      stats.invoicesCreated += 1;
      continue;
    }

    let supplierId;
    try {
      const ivaCondition = inferIvaCondition(mapping.letter);
      const wasCached = supplierCache.has(row.supplier_cuit);
      supplierId = await ensureSupplier(
        supabase,
        row.supplier_cuit,
        row.supplier_name,
        ivaCondition,
        supplierCache,
      );
      if (!wasCached) {
        const { data: existedBefore } = await supabase
          .from("suppliers")
          .select("created_at")
          .eq("id", supplierId)
          .single();
        if (
          existedBefore &&
          new Date(existedBefore.created_at).getTime() >
            Date.now() - 5 * 60 * 1000
        ) {
          stats.suppliersCreated += 1;
        } else {
          stats.suppliersReused += 1;
        }
      }
    } catch (err) {
      stats.errors += 1;
      console.error(`[línea ${row.lineNumber}] supplier error: ${err.message}`);
      continue;
    }

    const { error: insErr } = await supabase
      .from("purchase_invoices")
      .insert({
        channel_id: args.channel,
        supplier_id: supplierId,
        kind: mapping.kind,
        letter: mapping.letter,
        punto_venta: row.punto_venta,
        numero: row.numero,
        fecha: row.fecha,
        imp_neto: row.imp_neto,
        imp_iva: row.imp_iva,
        imp_trib: row.imp_trib,
        imp_total: row.imp_total,
        moneda: row.moneda,
        cae_proveedor: row.cae,
      });

    if (insErr) {
      // 23505 = unique violation (duplicate)
      if (insErr.code === "23505") {
        stats.invoicesSkippedDup += 1;
      } else {
        stats.errors += 1;
        console.error(
          `[línea ${row.lineNumber}] insert error: ${insErr.message} (CUIT ${row.supplier_cuit}, tipo ${row.tipo}, ${mapping.letter}${row.punto_venta}-${row.numero})`,
        );
      }
      continue;
    }
    stats.invoicesCreated += 1;
  }

  console.log("\n=== Reporte ===");
  console.log(`Proveedores creados:      ${stats.suppliersCreated}`);
  console.log(`Proveedores reutilizados: ${stats.suppliersReused}`);
  console.log(`Facturas creadas:         ${stats.invoicesCreated}`);
  console.log(`Saltadas (duplicadas):    ${stats.invoicesSkippedDup}`);
  console.log(
    `Saltadas (tipo no soportado): ${stats.invoicesSkippedType} (recibos/honorarios/etc.)`,
  );
  console.log(`Saltadas (datos faltantes): ${stats.invoicesSkippedBadData}`);
  console.log(`Errores:                  ${stats.errors}`);
  if (args.dryRun) {
    console.log("\n(dry-run: nada se escribió en la DB)");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
