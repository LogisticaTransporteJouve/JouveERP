"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney as money } from "@/lib/format";

import {
  useCreateManualJournalEntry,
  usePostableAccounts,
} from "../hooks/use-journal-entries";

type LineDraft = {
  account_id: string;
  debit: string;
  credit: string;
};

const EMPTY_LINE: LineDraft = { account_id: "", debit: "", credit: "" };

const NO_CHANNEL = "_none";

/** Code of the RECPAM account seeded for RG 4667 (prefill target). */
const RECPAM_CODE = "4.2.2";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Manual journal entry (source_table null): date, description, optional
 * channel and free debit/credit lines against leaf accounts. Used from the
 * journal page and, pre-filled, from the inflation page (RG 4667).
 */
export function ManualEntryDialog({
  open,
  onOpenChange,
  defaultDescription,
  prefillRecpam = false,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDescription?: string;
  /** Pre-select the RECPAM account on the first line (inflation flow). */
  prefillRecpam?: boolean;
  onCreated?: (id: string) => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const { accounts } = usePostableAccounts(open);
  const create = useCreateManualJournalEntry();

  const [fecha, setFecha] = useState(todayISO());
  const [descripcion, setDescripcion] = useState("");
  const [channelId, setChannelId] = useState(NO_CHANNEL);
  const [lines, setLines] = useState<LineDraft[]>([EMPTY_LINE, EMPTY_LINE]);

  useEffect(() => {
    if (!open) return;
    setFecha(todayISO());
    setDescripcion(defaultDescription ?? "");
    setChannelId(NO_CHANNEL);
    setLines([EMPTY_LINE, EMPTY_LINE]);
  }, [open, defaultDescription]);

  // Inflation flow: point the first line at RECPAM once accounts load.
  useEffect(() => {
    if (!open || !prefillRecpam || accounts.length === 0) return;
    const recpam = accounts.find((a) => a.code === RECPAM_CODE);
    if (!recpam) return;
    setLines((prev) =>
      prev[0] && prev[0].account_id === ""
        ? [{ ...prev[0], account_id: recpam.id }, ...prev.slice(1)]
        : prev,
    );
  }, [open, prefillRecpam, accounts]);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  const totalDebe = lines.reduce((a, l) => a + toNumber(l.debit), 0);
  const totalHaber = lines.reduce((a, l) => a + toNumber(l.credit), 0);
  const diff = Math.round((totalDebe - totalHaber) * 100) / 100;
  const balanced = diff === 0 && totalDebe > 0;

  function onSubmit() {
    create.mutate(
      {
        entry_date: fecha,
        description: descripcion,
        channel_id: channelId === NO_CHANNEL ? null : channelId,
        lines: lines
          .filter((l) => l.account_id !== "")
          .map((l) => ({
            account_id: l.account_id,
            debit: toNumber(l.debit),
            credit: toNumber(l.credit),
          })),
      },
      {
        onSuccess: (data) => {
          toast.success("Asiento creado.");
          onOpenChange(false);
          onCreated?.(data.id);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo asiento manual</DialogTitle>
          <DialogDescription>
            Ajustes, previsiones, reexpresiones — el asiento queda en el libro
            diario con origen “Manual”. Debe y Haber tienen que balancear.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="me-fecha">Fecha</Label>
            <Input
              id="me-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="me-canal">Canal (opcional)</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger id="me-canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CHANNEL}>Sin canal</SelectItem>
                {activeChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-1">
            <Label htmlFor="me-desc">Descripción</Label>
            <Input
              id="me-desc"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <div className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1">
          {lines.map((line, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                {i === 0 && <Label className="text-xs">Cuenta</Label>}
                <Select
                  value={line.account_id}
                  onValueChange={(v) => updateLine(i, { account_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="font-mono text-xs">{a.code}</span>{" "}
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-1">
                {i === 0 && <Label className="text-xs">Debe</Label>}
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={line.debit}
                  onChange={(e) =>
                    updateLine(i, { debit: e.target.value, credit: "" })
                  }
                />
              </div>
              <div className="w-28 space-y-1">
                {i === 0 && <Label className="text-xs">Haber</Label>}
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={line.credit}
                  onChange={(e) =>
                    updateLine(i, { credit: e.target.value, debit: "" })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Quitar línea"
                disabled={lines.length <= 2}
                onClick={() =>
                  setLines((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
          >
            <Plus />
            Agregar línea
          </Button>
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            Debe {money(totalDebe)} · Haber {money(totalHaber)}
          </span>
          <span className={balanced ? "font-medium" : "text-muted-foreground"}>
            {balanced
              ? "Balanceado"
              : `Diferencia ${money(Math.abs(diff))}`}
          </span>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={
              !balanced ||
              descripcion.trim().length === 0 ||
              !fecha ||
              lines.some((l) => l.account_id === "" && (toNumber(l.debit) > 0 || toNumber(l.credit) > 0)) ||
              create.isPending
            }
          >
            Crear asiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
