import Link from "next/link";
import { formatCuit } from "@/lib/validation/cuit";
import { notFound, redirect } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { getDriverAction } from "@/features/drivers/actions/drivers-actions";
import { getDriverKmDaysAction } from "@/features/vehicle-km/actions/vehicle-km-actions";
import { DriverKmDays } from "@/features/vehicle-km/components/driver-km-days";
import { kmPeriod } from "@/features/vehicle-km/lib/km-period";
import { vehicleKmKeys } from "@/features/vehicle-km/lib/vehicle-km-keys";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { todayInAR } from "@/lib/format";
import { resolvePeriod } from "@/lib/list-period";
import { Hydrate } from "@/lib/query/hydrate";
import { prefetchQueries } from "@/lib/query/prefetch";
import { runAction } from "@/lib/query/run-action";

export const dynamic = "force-dynamic";

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "drivers:read")) {
    redirect("/dashboard");
  }
  const { id } = await params;
  const result = await getDriverAction(id);
  if (!result.ok) {
    redirect("/drivers");
  }
  if (!result.data) {
    notFound();
  }
  const driver = result.data;
  const seesTrips = userCanAll(ctx.access, ["fleet_km:read", "trips:read"]);
  const range = kmPeriod(
    resolvePeriod({ preset: "this_month", from: null, to: null }, todayInAR()),
  );
  const dehydratedState = seesTrips
    ? await prefetchQueries([
        {
          queryKey: vehicleKmKeys.driverDays(id, range.from, range.to),
          queryFn: () =>
            runAction(() => getDriverKmDaysAction({ driver_id: id, ...range })),
        },
      ])
    : null;

  const facts = [
    driver.employee_id ? "Empleado" : "Contratado",
    driver.cuit ? `CUIT ${formatCuit(driver.cuit)}` : "",
    driver.license_number
      ? `Licencia ${driver.license_number}${driver.license_category ? ` (${driver.license_category})` : ""}`
      : "",
    driver.phone ?? "",
    driver.is_active ? "" : "Inactivo",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/drivers">Choferes</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{driver.full_name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {driver.full_name}
          </h1>
          <p className="text-muted-foreground text-sm">{facts.join(" · ")}</p>
        </div>
        {driver.employee_id && userCan(ctx.access, "hr:read") && (
          <Button variant="outline" asChild>
            <Link href={`/employees/${driver.employee_id}`}>
              Ver legajo de RRHH
            </Link>
          </Button>
        )}
      </div>

      {seesTrips && dehydratedState && (
        <Hydrate state={dehydratedState}>
          <DriverKmDays
            driverId={id}
            linkVehicles={userCan(ctx.access, "vehicles:read")}
          />
        </Hydrate>
      )}
    </div>
  );
}
