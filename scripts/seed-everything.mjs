#!/usr/bin/env node
// Comprehensive dev seed. Run AFTER `supabase db reset`.
//
// What it does (in order):
//   1. Ensures dev user (tomas@jouve.test / Test1234!) with `owner` role.
//   2. Imports AFIP "Mis Comprobantes" exports:
//        * Recibidos (compras)  → suppliers + purchase_invoices
//        * Emitidos  (ventas)   → clients   + invoices (status='emitted')
//      Walks every .txt under each dir; idempotent via unique constraints.
//   3. Synthesizes operational data so every UI flow has rows to play
//      with: receipts (with checks), payment orders (with endorsed +
//      issued checks), standalone transactions, transfers, client and
//      supplier opening balances. Only runs when the target tables are
//      empty so re-running the script is safe.
//
// Usage:
//   pnpm seed:all                            # full run, default paths
//   pnpm seed:all --skip-import              # only synth ops data
//   pnpm seed:all --skip-ops                 # only AFIP imports
//   pnpm seed:all --purchases <file>         # override purchases path
//   pnpm seed:all --sales <dir-or-file>      # override sales path
//   pnpm seed:all --years 2024,2025          # filter sales by year
//   pnpm seed:all --max-invoices 500         # cap per direction (debug)
//
// Defaults point to the user's local AFIP exports; pass --skip-import if
// running on a clean machine without those files.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ENV_PATH = join(ROOT, ".env.local");

const HOME = process.env.HOME || "";
const DEFAULT_PURCHASES = join(
  HOME,
  "Downloads",
  "comprobantes_consulta_txt_recibidos_179939765_30714637432_20260514-1456 (montos expresados en pesos).txt",
);
const DEFAULT_SALES_DIR = join(HOME, "Downloads", "ventas iva");

// ---------------------------------------------------------------------------
// AFIP code maps
// ---------------------------------------------------------------------------
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
};

const CBTE_TIPO = {
  factura: { A: 1, B: 6, C: 11 },
  nd: { A: 2, B: 7, C: 12 },
  nc: { A: 3, B: 8, C: 13 },
};

// CondicionIVAReceptorId codes (RG 5616).
const COND_IVA = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributo: 6,
  no_categorizado: 7,
};

// Letter → defaulted iva condition when minting a fresh client/supplier.
const IVA_BY_LETTER = {
  A: "responsable_inscripto",
  B: "consumidor_final",
  C: "monotributo",
};

// PV → channel mapping mirrors supabase/seed.sql.
const PV_TO_CHANNEL = {
  3: "jouve_fiscal",
  4: "dz_fiscal",
  1: "jouve_internal",
  2: "dz_internal",
};

// Sanity cap for imp_total. AFIP's "Mis Comprobantes" export sometimes
// contains user-entered errors (e.g. an invoice with a 13-digit amount
// from a single typo that was later annulled with a matching NC). Both
// the bogus factura and its NC land in the export, polluting reports
// with a 2.3-trillion-peso outlier. 100 B ARS is a generous ceiling
// that still leaves real high-nominal late-2025 invoices intact.
const IMP_TOTAL_SANITY_CAP = 1e11;

// ---------------------------------------------------------------------------
// Args + env
// ---------------------------------------------------------------------------
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
  const args = {
    purchases: DEFAULT_PURCHASES,
    sales: DEFAULT_SALES_DIR,
    skipImport: false,
    skipOps: false,
    years: null,
    maxInvoices: null,
    email: "tomas@jouve.test",
    password: "Test1234!",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--skip-import") args.skipImport = true;
    else if (a === "--skip-ops") args.skipOps = true;
    else if (a === "--purchases") args.purchases = argv[++i];
    else if (a === "--sales") args.sales = argv[++i];
    else if (a === "--years") args.years = argv[++i].split(",").map((y) => y.trim());
    else if (a === "--max-invoices") args.maxInvoices = Number.parseInt(argv[++i], 10);
    else if (a === "--email") args.email = argv[++i];
    else if (a === "--password") args.password = argv[++i];
  }
  return args;
}

// ---------------------------------------------------------------------------
// Parsing utils
// ---------------------------------------------------------------------------
function parseDate(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const [d, m, y] = ddmmyyyy.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseNumber(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (s === "") return 0;
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function readTsv(path) {
  let raw;
  try {
    raw = readFileSync(path, "latin1");
  } catch {
    raw = readFileSync(path, "utf-8");
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => line.split("\t"));
}

function listFiles(target) {
  const st = statSync(target);
  if (st.isFile()) return [target];
  return readdirSync(target)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .map((f) => join(target, f))
    .sort();
}

// Deterministic FNV-1a hash for stable seeded picks (issue/idempotency keys).
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// User + role
// ---------------------------------------------------------------------------
async function ensureDevUser(supabase, email, password) {
  let userId = null;
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const match = data.users.find((u) => u.email === email);
    if (match) {
      userId = match.id;
      break;
    }
    if (data.users.length < 200) break;
    page += 1;
  }
  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    userId = data.user.id;
  }
  const { error: roleErr } = await supabase
    .from("user_roles")
    .upsert(
      { user_id: userId, role_id: "owner", granted_by: userId },
      { onConflict: "user_id,role_id", ignoreDuplicates: true },
    );
  if (roleErr) throw new Error(`grant role: ${roleErr.message}`);
  return userId;
}

// ---------------------------------------------------------------------------
// AFIP purchases import
// ---------------------------------------------------------------------------
function parsePurchaseRows(path) {
  const rows = [];
  for (const cols of readTsv(path)) {
    if (cols.length < 30) continue;
    const tipo = Number.parseInt(cols[1], 10);
    const mapping = AFIP_TIPO_MAP[tipo];
    if (!mapping) continue;
    const fecha = parseDate(cols[0]);
    const pv = Number.parseInt(cols[2], 10);
    const numero = Number.parseInt(cols[3], 10);
    const cuit = (cols[7] ?? "").replace(/[^0-9]/g, "");
    if (!fecha || !pv || !numero || !cuit || cuit.length !== 11) continue;
    const imp_total = parseNumber(cols[29]);
    if (imp_total > IMP_TOTAL_SANITY_CAP) continue;
    const imp_iva = parseNumber(cols[28]);
    const imp_trib = parseNumber(cols[27]);
    // Same per-cent rounding fix as for sales; auto-journal requires
    // imp_neto + imp_iva + imp_trib == imp_total exactly.
    const imp_neto = Math.round((imp_total - imp_iva - imp_trib) * 100) / 100;
    rows.push({
      tipo,
      kind: mapping.kind,
      letter: mapping.letter,
      fecha,
      pv,
      numero,
      cae: (cols[5] ?? "").trim() || null,
      cuit,
      legal_name: (cols[8] ?? "").trim().slice(0, 120),
      moneda: (cols[12] ?? "").trim() === "$" ? "PES" : "DOL",
      imp_neto,
      imp_iva,
      imp_trib,
      imp_total,
    });
  }
  return rows;
}

