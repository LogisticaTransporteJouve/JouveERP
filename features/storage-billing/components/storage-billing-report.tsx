"use client";

import { AlertTriangle, Receipt } from "lucide-react";
import { useEffect, useState } from "react";

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

import {
  useStorageBilling,
  useStorageBillingRuns,
} from "../hooks/use-storage-billing";
import { lastBilledEnd } from "../lib/continuity";

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
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function StorageBillingReport() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    setStart(monthStart());
    setEnd(today());
  }, []);

  const { data, isLoading } = useStorageBilling(start, end);
  const { data: runs } = useStorageBillingRuns();
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
          {data.pallets_without_tariff} pallet(s) sin tarifa vigente — cargá una
          tarifa para que se facturen.
        </p>
      )}

      {isLoading || !data ? (
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
                        (runs ?? []).filter((r) => r.client_id === c.client_id),
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
                            {lastEnd ? fmtDate(lastEnd) : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
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
                  {data.lines.map((l) => (
                    <TableRow key={l.pallet_id}>
                      <TableCell className="font-mono text-xs">
                        {l.code}
                      </TableCell>
                      <TableCell>{l.client_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.days}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {l.has_tariff ? money(l.daily_rate) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {l.has_tariff ? money(l.handling_in_charge) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {l.has_tariff ? money(l.handling_out_charge) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono tabular-nums",
                          !l.has_tariff && "text-muted-foreground",
                        )}
                      >
                        {l.has_tariff ? money(l.charge) : "sin tarifa"}
                      </TableCell>
                    </TableRow>
                  ))}
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
