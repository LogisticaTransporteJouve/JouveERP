import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ImportKind } from "../schema";
import {
  existingCounterpartyKeys,
  existingEmployeeKeys,
  historicPayrollKey,
  vehicleKey,
} from "./keys";
import {
  buildRows,
  countRows,
  markDuplicates,
  missingRequired,
  type ImportLookups,
  type ImportMapping,
} from "./rows";

const EMP_1 = "00000000-0000-4000-8000-000000000001";
const EMP_2 = "00000000-0000-4000-8000-000000000002";
const EMP_3 = "00000000-0000-4000-8000-000000000003";
const VEH_1 = "00000000-0000-4000-8000-0000000000a1";
const DRV_1 = "00000000-0000-4000-8000-0000000000d1";
const CLI_1 = "00000000-0000-4000-8000-0000000000c1";
const CAT_1 = "00000000-0000-4000-8000-0000000001a1";
const CAT_2 = "00000000-0000-4000-8000-0000000001a2";
const ACC_1 = "00000000-0000-4000-8000-0000000001b1";
const ACC_2 = "00000000-0000-4000-8000-0000000001b2";
const ACC_3 = "00000000-0000-4000-8000-0000000001b3";
const CC_1 = "00000000-0000-4000-8000-0000000001c1";
const CC_2 = "00000000-0000-4000-8000-0000000001c2";

const LOOKUPS: ImportLookups = {
  today: "2026-11-03",
  hash: (t) => createHash("sha256").update(t).digest("hex"),
  employees: [
    { id: EMP_1, cuil: "20123456786", legal_name: "Pérez Juan" },
    { id: EMP_2, cuil: null, legal_name: "Gómez Ana" },
    { id: EMP_3, cuil: null, legal_name: "Gómez  ana" },
  ],
  vehicles: [{ id: VEH_1, patente: "AB 123 CD" }],
  drivers: [{ id: DRV_1, full_name: "Pérez Juan", cuit: "20123456786" }],
  clients: [
    {
      id: CLI_1,
      legal_name: "Logística Sur S.A.",
      display_name: "LogiSur",
      cuit: "30714637432",
    },
  ],
  fuelCards: new Map([["7069001234", "AB123CD"]]),
  realPayroll: new Set([
    historicPayrollKey({
      employee_id: EMP_1,
      period: "2026-09",
      kind: "monthly",
    }),
  ]),
  account: null,
  channelId: null,
  tariffs: [],
  supplierCategories: [
    { id: CAT_1, name: "Combustible", slug: "combustible", is_active: true },
    { id: CAT_2, name: "Viejos", slug: "viejos", is_active: false },
  ],
  expenseAccounts: [
    { id: ACC_1, code: "5.1.2", name: "Combustibles" },
    { id: ACC_2, code: "5.1.3", name: "Peajes" },
    { id: ACC_3, code: "5.2.3", name: "Peajes" },
  ],
  costCenters: [
    { id: CC_1, code: "FLOTA", name: "Flota", is_active: true },
    { id: CC_2, code: "DEP", name: "Depósito", is_active: false },
  ],
  areas: [],
};

/** Builds a file whose header is `columns` (mapped in order). */
function build(kind: ImportKind, columns: string[], rows: string[][]) {
  const mapping: ImportMapping = Object.fromEntries(
    columns.map((c, i) => [c, i]),
  );
  return buildRows({ kind, rows, firstLine: 2, mapping, lookups: LOOKUPS });
}

