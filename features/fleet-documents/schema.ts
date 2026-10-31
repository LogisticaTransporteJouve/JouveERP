import { z } from "zod";

export const FLEET_DOC_KINDS = [
  "vtv",
  "seguro",
  "cedula",
  "ruta",
  "senasa",
  "licencia",
  "lnh",
  "art",
  "libreta",
  "curso",
  "otro",
] as const;
export type FleetDocKind = (typeof FLEET_DOC_KINDS)[number];

export const FLEET_DOC_KIND_LABELS: Record<FleetDocKind, string> = {
  vtv: "VTV",
  seguro: "Seguro",
  cedula: "Cédula",
  ruta: "RTO/Ruta",
  senasa: "SENASA",
  licencia: "Licencia",
  lnh: "LNH",
  art: "ART",
  libreta: "Libreta sanitaria",
  curso: "Curso",
  otro: "Otro",
};

export function isFleetDocKind(v: unknown): v is FleetDocKind {
  return (
    typeof v === "string" && (FLEET_DOC_KINDS as readonly string[]).includes(v)
  );
}

export interface FleetDocument {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  kind: FleetDocKind;
  number: string | null;
  issued_at: string | null;
  expires_at: string;
  notes: string | null;
  attachment_file_id: string | null;
  created_at: string;
  updated_at: string;
  vehicle: { patente: string } | null;
  driver: { full_name: string } | null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).");

const optionalDate = z
  .union([z.literal(""), isoDate])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

function exactlyOneOwner(d: {
  vehicle_id?: string | null;
  driver_id?: string | null;
}) {
  return (d.vehicle_id == null) !== (d.driver_id == null);
}

export const FleetDocumentCreateSchema = z
  .object({
    vehicle_id: optionalUuid,
    driver_id: optionalUuid,
    kind: z.enum(FLEET_DOC_KINDS),
    number: optionalText(120),
    issued_at: optionalDate,
    expires_at: isoDate,
    notes: optionalText(2000),
    attachment_file_id: optionalUuid,
  })
  .refine(exactlyOneOwner, {
    message: "Elegí un vehículo o un chofer.",
    path: ["vehicle_id"],
  });

export type FleetDocumentCreateInput = z.infer<
  typeof FleetDocumentCreateSchema
>;

export const FleetDocumentUpdateSchema = z
  .object({
    id: z.string().uuid(),
    vehicle_id: optionalUuid,
    driver_id: optionalUuid,
    kind: z.enum(FLEET_DOC_KINDS).optional(),
    number: optionalText(120),
    issued_at: optionalDate,
    expires_at: isoDate.optional(),
    notes: optionalText(2000),
    attachment_file_id: optionalUuid,
  })
  .refine(exactlyOneOwner, {
    message: "Elegí un vehículo o un chofer.",
    path: ["vehicle_id"],
  });

export const FleetDocumentFileSchema = z.object({
  documentId: z.string().uuid(),
});
