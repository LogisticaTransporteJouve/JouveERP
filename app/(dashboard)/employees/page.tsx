import { redirect } from "next/navigation";

import { ExportButton } from "@/components/export-button";
import { searchEmployeesAction } from "@/features/hr/actions/employees-actions";
import { EmployeesTable } from "@/features/hr/components/employees-table";
import {
  EMPLOYEES_PAGE_SIZE,
  employeesKeys,
} from "@/features/hr/lib/employees-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const initialQuery = (params.q ?? "").trim();
  const initialOnlyActive = params.inactive !== "1";

  const filters = {
    query: initialQuery,
    onlyActive: initialOnlyActive,
  };
  const dehydratedState = await prefetchQueries([
    {
      infinite: true,
      queryKey: employeesKeys.searchInfinite(filters),
      queryFn: ({ pageParam }: { pageParam: number }) =>
        runAction(() =>
          searchEmployeesAction({
            ...filters,
            offset: pageParam,
            limit: EMPLOYEES_PAGE_SIZE,
          }),
        ),
      initialPageParam: 0,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Empleados</h1>
          <p className="text-sm text-muted-foreground">
            Personal de Jouve. La liquidación detallada va por el liquidador
            externo; acá manejamos identidad, sueldos cargados a mano y pagos.
          </p>
        </div>
        <ExportButton resource="employees" />
      </div>
      <Hydrate state={dehydratedState}>
        <EmployeesTable
          actorAccess={ctx.access}
          initialQuery={initialQuery}
          initialOnlyActive={initialOnlyActive}
        />
      </Hydrate>
    </div>
  );
}