describe("clients and suppliers", () => {
  const columns = ["legal_name", "cuit", "iva_condition", "email", "address"];

  it("with CUIT a row is fiscal; without, internal", () => {
    const rows = build("clients", columns, [
      ["Logística Sur S.A.", "30-71463743-2", "RI", "", "Calle 1"],
      ["Kiosco de Pepe", "", "", "pepe@example.com", "Calle 2"],
    ]);
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready"]);
    expect(rows[0]?.payload).toMatchObject({
      is_fiscal: true,
      cuit: "30714637432",
      iva_condition: "responsable_inscripto",
      address: "Calle 1",
    });
    expect(rows[0]?.key).toBe("cuit:30714637432");
    expect(rows[1]?.payload).toMatchObject({
      is_fiscal: false,
      cuit: null,
      iva_condition: null,
      address: null,
    });
    expect(rows[1]?.key).toBe("name:kiosco de pepe");
    expect(rows[1]?.warnings[0]).toMatch(/Sin CUIT/);
  });

  it("reports a bad CUIT, a missing IVA condition and a bad email", () => {
    const [bad, noIva, badMail] = build("suppliers", columns, [
      ["Proveedor A", "30714637431", "RI", "", ""],
      ["Proveedor B", "30714637432", "", "", ""],
      ["Proveedor C", "", "", "no-es-mail", ""],
    ]);
    expect(bad?.status).toBe("invalid");
    expect(bad?.errors.join(" ")).toMatch(/CUIT/);
    expect(noIva?.errors).toEqual([
      "Falta la condición de IVA (con CUIT es obligatoria).",
    ]);
    expect(badMail?.errors).toEqual(["Email: Email inválido."]);
    expect(bad?.payload).toBeNull();
  });

  it("marks what is loaded or repeated as duplicate", () => {
    const existing = existingCounterpartyKeys([
      {
        cuit: "30714637432",
        legal_name: "Logística Sur S.A.",
        is_fiscal: true,
      },
      { cuit: null, legal_name: "Kiosco  de PEPE", is_fiscal: false },
    ]);
    const rows = markDuplicates(
      build("clients", columns, [
        ["Logística Sur", "30714637432", "RI", "", ""],
        ["kiosco de pepe", "", "", "", ""],
        ["Nuevo SRL", "20123456786", "Monotributo", "", ""],
        ["Nuevo SRL bis", "20123456786", "Monotributo", "", ""],
      ]),
      existing,
    );
    expect(rows.map((r) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "ready",
      "duplicate",
    ]);
    expect(rows[3]?.warnings).toEqual(["Repetido en el archivo."]);
    expect(countRows(rows)).toEqual({ ready: 1, duplicate: 3, invalid: 0 });
  });

  it("leaves out blank lines and needs the name column", () => {
    expect(build("clients", columns, [["", "", "", "", ""]])).toEqual([]);
    expect(missingRequired("clients", { cuit: 0 })).toEqual(["legal_name"]);
  });
});

describe("supplier defaults", () => {
  const columns = ["legal_name", "category", "expense_account", "cost_center"];

  it("finds the category by name, the account and cost center by code or name", () => {
    const [byCode, byName] = build("suppliers", columns, [
      ["YPF Ruta 3", "combustible", "5.1.2", "flota"],
      ["Otro Proveedor", "", "Combustibles", "Flota"],
    ]);
    expect(byCode?.status).toBe("ready");
    expect(byCode?.payload).toMatchObject({
      category_id: CAT_1,
      default_expense_account_id: ACC_1,
      default_cost_center_id: CC_1,
    });
    expect(byCode?.detail).toContain("Gasto 5.1.2 Combustibles");
    expect(byName?.payload).toMatchObject({
      category_id: null,
      default_expense_account_id: ACC_1,
      default_cost_center_id: CC_1,
    });
  });

  it("refuses an unknown or ambiguous reference and warns on an inactive one", () => {
    const [unknown, ambiguous, inactive] = build("suppliers", columns, [
      ["A SRL", "Inexistente", "", ""],
      ["B SRL", "", "Peajes", ""],
      ["C SRL", "Viejos", "5.2.3", "DEP"],
    ]);
    expect(unknown?.errors).toEqual([
      'No hay una categoría de proveedor "Inexistente".',
    ]);
    expect(ambiguous?.errors).toEqual([
      'Hay más de una cuenta de gasto imputable "Peajes": usá el código.',
    ]);
    expect(inactive?.status).toBe("ready");
    expect(inactive?.payload).toMatchObject({
      default_expense_account_id: ACC_3,
    });
    expect(inactive?.warnings).toEqual([
      "La categoría Viejos está inactiva.",
      "El centro de costo Depósito está inactivo.",
    ]);
  });

  it("a client file has no supplier defaults", () => {
    const [row] = build("clients", ["legal_name"], [["Cliente X"]]);
    expect(row?.payload).not.toHaveProperty("category_id");
  });
});