function parseSalesRows(path) {
  const rows = [];
  for (const cols of readTsv(path)) {
    if (cols.length < 28) continue;
    const tipo = Number.parseInt(cols[1], 10);
    const mapping = AFIP_TIPO_MAP[tipo];
    if (!mapping) continue;
    const fecha = parseDate(cols[0]);
    const pv = Number.parseInt(cols[2], 10);
    const numero = Number.parseInt(cols[3], 10);
    const docTipo = Number.parseInt(cols[6], 10);
    const docNro = (cols[7] ?? "").replace(/[^0-9]/g, "");
    if (!fecha || !pv || !numero || !docNro) continue;
    const imp_total = parseNumber(cols[27]);
    if (imp_total > IMP_TOTAL_SANITY_CAP) continue;
    const imp_iva = parseNumber(cols[26]);
    const imp_trib = parseNumber(cols[25]);
    const imp_op_ex = parseNumber(cols[24]);
    // AFIP's printed imp_neto can differ from (imp_total − iva − trib − opex)
    // by ±1 cent due to per-line rounding. The auto-journal trigger
    // requires Σdebit = Σcredit exactly, so we snap imp_neto to absorb
    // the rounding while preserving the reported imp_iva/imp_trib/imp_total.
    const imp_neto = Math.round((imp_total - imp_iva - imp_trib - imp_op_ex) * 100) / 100;
    rows.push({
      tipo,
      kind: mapping.kind,
      letter: mapping.letter,
      fecha,
      pv,
      numero,
      cae: (cols[5] ?? "").trim() || null,
      doc_tipo: docTipo || 99,
      doc_nro: docNro,
      receptor_name: (cols[8] ?? "").trim().slice(0, 120),
      moneda: (cols[10] ?? "").trim() === "$" ? "PES" : "DOL",
      imp_neto,
      imp_iva,
      imp_trib,
      imp_op_ex,
      imp_total,
    });
  }
  return rows;
}

async function chunked(rows, size, fn) {
  let i = 0;
  while (i < rows.length) {
    const batch = rows.slice(i, i + size);
    await fn(batch, i);
    i += size;
  }
}

