"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
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
import { formatArgentineDate } from "@/lib/format";

import {
  useCreateExchangeRate,
  useDeleteExchangeRate,
  useExchangeRates,
} from "../hooks/use-exchange-rates";
import type { ExchangeRate } from "../schema";

const rateFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function ExchangeRatesPage() {
  const { data: items } = useExchangeRates();
  const deleteMut = useDeleteExchangeRate();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);

  const columns = useMemo<ColumnDef<ExchangeRate>[]>(() => {
    async function handleDelete(r: ExchangeRate) {
      const ok = await confirm({
        title: `Borrar cotización ${r.rate_date}`,
        description:
          "Las conversiones que usaban esta fecha van a tomar la cotización anterior más cercana.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(r.id, {
        onSuccess: () => toast.success("Cotización borrada."),
        onError: (err) => toast.error(err.message),
      });
    }

    return [
      {
        accessorKey: "rate_date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="font-mono">
            {formatArgentineDate(row.original.rate_date)}
          </span>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        accessorKey: "rate",
        header: "ARS por USD",
        cell: ({ row }) => (
          <span className="font-mono">
            {rateFmt.format(Number(row.original.rate))}
          </span>
        ),
        meta: { headerClassName: "w-40", align: "right" },
      },
      {
        accessorKey: "source",
        header: "Fuente",
        cell: ({ row }) => (
          <Badge
            variant={row.original.source === "manual" ? "default" : "secondary"}
          >
            {row.original.source === "manual" ? "Manual" : "BCRA"}
          </Badge>
        ),
        meta: { headerClassName: "w-28" },
      },
      {
        accessorKey: "notes",
        header: "Notas",
        enableSorting: false,
        cell: ({ row }) => row.original.notes ?? "—",
        meta: { cellClassName: "text-xs text-muted-foreground" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-12" },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(row.original)}
            aria-label="Borrar"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        ),
      },
    ];
  }, [confirm, deleteMut]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Cotización USD
          </h1>
          <p className="text-sm text-muted-foreground">
            Referencia oficial BCRA (ARS por 1 USD). El cron diario trae la del
            BCRA; podés cargar una manual como override.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="exchange-rates" />
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            Cargar cotización
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => r.id}
        emptyMessage="No hay cotizaciones cargadas."
      />

      <ExchangeRateDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

type DialogFormValues = {
  rate_date: string;
  rate: string;
  notes: string;
};

function ExchangeRateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateExchangeRate();
  const form = useForm<DialogFormValues>({
    defaultValues: { rate_date: "", rate: "", notes: "" },
  });

  function onSubmit(values: DialogFormValues) {
    const num = Number(values.rate.replace(",", "."));
    createMut.mutate(
      {
        rate_date: values.rate_date,
        rate: num,
        notes: values.notes.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success("Cotización cargada.");
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
          <DialogTitle>Cargar cotización USD</DialogTitle>
          <DialogDescription>
            ARS por 1 USD. Una carga manual sobreescribe la del BCRA para esa
            fecha.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="rate_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ARS por USD</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="1180,50"
                      className="font-mono"
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Cotización oficial. Ejemplo: 1180,50 = $1.180,50 por USD.
                  </FormDescription>
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
                    <Textarea {...field} rows={2} placeholder="Opcional" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
