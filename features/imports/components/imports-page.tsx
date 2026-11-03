"use client";

import { FileUp } from "lucide-react";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ImportKind } from "../schema";

import { HistoricPayrollView, HistoricTripsView } from "./historic-views";
import { ImportDialog } from "./import-dialog";
import { ImportRunsTable } from "./import-runs-table";

export function ImportsPage({
  importableKinds,
  canReadPayroll,
  canReadTrips,
  today,
}: {
  /** The kinds this user may import and undo. */
  importableKinds: readonly ImportKind[];
  canReadPayroll: boolean;
  canReadTrips: boolean;
  /** The Argentine today, YYYY-MM-DD. */
  today: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Importador</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Carga de planillas para el arranque: clientes, proveedores,
            empleados y vehículos, y sueldos y viajes de antes del sistema como
            referencia. Las diferencias de saldos se corrigen con el ajuste
            inicial.
          </p>
        </div>
        {importableKinds.length > 0 && (
          <Button onClick={() => setOpen(true)}>
            <FileUp className="size-4" />
            Importar planilla
          </Button>
        )}
      </div>

      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Importaciones</TabsTrigger>
          {canReadPayroll && (
            <TabsTrigger value="payroll">Sueldos históricos</TabsTrigger>
          )}
          {canReadTrips && (
            <TabsTrigger value="trips">Viajes históricos</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="runs" className="pt-2">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ImportRunsTable undoableKinds={importableKinds} />
          </Suspense>
        </TabsContent>
        {canReadPayroll && (
          <TabsContent value="payroll" className="pt-2">
            <HistoricPayrollView currentYear={Number(today.slice(0, 4))} />
          </TabsContent>
        )}
        {canReadTrips && (
          <TabsContent value="trips" className="pt-2">
            <HistoricTripsView currentMonth={today.slice(0, 7)} />
          </TabsContent>
        )}
      </Tabs>

      {importableKinds.length > 0 && (
        <ImportDialog
          open={open}
          onOpenChange={setOpen}
          kinds={importableKinds}
        />
      )}
    </div>
  );
}
