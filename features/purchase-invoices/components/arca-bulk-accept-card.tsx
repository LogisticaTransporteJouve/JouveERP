"use client";

import { CheckCheck, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatArgentineDate, formatArgentineDateTime } from "@/lib/format";

import {
  useArcaBulkAcceptStatus,
  useInvalidateTray,
  useRequestArcaBulkAccept,
} from "../hooks/use-arca-received";
import {
  BULK_MAX_ERRORS,
  BULK_OPENING_DATE,
  BULK_PENDING_REASONS,
  BULK_PENDING_REASON_LABEL,
  bulkPendingTotal,
  type BulkPhase,
  type BulkProgress,
  type BulkRun,
} from "../lib/arca-bulk-accept";

const OPENING = formatArgentineDate(BULK_OPENING_DATE);

const PHASE_TEXT: Record<BulkPhase, string> = {
  queued: "Pedido enviado: esperando que arranque…",
  suppliers: "Dando de alta los proveedores que faltan…",
  vouchers: "Cargando los comprobantes como compras…",
  opening_balances: `Fijando los saldos de apertura al ${OPENING}…`,
  done: "Terminó.",
  failed: "Se cortó.",
};

function processed(p: BulkProgress): number {
  return (
    p.vouchers.accepted +
    p.vouchers.linked +
    p.vouchers.alreadyProcessed +
    bulkPendingTotal(p)
  );
}

function summary(p: BulkProgress): string[] {
  const left = bulkPendingTotal(p);
  const reasons = BULK_PENDING_REASONS.filter((r) => p.vouchers.pending[r] > 0)
    .map((r) => `${p.vouchers.pending[r]} ${BULK_PENDING_REASON_LABEL[r]}`)
    .join(", ");
  const lines = [
    `Proveedores creados: ${p.suppliers.created}` +
      (p.suppliers.fallback > 0
        ? ` (${p.suppliers.fallback} sin datos del padrón)`
        : "") +
      (p.suppliers.failed > 0 ? ` · ${p.suppliers.failed} con error` : ""),
    `Comprobantes cargados: ${p.vouchers.accepted}` +
      (p.vouchers.linked > 0
        ? ` · ${p.vouchers.linked} vinculados a compras ya cargadas`
        : ""),
    left > 0
      ? `Quedaron en pendientes: ${left} (${reasons})`
      : "No quedó nada en pendientes.",
    `Saldos de apertura en 0: ${p.openingBalances.applied}` +
      (p.openingBalances.failed > 0
        ? ` · ${p.openingBalances.failed} con error`
        : ""),
  ];
  if (p.dolOpen > 0) {
    lines.push(
      `${p.dolOpen} compras en dólares hasta el ${OPENING} siguen abiertas: este saldo de apertura es en pesos. Para cancelarlas, ajustá el saldo en dólares del proveedor.`,
    );
  }
  return lines;
}