async function importPurchases(supabase, path, opts) {
  console.log(`→ Compras AFIP: ${path}`);
  const rows = parsePurchaseRows(path);
  console.log(`  ${rows.length} filas válidas`);
  if (opts.maxInvoices) rows.splice(opts.maxInvoices);

  // Dedup suppliers by CUIT (keep first legal_name + a best-guess iva).
  const supplierByCuit = new Map();
  for (const r of rows) {
    if (!supplierByCuit.has(r.cuit)) {
      supplierByCuit.set(r.cuit, {
        cuit: r.cuit,
        legal_name: r.legal_name || `Proveedor ${r.cuit}`,
        iva_condition: IVA_BY_LETTER[r.letter] || "responsable_inscripto",
      });
    }
  }

  const suppliers = [...supplierByCuit.values()];
  console.log(`  ${suppliers.length} proveedores únicos`);
  let supplierInsert = 0;
  await chunked(suppliers, 500, async (batch) => {
    const { error } = await supabase
      .from("suppliers")
      .upsert(batch, { onConflict: "cuit", ignoreDuplicates: true });
    if (error) throw new Error(`suppliers upsert: ${error.message}`);
    supplierInsert += batch.length;
  });

  // Map cuit → supplier_id (re-fetch since upsert with ignoreDuplicates
  // doesn't return rows reliably).
  const { data: supplierRows, error: supErr } = await supabase
    .from("suppliers")
    .select("id, cuit")
    .in("cuit", [...supplierByCuit.keys()]);
  if (supErr) throw new Error(`fetch suppliers: ${supErr.message}`);
  const supplierIdByCuit = new Map(supplierRows.map((s) => [s.cuit, s.id]));

  // Apply category + default channel for known patterns.
  const { data: cats } = await supabase
    .from("supplier_categories")
    .select("id, slug");
  const catBySlug = new Map((cats || []).map((c) => [c.slug, c.id]));
  await assignSupplierCategories(supabase, supplierRows, catBySlug);

  // Bulk insert purchase invoices.
  let invInserted = 0;
  let invSkipped = 0;
  const dedupeKeys = new Set();
  const invoiceRows = [];
  for (const r of rows) {
    const supplierId = supplierIdByCuit.get(r.cuit);
    if (!supplierId) continue;
    const channelId = PV_TO_CHANNEL[r.pv] ?? "jouve_fiscal";
    const key = `${supplierId}|${r.kind}|${r.letter}|${r.pv}|${r.numero}`;
    if (dedupeKeys.has(key)) continue;
    dedupeKeys.add(key);
    invoiceRows.push({
      channel_id: channelId,
      supplier_id: supplierId,
      kind: r.kind,
      letter: r.letter,
      punto_venta: r.pv,
      numero: r.numero,
      fecha: r.fecha,
      imp_neto: r.imp_neto,
      imp_iva: r.imp_iva,
      imp_trib: r.imp_trib,
      imp_total: r.imp_total,
      moneda: r.moneda,
      cae_proveedor: r.cae,
      status: "received",
    });
  }
  console.log(`  ${invoiceRows.length} facturas (post-dedup) a insertar`);
  await chunked(invoiceRows, 500, async (batch) => {
    const { error, data } = await supabase
      .from("purchase_invoices")
      .upsert(batch, {
        onConflict: "supplier_id,kind,letter,punto_venta,numero",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(`purchase_invoices upsert: ${error.message}`);
    invInserted += data?.length ?? 0;
    invSkipped += batch.length - (data?.length ?? 0);
  });
  console.log(`  ↑ creadas ${invInserted}, ya existentes ${invSkipped}`);
  return { suppliers: supplierInsert, invoices: invInserted };
}

async function assignSupplierCategories(supabase, suppliers, catBySlug) {
  // Simple heuristic: certain keywords in legal_name → category.
  const rules = [
    [/ypf|axion|shell|petrobras|combustible|estacion/i, "combustible"],
    [/repuest|autopart|neumat|bateria/i, "repuestos"],
    [/taller|service|mecan|chapa|pintur/i, "mantenimiento"],
    [/oficina|papeler|libreri|imprent/i, "oficina"],
    [/seguros?|abogad|estudio|contad|consultor|escribano|inmobiliar/i, "servicios"],
  ];
  const updates = [];
  for (const s of suppliers) {
    const name = (s.legal_name || "").toLowerCase();
    for (const [re, slug] of rules) {
      if (re.test(name) && catBySlug.has(slug)) {
        updates.push({ id: s.id, category_id: catBySlug.get(slug) });
        break;
      }
    }
  }
  if (!updates.length) return;
  // One UPDATE per row keeps it simple; the dataset is small here.
  for (const u of updates) {
    await supabase.from("suppliers").update({ category_id: u.category_id }).eq("id", u.id);
  }
  console.log(`  ${updates.length} proveedores con categoría asignada`);
}

async function importSales(supabase, target, opts) {
  console.log(`→ Ventas AFIP: ${target}`);
  const files = listFiles(target);
  console.log(`  ${files.length} archivo(s)`);

  const all = [];
  for (const f of files) {
    const rows = parseSalesRows(f);
    if (opts.years) {
      const filtered = rows.filter((r) => opts.years.includes(r.fecha.slice(0, 4)));
      all.push(...filtered);
    } else {
      all.push(...rows);
    }
  }
  console.log(`  ${all.length} comprobantes válidos`);
  if (opts.maxInvoices) all.splice(opts.maxInvoices);

  // Dedup clients by doc_nro (CUIT) — only DocTipo 80 enters the clients
  // table; DNI / CF receivers don't have a stable identity for our master.
  const clientByCuit = new Map();
  for (const r of all) {
    if (r.doc_tipo !== 80) continue;
    if (r.doc_nro.length !== 11) continue;
    if (!clientByCuit.has(r.doc_nro)) {
      clientByCuit.set(r.doc_nro, {
        cuit: r.doc_nro,
        legal_name: r.receptor_name || `Cliente ${r.doc_nro}`,
        iva_condition: IVA_BY_LETTER[r.letter] || "responsable_inscripto",
      });
    }
  }
  console.log(`  ${clientByCuit.size} clientes únicos (CUIT)`);
  await chunked([...clientByCuit.values()], 500, async (batch) => {
    const { error } = await supabase
      .from("clients")
      .upsert(batch, { onConflict: "cuit", ignoreDuplicates: true });
    if (error) throw new Error(`clients upsert: ${error.message}`);
  });

  // Add a synthetic "Consumidor Final" client to anchor DNI/CF receivers
  // since clients.client_id is NOT NULL on invoices.
  const cfCuit = "00000000000";
  await supabase
    .from("clients")
    .upsert(
      [
        {
          cuit: cfCuit,
          legal_name: "CONSUMIDOR FINAL",
          iva_condition: "consumidor_final",
        },
      ],
      { onConflict: "cuit", ignoreDuplicates: true },
    );

  // PostgREST caps responses at 1000 rows by default, and the clients
  // table grows past that quickly. Re-fetch in chunks by CUIT to make
  // sure every imported client lands in the lookup map.
  const allCuits = [...clientByCuit.keys(), cfCuit];
  const clientIdByCuit = new Map();
  for (let i = 0; i < allCuits.length; i += 500) {
    const slice = allCuits.slice(i, i + 500);
    const { data, error } = await supabase
      .from("clients")
      .select("id, cuit")
      .in("cuit", slice);
    if (error) throw new Error(`fetch clients: ${error.message}`);
    for (const c of data) clientIdByCuit.set(c.cuit, c.id);
  }
  const cfId = clientIdByCuit.get(cfCuit);

  // Bulk insert sales invoices.
  let invInserted = 0;
  let invSkippedNc = 0;
  const dedupe = new Set();
  const invoiceRows = [];
  for (const r of all) {
    // The invoices table enforces "NC/ND requires invoice_origin_id". The
    // AFIP "Comprobantes Emitidos" export doesn't carry the origin
    // reference, so historical NC/ND can't be reconstructed in bulk —
    // skip them. The user can re-issue NC/ND through the app to exercise
    // that flow.
    if (r.kind !== "factura") {
      invSkippedNc += 1;
      continue;
    }
    const channelId = PV_TO_CHANNEL[r.pv] ?? "jouve_fiscal";
    let clientId =
      r.doc_tipo === 80 && r.doc_nro.length === 11
        ? clientIdByCuit.get(r.doc_nro)
        : cfId;
    if (!clientId) clientId = cfId;
    const key = `${channelId}|${r.pv}|${r.kind}|${r.letter}|${r.numero}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    // Pick condicion IVA receptor based on letter + receipt identity.
    let condIvaRec = COND_IVA.consumidor_final;
    if (r.letter === "A") condIvaRec = COND_IVA.responsable_inscripto;
    else if (r.letter === "B") {
      condIvaRec =
        r.doc_tipo === 80 ? COND_IVA.monotributo : COND_IVA.consumidor_final;
    } else if (r.letter === "C") condIvaRec = COND_IVA.monotributo;
    invoiceRows.push({
      channel_id: channelId,
      client_id: clientId,
      kind: r.kind,
      letter: r.letter,
      punto_venta: r.pv,
      numero: r.numero,
      fecha: r.fecha,
      concepto: 1,
      doc_tipo: r.doc_tipo,
      doc_nro: r.doc_nro || "0",
      iva_condition_receptor: condIvaRec,
      cbte_tipo_afip: CBTE_TIPO[r.kind][r.letter],
      imp_neto: r.imp_neto,
      imp_iva: r.imp_iva,
      imp_trib: r.imp_trib,
      imp_op_ex: r.imp_op_ex,
      imp_total: r.imp_total,
      moneda: r.moneda,
      cae: r.cae,
      status: "emitted",
      emitted_at: `${r.fecha}T12:00:00Z`,
      idempotency_key: `afip-${r.pv}-${r.kind}-${r.letter}-${r.numero}-${fnv1a(r.fecha)}`,
    });
  }
  console.log(`  ${invoiceRows.length} comprobantes a insertar`);
  await chunked(invoiceRows, 500, async (batch) => {
    const { error, data } = await supabase
      .from("invoices")
      .upsert(batch, {
        onConflict: "idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(`invoices upsert: ${error.message}`);
    invInserted += data?.length ?? 0;
  });
  console.log(`  ↑ ${invInserted} insertadas, ${invSkippedNc} NC/ND skipped (sin origen)`);
  return { clients: clientByCuit.size, invoices: invInserted };
}

// ---------------------------------------------------------------------------
// Operational data synthesis
// ---------------------------------------------------------------------------
async function tableEmpty(supabase, table) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return (count ?? 0) === 0;
}

async function fetchAccounts(supabase) {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, type, currency");
  if (error) throw new Error(`fetch accounts: ${error.message}`);
  const byKey = {
    cashArs: data.find((a) => a.name === "Caja General" && a.currency === "ARS"),
    bankGalicia: data.find((a) => a.name === "Banco Galicia"),
    bankMacro: data.find((a) => a.name === "Banco Macro"),
    bankProv: data.find((a) => a.name === "Banco Provincia"),
    bankNacion: data.find((a) => a.name === "Banco Nación"),
    checks: data.find((a) => a.type === "checks" && a.currency === "ARS"),
    echeq: data.find((a) => a.type === "echeq" && a.currency === "ARS"),
    wallet: data.find((a) => a.type === "wallet"),
    cashUsd: data.find((a) => a.currency === "USD" && a.type === "cash"),
    bankUsd: data.find((a) => a.currency === "USD" && a.type === "bank"),
  };
  return byKey;
}

async function nextNumero(supabase, table, channelId, pv) {
  const { data, error } = await supabase
    .from(table)
    .select("numero")
    .eq("channel_id", channelId)
    .eq("punto_venta", pv)
    .order("numero", { ascending: false })
    .limit(1);
  if (error) throw new Error(`next numero ${table}: ${error.message}`);
  return ((data?.[0]?.numero) ?? 0) + 1;
}

async function synthReceipts(supabase, accounts) {
  if (!(await tableEmpty(supabase, "receipts"))) {
    console.log("  recibos: ya hay datos, skip");
    return 0;
  }
  console.log("→ Sintetizando recibos de cobro");
  // Pick the top-N clients by open invoices and pay a chunk per client.
  const { data: openDocs, error } = await supabase
    .from("v_aging_documents")
    .select("invoice_id, client_id, open_amount, channel_id, channel_is_fiscal, fecha")
    .gt("open_amount", 0)
    .order("fecha", { ascending: false })
    .limit(800);
  if (error) throw new Error(`v_aging_documents: ${error.message}`);
  if (!openDocs?.length) {
    console.log("  no hay facturas abiertas; skip");
    return 0;
  }

  // Group by client; cap to top 40 clients.
  const byClient = new Map();
  for (const d of openDocs) {
    if (!byClient.has(d.client_id)) byClient.set(d.client_id, []);
    byClient.get(d.client_id).push(d);
  }
  const clients = [...byClient.entries()].slice(0, 40);

  let n = 0;
  for (const [clientId, docs] of clients) {
    const docsForReceipt = docs.slice(0, 3);
    const total = docsForReceipt.reduce((s, d) => s + Number(d.open_amount), 0);
    if (total <= 0) continue;
    const channelId = docsForReceipt[0].channel_id;
    const pv = channelId.endsWith("fiscal") ? (channelId.startsWith("jouve") ? 3 : 4) : channelId.startsWith("jouve") ? 1 : 2;
    const numero = await nextNumero(supabase, "receipts", channelId, pv);
    // Spread the recibo date a few days after the latest doc.
    const baseDate = new Date(docsForReceipt[0].fecha);
    baseDate.setDate(baseDate.getDate() + 5 + (n % 10));
    const recDate = baseDate.toISOString().slice(0, 10);

    // Build a mix of payment lines: cash, bank transfer, sometimes a check.
    const lines = [];
    let remaining = round2(total);
    // 50% bank, 30% cash, 20% check
    const bankSlice = round2(remaining * 0.5);
    lines.push({
      account_id: accounts.bankGalicia.id,
      amount: bankSlice,
      reference: "Transferencia",
    });
    remaining = round2(remaining - bankSlice);
    if (remaining > 0 && n % 3 === 0 && accounts.checks) {
      const checkSlice = round2(remaining * 0.6);
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 30 + (n % 30));
      lines.push({
        account_id: accounts.checks.id,
        amount: checkSlice,
        reference: `CHK-${100000 + n}`,
        check: {
          check_number: String(100000 + n),
          bank_name: ["Banco Galicia", "Banco Provincia", "Banco Macro"][n % 3],
          drawer_name: `Cliente ${clientId.slice(0, 8)}`,
          issue_date: recDate,
          due_date: dueDate.toISOString().slice(0, 10),
        },
      });
      remaining = round2(remaining - checkSlice);
    }
    if (remaining > 0) {
      lines.push({
        account_id: accounts.cashArs.id,
        amount: remaining,
        reference: "Efectivo",
      });
    }

    const sumLines = lines.reduce((s, l) => s + l.amount, 0);
    const allocations = docsForReceipt.map((d) => ({
      invoice_id: d.invoice_id,
      amount_applied: round2(Number(d.open_amount)),
    }));
    const allocSum = allocations.reduce((s, a) => s + a.amount_applied, 0);
    // The RPC validates payment_lines + retentions == total. Use sumLines.
    const { error: rpcErr } = await supabase.rpc("create_receipt", {
      p_channel_id: channelId,
      p_punto_venta: pv,
      p_numero: numero,
      p_client_id: clientId,
      p_recibo_date: recDate,
      p_total_amount: sumLines,
      p_currency: "ARS",
      p_notes: `Cobro sintético #${numero}`,
      p_payment_lines: lines,
      p_allocations: allocSum > sumLines ? [] : allocations,
      p_retentions: [],
    });
    if (rpcErr) {
      console.warn(`  recibo ${pv}-${numero}: ${rpcErr.message}`);
      continue;
    }
    n += 1;
  }
  console.log(`  ↑ ${n} recibos creados`);
  return n;
}

