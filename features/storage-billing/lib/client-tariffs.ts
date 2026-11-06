import "server-only";

import {
  isClientTariffConcept,
  isClientTariffCurrency,
  isClientTariffUnit,
  STORAGE_TARIFF_CONCEPTS,
} from "@/features/client-tariffs/schema";
import { fetchUsdRateOnOrBefore } from "@/lib/fx";
import { paginateRange } from "@/lib/supabase/paginate";
import type { getServiceClient } from "@/lib/supabase/service";

import type { ClientTariffInput } from "./billing";

export type StorageRange = { periodStart: string; periodEnd: string };

/**
 * The client tariffs that touch [periodStart, periodEnd] (one client's, or
 * every client's) and, when one of them is in USD, the official rate on or
 * before periodEnd (null when none is loaded). Drained past max_rows: a
 * truncated read would bill at the fallback tariff silently.
 */
export async function loadClientTariffs(
  supabase: ReturnType<typeof getServiceClient>,
  range: StorageRange,
  clientId: string | null,
): Promise<
  | { ok: true; clientTariffs: ClientTariffInput[]; usdRate: number | null }
  | { ok: false; error: unknown }
> {
  const res = await paginateRange((from, to) => {
    let q = supabase
      .from("client_tariffs")
      .select(
        "id, client_id, concept, unit, price, currency, valid_from, valid_to, area_id",
      )
      .in("concept", [...STORAGE_TARIFF_CONCEPTS])
      .lte("valid_from", range.periodEnd)
      .or(`valid_to.is.null,valid_to.gte.${range.periodStart}`);
    if (clientId) q = q.eq("client_id", clientId);
    return q.order("id").range(from, to);
  });
  if (res.error) return { ok: false, error: res.error };

  const clientTariffs: ClientTariffInput[] = [];
  for (const t of res.data ?? []) {
    if (
      !isClientTariffConcept(t.concept) ||
      !isClientTariffUnit(t.unit) ||
      !isClientTariffCurrency(t.currency)
    ) {
      // A row this code cannot price must not bill at the fallback quietly.
      return { ok: false, error: { unknownTariff: t.id } };
    }
    clientTariffs.push({
      client_id: t.client_id,
      concept: t.concept,
      unit: t.unit,
      price: Number(t.price),
      currency: t.currency,
      valid_from: t.valid_from,
      valid_to: t.valid_to,
      area_id: t.area_id,
    });
  }

  const usdRate = clientTariffs.some((t) => t.currency === "USD")
    ? ((await fetchUsdRateOnOrBefore(supabase, range.periodEnd))?.rate ?? null)
    : null;
  return { ok: true, clientTariffs, usdRate };
}
