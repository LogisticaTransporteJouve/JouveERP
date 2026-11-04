"use client";

import { AlertTriangle, Receipt } from "lucide-react";
import { useEffect, useState } from "react";

import { ReadError } from "@/components/read-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { todayInAR } from "@/lib/format";

import {
  useStorageBilling,
  useStorageBillingRuns,
} from "../hooks/use-storage-billing";
import { billedRuns, lastBilledEnd } from "../lib/continuity";

import { StorageInvoiceDialog } from "./storage-invoice-dialog";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function StorageBillingReport() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    setStart(monthStart());
    setEnd(todayInAR());
  }, []);

  const { data, isLoading, isError, refetch } = useStorageBilling(start, end);
  const {
    data: runs,
    isError: runsFailed,
    refetch: refetchRuns,
  } = useStorageBillingRuns();
  const [invoiceClient, setInvoiceClient] = useState<{
    client_id: string;
    client_name: string;
  } | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Facturación de almacenaje
        </h1>
        <p className="text-muted-foreground text-sm">
          Días-pallet del rango × tarifa vigente (la específica del cliente gana
          sobre la general), agrupado por cliente.
        </p>
      </div>

      <div className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div className="space-y-1">
          <label className="text-muted-foreground text-xs">Desde</label>
          <Input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            className="w-[170px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground text-xs">Hasta</label>
          <Input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            className="w-[170px]"
          />
        </div>
        {data && (
          <div className="ml-auto flex flex-wrap items-end gap-6 text-sm">
            <div className="text-muted-foreground">
              Almacenaje:{" "}
              <span className="text-foreground font-mono">
                {money(data.storage_total)}
              </span>
            </div>
            <div className="text-muted-foreground">
              Carga + descarga:{" "}
              <span className="text-foreground font-mono">
                {money(data.handling_total)}
              </span>
            </div>
            <div className="text-muted-foreground">
              Total:{" "}
              <span className="text-foreground font-mono font-semibold">
                {money(data.total)}
              </span>
            </div>
          </div>
        )}
      </div>

      {data && data.pallets_without_tariff > 0 && (
        <p className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0" />
          {data.pallets_without_tariff} pallet(s) con días sin tarifa vigente —
          cargá una tarifa para que se facturen.
        </p>
      )}

      {data && data.pallets_without_rate > 0 && (
        <p className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0" />
          {data.pallets_without_rate} pallet(s) con tarifa del cliente en USD y
          sin cotización del dólar al cierre del rango — cargala para poder
          facturarlos.
        </p>
      )}

      {runsFailed && !runs && (
        <ReadError
          message="No se pudo leer hasta cuándo se facturó cada cliente."
          onRetry={() => void refetchRuns()}
        />
      )}

      {isError && !data ? (
        <ReadError
          message="No se pudo cargar la facturación de almacenaje."
          onRetry={() => void refetch()}
        />
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Por cliente</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="w-24 text-right">Pallets</TableHead>
                    <TableHead className="text-right">A facturar</TableHead>
                    <TableHead className="w-36">Facturado hasta</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byClient.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-muted-foreground py-8 text-center text-sm"
                      >
                        Sin pallets almacenados en el rango.
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.byClient.map((c) => {
                      const lastEnd = lastBilledEnd(
                        billedRuns(runs ?? [], c.client_id, null),
                      );
                      return (
                        <TableRow key={c.client_id}>
                          <TableCell className="font-medium">
                            {c.client_name}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.pallets}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {money(c.charge)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {!runs ? "…" : lastEnd ? fmtDate(lastEnd) : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              // The dialog's continuity and overlap checks
                              // need the earlier runs.
                              disabled={!runs}
                              onClick={() =>
                                setInvoiceClient({
                                  client_id: c.client_id,
                                  client_name: c.client_name,
                                })
                              }
                            >
                              <Receipt className="size-4" />
                              Facturar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Detalle por pallet</h2>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pallet</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="w-20 text-right">Días</TableHead>
                    <TableHead className="text-right">Tarifa/día</TableHead>
                    <TableHead className="text-right">Carga</TableHead>
                    <TableHead className="text-right">Descarga</TableHead>
                    <TableHead className="text-right">Cargo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => {
                    // Some days or a movement left unpriced (no tariff, or a
                    // USD tariff without a rate).
                    const incomplete = !l.has_tariff || l.missing_rate;
                    const priced = l.charge > 0 || !incomplete;
                    return (
                      <TableRow key={l.pallet_id}>
                        <TableCell className="font-mono text-xs">
                          {l.code}
                        </TableCell>
                        <TableCell>{l.client_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.days}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {priced ? money(l.daily_rate) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {priced ? money(l.handling_in_charge) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {priced ? money(l.handling_out_charge) : "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono tabular-nums",
                            incomplete && "text-muted-foreground",
                          )}
                        >
                          {priced
                            ? `${money(l.charge)}${incomplete ? " (parcial)" : ""}`
                            : l.missing_rate
                              ? "sin cotización"
                              : "sin tarifa"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}

      <StorageInvoiceDialog
        client={invoiceClient}
        reportStart={start}
        reportEnd={end}
        runs={runs ?? []}
        onClose={() => setInvoiceClient(null)}
      />
    </div>
  );
}
