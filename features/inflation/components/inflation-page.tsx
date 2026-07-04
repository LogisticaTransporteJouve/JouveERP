"use client";

import { BookOpen, Plus, Trash2, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ManualEntryDialog } from "@/features/journal-entries/components/manual-entry-dialog";
import { formatArgentineDate } from "@/lib/format";

import {
  useApplyInflationAdjustment,
  useCreateInflationAdjustment,
  useDeleteInflationAdjustment,
  useInflationAdjustments,
  useRevertInflationApplication,
} from "../hooks/use-inflation";
import type { InflationAdjustment } from "../schema";

const numFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

export function InflationPage() {
  const { data: items } = useInflationAdjustments();
  const deleteMut = useDeleteInflationAdjustment();
  const applyMut = useApplyInflationAdjustment();
  const revertMut = useRevertInflationApplication();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [entryFor, setEntryFor] = useState<InflationAdjustment | null>(null);

  const columns = useMemo<ColumnDef<InflationAdjustment>[]>(() => {
    async function handleDelete(adj: InflationAdjustment) {
      const ok = await confirm({
        title: `Borrar coeficiente ${adj.period}`,
        description:
          "Si ya hay asiento aplicado, va a quedar huérfano. Considerá revertir primero.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(adj.id, {
        onSuccess: () => toast.success("Coeficiente borrado."),
        onError: (err) => toast.error(err.message),
      });
    }

    async function handleRevert(adj: InflationAdjustment) {
      const ok = await confirm({
        title: `Desvincular asiento de ${adj.period}`,
        description:
          "Solo se desvincula del coeficiente — el asiento sigue en el libro diario; si corresponde, cargá su reversión a mano.",
        confirmLabel: "Desvincular",
        tone: "destructive",
      });
      if (!ok) return;
      revertMut.mutate(adj.id, {
        onSuccess: () => toast.success("Asiento desvinculado."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "period",
        header: "Período",
        cell: ({ row }) => (
          <span className="font-mono">{row.original.period}</span>
        ),
        meta: { headerClassName: "w-32" },
      },
      {
        accessorKey: "coefficient",
        header: "Coeficiente",
        cell: ({ row }) => (
          <span className="font-mono">
            {numFmt.format(Number(row.original.coefficient))}
          </span>
        ),
        meta: { headerClassName: "w-32", align: "right" },
      },
      {
        id: "source",
        header: "Fuente / Notas",
        enableSorting: false,
        cell: ({ row }) => (
          <>
            {row.original.index_source && (
              <span className="font-medium">{row.original.index_source}</span>
            )}
            {row.original.notes && (
              <p className="text-xs text-muted-foreground">
                {row.original.notes}
              </p>
            )}
          </>
        ),
        meta: { cellClassName: "text-sm" },
      },
      {
        id: "status",
        header: "Estado",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.applied_at
            ? `Aplicado ${formatArgentineDate(row.original.applied_at)}`
            : "Sin aplicar",
        meta: {
          headerClassName: "w-40",
          cellClassName: "text-xs text-muted-foreground",
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-40" },
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            {row.original.journal_entry_id ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRevert(row.original)}
              >
                <Unlink className="size-4" />
                Desvincular
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEntryFor(row.original)}
              >
                <BookOpen className="size-4" />
                Generar asiento
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDelete(row.original)}
              aria-label="Borrar"
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ),
      },
    ];
  }, [confirm, deleteMut, revertMut]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Ajuste por inflación
          </h1>
          <p className="text-sm text-muted-foreground">
            RG 4667 — coeficiente mensual usado para reexpresar saldos no
            monetarios (preparación de balance ajustado).
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus />
          Cargar coeficiente
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(adj) => adj.id}
        emptyMessage="No hay coeficientes cargados."
      />

      <InflationDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <ManualEntryDialog
        open={entryFor !== null}
        onOpenChange={(open) => {
          if (!open) setEntryFor(null);
        }}
        defaultDescription={
          entryFor
            ? `Ajuste por inflación RG 4667 — período ${entryFor.period}`
            : undefined
        }
        prefillRecpam
        onCreated={(journalEntryId) => {
          if (!entryFor) return;
          applyMut.mutate(
            { id: entryFor.id, journal_entry_id: journalEntryId },
            {
              onSuccess: () =>
                toast.success("Asiento vinculado al coeficiente."),
              onError: (err) =>
                toast.error(
                  `El asiento se creó pero no se pudo vincular: ${err.message}`,
                ),
            },
          );
          setEntryFor(null);
        }}
      />
    </div>
  );
}

type DialogFormValues = {
  period: string;
  coefficient: string;
  index_source: string;
  notes: string;
};

function InflationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateInflationAdjustment();
  const form = useForm<DialogFormValues>({
    defaultValues: { period: "", coefficient: "", index_source: "", notes: "" },
  });

  function onSubmit(values: DialogFormValues) {
    const num = Number(values.coefficient.replace(",", "."));
    createMut.mutate(
      {
        period: values.period,
        coefficient: num,
        index_source: values.index_source.trim() || null,
        notes: values.notes.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Coeficiente cargado.");
          form.reset();
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cargar coeficiente mensual</DialogTitle>
          <DialogDescription>
            Coeficiente IPIM o el que indique el contador.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="period"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Período (YYYY-MM)</FormLabel>
                  <FormControl>
                    <Input {...field} type="month" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="coefficient"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Coeficiente</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="1,058432" className="font-mono" />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Ejemplo: 1,058432 = inflación del 5,8432% en el período.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="index_source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fuente</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="IPIM INDEC" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? "Guardando…" : "Cargar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
