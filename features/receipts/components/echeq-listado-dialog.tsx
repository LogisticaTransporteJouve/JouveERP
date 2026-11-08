"use client";

import { previousPeriod, periodOf } from "@/lib/accounting-period";
import { todayInAR } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  importEcheqListadoAction,
  previewEcheqListadoAction,
  type EcheqListadoPreview,
} from "../actions/echeq-listado-actions";

/** The first day of last month: a statement is closed a month at a time. */
const firstOfLastMonth = () => `${previousPeriod(periodOf(todayInAR()))}-01`;

/** Loads the eCheqs of Banco Galicia's «Listado de cheques recibidos» as
 *  receipts of the clients who endorsed them. */
export function EcheqListadoDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState(firstOfLastMonth());
  const [preview, setPreview] = useState<EcheqListadoPreview | null>(null);
  const [busy, setBusy] = useState(false);

  function form() {
    const data = new FormData();
    if (file) data.set("file", file);
    data.set("from", from);
    return data;
  }

  async function read() {
    setBusy(true);
    try {
      const res = await previewEcheqListadoAction(form());
      if (!res.ok) toast.error(res.error);
      else setPreview(res.data);
    } catch {
      toast.error("No se pudo leer el listado.");
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    try {
      const res = await importEcheqListadoAction(form());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.failed.length > 0) {
        toast.error(
          `Se cargaron ${res.data.created}; fallaron: ${res.data.failed.join(" · ")}`,
        );
      } else {
        toast.success(
          res.data.created === 1
            ? "Se cargó 1 cobro con e-cheq."
            : `Se cargaron ${res.data.created} cobros con e-cheq.`,
        );
      }
      close();
    } catch {
      toast.error("No se pudo terminar la carga: revisá qué cobros quedaron.");
    } finally {
      // Some receipts may exist even when it failed halfway.
      void qc.invalidateQueries();
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setPreview(null);
    setFile(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileUp />
        Cargar e-cheq de Galicia
      </Button>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cargar e-cheq recibidos</DialogTitle>
          <DialogDescription>
            Subí el «Listado de cheques recibidos» que bajás de Galicia (.xlsx).
            Cada e-cheq entra como el recibo del cliente que te lo endosó, con
            la fecha del endoso (o la de emisión, si no tuvo endoso), e imputa a
            sus comprobantes más viejos. Se cargan los que están en custodia, en
            depósito o con el endoso recibido, y los pagados desde la fecha que
            elijas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="echeq-file">Listado</Label>
            <Input
              id="echeq-file"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="echeq-from">Pagados desde</Label>
            <DatePicker
              id="echeq-from"
              value={from}
              onChange={(v) => {
                setFrom(v);
                setPreview(null);
              }}
            />
          </div>
        </div>
        {preview && (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cheque</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Recibido</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r, i) => (
                  <TableRow key={`${r.check_number}-${r.amount}-${i}`}>
                    <TableCell className="font-mono">
                      {r.check_number}
                    </TableCell>
                    <TableCell>{r.client_name}</TableCell>
                    <TableCell>
                      {formatArgentineDate(r.received_date)}
                    </TableCell>
                    <TableCell>{formatArgentineDate(r.due_date)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatMoney(r.amount, "ARS")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.issue ?? `${r.status} · listo`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          {preview ? (
            <Button
              disabled={busy || preview.ready === 0}
              onClick={() => void load()}
            >
              {preview.ready === 1
                ? "Cargar 1 cobro"
                : `Cargar ${preview.ready} cobros`}
            </Button>
          ) : (
            <Button disabled={busy || !file} onClick={() => void read()}>
              Leer listado
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
