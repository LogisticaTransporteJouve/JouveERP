import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  getLateInterestGeneralRateAction,
  listLateInterestCandidatesAction,
} from "@/features/late-interest/actions/late-interest-actions";
import { LateInterestPage } from "@/features/late-interest/components/late-interest-page";
import { lateInterestKeys } from "@/features/late-interest/lib/late-interest-keys";
import { requireUserContext } from "@/lib/auth/context";
import { scopeIsFiscalFor, userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";
import { isFiscalFor } from "@/lib/scope";
import { readScopeCookie } from "@/lib/scope-server";

import Loading from "../loading";

export const dynamic = "force-dynamic";

export default async function LateInterestRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    redirect("/dashboard");
  }

  const asOf = todayInAR();
  const isFiscal = scopeIsFiscalFor(
    ctx.access,
    isFiscalFor(await readScopeCookie()),
  );
  const dehydratedState = await prefetchQueries([
    {
      queryKey: lateInterestKeys.candidates(asOf, isFiscal),
      queryFn: () =>
        runAction(() =>
          listLateInterestCandidatesAction({ as_of: asOf, isFiscal }),
        ),
    },
    {
      queryKey: lateInterestKeys.settings(),
      queryFn: () => runAction(() => getLateInterestGeneralRateAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Intereses por mora
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Facturas y notas de débito vencidas con saldo abierto. El interés es
          simple sobre el saldo, a la tasa mensual del cliente (o la general)
          prorrateada por día, desde el día siguiente al vencimiento o al último
          día ya cobrado. Nada se cobra solo: cada nota de débito se genera a
          mano y un período cobrado no se vuelve a cobrar.
        </p>
      </div>
      <Hydrate state={dehydratedState}>
        <Suspense fallback={<Loading />}>
          <LateInterestPage
            initialAsOf={asOf}
            canIssue={
              userCan(ctx.access, "invoices:issue") &&
              userCan(ctx.access, "credit_debit_notes:issue")
            }
            canSetGeneralRate={userCan(ctx.access, "credit_debit_notes:issue")}
            canSetClientRate={userCan(ctx.access, "clients:write")}
          />
        </Suspense>
      </Hydrate>
    </div>
  );
}
