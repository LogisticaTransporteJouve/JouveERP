import { z } from "zod";

import {
  getFreightSettlementAction,
  listFreightSettlementCandidatesAction,
} from "@/features/freight-settlements/actions/freight-settlements-actions";
import { MAINTENANCE_KINDS } from "@/features/maintenance/schema";
import {
  findShipmentRemitoConflictAction,
  listShipmentsAction,
} from "@/features/shipments/actions/shipments-actions";
import {
  REMITO_NUMBER_MAX,
  SHIPMENT_NEXT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TARGET_STATUSES,
} from "@/features/shipments/schema";
import { TRIP_STATUSES } from "@/features/trips/schema";
import { userCan } from "@/lib/auth/permissions";
import { changeShipmentStatus } from "@/lib/commands/change-shipment-status";
import { confirmFreightSettlement } from "@/lib/commands/confirm-freight-settlement";
import { createFuelLoad } from "@/lib/commands/create-fuel-load";
import { createMaintenance } from "@/lib/commands/create-maintenance";
import { createShipment } from "@/lib/commands/create-shipment";
import { createTrip } from "@/lib/commands/create-trip";
import { saveFreightSettlement } from "@/lib/commands/save-freight-settlement";
import { REMITO_TAKEN_ERROR } from "@/lib/commands/shipment-remito";
import {
  formatArgentineDate,
  formatMoney,
  round2,
  todayInAR,
} from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

