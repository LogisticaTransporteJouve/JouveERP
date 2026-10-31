import { z } from "zod";

import {
  FISCAL_FILTERS,
  isFiscalFor,
  SCOPE_LABEL,
  type FiscalFilter,
} from "@/lib/scope";

/** The scope a list tool reads, the same three values as the header
 *  selector. Absent = "all". */
export const ScopeInputSchema = z
  .enum(FISCAL_FILTERS)
  .nullish()
  .describe(
    "Scope: 'fiscal' (fiscal channels only: billing, VAT, anything tax), " +
      "'internal' (internal channels only) or 'all' (every channel, default).",
  );

/** The read filter and the label every figure carries. */
export function readScope(scope: FiscalFilter | null | undefined): {
  isFiscal: boolean | null;
  label: string;
} {
  const filter = scope ?? "all";
  return { isFiscal: isFiscalFor(filter), label: SCOPE_LABEL[filter] };
}