function RunStatus({ run }: { run: BulkRun }) {
  const p = run.progress;
  const open = run.finishedAt === null;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      {open ? (
        <p>
          {PHASE_TEXT[run.phase]}
          {run.phase === "suppliers" && p.totals.newSuppliers > 0
            ? ` ${p.suppliers.created + p.suppliers.existing + p.suppliers.failed} de ${p.totals.newSuppliers}.`
            : ""}
          {run.phase === "vouchers" && p.totals.vouchers > 0
            ? ` ${processed(p)} de ${p.totals.vouchers}.`
            : ""}
        </p>
      ) : (
        <p>
          Última vez{" "}
          {formatArgentineDateTime(run.finishedAt ?? run.requestedAt)}
          {run.phase === "failed"
            ? `: se cortó${run.error ? ` (${run.error})` : ""}. Lo cargado hasta ahí queda; podés volver a correrlo.`
            : "."}
        </p>
      )}
      {(run.phase !== "queued" || !open) && (
        <ul className="list-disc space-y-0.5 pl-5">
          {summary(p).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {!open && p.errors.length > 0 && (
        <details className="pt-1">
          <summary className="cursor-pointer underline underline-offset-2">
            Ver errores ({p.errors.length}
            {p.errors.length >= BULK_MAX_ERRORS ? " primeros" : ""})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
            {p.errors.map((e, i) => (
              <li key={`${e.ref}-${i}`} className="break-words">
                <span className="font-mono">{e.ref}</span>: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: number;
}) {
  const request = useRequestArcaBulkAccept();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aceptar todos los pendientes</DialogTitle>
          <DialogDescription>
            Carga los {pending} comprobantes pendientes de una vez. Corre en
            segundo plano y tarda un rato largo: podés cerrar esta pantalla.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Da de alta los proveedores que falten con los datos del padrón de
            AFIP (razón social, condición de IVA y domicilio fiscal). Si el
            padrón no responde, usa el nombre que informa ARCA y la condición
            según la letra (A o B: responsable inscripto; C: monotributo).
          </li>
          <li>
            Carga cada comprobante como compra, igual que «Aceptar y cargar»:
            primero las facturas, después las notas de débito y de crédito. Si
            los importes de ARCA no suman el total, la diferencia va a no
            gravado (al neto en B y C). Cada NC o ND se vincula con una factura
            del mismo proveedor, de igual total o la última con saldo.
          </li>
          <li>
            Fija en 0 el saldo de apertura al {OPENING} de cada proveedor con
            compras hasta esa fecha: todo lo anterior queda cancelado, y lo de
            noviembre en adelante queda como deuda abierta. Si el proveedor ya
            tenía un saldo de apertura, se reemplaza. Las compras en dólares no
            se cancelan: este saldo de apertura es en pesos (el saldo en dólares
            se ajusta desde la cuenta corriente del proveedor).
          </li>
        </ol>
        <p className="text-sm text-muted-foreground">
          Lo que no se pueda cargar (una NC sin factura, un comprobante en
          dólares sin cotización, un error) queda en Pendientes y se informa el
          motivo.
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={request.isPending}
          >
            Cancelar
          </Button>
          <Button
            disabled={request.isPending}
            onClick={() =>
              request.mutate(undefined, {
                onSuccess: () => {
                  toast.success(
                    "Arrancó la carga de todos los pendientes. Te muestro el avance acá.",
                  );
                  onOpenChange(false);
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            {request.isPending ? "Pidiendo…" : "Aceptar todos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «Aceptar todos los pendientes» (owner only): the button, its
 *  confirmation and the progress or result of the latest run. Refreshes the
 *  tray when a run it followed ends. */
export function ArcaBulkAcceptCard({ pending }: { pending: number }) {
  const status = useArcaBulkAcceptStatus();
  const invalidateTray = useInvalidateTray();
  const [open, setOpen] = useState(false);
  const run = status.data ?? null;
  const running = run !== null && run.finishedAt === null;

  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current || !run) return;
    wasRunning.current = false;
    void invalidateTray();
    if (run.phase === "failed") {
      toast.error("La carga de todos los pendientes se cortó.");
    } else {
      toast.success(
        `Se cargaron ${run.progress.vouchers.accepted} comprobantes.`,
      );
    }
  }, [running, run, invalidateTray]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">Aceptar todos los pendientes</p>
        {status.isPending ? (
          <p className="text-sm text-muted-foreground">Revisando…</p>
        ) : status.isError ? (
          <p className="text-sm text-muted-foreground">
            {status.error.message}
          </p>
        ) : run ? (
          <RunStatus run={run} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Crea los proveedores que faltan, carga todo como compras y cancela
            lo anterior al {OPENING} con un saldo de apertura en 0.
          </p>
        )}
      </div>
      <DisabledHint
        reason={
          !running && !status.isPending && pending === 0
            ? "No hay comprobantes pendientes de aceptar."
            : null
        }
        className="shrink-0"
      >
        <Button
          size="sm"
          className="shrink-0"
          disabled={running || pending === 0 || status.isPending}
          onClick={() => setOpen(true)}
        >
          {running ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <CheckCheck aria-hidden />
          )}
          {running ? "Cargando…" : "Aceptar todos los pendientes"}
        </Button>
      </DisabledHint>
      {open ? (
        <ConfirmDialog open={open} onOpenChange={setOpen} pending={pending} />
      ) : null}
    </div>
  );
}
