import { redirect } from "next/navigation";

import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { listTaxDocumentsAction } from "@/features/taxes/actions/tax-documents-actions";
import { TaxesView } from "@/features/taxes/components/taxes-view";
import { taxesKeys } from "@/features/taxes/lib/taxes-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "taxes:read")) {
    redirect("/dashboard");
  }
  const year = Number(todayInAR().slice(0, 4));
  const canWrite = userCan(ctx.access, "taxes:write");

  const [dehydratedState, accountsRes] = await Promise.all([
    prefetchQueries([
      {
        queryKey: taxesKeys.list(year),
        queryFn: () => runAction(() => listTaxDocumentsAction({ year })),
      },
    ]),
    canWrite && userCan(ctx.access, "accounts:read")
      ? listAccountsAction()
      : Promise.resolve(null),
  ]);

  // Taxes are paid in pesos from a cash or bank account (pay_tax_document).
  const payAccountOptions =
    accountsRes?.ok === true
      ? accountsRes.data
          .filter(
            (a) =>
              a.is_active &&
              a.currency === "ARS" &&
              a.type !== "checks" &&
              a.type !== "echeq",
          )
          .map((a) => ({ id: a.id, name: a.name }))
      : [];

  return (
    <Hydrate state={dehydratedState}>
      <TaxesView
        initialYear={year}
        canWrite={canWrite}
        canAttach={canWrite && userCan(ctx.access, "files:write")}
        canLinkPayment={
          canWrite &&
          userCan(ctx.access, "transactions:read") &&
          userCan(ctx.access, "transactions:write")
        }
        canMovePayment={canWrite && userCan(ctx.access, "transactions:write")}
        payAccountOptions={payAccountOptions}
      />
    </Hydrate>
  );
}
