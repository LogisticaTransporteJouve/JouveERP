import { isFiscalFor, SCOPE_LABEL, type FiscalFilter } from "@/lib/scope";

/** The read filter and the label every figure carries. */
export function readScope(scope: FiscalFilter | null | undefined): {
  isFiscal: boolean | null;
  label: string;
} {
  const filter = scope ?? "all";
  return { isFiscal: isFiscalFor(filter), label: SCOPE_LABEL[filter] };
}
