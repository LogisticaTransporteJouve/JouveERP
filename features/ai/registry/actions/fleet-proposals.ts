import { z } from "zod";

import { MAINTENANCE_KINDS } from "@/features/maintenance/schema";
import { listShipmentsAction } from "@/features/shipments/actions/shipments-actions";
import {
  SHIPMENT_KINDS,
  OFFERED_SHIPMENT_TARGETS,
  SHIPMENT_NEXT_STATUSES,
  SHIPMENT_STATUS_LABELS,
} from "@/features/shipments/schema";
import { TRIP_STATUSES } from "@/features/trips/schema";
import { changeShipmentStatus } from "@/lib/commands/change-shipment-status";
import { createFuelLoad } from "@/lib/commands/create-fuel-load";
import { createMaintenance } from "@/lib/commands/create-maintenance";
import { createShipment } from "@/lib/commands/create-shipment";
import { createTrip } from "@/lib/commands/create-trip";
import { formatArgentineDate, todayInAR } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

import {
  CANCEL_REASON_REQUIRED,
  SHIPMENT_STATUS_LABEL_KEYS,
  fuelLoadProposalSpec,
  maintenanceProposalSpec,
  shipmentProposalSpec,
  shipmentStatusProposalSpec,
  tripProposalSpec,
  type ProposalLabels,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { resolveClientRef } from "./resolve-client";
import {
  resolveCompanion,
  resolveDriver,
  resolveVehicle,
  type FleetRef,
} from "./fleet-refs";

// Fleet and operations proposals over the forms' writes. Each permission is
// the form's own gate: a plate, a driver or a client is resolved through
// its module's read when the user has it, and otherwise the model passes the
// id another result gave. The write runs only after the user accepts,
// through the lib/commands function the feature's server action calls, with
// the same client the action uses (the user's, so RLS applies as in the app).

const MONEY_MAX = 999_999_999_999.99;
const KM_MAX = 999_999_999;

const text = (max: number) => z.string().trim().min(1).max(max).optional();
const money = z.number().finite().min(0).max(MONEY_MAX).optional();
const km = z.number().finite().min(0).max(KM_MAX).optional();

const vehicleInput = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe("Vehicle plate (patente), alias or vehicle_id.");
const driverInput = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe("Driver name or driver_id.");

/** A fleet name the read could not resolve, as the proposal's issue. */
function refIssue(field: string, error: string): AiPrepareResult {
  return { kind: "issues", issues: [{ field, message: error }] };
}

function labelOf(ref: Extract<FleetRef, { ok: true }>): ProposalLabels {
  return ref.label ? { [ref.id]: ref.label } : {};
}

// ─── Trips ───────────────────────────────────────────────────────────────────

export const proposeTrip = defineAiProposal({
  name: "proposeTrip",
  domain: "flota",
  permission: "trips:write",
  sources: ["trips", "vehicles", "drivers"],
  description:
    "Propose creating a trip (viaje) for the user to accept on a card: date, " +
    "vehicle, driver and companion (acompañante, an active employee) as the " +
    "user said them and status (default planned), the fields of the trip " +
    "form. Cargas are put on the trip from the trip page. Writes nothing by " +
    "itself.",
  input: z.object({
    trip_date: IsoDateSchema,
    vehicle: vehicleInput.optional(),
    driver: driverInput.optional(),
    companion: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .optional()
      .describe("Companion (acompañante): an active employee's name or id."),
    status: z.enum(TRIP_STATUSES).optional(),
  }),
  spec: tripProposalSpec,
  prepare: async (ctx, input) => {
    const [vehicle, driver, companion] = await Promise.all([
      input.vehicle ? resolveVehicle(ctx.access, input.vehicle) : null,
      input.driver ? resolveDriver(ctx.access, input.driver) : null,
      input.companion ? resolveCompanion(input.companion) : null,
    ]);
    if (vehicle && !vehicle.ok) return refIssue("vehicle", vehicle.error);
    if (driver && !driver.ok) return refIssue("driver", driver.error);
    if (companion && !companion.ok) {
      return refIssue("companion", companion.error);
    }
    return {
      kind: "draft",
      draft: {
        trip_date: input.trip_date,
        vehicle_id: vehicle?.id ?? null,
        driver_id: driver?.id ?? null,
        companion_employee_id: companion?.id ?? null,
        status: input.status ?? "planned",
      },
      labels: {
        ...(vehicle ? labelOf(vehicle) : {}),
        ...(driver ? labelOf(driver) : {}),
        ...(companion ? labelOf(companion) : {}),
      },
    };
  },
  execute: async (ctx, draft) =>
    createTrip(await createSupabaseClient(), ctx.userId, draft),
});

// ─── Shipments ───────────────────────────────────────────────────────────────

export const proposeShipment = defineAiProposal({
  name: "proposeShipment",
  domain: "flota",
  permission: "shipments:write",
  sources: ["shipments", "clients"],
  description:
    "Propose creating a carga (shipment) for the user to accept on a card: " +
    "client (name or CUIT), description, kind (retiro/carga/mudanza, " +
    "default carga), load address (origin) and unload address " +
    "(destination), load day (scheduled_date) and unload day (unload_date, " +
    "not before the load day), horario (time_window) and observaciones " +
    "(notes): the fields of the carga form; and trip_id (from getTrips) to " +
    "put it on a trip. Writes nothing by itself.",
  input: z.object({
    client: z.string().trim().min(1).max(160).optional(),
    description: text(500),
    kind: z.enum(SHIPMENT_KINDS).optional(),
    origin: text(160).describe("Dirección de carga (where it is loaded)."),
    destination: text(160).describe("Dirección de descarga (where it goes)."),
    scheduled_date: IsoDateSchema.optional().describe("Fecha de carga."),
    unload_date: IsoDateSchema.optional().describe("Fecha de descarga."),
    time_window: text(60).describe("Horario, e.g. «8 a 12 hs»."),
    notes: text(1000).describe("Observaciones."),
    trip_id: UuidSchema.optional(),
  }),
  spec: shipmentProposalSpec,
  prepare: async (ctx, input) => {
    const client = input.client
      ? await resolveClientRef(ctx.access, input.client, "client")
      : null;
    if (client && !client.ok) return client.result;
    return {
      kind: "draft",
      draft: {
        client_id: client?.id ?? null,
        trip_id: input.trip_id ?? null,
        kind: input.kind ?? "carga",
        origin: input.origin ?? null,
        destination: input.destination ?? null,
        description: input.description ?? null,
        scheduled_date: input.scheduled_date ?? null,
        unload_date: input.unload_date ?? null,
        time_window: input.time_window ?? null,
        notes: input.notes ?? null,
      },
      labels: client?.label ? { [client.id]: client.label } : {},
    };
  },
  execute: async (ctx, draft) =>
    createShipment(await createSupabaseClient(), ctx.userId, draft),
});

export const proposeShipmentStatus = defineAiProposal({
  name: "proposeShipmentStatus",
  domain: "flota",
  permission: ["shipments:write", "shipments:read"],
  sources: ["shipments", "shipment_status_history"],
  description:
    "Propose changing a carga's status (shipment_id from getShipments) for " +
    "the user to accept on a card: delivered (entregar, delivery_date " +
    "default today), cancelled (cancelar, needs failure_reason) or " +
    "reprogrammed (reprogramar, new scheduled_date and optional reason; an " +
    "En curso carga goes back to No iniciada and leaves its trip). A carga " +
    "starts (En curso) by itself on its trip's date. Writes nothing by itself.",
  input: z.object({
    shipment_id: UuidSchema,
    status: z.enum(OFFERED_SHIPMENT_TARGETS),
    delivery_date: IsoDateSchema.optional(),
    scheduled_date: IsoDateSchema.optional(),
    failure_reason: text(1000),
    comment: text(1000),
  }),
  spec: shipmentStatusProposalSpec,
  prepare: async (_ctx, input) => {
    const res = await listShipmentsAction({ id: input.shipment_id, limit: 1 });
    if (!res.ok) return { kind: "error", error: res.error };
    const shipment = res.data[0];
    if (!shipment) return { kind: "error", error: "No se encontró la carga." };
    const before = SHIPMENT_STATUS_LABELS[shipment.status];
    if (!SHIPMENT_NEXT_STATUSES[shipment.status].includes(input.status)) {
      return {
        kind: "error",
        error: `La carga está ${before.toLowerCase()}: no puede pasar a ${SHIPMENT_STATUS_LABELS[input.status].toLowerCase()}.`,
      };
    }
    if (input.status === "cancelled" && !input.failure_reason) {
      return {
        kind: "issues",
        issues: [{ field: "failure_reason", message: CANCEL_REASON_REQUIRED }],
      };
    }
    const client =
      shipment.client?.display_name ?? shipment.client?.legal_name ?? null;
    const shipmentLabel = [
      shipment.remito_number
        ? `Remito ${shipment.remito_number}`
        : "Sin remito",
      client,
      shipment.scheduled_date
        ? formatArgentineDate(shipment.scheduled_date)
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const withReason =
      input.status === "cancelled" || input.status === "reprogrammed";
    return {
      kind: "draft",
      draft: {
        id: shipment.id,
        status: input.status,
        comment: input.comment ?? null,
        delivery_date:
          input.status === "delivered"
            ? (input.delivery_date ?? todayInAR())
            : null,
        failure_reason: withReason ? (input.failure_reason ?? null) : null,
        scheduled_date:
          input.status === "reprogrammed"
            ? (input.scheduled_date ?? shipment.scheduled_date)
            : null,
      },
      labels: {
        [SHIPMENT_STATUS_LABEL_KEYS.shipment]: shipmentLabel,
        [SHIPMENT_STATUS_LABEL_KEYS.statusBefore]: before,
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await changeShipmentStatus(
      await createSupabaseClient(),
      ctx.userId,
      draft,
    );
    return res.ok ? { ok: true, data: { id: draft.id } } : res;
  },
});

// ─── Fuel ────────────────────────────────────────────────────────────────────

export const proposeFuelLoad = defineAiProposal({
  name: "proposeFuelLoad",
  domain: "flota",
  permission: "fuel:write",
  sources: ["fuel_loads", "vehicles"],
  description:
    "Propose registering a fuel load (carga de combustible) for the user to " +
    "accept on a card: vehicle, date (default today), liters and amount as " +
    "the user said them (from the ticket), odometer, station and card. " +
    "Writes nothing by itself; never invents liters or amounts.",
  input: z.object({
    vehicle: vehicleInput,
    load_date: IsoDateSchema.optional(),
    liters: z.number().finite().positive().max(KM_MAX),
    amount: z.number().finite().min(0).max(MONEY_MAX),
    odometer_km: km,
    station: text(120),
    card: text(120),
    notes: text(2000),
  }),
  spec: fuelLoadProposalSpec,
  prepare: async (ctx, input) => {
    const vehicle = await resolveVehicle(ctx.access, input.vehicle);
    if (!vehicle.ok) return refIssue("vehicle", vehicle.error);
    return {
      kind: "draft",
      draft: {
        vehicle_id: vehicle.id,
        trip_id: null,
        load_date: input.load_date ?? todayInAR(),
        liters: input.liters,
        amount: input.amount,
        odometer_km: input.odometer_km ?? null,
        station: input.station ?? null,
        card: input.card ?? null,
        notes: input.notes ?? null,
      },
      labels: labelOf(vehicle),
    };
  },
  execute: async (ctx, draft) =>
    createFuelLoad(await createSupabaseClient(), ctx, draft),
});

// ─── Maintenance ─────────────────────────────────────────────────────────────

export const proposeMaintenance = defineAiProposal({
  name: "proposeMaintenance",
  domain: "flota",
  permission: "maintenance:write",
  sources: ["maintenance_records", "vehicles"],
  description:
    "Propose registering a vehicle maintenance (service, reparación, " +
    "neumáticos, VTV or otro) for the user to accept on a card: vehicle, " +
    "date (default today), kind, description, cost, odometer, next service " +
    "date or km and the provider/workshop. Writes nothing by itself; never " +
    "invents costs.",
  input: z.object({
    vehicle: vehicleInput,
    service_date: IsoDateSchema.optional(),
    kind: z.enum(MAINTENANCE_KINDS).optional(),
    description: z.string().trim().min(1).max(500),
    cost: money,
    odometer_km: km,
    next_service_date: IsoDateSchema.optional(),
    next_service_km: km,
    provider: text(160),
    notes: text(2000),
  }),
  spec: maintenanceProposalSpec,
  prepare: async (ctx, input) => {
    const vehicle = await resolveVehicle(ctx.access, input.vehicle);
    if (!vehicle.ok) return refIssue("vehicle", vehicle.error);
    return {
      kind: "draft",
      draft: {
        vehicle_id: vehicle.id,
        service_date: input.service_date ?? todayInAR(),
        kind: input.kind ?? "service",
        description: input.description,
        cost: input.cost ?? null,
        odometer_km: input.odometer_km ?? null,
        next_service_date: input.next_service_date ?? null,
        next_service_km: input.next_service_km ?? null,
        provider: input.provider ?? null,
        notes: input.notes ?? null,
      },
      labels: labelOf(vehicle),
    };
  },
  execute: async (ctx, draft) =>
    createMaintenance(await createSupabaseClient(), ctx, draft),
});
