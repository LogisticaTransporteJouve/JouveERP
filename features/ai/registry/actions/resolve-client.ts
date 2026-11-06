import { searchClientsAction } from "@/features/clients/actions/clients-actions";
import type { Client } from "@/features/clients/schema";
import { type Access, userCan } from "@/lib/auth/permissions";
import { UuidSchema } from "@/lib/validation/common";

import type { AiPrepareResult } from "../propose";

/** Options offered to the user when a name matched several records. */
export const MAX_CANDIDATES = 5;

/** Case- and accent-insensitive form of a name, for exact matches. */
export function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

/**
 * The client a proposal's `client` input names (razón social, nombre de
 * fantasía or CUIT), through the clients search the picker uses: one exact
 * match or a single hit wins; none or several come back as the issue to ask
 * the user about, with the candidates.
 */
export async function resolveClient(
  query: string,
  opts: { onlyActive?: boolean; field?: string } = {},
): Promise<
  | { ok: true; client: Client }
  | { ok: false; result: Exclude<AiPrepareResult, { kind: "draft" }> }
> {
  const field = opts.field ?? "client";
  const onlyActive = opts.onlyActive ?? true;
  const res = await searchClientsAction({
    query,
    onlyActive,
    limit: MAX_CANDIDATES + 1,
  });
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  const found = res.data.clients;
  const q = norm(query);
  const digits = query.replace(/[^0-9]/g, "");
  const exact = found.filter(
    (c) =>
      norm(c.legal_name) === q ||
      (!!c.display_name && norm(c.display_name) === q) ||
      (digits.length === 11 && c.cuit === digits),
  );
  const pick =
    exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
  if (pick) return { ok: true, client: pick };
  const which = onlyActive ? "cliente activo" : "cliente";
  return {
    ok: false,
    result: {
      kind: "issues",
      issues: [
        {
          field,
          message:
            found.length === 0
              ? `No hay un ${which} que coincida con "${query}".`
              : `Hay varios clientes que coinciden con "${query}".`,
        },
      ],
      candidates: found.length
        ? [
            {
              field,
              options: found.slice(0, MAX_CANDIDATES).map((c) => ({
                value: c.legal_name,
                label: c.cuit ? `${c.legal_name} (${c.cuit})` : c.legal_name,
              })),
            },
          ]
        : undefined,
    },
  };
}

export type ClientRef =
  | { ok: true; id: string; label: string | null }
  | { ok: false; result: Exclude<AiPrepareResult, { kind: "draft" }> };

/** A client the model names either by id (passes as is, e.g. from another
 *  read's result) or by name/CUIT, which needs `clients:read` to search. */
export async function resolveClientRef(
  access: Access,
  said: string,
  field = "client",
): Promise<ClientRef> {
  const ref = said.trim();
  if (UuidSchema.safeParse(ref).success) {
    return { ok: true, id: ref, label: null };
  }
  if (!userCan(access, "clients:read")) {
    return {
      ok: false,
      result: {
        kind: "error",
        error:
          "Para buscar un cliente por nombre hace falta permiso para ver clientes: pasá su id.",
      },
    };
  }
  const found = await resolveClient(ref, { field });
  if (!found.ok) return found;
  return { ok: true, id: found.client.id, label: found.client.legal_name };
}