describe("employees", () => {
  const columns = [
    "legal_name",
    "cuil",
    "hire_date",
    "termination_date",
    "position",
    "is_monotributo",
    "base_salary",
  ];

  it("validates and builds the employee", () => {
    const [chofer, gone] = build("employees", columns, [
      [
        "Pérez Juan",
        "20-12345678-6",
        "01/02/2020",
        "",
        "Chofer",
        "No",
        "850.000",
      ],
      ["López Eva", "", "2019-01-01", "31/12/2024", "", "", ""],
    ]);
    expect(chofer?.status).toBe("ready");
    expect(chofer?.payload).toMatchObject({
      cuil: "20123456786",
      hire_date: "2020-02-01",
      position: "Chofer / Acompañante",
      is_monotributo: false,
      base_salary: 850000,
      pay_frequency: "mensual",
      viatico_monthly: 0,
      termination_date: null,
    });
    expect(chofer?.warnings).toContain(
      "Es chofer: se crea también su ficha de chofer.",
    );
    expect(chofer?.key).toBe("cuil:20123456786");
    expect(gone?.payload).toMatchObject({ termination_date: "2024-12-31" });
    expect(gone?.key).toBe("name:lópez eva");
  });

  it("rejects an unreadable date, an egreso before the ingreso and a yes/no typo", () => {
    const [noDate, backwards, mono] = build("employees", columns, [
      ["A B", "", "", "", "", "", ""],
      ["C D", "", "2024-05-01", "2024-01-01", "", "", ""],
      ["E F", "", "2024-05-01", "", "", "quizás", ""],
    ]);
    expect(noDate?.errors).toEqual(["Falta fecha de ingreso."]);
    expect(backwards?.errors).toEqual([
      "La fecha de egreso es anterior a la de ingreso.",
    ]);
    expect(mono?.errors).toEqual(["Monotributista: poné Sí o No."]);
  });

  it("keeps a driver's license and warns when it expired", () => {
    const licenseColumns = [
      "legal_name",
      "hire_date",
      "position",
      "license_number",
      "license_category",
      "license_expires_at",
    ];
    const [driver, expired, soon, notDriver, badDate] = build(
      "employees",
      licenseColumns,
      [
        ["Chofer Uno", "2020-01-01", "Chofer", "123456", "E1", "31/12/2027"],
        ["Chofer Dos", "2020-01-01", "Chofer", "", "", "01/10/2026"],
        ["Chofer Tres", "2020-01-01", "Chofer", "", "", "20/11/2026"],
        ["Admin Uno", "2020-01-01", "Administrativo", "99", "B1", ""],
        ["Chofer Cuatro", "2020-01-01", "Chofer", "", "", "mañana"],
      ],
    );
    expect(driver?.payload).toMatchObject({
      license_number: "123456",
      license_category: "E1",
      license_expires_at: "2027-12-31",
    });
    expect(driver?.detail).toContain("Licencia 123456 (E1)");
    expect(expired?.status).toBe("ready");
    expect(expired?.warnings).toContain(
      "La licencia ya venció: renovala en Flota › Vencimientos.",
    );
    expect(soon?.warnings).toContain(
      "La licencia vence en los próximos 30 días.",
    );
    expect(notDriver?.payload).toMatchObject({
      license_number: null,
      license_category: null,
      license_expires_at: null,
    });
    expect(notDriver?.warnings).toContain(
      "La licencia es solo para el puesto Chofer / Acompañante: no se guarda.",
    );
    expect(badDate?.errors).toEqual([
      'Vencimiento de licencia: fecha ilegible ("mañana").',
    ]);
  });

  it("a row without CUIL is a duplicate of anyone with its name", () => {
    const existing = existingEmployeeKeys(LOOKUPS.employees);
    const rows = markDuplicates(
      build("employees", columns, [
        ["Pérez Juan", "", "2020-01-01", "", "", "", ""],
        ["Otro Nombre", "20123456786", "2020-01-01", "", "", "", ""],
        ["Nuevo Empleado", "", "2020-01-01", "", "", "", ""],
      ]),
      existing,
    );
    expect(rows.map((r) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "ready",
    ]);
  });
});

