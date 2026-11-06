import { redirect } from "next/navigation";

import { getAccountingSettingsAction } from "@/features/accounting-settings/actions/accounting-settings-actions";
import { AccountingSettingsPage } from "@/features/accounting-settings/components/accounting-settings-page";
import { accountingSettingsKeys } from "@/features/accounting-settings/lib/accounting-settings-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function AccountingSettingsRoute() {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    redirect("/dashboard");
  }

  const dehydratedState = await prefetchQueries([
    {
      queryKey: accountingSettingsKeys.detail(),
      queryFn: () => runAction(() => getAccountingSettingsAction()),
    },
  ]);

  return (
    <Hydrate state={dehydratedState}>
      <AccountingSettingsPage
        canEdit={userCan(ctx.access, "accounting:admin")}
      />
    </Hydrate>
  );
}