async function synthPaymentOrders(supabase, accounts) {
  if (!(await tableEmpty(supabase, "payment_orders"))) {
    console.log("  OPs: ya hay datos, skip");
    return 0;
  }
  console.log("→ Sintetizando órdenes de pago");
  const { data: openDocs, error } = await supabase
    .from("v_supplier_aging_documents")
    .select("purchase_invoice_id, supplier_id, open_amount, channel_id, fecha")
    .gt("open_amount", 0)
    .order("fecha", { ascending: false })
    .limit(600);
  if (error) throw new Error(`v_supplier_aging_documents: ${error.message}`);
  if (!openDocs?.length) {
    console.log("  no hay facturas de compra abiertas; skip");
    return 0;
  }
  const bySupplier = new Map();
  for (const d of openDocs) {
    if (!bySupplier.has(d.supplier_id)) bySupplier.set(d.supplier_id, []);
    bySupplier.get(d.supplier_id).push(d);
  }
  const suppliers = [...bySupplier.entries()].slice(0, 30);
  let n = 0;
  for (const [supplierId, docs] of suppliers) {
    const slice = docs.slice(0, 2);
    const total = slice.reduce((s, d) => s + Number(d.open_amount), 0);
    if (total <= 0) continue;
    const channelId = slice[0].channel_id;
    const pv = channelId.endsWith("fiscal") ? (channelId.startsWith("jouve") ? 3 : 4) : channelId.startsWith("jouve") ? 1 : 2;
    const numero = await nextNumero(supabase, "payment_orders", channelId, pv);
    const baseDate = new Date(slice[0].fecha);
    baseDate.setDate(baseDate.getDate() + 8 + (n % 7));
    const payDate = baseDate.toISOString().slice(0, 10);

    const lines = [];
    let remaining = round2(total);

    // Every 4th OP issues a propio check.
    if (n % 4 === 0 && accounts.bankGalicia) {
      const slicePart = round2(remaining * 0.5);
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + 30);
      lines.push({
        line_kind: "issue_check",
        account_id: accounts.bankGalicia.id,
        amount: slicePart,
        issued_check: {
          kind: "fisico",
          check_number: `9${(200000 + n).toString().padStart(7, "0")}`,
          bank_name: "Banco Galicia",
          beneficiary_name: `Proveedor ${supplierId.slice(0, 8)}`,
          issue_date: payDate,
          due_date: dueDate.toISOString().slice(0, 10),
        },
      });
      remaining = round2(remaining - slicePart);
    }

    // Half by bank transfer.
    if (remaining > 0) {
      const slicePart = round2(remaining * 0.6);
      lines.push({
        line_kind: "account",
        account_id: accounts.bankProv?.id ?? accounts.bankGalicia.id,
        amount: slicePart,
        reference: "Transferencia bancaria",
      });
      remaining = round2(remaining - slicePart);
    }
    // Rest in cash.
    if (remaining > 0) {
      lines.push({
        line_kind: "account",
        account_id: accounts.cashArs.id,
        amount: remaining,
        reference: "Efectivo",
      });
    }

    const sumLines = lines.reduce((s, l) => s + l.amount, 0);
    const allocations = slice.map((d) => ({
      purchase_invoice_id: d.purchase_invoice_id,
      amount_applied: round2(Number(d.open_amount)),
    }));
    const allocSum = allocations.reduce((s, a) => s + a.amount_applied, 0);

    const { error: rpcErr } = await supabase.rpc("create_payment_order", {
      p_channel_id: channelId,
      p_punto_venta: pv,
      p_numero: numero,
      p_supplier_id: supplierId,
      p_payment_date: payDate,
      p_total_amount: sumLines,
      p_currency: "ARS",
      p_notes: `OP sintética #${numero}`,
      p_payment_lines: lines,
      p_allocations: allocSum > sumLines ? [] : allocations,
    });
    if (rpcErr) {
      console.warn(`  OP ${pv}-${numero}: ${rpcErr.message}`);
      continue;
    }
    n += 1;
  }
  console.log(`  ↑ ${n} OPs creadas`);
  return n;
}

