import type { ImportKind } from "../schema";

// The columns each import kind reads. Aliases are compared normalized (no
// accents, lowercase, only letters and digits: lib/tables/columns.ts), an exact
// match first and then a header that starts with one.

export type ImportField = {
  key: string;
  label: string;
  /** The import cannot run without the column. */
  required: boolean;
  aliases: readonly string[];
  /** What the column takes, for the help text. */
  hint?: string;
};

const name = (label: string, aliases: readonly string[]): ImportField => ({
  key: "legal_name",
  label,
  required: true,
  aliases,
});

const counterpartyFields = (
  nameLabel: string,
  nameAliases: readonly string[],
): readonly ImportField[] => [
  name(nameLabel, nameAliases),
  {
    key: "display_name",
    label: "Nombre de fantasía",
    required: false,
    aliases: ["nombre de fantasia", "fantasia", "nombre comercial"],
  },
  {
    key: "cuit",
    label: "CUIT",
    required: false,
    aliases: ["cuit", "cuit cuil", "nro cuit", "documento"],
    hint: "Con CUIT entra a Ventas/Compras; sin CUIT, a Otras ventas/compras.",
  },
  {
    key: "iva_condition",
    label: "Condición de IVA",
    required: false,
    aliases: ["condicion de iva", "condicion iva", "iva", "cond iva"],
    hint: "Responsable Inscripto, Monotributo, Exento, Consumidor Final o No Categorizado.",
  },
  {
    key: "email",
    label: "Email",
    required: false,
    aliases: ["email", "e mail", "mail", "correo"],
  },
  {
    key: "phone",
    label: "Teléfono",
    required: false,
    aliases: ["telefono", "tel", "celular"],
  },
  {
    key: "address",
    label: "Domicilio fiscal",
    required: false,
    aliases: ["domicilio fiscal", "domicilio", "direccion"],
  },
  {
    key: "real_address",
    label: "Domicilio real",
    required: false,
    aliases: ["domicilio real", "direccion real", "domicilio de entrega"],
  },
  {
    key: "notes",
    label: "Notas",
    required: false,
    aliases: ["notas", "observaciones", "obs"],
  },
];

const notesField: ImportField = {
  key: "notes",
  label: "Notas",
  required: false,
  aliases: ["notas", "observaciones", "obs"],
};

const clientField: ImportField = {
  key: "client",
  label: "Cliente",
  required: true,
  aliases: ["cliente", "razon social", "cuit"],
  hint: "Razón social, nombre de fantasía o CUIT como está cargado en Clientes.",
};

const currencyField = (hint: string): ImportField => ({
  key: "currency",
  label: "Moneda",
  required: false,
  aliases: ["moneda", "divisa"],
  hint,
});

/** A supplier's purchase defaults: the purchase form starts a factura with
 *  them. Each names a record by its name (or code). */
const supplierDefaultFields: readonly ImportField[] = [
  {
    key: "category",
    label: "Categoría",
    required: false,
    aliases: ["categoria", "rubro", "categoria de proveedor"],
    hint: "Nombre de la categoría como está en Proveedores › Categorías.",
  },
  {
    key: "expense_account",
    label: "Cuenta de gasto",
    required: false,
    aliases: [
      "cuenta de gasto",
      "cuenta gasto",
      "cuenta contable",
      "imputacion",
    ],
    hint: "Código (5.1.2) o nombre de una cuenta de gasto imputable del plan.",
  },
  {
    key: "cost_center",
    label: "Centro de costo",
    required: false,
    aliases: ["centro de costo", "centro de costos", "centro costo", "cc"],
    hint: "Código o nombre del centro de costo.",
  },
];

/** A driver's license, kept on the driver record an employee with the
 *  driver position gets. */
