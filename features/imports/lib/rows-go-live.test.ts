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
const WH_1 = "00000000-0000-4000-8000-0000000002a1";
const WH_2 = "00000000-0000-4000-8000-0000000002a2";
const AREA_FRIO_1 = "00000000-0000-4000-8000-0000000002b1";
const AREA_FRIO_2 = "00000000-0000-4000-8000-0000000002b2";
const AREA_RACK = "00000000-0000-4000-8000-0000000002b3";
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
  tariffs: [],
  supplierCategories: [],
  expenseAccounts: [],
  costCenters: [],
  areas: [
    {
      id: AREA_FRIO_1,
      name: "Cámara de frío",
      is_active: true,
      warehouse_id: WH_1,
      warehouse_name: "Depósito Norte",
    },
    {
      id: AREA_FRIO_2,
      name: "Cámara de frío",
      is_active: true,
      warehouse_id: WH_2,
      warehouse_name: "Depósito Sur",
    },
    {
      id: AREA_RACK,
      name: "Rack",
      is_active: false,
      warehouse_id: WH_1,
      warehouse_name: "Depósito Norte",
    },
  ],
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

describe("client tariffs", () => {
  const columns = [
    "client",
    "concept",
    "unit",
    "price",
    "valid_from",
    "valid_to",
  ];

  it("finds the client and fills the concept's unit", () => {
    const rows = build("client_tariffs", columns, [
      ["30-71463743-2", "Almacenaje", "", "1.500,00", "01/01/2026", ""],
      ["LogiSur", "flete", "", "90000", "01/01/2026", "31/12/2026"],
    ]);
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[0]?.payload).toMatchObject({
      client_id: CLI_1,
      concept: "storage",
      unit: "pallet_month",
      price: 1500,
      currency: "ARS",
      valid_to: null,
    });
    expect(rows[1]?.payload).toMatchObject({
      concept: "freight",
      unit: "shipment",
    });
  });

  it("refuses an unknown client and an overlap with a loaded tariff", () => {
    const rows = build(
      "client_tariffs",
      columns,
      [
        ["Nadie SA", "Almacenaje", "", "10", "01/01/2026", ""],
        ["LogiSur", "Almacenaje", "", "10", "01/01/2026", ""],
        ["LogiSur", "Almacenaje", "", "10", "01/01/2025", ""],
      ],
      {
        tariffs: [
          {
            client_id: CLI_1,
            concept: "storage",
            area_id: null,
            valid_from: "2025-01-01",
            valid_to: null,
          },
        ],
      },
    );
    expect(rows[0]?.errors[0]).toMatch(/No hay un cliente "Nadie SA"/);
    expect(rows[1]?.errors[0]).toMatch(/Se superpone con la tarifa vigente/);
    // Same start as the loaded one: the same tariff, skipped as a duplicate.
    expect(rows[2]?.status).toBe("ready");
    expect(rows[2]?.key).toBe(`${CLI_1}|storage||2025-01-01`);
  });

  describe("per area", () => {
    const areaColumns = [
      "client",
      "concept",
      "warehouse",
      "area",
      "price",
      "valid_from",
    ];

    it("finds the area by name within its warehouse", () => {
      const [norte, rack] = build("client_tariffs", areaColumns, [
        [
          "LogiSur",
          "Almacenaje",
          "deposito norte",
          "cámara de frío",
          "20",
          "01/01/2026",
        ],
        ["LogiSur", "Almacenaje", "", "Rack", "15", "01/01/2026"],
      ]);
      expect(norte?.status).toBe("ready");
      expect(norte?.payload).toMatchObject({ area_id: AREA_FRIO_1 });
      expect(norte?.key).toBe(`${CLI_1}|storage|${AREA_FRIO_1}|2026-01-01`);
      expect(norte?.detail).toContain("Área Cámara de frío (Depósito Norte)");
      expect(norte?.warnings[0]).toMatch(/pisa a la general del cliente/);
      // A name only one warehouse has needs no warehouse.
      expect(rack?.payload).toMatchObject({ area_id: AREA_RACK });
      expect(rack?.warnings).toContain("El área Rack está inactiva.");
    });

    it("refuses an ambiguous or unknown area and an area on a flete", () => {
      const [ambiguous, unknown, freight] = build(
        "client_tariffs",
        areaColumns,
        [
          ["LogiSur", "Almacenaje", "", "Cámara de frío", "20", "01/01/2026"],
          ["LogiSur", "Carga", "Depósito Sur", "Rack", "5", "01/01/2026"],
          ["LogiSur", "Flete", "", "Rack", "9000", "01/01/2026"],
        ],
      );
      expect(ambiguous?.errors).toEqual([
        'Hay un área "Cámara de frío" en más de un depósito: agregá la columna Depósito.',
      ]);
      expect(unknown?.errors).toEqual([
        'No hay un área "Rack" en el depósito Depósito Sur.',
      ]);
      expect(freight?.errors).toEqual(["El flete no lleva área."]);
    });

    it("an area tariff overlaps only tariffs of its own area", () => {
      const rows = build(
        "client_tariffs",
        areaColumns,
        [
          [
            "LogiSur",
            "Almacenaje",
            "Depósito Norte",
            "Cámara de frío",
            "20",
            "01/03/2026",
          ],
          [
            "LogiSur",
            "Almacenaje",
            "Depósito Sur",
            "Cámara de frío",
            "20",
            "01/03/2026",
          ],
        ],
        {
          tariffs: [
            {
              client_id: CLI_1,
              concept: "storage",
              area_id: null,
              valid_from: "2026-01-01",
              valid_to: null,
            },
            {
              client_id: CLI_1,
              concept: "storage",
              area_id: AREA_FRIO_2,
              valid_from: "2026-01-01",
              valid_to: null,
            },
          ],
        },
      );
      expect(rows[0]?.status).toBe("ready");
      expect(rows[1]?.errors[0]).toMatch(/Se superpone con la tarifa vigente/);
    });
  });

  it("refuses two overlapping rows of the file", () => {
    const rows = build("client_tariffs", columns, [
      ["LogiSur", "Carga", "", "10", "01/01/2026", "30/06/2026"],
      ["LogiSur", "Carga", "", "12", "01/06/2026", ""],
    ]);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[1]?.errors).toEqual([
      "Se superpone con otra tarifa del archivo del mismo cliente y concepto.",
    ]);
  });
});

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