async function synthManualChecks(supabase, accounts) {
  if (!accounts.checks) return 0;
  // Insert a handful of manual checks (independientes de recibos) for the
  // /checks page to have content beyond recibo-generated ones.
  const { count } = await supabase
    .from("checks")
    .select("id", { count: "exact", head: true })
    .eq("source_kind", "manual");
  if ((count ?? 0) > 0) {
    console.log("  cheques manuales: ya hay datos, skip");
    return 0;
  }
  console.log("→ Sintetizando cheques en cartera (manuales)");
  const today = new Date();
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const due = new Date(today);
    due.setDate(due.getDate() + 15 * (i + 1));
    rows.push({
      kind: i % 3 === 0 ? "echeq" : "fisico",
      check_number: String(500000 + i),
      bank_name: ["Banco Galicia", "Banco Provincia", "Banco Nación", "Banco Macro"][i % 4],
      drawer_name: `Cliente Manual ${i + 1}`,
      drawer_cuit: null,
      issue_date: today.toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      amount: 100000 * (i + 1),
      currency: "ARS",
      cartera_account_id: i % 3 === 0 ? accounts.echeq.id : accounts.checks.id,
      source_kind: "manual",
      status: "en_cartera",
    });
  }
  const { error, data } = await supabase.from("checks").insert(rows).select("id");
  if (error) throw new Error(`manual checks: ${error.message}`);
  // Add 'received' movements so the timeline isn't empty.
  if (data?.length) {
    const moves = data.map((c) => ({
      check_id: c.id,
      event: "received",
      event_date: today.toISOString().slice(0, 10),
    }));
    await supabase.from("check_movements").insert(moves);
  }
  console.log(`  ↑ ${rows.length} cheques en cartera`);
  return rows.length;
}

async function synthTransfers(supabase, accounts) {
  if (!(await tableEmpty(supabase, "transactions"))) {
    // transactions table already has rows from receipts/OPs; check for
    // standalone transfer pairs instead.
    const { count } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("kind", "transfer_in");
    if ((count ?? 0) > 0) {
      console.log("  transfers: ya hay datos, skip");
      return 0;
    }
  }
  console.log("→ Sintetizando transferencias entre cuentas");
  const pairs = [
    [accounts.cashArs, accounts.bankGalicia, 250000, "Depósito de caja en Galicia"],
    [accounts.bankGalicia, accounts.bankProv, 500000, "Transferencia inter-banco"],
    [accounts.bankMacro, accounts.cashArs, 150000, "Retiro efectivo Macro"],
    [accounts.wallet, accounts.bankGalicia, 80000, "Retiro de MP a banco"],
  ].filter(([a, b]) => a && b);
  let n = 0;
  for (const [from, to, amt, desc] of pairs) {
    const today = new Date();
    const d = new Date(today);
    d.setDate(d.getDate() - n * 3);
    const isoDate = d.toISOString().slice(0, 10);
    const accrual = isoDate.slice(0, 7) + "-01";
    const { error } = await supabase.rpc("create_transfer", {
      p_account_from_id: from.id,
      p_account_to_id: to.id,
      p_channel_id: "jouve_internal",
      p_amount: amt,
      p_currency: from.currency,
      p_transaction_date: isoDate,
      p_accrual_month: accrual,
      p_description: desc,
    });
    if (error) {
      console.warn(`  transfer ${from.name}→${to.name}: ${error.message}`);
      continue;
    }
    n += 1;
  }
  console.log(`  ↑ ${n} transferencias`);
  return n;
}

