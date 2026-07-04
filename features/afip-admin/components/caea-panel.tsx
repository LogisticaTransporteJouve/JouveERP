"use client";

import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate } from "@/lib/format";

import { useCaeaStatus, useRequestCaea } from "../hooks/use-afip-admin";

function quincenaLabel(periodo: number, orden: number): string {
  const year = Math.floor(periodo / 100);
  const month = String(periodo % 100).padStart(2, "0");
  return `${year}-${month} · Q${orden}`;
}

/**
 * CAEA contingency status: granted fortnight codes, informing deadline and
 * vouchers still pending FECAEARegInformativo. The request button covers the
 * current + next quincena (the cron does the same twice a month).
 */
export function CaeaPanel() {
  const { data } = useCaeaStatus();
  const requestMut = useRequestCaea();
  const today = new Date().toISOString().slice(0, 10);
  const active = data.codes.find(
    (c) => c.fch_vig_desde <= today && c.fch_vig_hasta >= today,
  );

  function onRequest() {
    requestMut.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(
          `CAEA vigente: ${res.current ?? "—"} · próxima quincena: ${res.next ?? "—"}`,
        );
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-medium">CAEA (contingencia)</h2>
          <p className="text-xs text-muted-foreground">
            Código anticipado por quincena para emitir con AFIP caído desde un
            PV de contingencia. El uso se informa automáticamente hasta la
            fecha tope.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onRequest}
          disabled={requestMut.isPending}
        >
          Solicitar CAEA
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant={active ? "secondary" : "outline"}>
          {active ? `Vigente: ${active.caea}` : "Sin CAEA vigente"}
        </Badge>
        {data.pendingToInform > 0 && (
          <Badge variant="outline" className="gap-1">
            <ShieldAlert className="size-3" />
            {data.pendingToInform} comprobante(s) sin informar
          </Badge>
        )}
      </div>

      {data.codes.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quincena</TableHead>
              <TableHead>CAEA</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Tope p/ informar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.codes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs">
                  {quincenaLabel(c.periodo, c.orden)}
                </TableCell>
                <TableCell className="font-mono text-xs">{c.caea}</TableCell>
                <TableCell className="text-xs">
                  {formatArgentineDate(c.fch_vig_desde)} —{" "}
                  {formatArgentineDate(c.fch_vig_hasta)}
                </TableCell>
                <TableCell className="text-xs">
                  {formatArgentineDate(c.fch_tope_inf)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
