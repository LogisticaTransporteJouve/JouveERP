import "server-only";

import { cookies } from "next/headers";

import { getCurrentUserContext } from "@/lib/auth/context";
import {
  isFiscalOnly,
  scopeIsFiscalFor,
  type Access,
} from "@/lib/auth/permissions";
import { getInvoicingChannels, getSegregatedChannels } from "@/lib/channels";
import {
  CHANNEL_PARAM,
  isFiscalFor,
  parseFiscalFilter,
  SCOPE_COOKIE,
  segregatedChannelFor,
  toScopeSide,
  type ChannelScope,
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

/** The one validator of a requested segregated channel (page or export): an
 *  active segregated channel, fiscal for a fiscal-only user, else the main
 *  app. The side is the channel's own inside its section, else
 *  `sideIsFiscal`; a fiscal-only user is always pinned to fiscal. */
export async function resolveChannelScope(
  rawChannel: string | null | undefined,
  access: Access | null | undefined,
  sideIsFiscal: boolean | null,
): Promise<ChannelScope> {
  const channel = segregatedChannelFor(
    await getInvoicingChannels(),
    rawChannel,
    isFiscalOnly(access),
  );
  return {
    isFiscal: scopeIsFiscalFor(
      access,
      channel ? channel.is_fiscal : sideIsFiscal,
    ),
    channelId: channel?.id ?? null,
  };
}

/** The scope a split page prefetches under: its `?channel=` section, else
 *  the side the menu last switched to. Matches `usePageChannelScope`. */
export async function readPageChannelScope(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): Promise<ChannelScope> {
  const raw = searchParams?.[CHANNEL_PARAM];
  const access = (await getCurrentUserContext())?.access;
  return resolveChannelScope(
    Array.isArray(raw) ? raw[0] : raw,
    access,
    isFiscalFor(await readScopeCookie()),
  );
}

/** A record's channel when it is an active segregated one (its page opens
 *  inside that channel's section), else `null`. */
export async function segregatedChannelIdOf(
  channelId: string | null | undefined,
): Promise<string | null> {
  if (!channelId) return null;
  const segregated = await getSegregatedChannels();
  return segregated.some((c) => c.id === channelId) ? channelId : null;
}
