import { searchSuppliersAction } from "@/features/suppliers/actions/suppliers-actions";
import type { Supplier } from "@/features/suppliers/schema";

import type { AiPrepareResult } from "../propose";

import { MAX_CANDIDATES, norm } from "./resolve-client";

export function supplierName(s: Pick<Supplier, "legal_name" | "cuit">): string {
  return s.cuit ? `${s.legal_name} (CUIT ${s.cuit})` : s.legal_name;
}

export type SupplierLookup =
  | { kind: "found"; supplier: Supplier }
  | { kind: "stop"; result: AiPrepareResult };

/** A supplier as the user named it (legal or fantasy name, or CUIT) → one
 *  supplier, or a question with the candidates. */
export async function findSupplier(
  said: string,
  options: { onlyActive: boolean },
): Promise<SupplierLookup> {
  const res = await searchSuppliersAction({
    query: said,
    onlyActive: options.onlyActive,
    limit: MAX_CANDIDATES + 1,
  });
  if (!res.ok)
    return { kind: "stop", result: { kind: "error", error: res.error } };
  const found = res.data.suppliers;
  const q = norm(said);
  const digits = said.replace(/[^0-9]/g, "");
  const exact = found.filter(
    (s) =>
      norm(s.legal_name) === q ||
      (s.display_name !== null && norm(s.display_name) === q) ||
      (digits.length === 11 && s.cuit === digits),
  );
  const pick =
    exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : undefined;
  if (pick) return { kind: "found", supplier: pick };
  return {
    kind: "stop",
    result: {
      kind: "issues",
      issues: [
        {
          field: "supplier",
          message:
            found.length === 0
              ? `No hay un proveedor${options.onlyActive ? " activo" : ""} que coincida con "${said}".`
              : `Hay varios proveedores que coinciden con "${said}".`,
        },
      ],
      candidates: found.length
        ? [
            {
              field: "supplier",
              options: found.slice(0, MAX_CANDIDATES).map((s) => ({
                value: s.cuit ?? s.legal_name,
                label: supplierName(s),
              })),
            },
          ]
        : undefined,
    },
  };
}
