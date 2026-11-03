"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  formatArgentineDate,
  formatMoney,
  formatMoneySigned,
  round2,
  todayInAR,
} from "@/lib/format";

import { isCheckAccount, isAccountType } from "@/features/accounts/schema";

import {
  useSaveDriverSettlement,
  useSettlementAccounts,
} from "../hooks/use-driver-settlements";
import {
  emptyLine,
  rowReceived,
  rowsProblem,
  rowsToItems,
  type LineDraft,
  type RowDraft,
} from "../lib/settlement-form";
import {
  settlementDifference,
  type CodPendingShipment,
  type DriverSettlementDetail,
  type SettlementAccount,
} from "../schema";

/** Payment lines a carga takes (DriverSettlementItemSchema). */
const MAX_LINES = 10;

function route(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

function rowDetail(s: {
  remito_number: string | null;
  delivery_date: string | null;
  origin: string | null;
  destination: string | null;
}): string {
  return [
    s.delivery_date ? formatArgentineDate(s.delivery_date) : "Sin fecha",
    s.remito_number ? `Remito ${s.remito_number}` : null,
    route(s.origin, s.destination),
  ]
    .filter(Boolean)
    .join(" · ");
}

function isCheck(accounts: readonly SettlementAccount[], id: string): boolean {
  const type = accounts.find((a) => a.id === id)?.type;
  return isAccountType(type) && isCheckAccount(type);
}

function buildRows(
  pending: readonly CodPendingShipment[],
  settlement: DriverSettlementDetail | undefined,
  defaultAccount: string,
): RowDraft[] {
  const rows: RowDraft[] = [];
  for (const item of settlement?.items ?? []) {
    rows.push({
      shipment_id: item.shipment_id,
      label: item.client_name,
      detail: rowDetail(item),
      expected: item.expected_amount,
      included: true,
      note: item.note ?? "",
      // Every saved line, so an edit keeps what was handed in.
      lines:
        item.lines.length === 0
          ? [emptyLine(defaultAccount)]
          : item.lines.map((line) => ({
              ...emptyLine(line.account_id, String(line.amount)),
              reference: line.reference ?? "",
              check_number: line.check_number ?? "",
              bank_name: line.bank_name ?? "",
              check_due_date: line.check_due_date ?? "",
            })),
    });
  }
  for (const s of pending) {
    if (rows.some((r) => r.shipment_id === s.shipment_id)) continue;
    rows.push({
      shipment_id: s.shipment_id,
      label: s.client_name,
      detail: rowDetail(s),
      expected: s.cod_amount,
      // A new rendición takes every pending carga, collected in full.
      included: settlement === undefined,
      note: "",
      lines: [emptyLine(defaultAccount, String(s.cod_amount))],
    });
  }
  return rows;
}

/**
 * New rendición (draft) for a driver, or edit of a draft: per carga, what
 * the driver handed in (account, amount, check) against what they had to
 * collect. An included carga with no amount records that nothing came in.
 */
export function DriverSettlementDialog({
  driver,
  pending,
  settlement,
  open,
  onOpenChange,
}: {
  driver: { id: string; name: string };
  /** The driver's delivered cash-on-delivery cargas in no live rendición. */
  pending: readonly CodPendingShipment[];
  settlement?: DriverSettlementDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const accounts = useSettlementAccounts(open);
  const saveMut = useSaveDriverSettlement();
  const [date, setDate] = useState(todayInAR());
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<RowDraft[]>([]);

  const accountList = accounts.data ?? [];
  const defaultAccount =
    accountList.find((a) => a.type === "cash")?.id ?? accountList[0]?.id ?? "";

  useEffect(() => {
    if (!open) return;
    setDate(settlement?.settlement_date ?? todayInAR());
    setNotes(settlement?.notes ?? "");
    setRows(buildRows(pending, settlement, defaultAccount));
    // Rebuilt when the dialog opens or the accounts arrive (default account).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settlement, defaultAccount]);

  function update(id: string, patch: Partial<RowDraft>) {
    setRows((prev) =>
      prev.map((r) => (r.shipment_id === id ? { ...r, ...patch } : r)),
    );
  }

  function updateLine(id: string, key: string, patch: Partial<LineDraft>) {
    setRows((prev) =>
      prev.map((r) =>
        r.shipment_id === id
          ? {
              ...r,
              lines: r.lines.map((l) =>
                l.key === key ? { ...l, ...patch } : l,
              ),
            }
          : r,
      ),
    );
  }

  /** A new line takes what is still missing for the carga. */
  function addLine(row: RowDraft) {
    const missing = round2(row.expected - rowReceived(row));
    update(row.shipment_id, {
      lines: [
        ...row.lines,
        emptyLine(defaultAccount, missing > 0 ? String(missing) : ""),
      ],
    });
  }

  function removeLine(row: RowDraft, key: string) {
    const lines = row.lines.filter((l) => l.key !== key);
    update(row.shipment_id, {
      lines: lines.length === 0 ? [emptyLine(defaultAccount)] : lines,
    });
  }

  const checkOf = (accountId: string) => isCheck(accountList, accountId);
  const included = rows.filter((r) => r.included);
  const expected = round2(included.reduce((s, r) => s + r.expected, 0));
  const received = round2(included.reduce((s, r) => s + rowReceived(r), 0));
  const difference = settlementDifference(expected, received);

  function onSubmit() {
    const issue = rowsProblem(rows, checkOf);
    if (issue) {
      toast.error(issue);
      return;
    }
    saveMut.mutate(
      {
        id: settlement?.id ?? null,
        driver_id: driver.id,
        settlement_date: date,
        notes,
        items: rowsToItems(rows, checkOf),
      },
      {
        onSuccess: () => {
          toast.success(
            settlement ? "Rendición guardada." : "Rendición creada.",
          );
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {settlement ? "Editar rendición" : "Nueva rendición"} ·{" "}
            {driver.name}
          </DialogTitle>
          <DialogDescription>
            Lo que el chofer entrega por las cargas contra entrega, con uno o
            varios medios de pago por carga. Al confirmarla se emiten los
            recibos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ds-date">Fecha</Label>
              <Input
                id="ds-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {accounts.isError && (
            <p className="text-sm text-muted-foreground">
              No se pudieron cargar las cuentas: {accounts.error.message}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              El chofer no tiene cargas contra entrega pendientes.
            </p>
          ) : (
            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
              {rows.map((r) => {
                const rowDiff = settlementDifference(
                  r.expected,
                  rowReceived(r),
                );
                return (
                  <li key={r.shipment_id} className="space-y-2 px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-3 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={r.included}
                        onCheckedChange={(v) =>
                          update(r.shipment_id, { included: v === true })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {r.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {r.detail}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="block">{formatMoney(r.expected)}</span>
                        {r.included && rowDiff !== 0 && (
                          <span className="block text-xs text-muted-foreground">
                            Dif. {formatMoneySigned(rowDiff)}
                          </span>
                        )}
                      </span>
                    </label>
                    {r.included && (
                      <div className="space-y-2 pl-7">
                        {r.lines.map((l, index) => {
                          const check = checkOf(l.account_id);
                          return (
                            <div
                              key={l.key}
                              className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem_auto]"
                            >
                              <Select
                                value={l.account_id}
                                onValueChange={(v) =>
                                  updateLine(r.shipment_id, l.key, {
                                    account_id: v,
                                  })
                                }
                              >
                                <SelectTrigger
                                  className="w-full"
                                  aria-label={`Cuenta del pago ${index + 1}`}
                                >
                                  <SelectValue placeholder="Cuenta" />
                                </SelectTrigger>
                                <SelectContent>
                                  {accountList.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                      {a.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                aria-label={`Importe del pago ${index + 1}`}
                                placeholder="0 = no cobró"
                                value={l.amount}
                                onChange={(e) =>
                                  updateLine(r.shipment_id, l.key, {
                                    amount: e.target.value,
                                  })
                                }
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Quitar el pago ${index + 1}`}
                                disabled={
                                  r.lines.length === 1 && l.amount === ""
                                }
                                onClick={() => removeLine(r, l.key)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                              {check && (
                                <div className="grid grid-cols-1 gap-2 sm:col-span-3 sm:grid-cols-3">
                                  <Input
                                    aria-label="Número de cheque"
                                    placeholder="N° de cheque"
                                    maxLength={60}
                                    value={l.check_number}
                                    onChange={(e) =>
                                      updateLine(r.shipment_id, l.key, {
                                        check_number: e.target.value,
                                      })
                                    }
                                  />
                                  <Input
                                    type="date"
                                    aria-label="Fecha de pago del cheque"
                                    value={l.check_due_date}
                                    onChange={(e) =>
                                      updateLine(r.shipment_id, l.key, {
                                        check_due_date: e.target.value,
                                      })
                                    }
                                  />
                                  <Input
                                    aria-label="Banco"
                                    placeholder="Banco"
                                    maxLength={120}
                                    value={l.bank_name}
                                    onChange={(e) =>
                                      updateLine(r.shipment_id, l.key, {
                                        bank_name: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={r.lines.length >= MAX_LINES}
                            onClick={() => addLine(r)}
                          >
                            <Plus />
                            Otro medio de pago
                          </Button>
                          <Input
                            aria-label="Nota"
                            className="sm:flex-1"
                            placeholder={
                              rowDiff !== 0 ? "Motivo de la diferencia" : "Nota"
                            }
                            maxLength={500}
                            value={r.note}
                            onChange={(e) =>
                              update(r.shipment_id, { note: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-2">
            <Label htmlFor="ds-notes">Notas</Label>
            <Textarea
              id="ds-notes"
              rows={2}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div>
              <span className="block text-xs text-muted-foreground">
                A cobrar
              </span>
              <span className="tabular-nums">{formatMoney(expected)}</span>
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">
                Entregado
              </span>
              <span className="tabular-nums">{formatMoney(received)}</span>
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">
                Diferencia
              </span>
              <span className="font-medium tabular-nums">
                {formatMoneySigned(difference)}
              </span>
            </div>
          </div>
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
            disabled={saveMut.isPending || included.length === 0}
            onClick={onSubmit}
          >
            Guardar borrador
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
