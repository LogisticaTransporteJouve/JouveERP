"use client";

import { Banknote, Undo2 } from "lucide-react";
import { Suspense, useState } from "react";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  formatArgentineDate,
  formatMoneyWithCode,
  todayInAR,
} from "@/lib/format";

import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import {
  useCancelCheckSale,
  useCheckSaleDebts,
  useCheckSales,
  usePayCheckSaleDebt,
} from "../hooks/use-check-sales";
import type { CheckSale, CheckSaleDebt } from "../lib/check-sales";

function CancelSaleDialog({
  sale,
  onClose,
}: {
  sale: CheckSale | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const mut = useCancelCheckSale();
  if (!sale) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular venta a {sale.buyer_name}</DialogTitle>
          <DialogDescription>
            Para una venta cargada por error: sus {sale.checks} cheques vuelven
            a cartera y se borran la transferencia a la cuenta, los intereses y
            las comisiones. No se puede si algún cheque se rechazó o se movió
            después, ni con el período contable cerrado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="cancel-sale-reason" className="text-xs">
            Motivo
          </Label>
          <Textarea
            id="cancel-sale-reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={mut.isPending || reason.trim() === ""}
            onClick={() =>
              mut.mutate(
                { sale_id: sale.id, reason },
                {
                  onSuccess: () => {
                    toast.success(
                      "Venta anulada: los cheques volvieron a cartera.",
                    );
                    setReason("");
                    onClose();
                  },
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            {mut.isPending ? "Anulando…" : "Anular venta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while a debt is being paid: its accounts read is a
 *  suspense query, kept off the page for users who never open it. */
function PayDebtDialog({
  debt,
  onClose,
}: {
  debt: CheckSaleDebt;
  onClose: () => void;
}) {
  const { data: accounts } = useAccountsList();
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayInAR());
  const mut = usePayCheckSaleDebt();
  const options = accounts.filter(
    (a) =>
      a.is_active &&
      a.currency === debt.currency &&
      a.type !== "checks" &&
      a.type !== "echeq",
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar cheque {debt.check_number}</DialogTitle>
          <DialogDescription>
            {debt.buyer_name} debita{" "}
            {formatMoneyWithCode(debt.amount, debt.currency)} del cheque
            rechazado. Sale de la cuenta que elijas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Cuenta</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger aria-label="Cuenta">
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent position="popper">
                {options.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fecha</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            disabled={mut.isPending || accountId === ""}
            onClick={() =>
              mut.mutate(
                { debt_id: debt.id, account_id: accountId, payment_date: date },
                {
                  onSuccess: () => {
                    toast.success("Deuda pagada.");
                    onClose();
                  },
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            {mut.isPending ? "Pagando…" : "Pagar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Check sales (to anul one entered by mistake) and the debts to buyers of
 *  rejected sold checks still to pay. */
export function CheckSalesSection({
  canWrite,
  canPay,
}: {
  canWrite: boolean;
  /** cheques:write plus accounts:read: paying picks the account. */
  canPay: boolean;
}) {
  const sales = useCheckSales();
  const debts = useCheckSaleDebts();
  const [cancelling, setCancelling] = useState<CheckSale | null>(null);
  const [paying, setPaying] = useState<CheckSaleDebt | null>(null);

  const pendingDebts = (debts.data ?? []).filter((d) => d.paid_at === null);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Ventas de cheques</h2>
      {sales.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : sales.isError ? (
        <p className="text-sm text-muted-foreground">
          No se pudieron cargar las ventas: {sales.error.message}
        </p>
      ) : (sales.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no se vendió ningún cheque.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {(sales.data ?? []).map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {s.buyer_name}
                  {s.status === "cancelled" ? " · anulada" : ""}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatArgentineDate(s.sale_date)} · {s.account_name} ·{" "}
                  {s.status === "cancelled"
                    ? (s.cancel_reason ?? "")
                    : `${s.checks} cheques`}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-right tabular-nums">
                  <span className="block">
                    {formatMoneyWithCode(s.net_amount, s.currency)} neto
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    de {formatMoneyWithCode(s.gross_amount, s.currency)}
                  </span>
                </span>
                {canWrite && s.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCancelling(s)}
                  >
                    <Undo2 className="size-4" />
                    Anular
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {debts.isError ? (
        <p className="text-sm text-muted-foreground">
          No se pudieron cargar las deudas por cheques: {debts.error.message}
        </p>
      ) : (
        pendingDebts.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Cheques vendidos rechazados por pagar al comprador
            </h3>
            <ul className="divide-y rounded-md border">
              {pendingDebts.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      Cheque {d.check_number} · {d.bank_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {d.buyer_name} · rechazado el{" "}
                      {formatArgentineDate(d.rejected_on)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">
                      {formatMoneyWithCode(d.amount, d.currency)}
                    </span>
                    {canPay && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPaying(d)}
                      >
                        <Banknote className="size-4" />
                        Pagar
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}

      {/* Keyed by the row: each one opens with fresh state, not the account,
          date or reason left by the previous one. */}
      <CancelSaleDialog
        key={cancelling?.id ?? "none"}
        sale={cancelling}
        onClose={() => setCancelling(null)}
      />
      {paying && (
        <Suspense fallback={null}>
          <PayDebtDialog
            key={paying.id}
            debt={paying}
            onClose={() => setPaying(null)}
          />
        </Suspense>
      )}
    </section>
  );
}
