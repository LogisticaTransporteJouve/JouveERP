import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IMPORT_KINDS, type ImportKind } from "../schema";
import { IMPORT_FIELDS } from "./fields";

// The user manual documents each import kind's columns (docs/manual/
// admin.html#importador-<kind>): a column added to fields.ts without its
// line in the manual fails here.

const ANCHORS: Record<ImportKind, string> = {
  clients: "importador-clientes",
  suppliers: "importador-proveedores",
  employees: "importador-empleados",
  vehicles: "importador-vehiculos",
  historic_payroll: "importador-sueldos-historicos",
  historic_trips: "importador-viajes-historicos",
  client_tariffs: "importador-tarifas",
  loans: "importador-prestamos",
  checks: "importador-cheques",
  opening_balances: "importador-saldos",
  bank_statement: "importador-extracto",
};

const html = readFileSync(
  path.resolve(__dirname, "../../../docs/manual/admin.html"),
  "utf8",
);

/** The text from a section's heading to the next h2/h3. */
function section(anchor: string): string {
  const start = html.indexOf(`id="${anchor}"`);
  if (start < 0) return "";
  const rest = html.slice(start + anchor.length);
  const end = rest.search(/<h[23][\s>]/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("the manual's importer formats", () => {
  it.each(IMPORT_KINDS.map((k) => [k]))("%s lists every column", (kind) => {
    // Suppliers take the clients' columns ("las mismas columnas que
    // clientes") plus their own.
    const text =
      kind === "suppliers"
        ? section(ANCHORS.clients) + section(ANCHORS.suppliers)
        : section(ANCHORS[kind]);
    expect(text, ANCHORS[kind]).not.toBe("");
    const missing = IMPORT_FIELDS[kind]
      .map((f) => f.label)
      .filter((label) => !text.includes(label));
    expect(missing).toEqual([]);
  });
});