const driverLicenseFields: readonly ImportField[] = [
  {
    key: "license_number",
    label: "N.º de licencia",
    required: false,
    aliases: [
      "numero de licencia",
      "nro de licencia",
      "nro licencia",
      "licencia",
      "licencia de conducir",
    ],
    hint: "Solo para choferes.",
  },
  {
    key: "license_category",
    label: "Categoría de licencia",
    required: false,
    aliases: [
      "categoria de licencia",
      "categoria licencia",
      "clase de licencia",
    ],
    hint: "La clase de la licencia (E1, C2…).",
  },
  {
    key: "license_expires_at",
    label: "Vencimiento de licencia",
    required: false,
    aliases: [
      "vencimiento de licencia",
      "vencimiento licencia",
      "vto licencia",
      "licencia vence",
    ],
    hint: "Se carga como licencia del chofer en Flota › Vencimientos, que avisa antes de que venza.",
  },
];

const GO_LIVE_FIELDS = {
  client_tariffs: [
    clientField,
    {
      key: "concept",
      label: "Concepto",
      required: true,
      aliases: ["concepto", "servicio", "tipo"],
      hint: "Almacenaje, carga, descarga o flete.",
    },
    {
      key: "warehouse",
      label: "Depósito",
      required: false,
      aliases: ["deposito", "almacen"],
      hint: "El depósito del área. Hace falta solo si dos depósitos tienen un área con el mismo nombre.",
    },
    {
      key: "area",
      label: "Área",
      required: false,
      aliases: ["area", "zona", "sector"],
      hint: "Vacío: todas las áreas. Con área, pisa a la tarifa general para los pallets de esa área (el flete no lleva área).",
    },
    {
      key: "unit",
      label: "Unidad",
      required: false,
      aliases: ["unidad", "por"],
      hint: "Por pallet por mes o por día (almacenaje; vacío: por mes); carga, descarga y flete tienen una sola.",
    },
    {
      key: "price",
      label: "Precio",
      required: true,
      aliases: ["precio", "tarifa", "importe", "valor"],
    },
    currencyField("ARS o USD (vacío: ARS). El flete va en pesos."),
    {
      key: "valid_from",
      label: "Vigente desde",
      required: true,
      aliases: ["vigente desde", "desde", "vigencia desde", "fecha desde"],
    },
    {
      key: "valid_to",
      label: "Vigente hasta",
      required: false,
      aliases: ["vigente hasta", "hasta", "vigencia hasta", "fecha hasta"],
      hint: "Vacío: sin fin.",
    },
    notesField,
  ],
  loans: [
    {
      key: "description",
      label: "Descripción",
      required: true,
      aliases: ["descripcion", "prestamo", "detalle"],
    },
    {
      key: "lender",
      label: "Entidad",
      required: false,
      aliases: ["entidad", "banco", "acreedor", "prestamista"],
    },
    {
      key: "kind",
      label: "Tipo",
      required: false,
      aliases: ["tipo"],
      hint: "Préstamo o leasing (vacío: préstamo).",
    },
    currencyField("ARS o USD (vacío: ARS)."),
    {
      key: "principal",
      label: "Capital pendiente",
      required: true,
      aliases: [
        "capital pendiente",
        "saldo de capital",
        "saldo capital",
        "capital",
      ],
      hint: "Lo que falta devolver al arranque.",
    },
    {
      key: "installments_count",
      label: "Cuotas pendientes",
      required: true,
      aliases: [
        "cuotas pendientes",
        "cuotas restantes",
        "cantidad de cuotas",
        "cuotas",
      ],
    },
    {
      key: "first_due_date",
      label: "Próximo vencimiento",
      required: true,
      aliases: ["proximo vencimiento", "primer vencimiento", "vencimiento"],
      hint: "Las cuotas siguientes vencen el mismo día de cada mes.",
    },
    {
      key: "installment_amount",
      label: "Importe de cuota",
      required: false,
      aliases: ["importe de cuota", "importe cuota", "valor cuota", "cuota"],
      hint: "Vacío: el capital dividido en cuotas iguales. Cada cuota se edita después.",
    },
    notesField,
  ],
  checks: [
    {
      key: "kind",
      label: "Tipo",
      required: false,
      aliases: ["tipo"],
      hint: "Físico o e-cheq (vacío: el de la cuenta de cartera).",
    },
    {
      key: "check_number",
      label: "Número",
      required: true,
      aliases: ["numero de cheque", "nro cheque", "nro", "numero", "cheque"],
    },
    {
      key: "bank_name",
      label: "Banco",
      required: true,
      aliases: ["banco", "banco emisor", "entidad"],
    },
    {
      key: "drawer_name",
      label: "Librador",
      required: true,
      aliases: ["librador", "firmante", "emisor", "titular"],
    },
    {
      key: "drawer_cuit",
      label: "CUIT del librador",
      required: false,
      aliases: ["cuit del librador", "cuit librador", "cuit firmante", "cuit"],
    },
    {
      key: "issue_date",
      label: "Fecha de emisión",
      required: true,
      aliases: ["fecha de emision", "fecha emision", "emision", "emitido"],
    },
    {
      key: "due_date",
      label: "Fecha de pago",
      required: true,
      aliases: [
        "fecha de pago",
        "fecha pago",
        "fecha de cobro",
        "vencimiento",
        "pago",
      ],
    },
    {
      key: "amount",
      label: "Importe",
      required: true,
      aliases: ["importe", "monto", "valor"],
    },
    currencyField("ARS o USD (vacío: la de la cuenta de cartera)."),
    notesField,
  ],
  opening_balances: [
    clientField,
    {
      key: "target_balance",
      label: "Saldo",
      required: true,
      aliases: [
        "saldo",
        "saldo pendiente",
        "deuda",
        "a cobrar",
        "importe",
        "total",
      ],
      hint: "En pesos, lo que el cliente debe al corte (0 si no debe nada).",
    },
    {
      key: "opening_date",
      label: "Fecha de corte",
      required: true,
      aliases: ["fecha de corte", "corte", "al", "fecha"],
    },
    notesField,
  ],
  bank_statement: [
    {
      key: "line_date",
      label: "Fecha",
      required: true,
      aliases: ["fecha", "fecha de operacion", "fecha operacion", "fecha mov"],
    },
    {
      key: "description",
      label: "Descripción",
      required: true,
      // Banco Provincia's export has a short «Descripción» and the full one
      // (with the CUIT and the loan) in «Descripción Extendida».
      aliases: [
        "descripcion extendida",
        "descripcion",
        "concepto",
        "detalle",
        "movimiento",
        "leyenda",
      ],
    },
    {
      key: "amount",
      label: "Importe",
      required: false,
      aliases: ["importe", "monto"],
      hint: "Con signo (negativo = débito). Si el banco separa débitos y créditos, usá esas dos columnas.",
    },
    {
      key: "debit",
      label: "Débito",
      required: false,
      aliases: ["debito", "debitos", "debe", "egreso", "egresos"],
    },
    {
      key: "credit",
      label: "Crédito",
      required: false,
      aliases: ["credito", "creditos", "haber", "ingreso", "ingresos"],
    },
    {
      key: "balance",
      label: "Saldo",
      required: false,
      aliases: ["saldo", "saldo parcial"],
    },
    {
      key: "reference",
      label: "Referencia",
      required: false,
      aliases: [
        "referencia",
        "comprobante",
        "nro comprobante",
        "nro de comprobante",
        "numero secuencia",
      ],
    },
    {
      key: "bank_code",
      label: "Código del banco",
      required: false,
      aliases: [
        "codigo causal",
        "causal",
        "cod causal",
        "codigo de operacion",
        "cod operacion",
      ],
      hint: "El código que el banco da a cada movimiento (en Macro, «Código Causal»).",
    },
    // Banco Galicia puts who sent or got the money apart from the
    // description: the name in «Leyendas Adicionales 1», the CUIT in «2».
    {
      key: "counterparty",
      label: "Ordenante / destinatario",
      required: false,
      aliases: ["leyendas adicionales 1"],
      hint: "Se agrega a la descripción: el nombre de quien transfirió o recibió.",
    },
    {
      key: "counterparty_cuit",
      label: "CUIT de la contraparte",
      required: false,
      aliases: ["leyendas adicionales 2"],
      hint: "Se agrega a la descripción cuando es un CUIT, para reconocer al cliente.",
    },
    {
      key: "movement_status",
      label: "Estado del movimiento",
      required: false,
      aliases: ["tipo de movimiento"],
      hint: "Las líneas «Pendiente» (un cheque en proceso) no se importan: entran cuando el banco las imputa.",
    },
  ],
} satisfies Partial<Record<ImportKind, readonly ImportField[]>>;