import {
  CANCEL_REASON_REQUIRED,
  FREIGHT_CONFIRM_LABELS,
  FREIGHT_SETTLEMENT_LABELS,
  SHIPMENT_STATUS_LABEL_KEYS,
  freightSettlementConfirmProposalSpec,
  freightSettlementProposalSpec,
  fuelLoadProposalSpec,
  maintenanceProposalSpec,
  shipmentProposalSpec,
  shipmentStatusProposalSpec,
  tripProposalSpec,
  type ProposalLabels,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { resolveClientRef } from "./resolve-client";
import { resolveDriver, resolveVehicle, type FleetRef } from "./fleet-refs";

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
    "vehicle and driver as the user said them, origin, destination, cargo, " +
    "status (default planned), km, revenue and cost if the user gave them. " +
    "Writes nothing by itself; never invents amounts.",
  input: z.object({
    trip_date: IsoDateSchema,
    vehicle: vehicleInput.optional(),
    driver: driverInput.optional(),
    origin: text(160),
    destination: text(160),
    cargo_description: text(500),
    status: z.enum(TRIP_STATUSES).optional(),
    km,
    revenue: money,
    cost: money,
    notes: text(2000),
  }),
  spec: tripProposalSpec,
  prepare: async (ctx, input) => {
    const [vehicle, driver] = await Promise.all([
      input.vehicle ? resolveVehicle(ctx.access, input.vehicle) : null,
      input.driver ? resolveDriver(ctx.access, input.driver) : null,
    ]);
    if (vehicle && !vehicle.ok) return refIssue("vehicle", vehicle.error);
    if (driver && !driver.ok) return refIssue("driver", driver.error);
    return {
      kind: "draft",
      draft: {
        trip_date: input.trip_date,
        vehicle_id: vehicle?.id ?? null,
        driver_id: driver?.id ?? null,
        channel_id: null,
        origin: input.origin ?? null,
        destination: input.destination ?? null,
        cargo_description: input.cargo_description ?? null,
        status: input.status ?? "planned",
        km: input.km ?? null,
        revenue: input.revenue ?? null,
        cost: input.cost ?? null,
        notes: input.notes ?? null,
      },
      labels: {
        ...(vehicle ? labelOf(vehicle) : {}),
        ...(driver ? labelOf(driver) : {}),
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
    "client (name or CUIT), remito number, scheduled date, origin, " +
    "destination, description, freight and cash-on-delivery amounts if the " +
    "user gave them, and trip_id (from getTrips) to put it on a trip. A remito " +
    "number another carga of the client holds is refused. Writes nothing by " +
    "itself; never invents amounts.",
  input: z.object({
    client: z.string().trim().min(1).max(160).optional(),
    remito_number: text(REMITO_NUMBER_MAX),
    scheduled_date: IsoDateSchema.optional(),
    origin: text(160),
    destination: text(160),
    description: text(500),
    freight_amount: money,
    cod_amount: z.number().finite().positive().max(MONEY_MAX).optional(),
    trip_id: UuidSchema.optional(),
    notes: text(2000),
  }),
  spec: shipmentProposalSpec,
  prepare: async (ctx, input) => {
    const client = input.client
      ? await resolveClientRef(ctx.access, input.client, "client")
      : null;
    if (client && !client.ok) return client.result;
    // The form warns before saving; the unique index refuses on accept.
    if (
      client &&
      input.remito_number &&
      userCan(ctx.access, "shipments:read")
    ) {
      const conflict = await findShipmentRemitoConflictAction({
        client_id: client.id,
        remito_number: input.remito_number,
      });
      if (!conflict.ok) return { kind: "error", error: conflict.error };
      if (conflict.data) {
        return {
          kind: "issues",
          issues: [{ field: "remito_number", message: REMITO_TAKEN_ERROR }],
        };
      }
    }
    return {
      kind: "draft",
      draft: {
        client_id: client?.id ?? null,
        trip_id: input.trip_id ?? null,
        channel_id: null,
        remito_number: input.remito_number ?? null,
        origin: input.origin ?? null,
        destination: input.destination ?? null,
        description: input.description ?? null,
        scheduled_date: input.scheduled_date ?? null,
        freight_amount: input.freight_amount ?? null,
        cod_amount: input.cod_amount ?? null,
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
    "the user to accept on a card: in_progress (iniciar), delivered " +
    "(entregar, delivery_date default today), cancelled (cancelar, needs " +
    "failure_reason) or reprogrammed (reprogramar, new scheduled_date and " +
    "optional reason). Writes nothing by itself.",
  input: z.object({
    shipment_id: UuidSchema,
    status: z.enum(SHIPMENT_TARGET_STATUSES),
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

// ─── Freight settlements ─────────────────────────────────────────────────────

/** Cargas per liquidación (FreightSettlementSaveSchema). */
const MAX_SETTLEMENT_SHIPMENTS = 500;

export const proposeFreightSettlement = defineAiProposal({
  name: "proposeFreightSettlement",
  domain: "ventas",
  permission: ["invoices:issue", "invoices:read"],
  sources: ["freight_settlements", "freight_settlement_items", "shipments"],
  description:
    "Propose a liquidación de fletes draft for a client and period, for the " +
    "user to accept on a card: it takes every delivered carga of the period " +
    "not settled yet that has a flete or a freight tariff, priced by the " +
    "server. It stays a draft; confirming and invoicing it are done on the " +
    "liquidación. Writes nothing by itself.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Client name or CUIT, as the user said it."),
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
    notes: z.string().trim().min(1).max(1000).optional(),
  }),
  spec: freightSettlementProposalSpec,
  prepare: async (ctx, input) => {
    const client = await resolveClientRef(ctx.access, input.client, "client");
    if (!client.ok) return client.result;
    const res = await listFreightSettlementCandidatesAction({
      client_id: client.id,
      period_start: input.period_start,
      period_end: input.period_end,
    });
    if (!res.ok) return { kind: "error", error: res.error };
    const priced = res.data.filter((c) => c.amount !== null && c.amount > 0);
    if (priced.length === 0) {
      return {
        kind: "error",
        error:
          res.data.length === 0
            ? "No hay cargas entregadas sin liquidar de ese cliente en el período."
            : "Las cargas entregadas del período no tienen flete ni tarifa de flete vigente: cargá uno de los dos.",
      };
    }
    if (priced.length > MAX_SETTLEMENT_SHIPMENTS) {
      return {
        kind: "error",
        error: `Son ${priced.length} cargas: una liquidación lleva hasta ${MAX_SETTLEMENT_SHIPMENTS}. Acortá el período.`,
      };
    }
    const total = priced.reduce((s, c) => s + (c.amount ?? 0), 0);
    return {
      kind: "draft",
      draft: {
        client_id: client.id,
        period_start: input.period_start,
        period_end: input.period_end,
        shipment_ids: priced.map((c) => c.shipment_id),
        notes: input.notes ?? null,
      },
      labels: {
        ...(client.label ? { [client.id]: client.label } : {}),
        [FREIGHT_SETTLEMENT_LABELS.total]: formatMoney(total),
        [FREIGHT_SETTLEMENT_LABELS.unpriced]: String(
          res.data.length - priced.length,
        ),
      },
    };
  },
  execute: (ctx, draft) => saveFreightSettlement(ctx.userId, draft),
});

export const proposeFreightSettlementConfirm = defineAiProposal({
  name: "proposeFreightSettlementConfirm",
  domain: "ventas",
  permission: ["invoices:issue", "invoices:read"],
  sources: [
    "freight_settlements",
    "freight_settlement_items",
    "shipments",
    "client_tariffs",
  ],
  description:
    "Propose confirming a liquidación de fletes draft of a Ventas client " +
    "(settlement_id from getFreightSettlements) for the user to accept on a " +
    "card: each carga is priced at its flete or the freight tariff in force, " +
    "the card shows that total and confirming emits its Remito R. An Otras " +
    "ventas liquidación is confirmed when its remito interno is issued, on " +
    "the liquidación. Writes nothing by itself.",
  input: z.object({ settlement_id: UuidSchema }),
  spec: freightSettlementConfirmProposalSpec,
  prepare: async (_ctx, input) => {
    const detail = await getFreightSettlementAction(input.settlement_id);
    if (!detail.ok) return { kind: "error", error: detail.error };
    const s = detail.data;
    if (s.status !== "draft") {
      return {
        kind: "error",
        error:
          s.status === "cancelled"
            ? "La liquidación está cancelada."
            : "La liquidación ya está confirmada.",
      };
    }
    if (!s.client_is_fiscal) {
      return {
        kind: "error",
        error:
          "Es una liquidación de Otras ventas: se confirma al emitir su remito interno, desde la liquidación.",
      };
    }
    if (s.items.length === 0) {
      return { kind: "error", error: "La liquidación no tiene cargas." };
    }
    // The prices the confirm will take: each carga's flete or tariff now.
    const res = await listFreightSettlementCandidatesAction({
      client_id: s.client_id,
      period_start: s.period_start,
      period_end: s.period_end,
      settlement_id: s.id,
    });
    if (!res.ok) return { kind: "error", error: res.error };
    const priceOf = new Map(res.data.map((c) => [c.shipment_id, c.amount]));
    let total = 0;
    for (const item of s.items) {
      const amount = priceOf.get(item.shipment_id);
      const name = item.remito_number ?? item.shipment_id.slice(0, 8);
      if (amount === undefined) {
        return {
          kind: "error",
          error: `La carga ${name} ya no se puede liquidar en este período: revisá la liquidación.`,
        };
      }
      if (amount === null || amount <= 0) {
        return {
          kind: "error",
          error: `La carga ${name} ya no tiene flete ni tarifa de flete vigente: cargá uno de los dos.`,
        };
      }
      total += amount;
    }
    total = round2(total);
    return {
      kind: "draft",
      draft: { id: s.id, expected_total: total },
      labels: {
        [s.id]: s.client_name,
        [FREIGHT_CONFIRM_LABELS.period]: `${formatArgentineDate(s.period_start)} al ${formatArgentineDate(s.period_end)}`,
        [FREIGHT_CONFIRM_LABELS.cargas]: String(s.items.length),
        ...(round2(s.total) !== total
          ? { [FREIGHT_CONFIRM_LABELS.savedTotal]: formatMoney(s.total) }
          : {}),
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await confirmFreightSettlement(
      ctx.userId,
      draft.id,
      draft.expected_total,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        id: draft.id,
        ...(res.data.number ? { note: `Remito ${res.data.number}` } : {}),
      },
    };
  },
});
