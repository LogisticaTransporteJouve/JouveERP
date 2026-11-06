import { z } from "zod";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { ACCOUNT_TYPE_LABEL, type Account } from "@/features/accounts/schema";
import type { EnCarteraCheck } from "@/features/checks/actions/checks-actions";
import {
  readInvoicingChannels,
  type InvoicingChannelRow,
} from "@/lib/channels";
import { formatMoney } from "@/lib/format";
import type { ScopeSide } from "@/lib/scope";

import type { AiPrepareResult } from "../propose";

import { MAX_CANDIDATES, norm } from "./resolve-client";

// How the model names what a treasury proposal needs (a cash account, a
// client, a supplier, a channel side) → the record, through the features'
// read actions (their own gate + RLS). A miss or a tie comes back as the
// `issues` a proposal returns, with the candidates to ask about.

export type Resolved<T> =
  { ok: true; value: T } | { ok: false; result: AiPrepareResult };

/** The one option whose name equals `said`, else the one that contains it;
 *  otherwise `null` and the close ones (all of them when none is close). */
export function pick<T>(
  said: string,
  options: readonly T[],
  names: (o: T) => string[],
): { one: T } | { many: T[] } {
  const q = norm(said);
  const exact = options.filter((o) => names(o).some((n) => norm(n) === q));
  if (exact.length === 1 && exact[0] !== undefined) return { one: exact[0] };
  const close = options.filter((o) =>
    names(o).some((n) => norm(n).includes(q)),
  );
  if (close.length === 1 && close[0] !== undefined) return { one: close[0] };
  return { many: exact.length > 1 ? exact : close };
}

export function ask(
  field: string,
  message: string,
  options: { value: string; label: string }[],
): AiPrepareResult {
  return {
    kind: "issues",
    issues: [{ field, message }],
    ...(options.length
      ? { candidates: [{ field, options: options.slice(0, MAX_CANDIDATES) }] }
      : {}),
  };
}

export function accountLabel(a: Pick<Account, "name" | "currency">): string {
  return `${a.name} (${a.currency})`;
}

/** An active treasury account by name ("Banco Galicia", "Caja"), among those
 *  `allowed` keeps (e.g. no check accounts for a cash movement). Unnamed,
 *  the only allowed one; otherwise a question offering them. */
export async function resolveAccount(
  said: string | undefined,
  field: string,
  allowed: (a: Account) => boolean = () => true,
): Promise<Resolved<Account>> {
  const res = await listAccountsAction();
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  const accounts = res.data.filter((a) => a.is_active && allowed(a));
  const options = (list: readonly Account[]) =>
    list.map((a) => ({
      value: a.name,
      label: `${accountLabel(a)} · ${ACCOUNT_TYPE_LABEL[a.type]}`,
    }));
  if (!said?.trim()) {
    if (accounts.length === 1 && accounts[0]) {
      return { ok: true, value: accounts[0] };
    }
    return {
      ok: false,
      result: ask(
        field,
        accounts.length === 0
          ? "No hay una cuenta activa que sirva para esto."
          : "¿En qué cuenta?",
        options(accounts),
      ),
    };
  }
  const found = pick(said, accounts, (a) => [a.name]);
  if ("one" in found) return { ok: true, value: found.one };
  return {
    ok: false,
    result: ask(
      field,
      found.many.length === 0
        ? `No hay una cuenta activa que coincida con "${said}".`
        : `"${said}" coincide con varias cuentas.`,
      options(found.many.length ? found.many : accounts),
    ),
  };
}

export const CHANNEL_SIDES = [
  "fiscal",
  "internal",
] as const satisfies readonly ScopeSide[];

export const ChannelSideInput = z
  .enum(CHANNEL_SIDES)
  .optional()
  .describe(
    "'fiscal' (Ventas/Compras) or 'internal' (Otras ventas/compras). Omit " +
      "unless the user said it; the proposal asks when it cannot tell.",
  );

/** The active invoicing channels, or an error result. */
export async function activeChannels(): Promise<
  Resolved<InvoicingChannelRow[]>
> {
  const res = await readInvoicingChannels();
  if (!res.ok) {
    return {
      ok: false,
      result: { kind: "error", error: "No se pudieron leer los canales." },
    };
  }
  return { ok: true, value: res.channels.filter((c) => c.is_active) };
}

/** The channel of a side; with no side, the only active channel, else a
 *  question offering the sides of `among` (default: every active channel). */
export function channelFor(
  channels: readonly InvoicingChannelRow[],
  side: ScopeSide | undefined,
  among: readonly InvoicingChannelRow[] = channels,
): Resolved<InvoicingChannelRow> {
  if (side) {
    const isFiscal = side === "fiscal";
    const match = channels.filter((c) => c.is_fiscal === isFiscal);
    if (match.length === 1 && match[0]) return { ok: true, value: match[0] };
    return {
      ok: false,
      result: {
        kind: "error",
        error:
          match.length === 0
            ? `No hay un canal ${isFiscal ? "fiscal" : "interno"} activo.`
            : `Hay más de un canal ${isFiscal ? "fiscal" : "interno"} activo: cargalo desde la pantalla.`,
      },
    };
  }
  if (channels.length === 1 && channels[0]) {
    return { ok: true, value: channels[0] };
  }
  if (among.length === 1 && among[0]) return { ok: true, value: among[0] };
  return {
    ok: false,
    result: ask(
      "channel",
      "¿Va por el canal fiscal o por el interno?",
      (among.length ? among : channels).map((c) => ({
        value: c.is_fiscal ? "fiscal" : "internal",
        label: c.name,
      })),
    ),
  };
}

/** A check number as typed: digits only, no leading zeros. */
function checkNumberKey(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+/, "");
}

/** The cartera check with the number the user said (and bank, when the
 *  number alone is ambiguous): an error when none has it, a question
 *  offering the banks when several do. */
export function pickCarteraCheck(
  checks: readonly EnCarteraCheck[],
  number: string,
  bank: string | undefined,
  field: string,
): Resolved<EnCarteraCheck> {
  const key = checkNumberKey(number);
  const b = bank ? norm(bank) : "";
  const found = checks.filter(
    (c) =>
      checkNumberKey(c.check_number) === key &&
      (!b || norm(c.bank_name).includes(b)),
  );
  if (found.length === 1 && found[0]) return { ok: true, value: found[0] };
  if (found.length === 0) {
    return {
      ok: false,
      result: {
        kind: "error",
        error: `No hay un cheque en cartera con el número ${number}.`,
      },
    };
  }
  return {
    ok: false,
    result: ask(
      field,
      `Hay varios cheques en cartera con el número ${number}.`,
      found.map((c) => ({
        value: c.bank_name,
        label: `${c.bank_name} · ${c.drawer_name} · ${formatMoney(c.amount, c.currency)}`,
      })),
    ),
  };
}
