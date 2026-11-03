"use client";

import { Gavel, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import {
  amountToInput,
  formatArgentineDate,
  formatMoney,
  parseArAmount,
  todayInAR,
} from "@/lib/format";

import {
  useCreateGarnishment,
  useDeleteGarnishment,
  useEmployeeGarnishments,
  useUpdateGarnishment,
} from "../hooks/use-garnishments";
import {
  GARNISHMENT_MODE_LABEL,
  GARNISHMENT_MODES,
  isGarnishmentMode,
  type Garnishment,
  type GarnishmentMode,
} from "../payroll-schema";

type Draft = {
  mode: GarnishmentMode;
  value: string;
  active_from: string;
  active_to: string;
  beneficiary: string;
  court_note: string;
};

function toDraft(g: Garnishment | null): Draft {
  if (!g) {
    return {
      mode: "percentage",
      value: "10",
      active_from: todayInAR(),
      active_to: "",
      beneficiary: "",
      court_note: "",
    };
  }
  return {
    mode: g.mode,
    value:
      g.mode === "percentage"
        ? String(g.percentage)
        : amountToInput(Number(g.amount)),
    active_from: g.active_from,
    active_to: g.active_to ?? "",
    beneficiary: g.beneficiary ?? "",
    court_note: g.court_note ?? "",
  };
}

function describe(g: Garnishment): string {
  return g.mode === "percentage"
    ? `${g.percentage ?? 0}% del recibo`
    : `${formatMoney(g.amount ?? 0)} por mes`;
}

export function EmployeeGarnishmentsCard({
  employeeId,
  canWrite,
}: {
  employeeId: string;
  canWrite: boolean;
}) {
  const { data, isPending, isError, error } =
    useEmployeeGarnishments(employeeId);
  const deleteMut = useDeleteGarnishment(employeeId);
  const [editing, setEditing] = useState<Garnishment | null>(null);
  const [open, setOpen] = useState(false);

  function openFor(g: Garnishment | null) {
    setEditing(g);
    setOpen(true);
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Gavel className="size-4 text-muted-foreground" />
            Embargos
          </h2>
          <p className="text-xs text-muted-foreground">
            Se descuentan solos en cada planilla en borrador mientras estén
            vigentes, y bajan la transferencia sugerida.
          </p>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={() => openFor(null)}>
            <Plus className="size-4" />
            Nuevo embargo
          </Button>
        )}
      </div>

      <div className="mt-3 text-sm">
        {isPending ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : isError ? (
          <p className="text-muted-foreground">
            No se pudieron leer los embargos: {error.message}
          </p>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground">Sin embargos.</p>
        ) : (
          <ul className="divide-y">
            {data.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="font-medium">{describe(g)}</p>
                  <p className="text-xs text-muted-foreground">
                    Desde {formatArgentineDate(g.active_from)}
                    {g.active_to
                      ? ` hasta ${formatArgentineDate(g.active_to)}`
                      : " · sin fecha de fin"}
                    {g.beneficiary ? ` · ${g.beneficiary}` : ""}
                  </p>
                  {g.court_note && (
                    <p className="text-xs text-muted-foreground">
                      {g.court_note}
                    </p>
                  )}
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Editar embargo"
                      onClick={() => openFor(g)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Borrar embargo"
                      disabled={deleteMut.isPending}
                      onClick={() =>
                        deleteMut.mutate(g.id, {
                          onSuccess: () => toast.success("Embargo borrado."),
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canWrite && open && (
        <GarnishmentDialog
          employeeId={employeeId}
          garnishment={editing}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}

function GarnishmentDialog({
  employeeId,
  garnishment,
  open,
  onOpenChange,
}: {
  employeeId: string;
  garnishment: Garnishment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(garnishment));
  const createMut = useCreateGarnishment(employeeId);
  const updateMut = useUpdateGarnishment(employeeId);
  const pending = createMut.isPending || updateMut.isPending;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function onSave() {
    const payload = {
      mode: draft.mode,
      // A percentage keeps its decimal point; an amount reads as es-AR.
      value:
        draft.mode === "percentage"
          ? draft.value.replace(/,/g, ".")
          : (parseArAmount(draft.value) ?? Number.NaN),
      active_from: draft.active_from,
      active_to: draft.active_to || null,
      beneficiary: draft.beneficiary,
      court_note: draft.court_note,
    };
    const callbacks = {
      onSuccess: () => {
        toast.success(
          garnishment ? "Embargo actualizado." : "Embargo cargado.",
        );
        onOpenChange(false);
      },
      onError: (err: Error) => toast.error(err.message),
    };
    if (garnishment) {
      updateMut.mutate({ ...payload, id: garnishment.id }, callbacks);
    } else {
      createMut.mutate({ ...payload, employee_id: employeeId }, callbacks);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {garnishment ? "Editar embargo" : "Nuevo embargo"}
          </DialogTitle>
          <DialogDescription>
            El porcentaje se calcula sobre el neto del recibo (o sobre el sueldo
            pactado mientras no haya recibo). Cambiarlo recalcula las planillas
            en borrador; las cerradas no cambian.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="garnishment-mode">Tipo</Label>
            <Select
              value={draft.mode}
              onValueChange={(v) => {
                if (isGarnishmentMode(v)) set("mode", v);
              }}
            >
              <SelectTrigger id="garnishment-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GARNISHMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {GARNISHMENT_MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="garnishment-value">
              {draft.mode === "percentage" ? "Porcentaje" : "Monto mensual"}
            </Label>
            <Input
              id="garnishment-value"
              inputMode="decimal"
              value={draft.value}
              onChange={(e) => set("value", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="garnishment-from">Vigente desde</Label>
            <Input
              id="garnishment-from"
              type="date"
              value={draft.active_from}
              onChange={(e) => set("active_from", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="garnishment-to">Hasta (opcional)</Label>
            <Input
              id="garnishment-to"
              type="date"
              value={draft.active_to}
              onChange={(e) => set("active_to", e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="garnishment-beneficiary">Beneficiario</Label>
            <Input
              id="garnishment-beneficiary"
              placeholder="Ej. cuota alimentaria, acreedor"
              value={draft.beneficiary}
              onChange={(e) => set("beneficiary", e.target.value)}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="garnishment-note">Juzgado / oficio</Label>
            <Textarea
              id="garnishment-note"
              rows={2}
              value={draft.court_note}
              onChange={(e) => set("court_note", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
