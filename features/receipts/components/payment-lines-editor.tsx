"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCOUNT_TYPE_LABEL,
  type Account,
} from "@/features/accounts/schema";

export type PaymentLineDraft = {
  account_id: string;
  amount: string; // input string, parsed on submit
  reference: string;
};

export function PaymentLinesEditor({
  accounts,
  lines,
  onChange,
}: {
  accounts: Account[];
  lines: PaymentLineDraft[];
  onChange: (next: PaymentLineDraft[]) => void;
}) {
  function update(index: number, patch: Partial<PaymentLineDraft>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function remove(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...lines, { account_id: "", amount: "", reference: "" }]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Líneas de pago</Label>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Agregar línea
        </Button>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Sin líneas todavía. Agregá al menos una para registrar la entrada de plata.
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((line, idx) => {
            const account = accounts.find((a) => a.id === line.account_id);
            return (
              <div
                key={idx}
                className="grid items-end gap-2 rounded-md border bg-card p-3 sm:grid-cols-[2fr_1fr_1.5fr_auto]"
              >
                <div className="space-y-1">
                  <Label className="text-xs">Cuenta</Label>
                  <Select
                    value={line.account_id}
                    onValueChange={(v) => update(idx, { account_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Elegir cuenta" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}{" "}
                          <span className="text-xs text-muted-foreground">
                            · {ACCOUNT_TYPE_LABEL[a.type]} · {a.currency}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Monto</Label>
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.amount}
                    onChange={(e) => update(idx, { amount: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Referencia{" "}
                    {account?.type === "cheques" || account?.type === "echeq"
                      ? "(nro cheque)"
                      : account?.type === "bank"
                        ? "(transferencia)"
                        : "(opcional)"}
                  </Label>
                  <Input
                    placeholder=""
                    value={line.reference}
                    onChange={(e) => update(idx, { reference: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(idx)}
                  aria-label="Quitar línea"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