export const IMPORT_FIELDS: Record<ImportKind, readonly ImportField[]> = {
  clients: counterpartyFields("Razón social", [
    "razon social",
    "cliente",
    "nombre",
    "denominacion",
  ]),
  suppliers: [
    ...counterpartyFields("Razón social", [
      "razon social",
      "proveedor",
      "nombre",
      "denominacion",
    ]),
    ...supplierDefaultFields,
  ],
  employees: [
    name("Apellido y nombre", [
      "apellido y nombre",
      "nombre y apellido",
      "empleado",
      "nombre",
    ]),
    {
      key: "cuil",
      label: "CUIL",
      required: false,
      aliases: ["cuil", "cuit", "cuil cuit"],
    },
    {
      key: "hire_date",
      label: "Fecha de ingreso",
      required: true,
      aliases: ["fecha de ingreso", "ingreso", "fecha ingreso", "alta"],
    },
    {
      key: "termination_date",
      label: "Fecha de egreso",
      required: false,
      aliases: ["fecha de egreso", "egreso", "fecha egreso", "baja"],
      hint: "Con fecha de egreso el empleado entra inactivo.",
    },
    {
      key: "position",
      label: "Puesto",
      required: false,
      aliases: ["puesto", "cargo", "funcion"],
      hint: "Chofer o acompañante crea también su ficha de chofer.",
    },
    {
      key: "pay_frequency",
      label: "Frecuencia de pago",
      required: false,
      aliases: ["frecuencia de pago", "frecuencia", "liquidacion"],
      hint: "Semanal, mensual o mixto (vacío: mensual).",
    },
    {
      key: "base_salary",
      label: "Sueldo base",
      required: false,
      aliases: ["sueldo base", "sueldo", "basico", "sueldo basico"],
    },
    {
      key: "viatico_monthly",
      label: "Viático mensual",
      required: false,
      aliases: ["viatico mensual", "viatico", "viaticos"],
    },
    {
      key: "is_monotributo",
      label: "Monotributista",
      required: false,
      aliases: ["monotributista", "monotributo", "es monotributo"],
      hint: "Sí o No (vacío: No).",
    },
    {
      key: "cbu",
      label: "CBU",
      required: false,
      aliases: ["cbu", "cbu cvu"],
    },
    {
      key: "convenio",
      label: "Convenio",
      required: false,
      aliases: ["convenio", "cct"],
    },
    {
      key: "categoria",
      label: "Categoría",
      required: false,
      aliases: ["categoria"],
    },
    {
      key: "obra_social",
      label: "Obra social",
      required: false,
      aliases: ["obra social", "os"],
    },
    { key: "art", label: "ART", required: false, aliases: ["art"] },
    ...driverLicenseFields,
    {
      key: "notes",
      label: "Notas",
      required: false,
      aliases: ["notas", "observaciones", "obs"],
    },
  ],
  vehicles: [
    {
      key: "patente",
      label: "Patente",
      required: true,
      aliases: ["patente", "dominio"],
    },
    {
      key: "vehicle_type",
      label: "Tipo",
      required: true,
      aliases: ["tipo", "tipo de vehiculo", "tipo vehiculo", "clase"],
      hint: "Camión, acoplado, semi, utilitario, furgón, auto u otro.",
    },
    {
      key: "alias",
      label: "Alias",
      required: false,
      aliases: ["alias", "interno", "nro interno"],
    },
    { key: "brand", label: "Marca", required: false, aliases: ["marca"] },
    { key: "model", label: "Modelo", required: false, aliases: ["modelo"] },
    {
      key: "year",
      label: "Año",
      required: false,
      aliases: ["ano", "anio", "ano modelo"],
    },
    { key: "fleet", label: "Flota", required: false, aliases: ["flota"] },
    {
      key: "fuel_card",
      label: "Tarjeta de combustible",
      required: false,
      aliases: ["tarjeta de combustible", "tarjeta", "nro tarjeta"],
    },
    {
      key: "capacity_kg",
      label: "Capacidad (kg)",
      required: false,
      aliases: ["capacidad kg", "capacidad", "carga util"],
    },
    {
      key: "notes",
      label: "Notas",
      required: false,
      aliases: ["notas", "observaciones", "obs"],
    },
  ],
  historic_payroll: [
    {
      key: "employee",
      label: "Empleado",
      required: true,
      aliases: ["empleado", "apellido y nombre", "nombre y apellido", "nombre"],
      hint: "Nombre como está cargado en Personal (o usá la columna CUIL).",
    },
    {
      key: "cuil",
      label: "CUIL",
      required: false,
      aliases: ["cuil", "cuit"],
    },
    {
      key: "period",
      label: "Período",
      required: true,
      aliases: ["periodo", "mes", "mes liquidado"],
      hint: "2025-10, 10/2025 u octubre 2025.",
    },
    {
      key: "kind",
      label: "Tipo",
      required: false,
      aliases: ["tipo", "concepto"],
      hint: "Sueldo o aguinaldo (vacío: sueldo).",
    },
    {
      key: "net_amount",
      label: "Neto",
      required: true,
      aliases: ["neto", "sueldo neto", "neto a cobrar", "importe neto"],
    },
    {
      key: "paid_amount",
      label: "Pagado",
      required: false,
      aliases: ["pagado", "importe pagado", "abonado"],
    },
    {
      key: "paid_on",
      label: "Fecha de pago",
      required: false,
      aliases: ["fecha de pago", "fecha pago", "pagado el"],
    },
    {
      key: "notes",
      label: "Notas",
      required: false,
      aliases: ["notas", "observaciones", "obs"],
    },
  ],
  historic_trips: [
    {
      key: "trip_date",
      label: "Fecha",
      required: true,
      aliases: ["fecha", "fecha del viaje", "fecha viaje", "dia"],
    },
    {
      key: "patente",
      label: "Vehículo",
      required: false,
      aliases: ["patente", "dominio", "vehiculo", "camion"],
    },
    {
      key: "driver",
      label: "Chofer",
      required: false,
      aliases: ["chofer", "conductor"],
    },
    {
      key: "client",
      label: "Cliente",
      required: false,
      aliases: ["cliente", "razon social"],
    },
    {
      key: "origin",
      label: "Origen",
      required: false,
      aliases: ["origen", "desde"],
    },
    {
      key: "destination",
      label: "Destino",
      required: false,
      aliases: ["destino", "hasta"],
    },
    {
      key: "km",
      label: "Km",
      required: false,
      aliases: ["km", "kms", "kilometros", "distancia"],
    },
    {
      key: "freight_amount",
      label: "Flete",
      required: false,
      aliases: ["flete", "importe", "tarifa", "monto", "facturado"],
      hint: "En pesos.",
    },
    {
      key: "notes",
      label: "Notas",
      required: false,
      aliases: ["notas", "observaciones", "obs"],
    },
  ],
  ...GO_LIVE_FIELDS,
};

export function fieldKeys(kind: ImportKind): string[] {
  return IMPORT_FIELDS[kind].map((f) => f.key);
}

export function fieldAliases(
  kind: ImportKind,
): Record<string, readonly string[]> {
  return Object.fromEntries(IMPORT_FIELDS[kind].map((f) => [f.key, f.aliases]));
}

export function fieldLabel(kind: ImportKind, key: string): string {
  return IMPORT_FIELDS[kind].find((f) => f.key === key)?.label ?? key;
}
