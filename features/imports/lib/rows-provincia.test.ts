import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readUploadedTable } = await import("@/lib/tables/read-upload");
const { findHeaderRowIndex, suggestColumnMapping } =
  await import("@/lib/tables/columns");
const { fieldAliases, fieldKeys } = await import("./fields");
const { buildRows, countRows, mergeDescriptionOverflow } =
  await import("./rows");

// Banco Provincia's monthly statement as it downloads (.txt): a tab-separated
// preamble, a comma-separated table with unquoted commas in the concept,
// the opening balance line and a footer of totals.
const PROVINCIA_TXT = [
  "7175 - MERCEDES\t \t Emitido el 02/11/2026 \t \t Frecuencia: MENSUAL",
  "EMPRESA SA\t \tCUIT\t30000000007\t CBU: 0000000000000000000000",
  "\t \t\t\t   CUENTA CORRIENTE EN PESOS",
  "-----------------------------------------------------------",
  "FECHA,CONCEPTO,IMPORTE,Fecha Valor,Saldo",
  "30/09/2026,SALDO ANTERIOR,0,,1609637.32 ",
  "02/10/2026,TRANSF DE VALDEZ, MONICA ADRIA (23207269824) VAR VARIOS,43700.49,02-10,1653337.81 ",
  "02/10/2026,PAGO CUOTA DE PRESTAMO         1987 BIYCSA,-41711.59,02-10,1611626.22 ",
  "02/10/2026,IMPUESTO DEBITO - LEY 25413,-250.27,02-10,1611375.95 ",
  "-----------------------------------------------------------",
  "Tot. Retención ARBA:\t-34793.42\t ITF - LEY25413(DEB): \t-42700.00",
  "\t \t ITF - LEY25413(CRE): \t-16058.55",
  "\t \t DESDE: \t01/10/2026",
].join("\n");

function build(text: string) {
  const table = readUploadedTable(
    "extracto.txt",
    new TextEncoder().encode(text),
    { rows: 100, columns: 20, cellChars: 500 },
    {
      header: {
        fields: fieldKeys("bank_statement"),
        aliases: fieldAliases("bank_statement"),
      },
    },
  );
  if (typeof table === "string") throw new Error(table);
  const keys = fieldKeys("bank_statement");
  const aliases = fieldAliases("bank_statement");
  const h = findHeaderRowIndex(table.rows, keys, aliases);
  const headers = table.rows[h] ?? [];
  const mapping = suggestColumnMapping(headers, keys, aliases);
  const rows = mergeDescriptionOverflow(
    table.rows.slice(h + 1),
    headers.length,
    mapping.description,
  );
  return buildRows({
    kind: "bank_statement",
    rows,
    firstLine: h + 2,
    mapping,
    lookups: {
      today: "2026-11-07",
      hash: (t: string) => createHash("sha256").update(t).digest("hex"),
      account: {
        id: "dc5e12c7-3c9a-467b-81ce-58d429d2d7c5",
        type: "bank",
        currency: "ARS",
      },
    } as never,
  });
}

describe("Banco Provincia's statement", () => {
  it("reads the table under the preamble, skips the balance line and the footer", () => {
    const rows = build(PROVINCIA_TXT);
    expect(rows.flatMap((r) => r.errors)).toEqual([]);
    expect(countRows(rows)).toMatchObject({ ready: 3, invalid: 0 });
    expect(rows.map((r) => r.payload?.amount)).toEqual([
      43700.49, -41711.59, -250.27,
    ]);
  });

  it("puts a comma written inside the concept back into the description", () => {
    const [first] = build(PROVINCIA_TXT);
    expect(first?.payload?.description).toBe(
      "TRANSF DE VALDEZ, MONICA ADRIA (23207269824) VAR VARIOS",
    );
    expect(first?.payload?.balance).toBe(1653337.81);
  });
});

describe("mergeDescriptionOverflow", () => {
  it("leaves rows of the header's width alone", () => {
    expect(mergeDescriptionOverflow([["a", "b", "c"]], 3, 1)).toEqual([
      ["a", "b", "c"],
    ]);
  });
});

describe("suggestColumnMapping", () => {
  it("prefers the more specific alias when both headers are there", () => {
    const keys = fieldKeys("bank_statement");
    const mapping = suggestColumnMapping(
      ["Fecha", "Importe", "Descripción", "Descripción Extendida"],
      keys,
      fieldAliases("bank_statement"),
    );
    expect(mapping.description).toBe(3);
  });
});
