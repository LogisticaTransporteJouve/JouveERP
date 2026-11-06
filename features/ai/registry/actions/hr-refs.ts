import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import type { Account } from "@/features/accounts/schema";
import { searchEmployeesAction } from "@/features/hr/actions/employees-actions";
import type { Employee } from "@/features/hr/schema";
import type { ScopeSide } from "@/lib/scope";

import { MAX_CANDIDATES, norm } from "./resolve-client";
import { activeChannels, channelFor, type Resolved } from "./treasury-refs";

// How a proposal's `prepare` turns what the user said (an employee, a
// treasury account, "fiscal" / "interno") into the ids the form's schema
// takes, through the features' read actions (their own gates + RLS). A name
// that matches none or several becomes a question with the candidates.

function ask<T>(
  field: string,
  message: string,
  options: { value: string; label: string }[] = [],
): Resolved<T> {
  return {
    ok: false,
    result: {
      kind: "issues",
      issues: [{ field, message }],
      candidates: options.length
        ? [{ field, options: options.slice(0, MAX_CANDIDATES) }]
        : undefined,
    },
  };
}

/** An employee by name or CUIL: the exact match, else the only one found. */
export async function resolveEmployee(
  said: string,
  { onlyActive = true, field = "employee" } = {},
): Promise<Resolved<Employee>> {
  const res = await searchEmployeesAction({
    query: said,
    onlyActive,
    limit: MAX_CANDIDATES + 1,
  });
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  const found = res.data.employees;
  const digits = said.replace(/[^0-9]/g, "");
  const exact = found.filter(
    (e) =>
      norm(e.legal_name) === norm(said) ||
      (digits.length === 11 && e.cuil === digits),
  );
  const pick =
    exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
  if (pick) return { ok: true, value: pick };
  const who = onlyActive ? "un empleado activo" : "un empleado";
  return ask(
    field,
    found.length === 0
      ? `No hay ${who} que coincida con "${said}".`
      : `Hay varios empleados que coinciden con "${said}".`,
    found.map((e) => ({
      value: e.legal_name,
      label: e.position ? `${e.legal_name} (${e.position})` : e.legal_name,
    })),
  );
}

/** A treasury account by name among those `allowed` keeps (the form's
 *  picker): the exact name, else the only one that contains it. */
export async function resolveTreasuryAccount(
  said: string,
  allowed: (accounts: Account[]) => Account[],
  what: string,
  field = "account",
): Promise<Resolved<Account>> {
  const res = await listAccountsAction();
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  const options = allowed(res.data);
  const q = norm(said);
  const exact = options.filter((a) => norm(a.name) === q);
  const close = options.filter((a) => norm(a.name).includes(q));
  const pick =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  if (pick) return { ok: true, value: pick };
  return ask(
    field,
    close.length === 0
      ? `No hay ${what} que coincida con "${said}".`
      : `"${said}" coincide con varias cuentas.`,
    (close.length ? close : options).map((a) => ({
      value: a.name,
      label: `${a.name} (${a.currency})`,
    })),
  );
}

/** The active invoicing channel of a side (fiscal / interno). */
export async function resolveChannel(
  side: ScopeSide,
): Promise<Resolved<{ id: string; name: string }>> {
  const channels = await activeChannels();
  if (!channels.ok) return channels;
  const channel = channelFor(channels.value, side);
  if (!channel.ok) return channel;
  return {
    ok: true,
    value: { id: channel.value.id, name: channel.value.name },
  };
}