async function synthOpeningBalances(supabase) {
  // Insert directly into the tables — the RPCs require an authed user
  // with owner role, and the service-role context has no auth.uid().
  console.log("→ Sintetizando saldos de apertura (clientes + proveedores)");
  let n = 0;

  // Clients: top 5 by number of invoices.
  const { data: invSample } = await supabase
    .from("invoices")
    .select("client_id")
    .eq("status", "emitted")
    .limit(2000);
  const counts = new Map();
  for (const r of invSample || []) {
    counts.set(r.client_id, (counts.get(r.client_id) || 0) + 1);
  }
  const clientIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  for (const clientId of clientIds.slice(0, 5)) {
    // Pick opening_date = 2022-12-31, target = sum of invoices up to that date * 0.4
    const openingDate = "2022-12-31";
    const { data: prior } = await supabase
      .from("invoices")
      .select("imp_total")
      .eq("client_id", clientId)
      .eq("status", "emitted")
      .lte("fecha", openingDate)
      .in("kind", ["factura", "nd"]);
    const sumPrior = (prior || []).reduce((s, r) => s + Number(r.imp_total), 0);
    if (sumPrior <= 0) continue;
    const target = round2(sumPrior * 0.4);
    const settled = round2(sumPrior - target);
    if (settled <= 0) continue;
    // Insert header
    const { error: hErr } = await supabase
      .from("client_opening_balances")
      .upsert(
        {
          client_id: clientId,
          opening_date: openingDate,
          target_balance: target,
          total_settled: settled,
          notes: "Saldo de apertura sintético",
        },
        { onConflict: "client_id" },
      );
    if (hErr) {
      console.warn(`  opening client ${clientId}: ${hErr.message}`);
      continue;
    }
    // Allocate FIFO until exhausted.
    let remaining = settled;
    const { data: olderInvs } = await supabase
      .from("invoices")
      .select("id, imp_total")
      .eq("client_id", clientId)
      .eq("status", "emitted")
      .lte("fecha", openingDate)
      .in("kind", ["factura", "nd"])
      .order("fecha", { ascending: true })
      .order("numero", { ascending: true })
      .limit(200);
    const allocs = [];
    for (const inv of olderInvs || []) {
      if (remaining <= 0) break;
      const apply = Math.min(Number(inv.imp_total), remaining);
      if (apply <= 0) continue;
      allocs.push({ client_id: clientId, invoice_id: inv.id, amount_applied: round2(apply) });
      remaining = round2(remaining - apply);
    }
    if (allocs.length) {
      await supabase
        .from("client_opening_balance_allocations")
        .upsert(allocs, { onConflict: "invoice_id" });
    }
    n += 1;
  }
  console.log(`  ↑ ${n} client opening balances`);

  // Suppliers: same logic.
  const { data: spurchases } = await supabase
    .from("purchase_invoices")
    .select("supplier_id")
    .eq("status", "received")
    .limit(2000);
  const sCounts = new Map();
  for (const r of spurchases || []) {
    sCounts.set(r.supplier_id, (sCounts.get(r.supplier_id) || 0) + 1);
  }
  const topSuppliers = [...sCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
  let m = 0;
  for (const supplierId of topSuppliers) {
    // Compras AFIP en este export son todas 2025; el cutoff debe caer
    // dentro del rango para que las facturas previas existan.
    const openingDate = "2025-06-30";
    const { data: prior } = await supabase
      .from("purchase_invoices")
      .select("imp_total")
      .eq("supplier_id", supplierId)
      .eq("status", "received")
      .lte("fecha", openingDate)
      .in("kind", ["factura", "nd"]);
    const sumPrior = (prior || []).reduce((s, r) => s + Number(r.imp_total), 0);
    if (sumPrior <= 0) continue;
    const target = round2(sumPrior * 0.4);
    const settled = round2(sumPrior - target);
    if (settled <= 0) continue;
    const { error: hErr } = await supabase
      .from("supplier_opening_balances")
      .upsert(
        {
          supplier_id: supplierId,
          opening_date: openingDate,
          target_balance: target,
          total_settled: settled,
          notes: "Saldo de apertura sintético",
        },
        { onConflict: "supplier_id" },
      );
    if (hErr) {
      console.warn(`  opening supplier ${supplierId}: ${hErr.message}`);
      continue;
    }
    let remaining = settled;
    const { data: older } = await supabase
      .from("purchase_invoices")
      .select("id, imp_total")
      .eq("supplier_id", supplierId)
      .eq("status", "received")
      .lte("fecha", openingDate)
      .in("kind", ["factura", "nd"])
      .order("fecha", { ascending: true })
      .order("numero", { ascending: true })
      .limit(200);
    const allocs = [];
    for (const inv of older || []) {
      if (remaining <= 0) break;
      const apply = Math.min(Number(inv.imp_total), remaining);
      if (apply <= 0) continue;
      allocs.push({
        supplier_id: supplierId,
        purchase_invoice_id: inv.id,
        amount_applied: round2(apply),
      });
      remaining = round2(remaining - apply);
    }
    if (allocs.length) {
      await supabase
        .from("supplier_opening_balance_allocations")
        .upsert(allocs, { onConflict: "purchase_invoice_id" });
    }
    m += 1;
  }
  console.log(`  ↑ ${m} supplier opening balances`);
  return n + m;
}

async function synthIssuedChecks(supabase, accounts) {
  // OP synth already issues some checks; add a couple of manual ones
  // (no OP) so the /issued-checks page has variety.
  const { count } = await supabase
    .from("issued_checks")
    .select("id", { count: "exact", head: true })
    .is("payment_order_id", null);
  if ((count ?? 0) > 0) return 0;
  console.log("→ Sintetizando cheques propios manuales");
  const today = new Date();
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const due = new Date(today);
    due.setDate(due.getDate() + 45 + i * 7);
    rows.push({
      kind: i % 2 === 0 ? "fisico" : "echeq",
      check_number: `8${(700000 + i).toString().padStart(7, "0")}`,
      bank_name: "Banco Galicia",
      beneficiary_name: `Acreedor manual ${i + 1}`,
      issue_date: today.toISOString().slice(0, 10),
      due_date: due.toISOString().slice(0, 10),
      amount: 200000 + i * 50000,
      currency: "ARS",
      bank_account_id: accounts.bankGalicia.id,
      status: "emitted",
    });
  }
  const { error } = await supabase.from("issued_checks").insert(rows);
  if (error) throw new Error(`issued_checks: ${error.message}`);
  console.log(`  ↑ ${rows.length} cheques propios manuales`);
  return rows.length;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Synth employees (HR data — nombres y sueldos reales de la planilla MAYO 26)
// ---------------------------------------------------------------------------
//
// Source: /Users/tomasdziurdzia/Downloads/SUELDOS 2026.xlsx (sheet MAYO 26).
// Choferes: pay_frequency=semanal, base_salary NULL (cobran liquidación
// semanal + viático 20k/mes). Administrativos: pay_frequency=mensual con
// neto fijo y viático 20k. CBUs reales solo donde figuran en la planilla;
// CUIL queda NULL salvo donde lo sepamos (la planilla no los trae).
async function synthEmployees(supabase) {
  if (!(await tableEmpty(supabase, "employees"))) {
    console.log("→ employees: ya hay datos, skip");
    return 0;
  }
  console.log("→ Sintetizando empleados");

  const employees = [
    // Choferes (semanal, sin base_salary mensual)
    {
      legal_name: "Bartolomeo Axel",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2022-01-10",
    },
    {
      legal_name: "Cabral Agustin",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2021-06-15",
    },
    {
      legal_name: "Casco Maximiliano",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2020-09-01",
    },
    {
      legal_name: "Magnifico Pablo",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2019-03-12",
    },
    {
      legal_name: "Olmedo Ezequiel",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2022-11-05",
    },
    {
      legal_name: "Ramirez Matias",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2021-04-20",
    },
    {
      legal_name: "Sanchez Jorge",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2018-07-08",
    },
    {
      legal_name: "Santana Daniel",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2023-02-14",
    },
    {
      legal_name: "Villagra Jorge",
      position: "Chofer",
      pay_frequency: "semanal",
      base_salary: null,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2020-05-22",
    },

    // Administrativos (mensual, sueldo neto fijo)
    {
      legal_name: "Baez Martin",
      position: "Administrativo",
      pay_frequency: "mensual",
      base_salary: 1_181_838.95,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2021-08-01",
    },
    {
      legal_name: "Alejo Mauro",
      position: "Administrativo",
      cbu: "0070182830004024923814",
      pay_frequency: "mensual",
      base_salary: 1_155_528.64,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2022-03-15",
    },
    {
      legal_name: "Arias Juan Martin",
      position: "Administrativo",
      cbu: "0140022903717551619674",
      pay_frequency: "mensual",
      base_salary: 1_464_820.53,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2019-11-04",
    },
    {
      legal_name: "Parra Ma. Florencia",
      position: "Administrativa",
      pay_frequency: "mensual",
      base_salary: 2_120_689.4,
      viatico_monthly: 20000,
      is_monotributo: true,
      hire_date: "2018-02-19",
      notes:
        "Combina sueldo en relación de dependencia + factura monotributo (65k mensuales).",
    },
    {
      legal_name: "Reynoso Lucas",
      position: "Administrativo",
      pay_frequency: "mensual",
      base_salary: 1_699_360.37,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2020-06-10",
    },

    // Mecánico (mensual con neto fijo, pero recibe adelantos y mezcla cash)
    {
      legal_name: "Apesteguia Tete",
      position: "Mecánico de flota",
      cbu: "0720149988000000563486",
      pay_frequency: "mixto",
      base_salary: 1_531_827.46,
      viatico_monthly: 20000,
      is_monotributo: false,
      hire_date: "2017-09-25",
    },
  ];

  const { data, error } = await supabase
    .from("employees")
    .insert(employees)
    .select("id, legal_name, position");
  if (error) throw new Error(`employees insert: ${error.message}`);
  console.log(`  ↑ ${data.length} empleados creados`);

  // Documentos sample: para que el cron + UI tengan algo que mostrar.
  // Mix de: vencido (rojo), por vencer en 10/25 días (amarillo), vigente
  // 1 año (verde). Solo a choferes y mecánico (los admins no manejan).
  const today = new Date();
  const addDays = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const chofer = (name) =>
    data.find((e) => e.legal_name === name)?.id ?? null;

  const docsRaw = [
    // Bartolomeo Axel — carnet por vencer en 10 días (alerta inminente)
    [chofer("Bartolomeo Axel"), "licencia_conducir", "ABC123456", addDays(-365 * 4 + 10), addDays(10), "Categoría D2 — Municipalidad de Tigre"],
    // Cabral Agustin — LNH ya vencido (rojo)
    [chofer("Cabral Agustin"), "lnh", "LNH-554321", addDays(-365 * 2 - 30), addDays(-15), "CNRT"],
    // Casco Maximiliano — carnet vigente 2 años
    [chofer("Casco Maximiliano"), "licencia_conducir", "CSM998877", addDays(-365), addDays(730), "Categoría D2"],
    // Magnifico Pablo — psicofísica por vencer en 25 días
    [chofer("Magnifico Pablo"), "aptitud_psicofisica", null, addDays(-340), addDays(25), null],
    // Olmedo Ezequiel — curso cargas peligrosas vigente 6 meses
    [chofer("Olmedo Ezequiel"), "curso_cargas_peligrosas", "CCP-2023-456", addDays(-180), addDays(180), null],
    // Ramirez Matias — libreta sanitaria por vencer en 5 días (alerta crítica)
    [chofer("Ramirez Matias"), "libreta_sanitaria", null, addDays(-360), addDays(5), "Municipalidad de Tigre"],
    // Sanchez Jorge — carnet vencido hace 2 meses
    [chofer("Sanchez Jorge"), "licencia_conducir", "SJG112233", addDays(-365 * 5 - 60), addDays(-60), "Categoría D2"],
    // Apesteguia Tete (mecánico) — aptitud visual vigente 8 meses
    [chofer("Apesteguia Tete"), "aptitud_visual", null, addDays(-120), addDays(240), null],
  ].filter(([employeeId]) => employeeId);

  if (docsRaw.length > 0) {
    const docs = docsRaw.map(([employee_id, kind, number, issued_at, expires_at, issuing_authority]) => ({
      employee_id,
      kind,
      number,
      issued_at,
      expires_at,
      issuing_authority,
    }));
    const { error: docsErr } = await supabase
      .from("employee_documents")
      .insert(docs);
    if (docsErr) {
      console.warn(`  ⚠ documents skip: ${docsErr.message}`);
    } else {
      console.log(`  ↑ ${docs.length} documentos sample (vencidos, por vencer y vigentes)`);
    }
  }

  return data.length;
}

// ---------------------------------------------------------------------------
// Synth 2026 invoices (current year, missing from AFIP exports)
// ---------------------------------------------------------------------------
//
// The AFIP exports go up to 2025. We're operating in 2026 so the
// dashboards (planilla mensual, libro IVA, ventas-por-mes,
// cuenta corriente abierta) all look empty for the current year.
// This function fills Jan→May 2026 with believable monthly activity:
//   * ~25 sales invoices/month spread across both fiscal channels
//     (jouve_fiscal PV 3, dz_fiscal PV 4)
//   * ~10 purchase invoices/month for the same window
// All amounts stay in the 200k–4M ARS range so they look like
// late-2025/early-2026 ticket sizes without dwarfing prior years.
async function synth2026Invoices(supabase) {
  const { count: existing2026 } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .gte("fecha", "2026-01-01");
  if ((existing2026 ?? 0) > 0) {
    console.log("  facturas 2026: ya hay datos, skip");
    return 0;
  }
  console.log("→ Sintetizando facturas 2026 (ene–may)");

  // Pull a stable sample of clients with CUIT for letter A, and a
  // small set of CF/monotributo for letter B.
  const { data: clientsA } = await supabase
    .from("clients")
    .select("id, iva_condition")
    .eq("iva_condition", "responsable_inscripto")
    .limit(80);
  const { data: clientsB } = await supabase
    .from("clients")
    .select("id, iva_condition")
    .in("iva_condition", ["monotributo", "consumidor_final", "exento"])
    .limit(40);
  const cliA = clientsA ?? [];
  const cliB = clientsB ?? [];
  if (!cliA.length && !cliB.length) {
    console.log("  no hay clientes; skip");
    return 0;
  }

  // Resume per-channel counters from the existing max numero.
  const counters = {};
  for (const [pv, ch] of [
    [3, "jouve_fiscal"],
    [4, "dz_fiscal"],
  ]) {
    const { data } = await supabase
      .from("invoices")
      .select("numero")
      .eq("channel_id", ch)
      .eq("punto_venta", pv)
      .order("numero", { ascending: false })
      .limit(1);
    counters[ch] = (data?.[0]?.numero ?? 0) + 1;
  }

  const months = [
    { ym: "2026-01", days: 31 },
    { ym: "2026-02", days: 28 },
    { ym: "2026-03", days: 31 },
    { ym: "2026-04", days: 30 },
    { ym: "2026-05", days: 15 },
  ];

  const rows = [];
  let seq = 0;
  for (const { ym, days } of months) {
    const perMonth = 25;
    for (let i = 0; i < perMonth; i++) {
      const day = String(((i * 3 + 1) % days) + 1).padStart(2, "0");
      const fecha = `${ym}-${day}`;
      const useA = (seq % 3) !== 0; // ~66% letter A
      const channel = (seq % 2 === 0) ? "jouve_fiscal" : "dz_fiscal";
      const pv = channel === "jouve_fiscal" ? 3 : 4;
      const numero = counters[channel]++;
      const letter = useA ? "A" : "B";
      const pool = useA ? cliA : (cliB.length ? cliB : cliA);
      const client = pool[seq % pool.length];

      // Base neto in the 200k–4M ARS band, IVA 21%.
      const base = 200_000 + ((seq * 73 + 17) % 38) * 100_000;
      const imp_neto = round2(base);
      const imp_iva = round2(imp_neto * 0.21);
      const imp_total = round2(imp_neto + imp_iva);

      const condIvaRec =
        letter === "A"
          ? COND_IVA.responsable_inscripto
          : client.iva_condition === "monotributo"
            ? COND_IVA.monotributo
            : client.iva_condition === "exento"
              ? COND_IVA.exento
              : COND_IVA.consumidor_final;

      rows.push({
        channel_id: channel,
        client_id: client.id,
        kind: "factura",
        letter,
        punto_venta: pv,
        numero,
        fecha,
        concepto: 1,
        doc_tipo: 80,
        doc_nro: "0",
        iva_condition_receptor: condIvaRec,
        cbte_tipo_afip: CBTE_TIPO.factura[letter],
        imp_neto,
        imp_iva,
        imp_trib: 0,
        imp_op_ex: 0,
        imp_total,
        moneda: "PES",
        cae: `7${(70000000000000 + seq).toString().padStart(14, "0")}`,
        status: "emitted",
        emitted_at: `${fecha}T11:30:00Z`,
        idempotency_key: `seed2026-${channel}-${pv}-${numero}`,
      });
      seq += 1;
    }
  }

  let inserted = 0;
  await chunked(rows, 500, async (batch) => {
    const { error, data } = await supabase
      .from("invoices")
      .upsert(batch, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`invoices 2026 upsert: ${error.message}`);
    inserted += data?.length ?? 0;
  });
  console.log(`  ↑ ${inserted} facturas 2026 (ventas)`);

  // Compras 2026 — same window, smaller volume.
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, iva_condition")
    .limit(80);
  const supList = suppliers ?? [];
  if (!supList.length) {
    console.log("  no hay proveedores; skip compras 2026");
    return inserted;
  }
  const purchRows = [];
  let pseq = 0;
  for (const { ym, days } of months) {
    const perMonth = 10;
    for (let i = 0; i < perMonth; i++) {
      const day = String(((i * 5 + 2) % days) + 1).padStart(2, "0");
      const fecha = `${ym}-${day}`;
      const supplier = supList[pseq % supList.length];
      const letter = supplier.iva_condition === "responsable_inscripto" ? "A" : "B";
      // Suppliers use their own AFIP PV (we don't control them); fake
      // it as the supplier's CUIT mod 999 for variety.
      const pv = (pseq % 4) + 1;
      const numero = 50000 + pseq;
      const base = 100_000 + ((pseq * 41 + 9) % 30) * 80_000;
      const imp_neto = round2(base);
      const imp_iva = round2(imp_neto * 0.21);
      const imp_total = round2(imp_neto + imp_iva);
      // Default to jouve_fiscal for the receiving channel; suppliers
      // are not channel-scoped in real life, only the receiving side
      // is. PV_TO_CHANNEL is good enough here.
      const channel = "jouve_fiscal";
      purchRows.push({
        channel_id: channel,
        supplier_id: supplier.id,
        kind: "factura",
        letter,
        punto_venta: pv,
        numero,
        fecha,
        imp_neto,
        imp_iva,
        imp_trib: 0,
        imp_total,
        moneda: "PES",
        cae_proveedor: null,
        status: "received",
      });
      pseq += 1;
    }
  }
  let pInserted = 0;
  await chunked(purchRows, 500, async (batch) => {
    const { error, data } = await supabase
      .from("purchase_invoices")
      .upsert(batch, {
        onConflict: "supplier_id,kind,letter,punto_venta,numero",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(`purchase_invoices 2026 upsert: ${error.message}`);
    pInserted += data?.length ?? 0;
  });
  console.log(`  ↑ ${pInserted} facturas 2026 (compras)`);
  return inserted + pInserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
  });

  console.log("== seed-everything ==");
  console.log(`url: ${url}`);

  const userId = await ensureDevUser(supabase, args.email, args.password);
  console.log(`✓ dev user ${args.email} ready (id=${userId})`);

  if (!args.skipImport) {
    try {
      statSync(args.purchases);
      await importPurchases(supabase, args.purchases, args);
    } catch (e) {
      console.warn(`⚠ purchases skip: ${e.message}`);
    }
    try {
      statSync(args.sales);
      await importSales(supabase, args.sales, args);
    } catch (e) {
      console.warn(`⚠ sales skip: ${e.message}`);
    }
  } else {
    console.log("✓ --skip-import, no AFIP import");
  }

  if (!args.skipOps) {
    const accounts = await fetchAccounts(supabase);
    await synth2026Invoices(supabase);
    await synthReceipts(supabase, accounts);
    await synthPaymentOrders(supabase, accounts);
    await synthManualChecks(supabase, accounts);
    await synthIssuedChecks(supabase, accounts);
    await synthTransfers(supabase, accounts);
    await synthOpeningBalances(supabase);
    await synthEmployees(supabase);
  } else {
    console.log("✓ --skip-ops, no operational synthesis");
  }

  console.log("== done ==");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
