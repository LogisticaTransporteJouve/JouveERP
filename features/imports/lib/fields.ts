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

export const IMPORT_FIELDS: Record<ImportKind, readonly ImportField[]> = {
  clients: counterpartyFields("Razón social", [
    "razon social",
    "cliente",
    "nombre",
    "denominacion",
  ]),
  suppliers: counterpartyFields("Razón social", [
    "razon social",
    "proveedor",
    "nombre",
    "denominacion",
  ]),
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
