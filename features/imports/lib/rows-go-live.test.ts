import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ImportKind } from "../schema";
import {
  buildRows,
  markDuplicates,
  missingRequired,
  type ImportLookups,
  type ImportMapping,
} from "./rows";

// The go-live kinds (5.3) and bank statements (5.4).

const CLI_1 = "00000000-0000-4000-8000-0000000000c1";
const CARTERA = {
  id: "00000000-0000-4000-8000-0000000000e1",
  name: "Cheques en cartera",
  type: "checks",
  currency: "ARS" as const,
};
const BANK = {
  id: "00000000-0000-4000-8000-0000000000b1",
  name: "Banco Galicia",
  type: "bank",
  currency: "ARS" as const,
};

const LOOKUPS: ImportLookups = {
  today: "2026-11-03",
  hash: (t) => createHash("sha256").update(t).digest("hex"),
  employees: [],
  vehicles: [],
  drivers: [],
  clients: [
    {
      id: CLI_1,
      legal_name: "Logística Sur S.A.",
      display_name: "LogiSur",
      cuit: "30714637432",
    },
  ],
  fuelCards: new Map(),
  realPayroll: new Set(),
  account: null,
  channelId: null,
  supplierCategories: [],
  expenseAccounts: [],
  costCenters: [],
};

function build(
  kind: ImportKind,
  columns: string[],
  rows: string[][],
  lookups: Partial<ImportLookups> = {},
) {
  const mapping: ImportMapping = Object.fromEntries(
    columns.map((c, i) => [c, i]),
  );
  return buildRows({
    kind,
    rows,
    firstLine: 2,
    mapping,
    lookups: { ...LOOKUPS, ...lookups },
  });
}

describe("loans", () => {
  const columns = [
    "description",
    "lender",
    "principal",
    "installments_count",
    "first_due_date",
    "installment_amount",
  ];

  it("needs the channel", () => {
    const rows = build("loans", columns, [
      ["Préstamo", "Galicia", "1000", "3", "10/12/2026", ""],
    ]);
    expect(rows[0]?.errors).toEqual(["Elegí el canal de los préstamos."]);
  });

  it("builds the pending schedule: equal cuotas or the file's cuota", () => {
    const rows = build(
      "loans",
      columns,
      [
        ["Préstamo", "Galicia", "1000", "3", "10/12/2026", ""],
        ["Leasing camión", "Banco X", "900", "2", "31/01/2027", "500"],
      ],
      { channelId: "jouve_fiscal" },
    );
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[0]?.payload?.installments).toEqual([
      { number: 1, due_date: "2026-12-10", amount: 333.33 },
      { number: 2, due_date: "2027-01-10", amount: 333.33 },
      { number: 3, due_date: "2027-02-10", amount: 333.34 },
    ]);
    expect(rows[1]?.payload?.installments).toEqual([
      { number: 1, due_date: "2027-01-31", amount: 500 },
      { number: 2, due_date: "2027-02-28", amount: 500 },
    ]);
    expect(rows[0]?.key).toBe("préstamo|galicia|2026-12-10");
  });

  it("a loan repeated in the file is an error in both rows", () => {
    const built = build(
      "loans",
      columns,
      [
        ["Préstamo", "Galicia", "1000", "3", "10/12/2026", ""],
        ["préstamo", "GALICIA", "1000", "3", "10/12/2026", ""],
      ],
      { channelId: "jouve_fiscal" },
    );
    const rows = markDuplicates(built, new Set(), true);
    expect(rows.map((r) => r.status)).toEqual(["invalid", "invalid"]);
    expect(rows[0]?.errors[0]).toMatch(/Se repite en el archivo \(fila 3\)/);
    expect(rows[0]?.payload).toBeNull();
  });
});

describe("cartera checks", () => {
  const columns = [
    "check_number",
    "bank_name",
    "drawer_name",
    "issue_date",
    "due_date",
    "amount",
    "kind",
  ];
  const targets = { account: CARTERA, channelId: "jouve_fiscal" };

  it("goes to the cartera account and channel the user picked", () => {
    const rows = build(
      "checks",
      columns,
      [["123", "Galicia", "Acme", "01/10/2026", "15/12/2026", "50.000", ""]],
      targets,
    );
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.payload).toMatchObject({
      kind: "fisico",
      cartera_account_id: CARTERA.id,
      channel_id: "jouve_fiscal",
      amount: 50000,
      currency: "ARS",
    });
    expect(rows[0]?.key).toBe("fisico|galicia|123");
  });

  it("refuses an e-cheq into a physical cartera and warns on an old check", () => {
    const rows = build(
      "checks",
      columns,
      [
        ["1", "Galicia", "Acme", "01/10/2026", "15/12/2026", "10", "e-cheq"],
        ["2", "Galicia", "Acme", "01/08/2026", "01/09/2026", "10", ""],
      ],
      targets,
    );
    expect(rows[0]?.errors[0]).toMatch(/Es un e-cheq/);
    expect(rows[1]?.warnings).toContain(
      "Venció hace más de 30 días: revisá que siga en cartera.",
    );
  });

  it("needs a cartera account", () => {
    const rows = build(
      "checks",
      columns,
      [["1", "Galicia", "Acme", "01/10/2026", "15/12/2026", "10", ""]],
      { account: BANK, channelId: "jouve_fiscal" },
    );
    expect(rows[0]?.errors).toEqual([
      "Elegí la cuenta de cartera de los cheques.",
    ]);
  });
});

