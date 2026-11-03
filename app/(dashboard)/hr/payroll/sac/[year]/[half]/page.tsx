import { notFound, redirect } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getPayrollPeriodAction } from "@/features/hr/actions/payroll-actions";
import { PayrollPeriodGrid } from "@/features/hr/components/payroll-period-grid";
import { payrollKeys } from "@/features/hr/lib/payroll-keys";
import { formatPayrollPeriod, sacMonth } from "@/features/hr/payroll-schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function SacPeriodPage({
  params,
}: {
  params: Promise<{ year: string; half: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    redirect("/dashboard");
  }

  const { year: yearStr, half: halfStr } = await params;
  const year = Number.parseInt(yearStr, 10);
  if (
    !Number.isInteger(year) ||
    year < 2020 ||
    year > 2099 ||
    (halfStr !== "1" && halfStr !== "2")
  ) {
    notFound();
  }
  const month = sacMonth(halfStr === "1" ? 1 : 2);

  const dehydratedState = await prefetchQueries([
    {
      queryKey: payrollKeys.periodOfKind(year, month, "sac"),
      queryFn: () =>
        runAction(() => getPayrollPeriodAction(year, month, "sac")),
    },
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
            <BreadcrumbPage>
              {formatPayrollPeriod(year, month, "sac")}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Hydrate state={dehydratedState}>
        <PayrollPeriodGrid
          year={year}
          month={month}
          kind="sac"
          actorAccess={ctx.access}
        />
      </Hydrate>
    </div>
  );
}
