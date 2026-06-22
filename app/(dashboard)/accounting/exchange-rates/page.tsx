import { redirect } from "next/navigation";

import { listExchangeRatesAction } from "@/features/exchange-rates/actions/exchange-rates-actions";
import { ExchangeRatesPage } from "@/features/exchange-rates/components/exchange-rates-page";
import { exchangeRatesKeys } from "@/features/exchange-rates/lib/exchange-rates-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function ExchangeRatesPageRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    redirect("/dashboard");
  }
  const dehydratedState = await prefetchQueries([
    {
      queryKey: exchangeRatesKeys.list(),
      queryFn: () => runAction(() => listExchangeRatesAction()),
    },
  ]);
  return (
    <Hydrate state={dehydratedState}>
      <ExchangeRatesPage />
    </Hydrate>
  );
}
