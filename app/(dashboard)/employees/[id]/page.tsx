import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { getDriverIdForEmployeeAction } from "@/features/drivers/actions/drivers-actions";
import { EmployeeDocumentsCard } from "@/features/employee-documents/components/employee-documents-card";
import { getEmployeeByIdAction } from "@/features/hr/actions/employees-actions";
import { EditEmployeeDialog } from "@/features/hr/components/edit-employee-dialog";
import { EmployeeAccountCard } from "@/features/hr/components/employee-account-card";
import { EmployeeGarnishmentsCard } from "@/features/hr/components/employee-garnishments-card";
import { EmployeeVacationsCard } from "@/features/hr/components/employee-vacations-card";
import { FinalSettlementCard } from "@/features/hr/components/final-settlement-card";
import { SalaryHistoryCard } from "@/features/hr/components/salary-history-card";
import { TerminateEmployeeDialog } from "@/features/hr/components/terminate-employee-dialog";
import { TripRatesCard } from "@/features/hr/components/trip-rates-card";
import { HR_CASH_PERMISSIONS } from "@/features/hr/lib/hr-cash";
import { PAY_FREQUENCY_LABEL, PAY_MODE_LABEL } from "@/features/hr/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";

export const dynamic = "force-dynamic";

const money = (n: number | string | null) => {
  if (n === null) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  return `$ ${formatNumber2(num)}`;
};

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "hr:read")) {
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
  const canWrite = userCan(ctx.access, "hr:write");
  const canMoveCash = userCanAll(ctx.access, HR_CASH_PERMISSIONS);
  const driverRes = userCan(ctx.access, "drivers:read")
    ? await getDriverIdForEmployeeAction(id)
    : null;
  const driverId = driverRes?.ok ? driverRes.data : null;

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
                className="ml-2 bg-muted text-xs text-foreground dark:text-foreground"
              >
                Inactivo
                {employee.termination_date
                  ? ` · baja ${formatArgentineDate(employee.termination_date)}`
                  : ""}
              </Badge>
            )}
          </p>
        </div>
        {(canWrite || driverId) && (
          <div className="flex items-center gap-2">
            {driverId && (
              <Button variant="outline" asChild>
                <Link href={`/drivers/${driverId}`}>Ver viajes y km</Link>
              </Button>
            )}
            {canWrite && (
              <>
                <EditEmployeeDialog employee={employee} />
                <TerminateEmployeeDialog employee={employee} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Datos formales</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="Convenio" value={employee.convenio ?? "—"} />
          <Row label="Categoría" value={employee.categoria ?? "—"} />
          <Row label="Obra social" value={employee.obra_social ?? "—"} />
          <Row label="ART" value={employee.art ?? "—"} />
          <Row
            label="Retribución formal"
            value={money(employee.retribucion_formal)}
          />
          <Row label="Modalidad" value={PAY_MODE_LABEL[employee.pay_mode]} />
        </dl>
      </div>

      {employee.notes && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Notas</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {employee.notes}
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Vacaciones y licencias</h2>
        <div className="mt-3">
          <EmployeeVacationsCard
            employeeId={employee.id}
            employeeName={employee.legal_name}
            hireDate={employee.hire_date}
            actorAccess={ctx.access}
          />
        </div>
      </div>

      <EmployeeAccountCard
        employeeId={employee.id}
        employeeName={employee.legal_name}
        canWrite={canWrite}
        canMoveCash={canMoveCash}
      />

      <EmployeeGarnishmentsCard employeeId={employee.id} canWrite={canWrite} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SalaryHistoryCard employeeId={employee.id} />
        <TripRatesCard
          employeeId={employee.id}
          canWrite={canWrite}
          rates={{
            trip_rate_per_day: numOrNull(employee.trip_rate_per_day),
            trip_rate_per_km: numOrNull(employee.trip_rate_per_km),
            trip_rate_per_unload: numOrNull(employee.trip_rate_per_unload),
          }}
        />
      </div>

      {!employee.is_active && employee.termination_date && canWrite && (
        <FinalSettlementCard employeeId={employee.id} />
      )}

      <EmployeeDocumentsCard employeeId={employee.id} canWrite={canWrite} />
    </div>
  );
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
