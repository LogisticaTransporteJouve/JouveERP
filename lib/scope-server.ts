import "server-only";

import { cookies } from "next/headers";

import { getCurrentUserContext } from "@/lib/auth/context";
import { isFiscalOnly } from "@/lib/auth/permissions";
import {
  parseFiscalFilter,
  SCOPE_COOKIE,
  toScopeSide,
  type FiscalFilter,
  type ScopeSide,
} from "@/lib/scope";

/** The side the menu last switched to (Ventas/Compras = fiscal, Otras = internal),
 *  so a split page prefetches under the query key the client will read.
 *  Fiscal without a cookie, and always fiscal for a fiscal-only user. */
export async function readScopeCookie(): Promise<ScopeSide> {
  if (isFiscalOnly((await getCurrentUserContext())?.access)) return "fiscal";
  const raw = (await cookies()).get(SCOPE_COOKIE)?.value;
  if (!raw) return "fiscal";
  try {
    return toScopeSide(parseFiscalFilter(decodeURIComponent(raw)));
  } catch {
    return "fiscal";
  }
}

/** The scope of a shared page (treasury, dashboard…): every channel, except a
 *  fiscal-only user, who stays fiscal. Matches `useScopeIsFiscal` off a split page. */
export async function readSharedScope(): Promise<FiscalFilter> {
  return isFiscalOnly((await getCurrentUserContext())?.access)
    ? "fiscal"
    : "all";
}
