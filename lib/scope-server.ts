import "server-only";

import { cookies } from "next/headers";

import {
  parseFiscalFilter,
  SCOPE_COOKIE,
  type FiscalFilter,
} from "@/lib/scope";

/** The scope the header selector last wrote, so a server component prefetches
 *  under the same query key the client will read. `"all"` without a cookie. */
export async function readScopeCookie(): Promise<FiscalFilter> {
  const raw = (await cookies()).get(SCOPE_COOKIE)?.value;
  if (!raw) return "all";
  try {
    return parseFiscalFilter(decodeURIComponent(raw));
  } catch {
    return "all";
  }
}
