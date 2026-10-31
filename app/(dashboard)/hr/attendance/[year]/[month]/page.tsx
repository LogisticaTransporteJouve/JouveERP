import { notFound, redirect } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  getAttendanceMonthAction,
  listAttendanceEmployeesAction,
} from "@/features/hr/actions/attendance-actions";
import { AttendanceGrid } from "@/features/hr/components/attendance-grid";
import { attendanceKeys } from "@/features/hr/lib/attendance-keys";
import { MONTH_LABELS } from "@/features/hr/payroll-schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function AttendanceMonthPage({
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

  const dehydratedState = await prefetchQueries([
    {
      queryKey: attendanceKeys.month(year, month),
      queryFn: () => runAction(() => getAttendanceMonthAction(year, month)),
    },
    {
      queryKey: attendanceKeys.employees(),
      queryFn: () => runAction(() => listAttendanceEmployeesAction()),
    },
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/hr/attendance">Asistencia</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {MONTH_LABELS[month - 1]} {year}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Hydrate state={dehydratedState}>
        <AttendanceGrid year={year} month={month} actorAccess={ctx.access} />
      </Hydrate>
    </div>
  );
}
