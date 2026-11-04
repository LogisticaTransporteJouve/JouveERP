import { notFound, redirect } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { listAccountsAction } from "@/features/accounts/actions/accounts-actions";
import { accountsKeys } from "@/features/accounts/lib/accounts-keys";
import { getPayrollPeriodAction } from "@/features/hr/actions/payroll-actions";
import { HR_CASH_PERMISSIONS } from "@/features/hr/lib/hr-cash";
import { PayrollPeriodGrid } from "@/features/hr/components/payroll-period-grid";
import { payrollKeys } from "@/features/hr/lib/payroll-keys";
import { formatPayrollPeriod } from "@/features/hr/payroll-schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function PayrollPeriodPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    redirect("/dashboard");
  }

  const { year: yearStr, month: monthStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    year < 2020 ||
    year > 2099 ||
    month < 1 ||
    month > 12
  ) {
    notFound();
  }

  // The payment dialogs pick an account: read them here, only for whoever
  // can pay and read accounts (a deny must not fail the page's prefetch).
  const canPay =
    userCanAll(ctx.access, HR_CASH_PERMISSIONS) &&
    userCan(ctx.access, "accounts:read");
  const dehydratedState = await prefetchQueries([
    {
      queryKey: payrollKeys.periodOfKind(year, month, "monthly"),
      queryFn: () => runAction(() => getPayrollPeriodAction(year, month)),
    },
    ...(canPay
      ? [
          {
            queryKey: accountsKeys.list(),
            queryFn: () => runAction(() => listAccountsAction()),
          },
        ]
      : []),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/hr/payroll">Sueldos</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{formatPayrollPeriod(year, month)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Hydrate state={dehydratedState}>
        <PayrollPeriodGrid year={year} month={month} actorAccess={ctx.access} />
      </Hydrate>
    </div>
  );
}