describe("vehicles", () => {
  const columns = ["patente", "vehicle_type", "year", "fuel_card"];

  it("needs a known type and a card no other vehicle has", () => {
    const rows = build("vehicles", columns, [
      ["ab123cd", "Camión", "2018", "7069-001234"],
      ["AC 456 EF", "Acoplado", "", "7069001234"],
      ["AD789GH", "moto", "", ""],
      ["AE111AA", "Semi", "dos mil", ""],
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "ready",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(rows[0]?.payload).toMatchObject({
      patente: "AB123CD",
      vehicle_type: "camion",
      year: 2018,
      fuel_card: "7069001234",
    });
    expect(rows[1]?.errors).toEqual([
      "La tarjeta de combustible ya es de otro vehículo.",
    ]);
    expect(rows[2]?.errors).toEqual(['Tipo desconocido: "moto".']);
    expect(rows[3]?.errors).toEqual(["Año: no es un número."]);
  });

  it("compares patentes by their letters and digits", () => {
    const rows = markDuplicates(
      build("vehicles", columns, [["AB-123-CD", "camion", "", ""]]),
      new Set([vehicleKey("AB 123 CD")]),
    );
    expect(rows[0]?.status).toBe("duplicate");
  });
});

describe("historic payroll", () => {
  const columns = [
    "employee",
    "cuil",
    "period",
    "kind",
    "net_amount",
    "paid_amount",
  ];

  it("matches the employee by CUIL, else by a unique name", () => {
    const rows = build("historic_payroll", columns, [
      [
        "Juan Pérez",
        "20123456786",
        "09/2026",
        "",
        "1.000.000,50",
        "1.000.000,50",
      ],
      ["Gómez Ana", "", "2026-06", "aguinaldo", "500000", ""],
      ["Nadie", "", "2026-05", "", "1", ""],
      ["Pérez Juan", "", "2026-12", "", "1", ""],
      ["Pérez Juan", "", "2026-05", "SAC", "1", ""],
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "ready",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(rows[0]?.payload).toMatchObject({
      employee_id: EMP_1,
      period: "2026-09",
      kind: "monthly",
      net_amount: 1000000.5,
    });
    expect(rows[0]?.warnings).toEqual([
      "El nombre no coincide con el del CUIL: se usa Pérez Juan.",
      "Ya hay una planilla de ese mes en el sistema: el histórico queda solo como referencia.",
    ]);
    expect(rows[1]?.errors[0]).toMatch(/más de un empleado/);
    expect(rows[2]?.errors[0]).toMatch(/importalo primero/);
    expect(rows[3]?.errors).toEqual(["El período es futuro."]);
    expect(rows[4]?.errors).toEqual([
      "Tipo: El aguinaldo es de junio o diciembre.",
    ]);
  });

  it("an employee's month and kind is imported once", () => {
    const rows = markDuplicates(
      build("historic_payroll", columns, [
        ["Pérez Juan", "", "2025-01", "", "10", ""],
        ["Pérez Juan", "", "enero 2025", "", "10", ""],
      ]),
      new Set(),
    );
    expect(rows.map((r) => r.status)).toEqual(["ready", "duplicate"]);
  });
});

describe("historic trips", () => {
  const columns = [
    "trip_date",
    "patente",
    "driver",
    "client",
    "origin",
    "destination",
    "km",
    "freight_amount",
  ];
  const file = [
    [
      "10/03/2025",
      "AB123CD",
      "pérez juan",
      "LogiSur",
      "Rosario",
      "Córdoba",
      "400",
      "350.000",
    ],
    [
      "10/03/2025",
      "AB123CD",
      "pérez juan",
      "LogiSur",
      "Rosario",
      "Córdoba",
      "400",
      "350.000",
    ],
    [
      "11/03/2025",
      "ZZ999ZZ",
      "Desconocido",
      "30714637432",
      "Rosario",
      "",
      "",
      "",
    ],
  ];

  it("matches what it can and keeps the text of what it cannot", () => {
    const rows = build("historic_trips", columns, file);
    expect(rows.map((r) => r.status)).toEqual(["ready", "ready", "ready"]);
    expect(rows[0]?.payload).toMatchObject({
      trip_date: "2025-03-10",
      vehicle_id: VEH_1,
      driver_id: DRV_1,
      client_id: CLI_1,
      km: 400,
      freight_amount: 350000,
    });
    expect(rows[2]?.payload).toMatchObject({
      vehicle_id: null,
      vehicle_label: "ZZ999ZZ",
      driver_id: null,
      client_id: CLI_1,
    });
    expect(rows[2]?.warnings).toEqual([
      "No hay un vehículo ZZ999ZZ: se guarda el texto.",
      'No hay un chofer "Desconocido": se guarda el texto.',
    ]);
  });

  it("two equal trips stay two, and the same file gives the same hashes", () => {
    const first = build("historic_trips", columns, file);
    const again = build("historic_trips", columns, file);
    expect(first[0]?.key).not.toBe(first[1]?.key);
    expect(again.map((r) => r.key)).toEqual(first.map((r) => r.key));
    const reimport = markDuplicates(
      again,
      new Set(first.flatMap((r) => (r.key ? [r.key] : []))),
    );
    expect(reimport.every((r) => r.status === "duplicate")).toBe(true);
  });

  it("rejects a future date and a row with only the date", () => {
    const rows = build("historic_trips", columns, [
      ["01/01/2027", "AB123CD", "", "", "", "", "", ""],
      ["01/01/2025", "", "", "", "", "", "", ""],
    ]);
    expect(rows[0]?.errors).toEqual(["La fecha es futura."]);
    expect(rows[1]?.errors).toEqual([
      "La fila no tiene datos del viaje, solo la fecha.",
    ]);
  });
});
