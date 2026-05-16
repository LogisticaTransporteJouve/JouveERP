import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getEmployeeByIdAction } from "@/features/hr/actions/employees-actions";
import { EditEmployeeDialog } from "@/features/hr/components/edit-employee-dialog";
import { TerminateEmployeeDialog } from "@/features/hr/components/terminate-employee-dialog";
import { PAY_FREQUENCY_LABEL } from "@/features/hr/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ARS = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n: number | string | null) => {
  if (n === null) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  return `$ ${ARS.format(num)}`;
};

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "hr:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const result = await getEmployeeByIdAction(id);
  if (!result.ok) {
    redirect("/employees");
  }
  if (!result.data) {
    notFound();
  }

  const employee = result.data;
  const canWrite = userCan(ctx.roles, "hr:write");

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/employees">Empleados</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{employee.legal_name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {employee.legal_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {employee.position ?? "—"}
            <Badge variant="secondary" className="ml-2 text-xs">
              {PAY_FREQUENCY_LABEL[employee.pay_frequency]}
            </Badge>
            {employee.is_monotributo && (
              <Badge variant="outline" className="ml-2 text-xs">
                Monotributo
              </Badge>
            )}
            {!employee.is_active && (
              <Badge
                variant="secondary"
                className="ml-2 bg-red-500/15 text-xs text-red-700 dark:text-red-300"
              >
                Inactivo
                {employee.termination_date
                  ? ` · baja ${formatArgentineDate(employee.termination_date)}`
                  : ""}
              </Badge>
            )}
          </p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <EditEmployeeDialog employee={employee} />
            <TerminateEmployeeDialog employee={employee} />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="text-sm font-medium">Datos</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row label="CUIL" value={employee.cuil ?? "—"} mono />
            <Row label="CBU" value={employee.cbu ?? "—"} mono />
            <Row
              label="Fecha de ingreso"
              value={formatArgentineDate(employee.hire_date)}
            />
            {employee.termination_date && (
              <Row
                label="Fecha de egreso"
                value={formatArgentineDate(employee.termination_date)}
              />
            )}
          </dl>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Sueldo</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row label="Sueldo base" value={money(employee.base_salary)} />
            <Row
              label="Viático mensual"
              value={money(employee.viatico_monthly)}
            />
          </dl>
        </div>
      </div>

      {employee.notes && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Notas</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {employee.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}
