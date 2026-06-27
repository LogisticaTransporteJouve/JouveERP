"use client";

import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ExportPdfButton } from "@/components/export-pdf-button";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useDeleteRecurringPayment,
  useRecurringPayments,
  useSetRecurringPaymentActive,
} from "../hooks/use-recurring-payments";
import {
  RECURRING_CATEGORY_LABELS,
  RECURRING_FREQUENCY_LABELS,
  type RecurringPayment,
} from "../schema";

import { RecurringPaymentDialog } from "./recurring-payment-dialog";

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function RecurringPaymentsTable() {
  const { data: items } = useRecurringPayments();
  const deleteMut = useDeleteRecurringPayment();
  const toggleMut = useSetRecurringPaymentActive();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; payment: RecurringPayment } | null
  >(null);

  async function handleDelete(p: RecurringPayment) {
    const ok = await confirm({
      title: `Borrar "${p.description}"`,
      description: "Se elimina el pago recurrente. No se puede deshacer.",
      confirmLabel: "Borrar",
      tone: "destructive",
    });
    if (!ok) return;
    deleteMut.mutate(p.id, {
      onSuccess: () => toast.success("Pago borrado."),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleToggle(p: RecurringPayment) {
    toggleMut.mutate(
      { id: p.id, is_active: !p.is_active },
      { onError: (err) => toast.error(err.message) },
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pagos recurrentes
          </h1>
          <p className="text-muted-foreground text-sm">
            Compromisos que se repiten (alquiler, servicios, préstamos,
            impuestos, sueldos). Insumo del cash-flow proyectado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportPdfButton resource="recurring-payments" label="Exportar PDF" />
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus />
            Nuevo pago
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-28">Categoría</TableHead>
              <TableHead className="w-36 text-right">Monto</TableHead>
              <TableHead className="w-24">Frecuencia</TableHead>
              <TableHead className="w-32">Próx. venc.</TableHead>
              <TableHead className="w-20">Activo</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  Sin pagos recurrentes. Agregá el primero.
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {RECURRING_CATEGORY_LABELS[p.category]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(p.amount, p.currency)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {RECURRING_FREQUENCY_LABELS[p.frequency]}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {p.next_due_date}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.is_active}
                      onCheckedChange={() => handleToggle(p)}
                      aria-label="Activo"
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDialog({ mode: "edit", payment: p })}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 className="size-4" />
                          Borrar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {dialog && (
        <RecurringPaymentDialog
          mode={dialog.mode}
          payment={dialog.mode === "edit" ? dialog.payment : undefined}
          open={dialog !== null}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </>
  );
}
