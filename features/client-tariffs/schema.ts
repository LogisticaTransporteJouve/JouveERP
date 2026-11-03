import { z } from "zod";

import { IsoDateSchema } from "@/lib/validation/common";

/** What a client tariff prices. Mirrors client_tariffs.concept. */
export const CLIENT_TARIFF_CONCEPTS = [
  "storage",
  "handling_in",
  "handling_out",
  "freight",
] as const;
export type ClientTariffConcept = (typeof CLIENT_TARIFF_CONCEPTS)[number];

export const CLIENT_TARIFF_CONCEPT_LABELS: Record<ClientTariffConcept, string> =
  {
    storage: "Almacenaje",
    handling_in: "Carga (ingreso)",
    handling_out: "Descarga (egreso)",
    freight: "Flete",
  };

/** The concepts storage billing prices; flete prices cargas in a
 *  liquidación (features/freight-settlements). */
export const STORAGE_TARIFF_CONCEPTS = [
  "storage",
  "handling_in",
  "handling_out",
] as const satisfies readonly ClientTariffConcept[];

/** Mirrors client_tariffs.unit. */
export const CLIENT_TARIFF_UNITS = [
  "pallet_day",
  "pallet_month",
  "pallet",
  "shipment",
] as const;
export type ClientTariffUnit = (typeof CLIENT_TARIFF_UNITS)[number];

export const CLIENT_TARIFF_UNIT_LABELS: Record<ClientTariffUnit, string> = {
  pallet_day: "Por pallet por día",
  pallet_month: "Por pallet por mes",
  pallet: "Por pallet",
  shipment: "Por carga",
};

/** The units each concept takes (client_tariffs_concept_unit). */
export const UNITS_BY_CONCEPT: Record<
  ClientTariffConcept,
  readonly ClientTariffUnit[]
> = {
  storage: ["pallet_month", "pallet_day"],
  handling_in: ["pallet"],
  handling_out: ["pallet"],
  freight: ["shipment"],
};

export const CLIENT_TARIFF_CURRENCIES = ["ARS", "USD"] as const;
export type ClientTariffCurrency = (typeof CLIENT_TARIFF_CURRENCIES)[number];

export function isClientTariffConcept(v: unknown): v is ClientTariffConcept {
  return (
    typeof v === "string" &&
    (CLIENT_TARIFF_CONCEPTS as readonly string[]).includes(v)
  );
}

export function isClientTariffUnit(v: unknown): v is ClientTariffUnit {
  return (
    typeof v === "string" &&
    (CLIENT_TARIFF_UNITS as readonly string[]).includes(v)
  );
}

export function isClientTariffCurrency(v: unknown): v is ClientTariffCurrency {
  return (
    typeof v === "string" &&
    (CLIENT_TARIFF_CURRENCIES as readonly string[]).includes(v)
  );
}

export interface ClientTariff {
  id: string;
  client_id: string;
  concept: ClientTariffConcept;
  unit: ClientTariffUnit;
  price: number;
  currency: ClientTariffCurrency;
  valid_from: string;
  valid_to: string | null;
  notes: string | null;
  /** Area of a warehouse the tariff applies to; null = every area. */
  area_id: string | null;
  created_at: string;
}

const optionalDate = z
  .union([z.literal(""), IsoDateSchema])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalNotes = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .optional();

const TariffFields = z.object({
  concept: z.enum(CLIENT_TARIFF_CONCEPTS),
  unit: z.enum(CLIENT_TARIFF_UNITS),
  // numeric(14, 2)
  price: z.coerce
    .number({ message: "Precio requerido." })
    .min(0, "El precio no puede ser negativo.")
    .max(999_999_999_999.99, "Precio demasiado alto."),
  currency: z.enum(CLIENT_TARIFF_CURRENCIES).default("ARS"),
  valid_from: IsoDateSchema,
  valid_to: optionalDate,
  notes: optionalNotes,
  area_id: optionalUuid,
});

function checkTariff(
  d: z.infer<typeof TariffFields>,
  ctx: z.RefinementCtx,
): void {
  if (!UNITS_BY_CONCEPT[d.concept].includes(d.unit)) {
    ctx.addIssue({
      code: "custom",
      message: "La unidad no corresponde al concepto.",
      path: ["unit"],
    });
  }
  // The liquidación and its invoice are in pesos (client_tariffs_concept_unit).
  if (d.concept === "freight" && d.currency !== "ARS") {
    ctx.addIssue({
      code: "custom",
      message: "El flete se tarifa en pesos.",
      path: ["currency"],
    });
  }
  // client_tariffs_area_concept: flete prices cargas, not stored pallets.
  if (d.concept === "freight" && d.area_id) {
    ctx.addIssue({
      code: "custom",
      message: "El flete no lleva área.",
      path: ["area_id"],
    });
  }
  if (d.valid_to && d.valid_to < d.valid_from) {
    ctx.addIssue({
      code: "custom",
      message: "El fin de vigencia no puede ser anterior al inicio.",
      path: ["valid_to"],
    });
  }
}

export const ClientTariffCreateSchema = TariffFields.extend({
  client_id: z.string().uuid(),
}).superRefine(checkTariff);
export type ClientTariffCreateInput = z.input<typeof ClientTariffCreateSchema>;

/** Edits replace every field but the client. */
export const ClientTariffUpdateSchema = TariffFields.extend({
  id: z.string().uuid(),
}).superRefine(checkTariff);
export type ClientTariffUpdateInput = z.input<typeof ClientTariffUpdateSchema>;

/** Price per pallet per day in the tariff's currency (a monthly price is
 *  prorated /30, as storage billing does). */
export function dailyPrice(t: Pick<ClientTariff, "unit" | "price">): number {
  return t.unit === "pallet_month" ? t.price / 30 : t.price;
}
