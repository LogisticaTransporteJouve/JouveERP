import {
  listEnabledPosAction,
  listInvoicingChannelsAction,
  type FiscalChannelOption,
} from "@/features/invoices/actions/invoices-actions";

import type { AiPrepareResult } from "../propose";

import { MAX_CANDIDATES, norm } from "./resolve-client";

// Where a proposal that issues a comprobante for a client issues it: the
// active channel of the client's side (Ventas → fiscal, Otras ventas →
// internal) and one of its enabled puntos de venta, as the forms offer them.
// A name the user did not give is asked about when there is more than one.

export type IssuePoint = { channel: FiscalChannelOption; puntoVenta: number };

function ask(
  field: string,
  message: string,
  options: { value: string; label: string }[],
): AiPrepareResult {
  return {
    kind: "issues",
    issues: [{ field, message }],
    ...(options.length ? { candidates: [{ field, options }] } : {}),
  };
}

export async function resolveIssuePoint(
  client: { is_fiscal: boolean },
  said: { channel?: string; punto_venta?: number },
): Promise<
  { ok: true; value: IssuePoint } | { ok: false; result: AiPrepareResult }
> {
  const channels = await listInvoicingChannelsAction();
  if (!channels.ok) {
    return { ok: false, result: { kind: "error", error: channels.error } };
  }
  const sideChannels = channels.data.filter(
    (c) => c.is_fiscal === client.is_fiscal,
  );
  const wanted = said.channel ? norm(said.channel) : null;
  const matching = wanted
    ? sideChannels.filter(
        (c) => c.id === said.channel || norm(c.name) === wanted,
      )
    : sideChannels;
  const channel = matching[0];
  if (!channel) {
    return {
      ok: false,
      result: {
        kind: "error",
        error: client.is_fiscal
          ? "No hay un canal de Ventas activo para emitir."
          : "No hay un canal de Otras ventas activo para emitir.",
      },
    };
  }
  if (matching.length > 1) {
    return {
      ok: false,
      result: ask(
        "channel",
        "Hay más de un canal: ¿por cuál emito?",
        matching
          .slice(0, MAX_CANDIDATES)
          .map((c) => ({ value: c.id, label: c.name })),
      ),
    };
  }

  const pos = await listEnabledPosAction(channel.id);
  if (!pos.ok)
    return { ok: false, result: { kind: "error", error: pos.error } };
  const posPick =
    said.punto_venta !== undefined
      ? pos.data.find((p) => p.numero === said.punto_venta)
      : pos.data.length === 1
        ? pos.data[0]
        : undefined;
  if (!posPick) {
    if (pos.data.length === 0) {
      return {
        ok: false,
        result: {
          kind: "error",
          error: `No hay puntos de venta habilitados para ${channel.name}.`,
        },
      };
    }
    return {
      ok: false,
      result: ask(
        "punto_venta",
        said.punto_venta !== undefined
          ? `El punto de venta ${said.punto_venta} no está habilitado para ${channel.name}.`
          : "Hay más de un punto de venta: ¿cuál uso?",
        pos.data.slice(0, MAX_CANDIDATES).map((p) => ({
          value: String(p.numero),
          label: p.nickname ? `${p.numero} · ${p.nickname}` : String(p.numero),
        })),
      ),
    };
  }
  return { ok: true, value: { channel, puntoVenta: posPick.numero } };
}