describe("client opening balances", () => {
  const columns = ["client", "target_balance", "opening_date"];

  it("one balance per client, in pesos, not negative nor future", () => {
    const rows = build("opening_balances", columns, [
      ["LogiSur", "125.000,50", "31/10/2026"],
      ["LogiSur", "-10", "31/10/2026"],
      ["LogiSur", "10", "01/01/2027"],
    ]);
    expect(rows[0]?.payload).toEqual({
      client_id: CLI_1,
      opening_date: "2026-10-31",
      target_balance: 125000.5,
      notes: null,
    });
    expect(rows[1]?.errors[0]).toMatch(/saldo a favor/);
    expect(rows[2]?.errors).toEqual(["La fecha de corte es futura."]);
  });
});

describe("bank statements", () => {
  it("needs an amount column or debit and credit", () => {
    expect(
      missingRequired("bank_statement", { line_date: 0, description: 1 }),
    ).toEqual(["amount"]);
    expect(
      missingRequired("bank_statement", {
        line_date: 0,
        description: 1,
        debit: 2,
      }),
    ).toEqual([]);
  });

  it("signs debits and credits and keeps the row of the file", () => {
    const rows = build(
      "bank_statement",
      ["line_date", "description", "debit", "credit", "balance"],
      [
        ["01/10/2026", "Comisión", "1.210,00", "", "98.790,00"],
        ["02/10/2026", "Transferencia recibida", "", "5000", "103.790,00"],
        ["02/10/2026", "Saldo", "", "", "103.790,00"],
      ],
      { account: BANK },
    );
    expect(rows[0]?.payload).toMatchObject({
      account_id: BANK.id,
      amount: -1210,
      balance: 98790,
      line_no: 2,
    });
    expect(rows[1]?.payload).toMatchObject({ amount: 5000, line_no: 3 });
    expect(rows[2]?.errors).toEqual(["La línea no tiene importe."]);
  });

  it("two equal lines stay two and an overlapping file dedupes", () => {
    const columns = ["line_date", "description", "amount"];
    const file = [
      ["01/10/2026", "Comisión", "-100"],
      ["01/10/2026", "Comisión", "-100"],
    ];
    const first = build("bank_statement", columns, file, { account: BANK });
    expect(first[0]?.key).not.toBe(first[1]?.key);
    const again = build(
      "bank_statement",
      columns,
      [...file, ["02/10/2026", "Interés", "5"]],
      { account: BANK },
    );
    const marked = markDuplicates(
      again,
      new Set(first.flatMap((r) => (r.key ? [r.key] : []))),
    );
    expect(marked.map((r) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "ready",
    ]);
  });

  it("keeps the bank's code without changing the line's hash", () => {
    const columns = [
      "line_date",
      "reference",
      "description",
      "debit",
      "credit",
      "balance",
    ];
    const line = [
      "05/10/2026",
      "1953630435",
      "DBCR 25413 S/CR TASA GRAL",
      "2.007,04",
      "",
      "3.063.436,38",
    ];
    const withoutCode = build("bank_statement", columns, [line], {
      account: BANK,
    });
    const withCode = build(
      "bank_statement",
      [...columns, "bank_code"],
      [[...line, "1685"]],
      { account: BANK },
    );
    expect(withCode[0]?.payload).toMatchObject({
      amount: -2007.04,
      balance: 3063436.38,
      reference: "1953630435",
      bank_code: "1685",
    });
    expect(withoutCode[0]?.payload).toMatchObject({ bank_code: null });
    expect(withCode[0]?.key).toBe(withoutCode[0]?.key);
  });

  it("fills the code of a line loaded without it, once", () => {
    const columns = ["line_date", "description", "amount", "bank_code"];
    const rows = build(
      "bank_statement",
      columns,
      [
        ["01/10/2026", "Comisión", "-100", "2033"],
        ["01/10/2026", "Interés", "5", ""],
        ["02/10/2026", "Transferencia", "50", "2027"],
      ],
      { account: BANK },
    );
    const loaded = new Set(rows.slice(0, 2).flatMap((r) => r.key ?? []));
    const marked = markDuplicates(rows, loaded, false, loaded);
    expect(marked.map((r) => r.status)).toEqual(["fill", "duplicate", "ready"]);
    expect(marked[0]?.payload).toMatchObject({
      bank_code: "2033",
      fill_only: true,
    });
    expect(marked[2]?.payload).not.toHaveProperty("fill_only");
  });

  it("needs an account that is not a check cartera", () => {
    const rows = build(
      "bank_statement",
      ["line_date", "description", "amount"],
      [["01/10/2026", "Comisión", "-100"]],
      { account: CARTERA },
    );
    expect(rows[0]?.status).toBe("invalid");
  });
});
