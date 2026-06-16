"use client";

import { Table2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Friendly label per tool name, for both the running state and the artifact. */
const TOOL_LABELS: Record<string, string> = {
  getClientAging: "Aging de clientes",
  getInvoices: "Comprobantes",
  getReceipts: "Recibos",
  searchClients: "Clientes",
  getSupplierAging: "Aging de proveedores",
  getPurchaseInvoices: "Facturas de compra",
  getPaymentOrders: "Órdenes de pago",
  searchSuppliers: "Proveedores",
  getTreasurySummary: "Tesorería",
  getTrialBalance: "Balance de saldos",
  getLedger: "Libro mayor",
  getLibroIvaVentas: "IVA Ventas",
  getLibroIvaCompras: "IVA Compras",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "datos";
}

const MONEY_KEY =
  /total|saldo|importe|imp_|amount|monto|neto|iva|debe|haber|debit|credit|balance|running|bucket|open/i;
const MAX_ROWS = 8;
const MAX_COLS = 5;

type Col = { key: string; label: string };

/** Curated columns per tool; falls back to a generic derivation when absent. */
const COLUMN_HINTS: Record<string, Col[]> = {
  getClientAging: [
    { key: "client_legal_name", label: "Cliente" },
    { key: "total_open", label: "Total" },
    { key: "bucket_90_plus", label: "+90d" },
    { key: "document_count", label: "Comp." },
  ],
  getSupplierAging: [
    { key: "supplier_legal_name", label: "Proveedor" },
    { key: "total_open", label: "Total" },
    { key: "bucket_90_plus", label: "+90d" },
    { key: "document_count", label: "Comp." },
  ],
  getInvoices: [
    { key: "numero", label: "N°" },
    { key: "client_legal_name", label: "Cliente" },
    { key: "fecha", label: "Fecha" },
    { key: "imp_total", label: "Total" },
    { key: "status", label: "Estado" },
  ],
  getReceipts: [
    { key: "numero", label: "N°" },
    { key: "client_legal_name", label: "Cliente" },
    { key: "receipt_date", label: "Fecha" },
    { key: "total_amount", label: "Importe" },
    { key: "status", label: "Estado" },
  ],
  getPurchaseInvoices: [
    { key: "numero", label: "N°" },
    { key: "supplier_legal_name", label: "Proveedor" },
    { key: "fecha", label: "Fecha" },
    { key: "imp_total", label: "Total" },
    { key: "status", label: "Estado" },
  ],
  getPaymentOrders: [
    { key: "numero", label: "N°" },
    { key: "supplier_legal_name", label: "Proveedor" },
    { key: "total_amount", label: "Importe" },
    { key: "status", label: "Estado" },
  ],
  searchClients: [
    { key: "legal_name", label: "Cliente" },
    { key: "cuit", label: "CUIT" },
    { key: "iva_condition", label: "IVA" },
  ],
  searchSuppliers: [
    { key: "legal_name", label: "Proveedor" },
    { key: "cuit", label: "CUIT" },
    { key: "iva_condition", label: "IVA" },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pull a row array out of a tool's `data`: either the array itself, or the
 *  first array-of-objects property (e.g. `clients`, `items`, `rows`). */
function resolveRows(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) {
    const rows = data.filter(isRecord);
    return rows.length ? rows : null;
  }
  if (isRecord(data)) {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) {
        const rows = value.filter(isRecord);
        if (rows.length) return rows;
      }
    }
  }
  return null;
}

function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveColumns(
  toolName: string,
  rows: Record<string, unknown>[],
): Col[] {
  const first = rows[0] ?? {};
  const hinted = COLUMN_HINTS[toolName];
  if (hinted) {
    const present = hinted.filter((c) => c.key in first);
    if (present.length) return present.slice(0, MAX_COLS);
  }
  return Object.keys(first)
    .filter((k) => !/_id$|^id$/i.test(k))
    .slice(0, MAX_COLS)
    .map((k) => ({ key: k, label: prettifyKey(k) }));
}

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return MONEY_KEY.test(key)
      ? `$${Math.round(value).toLocaleString("es-AR")}`
      : value.toLocaleString("es-AR");
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  const s = String(value);
  if (/(_at$|fecha|date)/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/**
 * Renders a tool result's `data` as a compact inline table. Generic: works for
 * any tool whose data is an array (or holds one), so new tools render for free.
 * When nothing tabular is found it falls back to a one-line label.
 */
export function ToolArtifact({
  toolName,
  output,
}: {
  toolName: string;
  output: unknown;
}) {
  const label = toolLabel(toolName);
  const data = isRecord(output) ? output.data : undefined;
  const rows = resolveRows(data);

  if (!rows) {
    return (
      <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
        <Table2 className="size-3" /> {label}
      </p>
    );
  }

  const columns = deriveColumns(toolName, rows);
  const shown = rows.slice(0, MAX_ROWS);
  const extra = rows.length - shown.length;

  return (
    <div className="mt-2 overflow-hidden rounded-md border text-xs">
      <div className="text-muted-foreground flex items-center gap-1 border-b px-2 py-1">
        <Table2 className="size-3" /> {label}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-muted-foreground border-b">
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-1 text-left font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {columns.map((c) => {
                  const numeric = typeof row[c.key] === "number";
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "px-2 py-1",
                        numeric && "text-right tabular-nums",
                      )}
                    >
                      {formatCell(c.key, row[c.key])}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {extra > 0 && (
        <div className="text-muted-foreground px-2 py-1 text-[11px]">
          +{extra} más
        </div>
      )}
    </div>
  );
}
