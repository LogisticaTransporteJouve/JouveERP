"use client";

import { useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import {
  useCreateTransaction,
  useCreateTransfer,
} from "../hooks/use-transactions";
import {
  defaultAccrualMonth,
  TRANSACTION_CURRENCIES,
  type CheckMetadataInput,
  type TransactionCurrency,
} from "../schema";

const DEFAULT_CHANNEL_ID = "jouve_fiscal";

type FormKind = "income" | "expense" | "transfer";

export interface ChannelOption {
  id: string;
  name: string;
}

function todayISO() {
  const d = new Date();
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

export function TransactionForm({
  channels,
  onSuccess,
  onCancel,
}: {
  channels: ChannelOption[];
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const { data: accounts } = useAccountsList();
  const activeAccounts = accounts.filter((a) => a.is_active);

  const createTxMut = useCreateTransaction();
  const createTransferMut = useCreateTransfer();
  const isSaving = createTxMut.isPending || createTransferMut.isPending;

  const [kind, setKind] = useState<FormKind>("income");
  const [channelId, setChannelId] = useState(
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ??
      channels[0]?.id ??
      "",
  );
  const [accountId, setAccountId] = useState("");
  const [accountFromId, setAccountFromId] = useState("");
  const [accountToId, setAccountToId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<TransactionCurrency>("ARS");
  const [transactionDate, setTransactionDate] = useState(todayISO());
  const [accrualMonth, setAccrualMonth] = useState(
    defaultAccrualMonth(todayISO()),
  );
  const [description, setDescription] = useState("");

  // Check sub-form state. Sólo se usa si la cuenta es de tipo
  // checks/echeq y el kind es income (recibo manual de check de tercero).
  const selectedAccount = activeAccounts.find((a) => a.id === accountId);
  const isCheckAccount =
    !!selectedAccount &&
    (selectedAccount.type === "checks" || selectedAccount.type === "echeq");
  const showCheckSubForm = kind === "income" && isCheckAccount;
  const defaultCheckKind: "fisico" | "echeq" =
    selectedAccount?.type === "echeq" ? "echeq" : "fisico";

  const [checkNumber, setCheckNumber] = useState("");
  const [checkBank, setCheckBank] = useState("");
  const [checkDrawer, setCheckDrawer] = useState("");
  const [checkDrawerCuit, setCheckDrawerCuit] = useState("");
  const [checkIssueDate, setCheckIssueDate] = useState(todayISO());
  const [checkDueDate, setCheckDueDate] = useState(todayISO());

  function onTransactionDateChange(value: string) {
    setTransactionDate(value);
    setAccrualMonth(defaultAccrualMonth(value));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (kind === "transfer") {
      if (!accountFromId || !accountToId) {
        toast.error("Elegí cuenta origen y destino.");
        return;
      }
      const fromAcc = activeAccounts.find((a) => a.id === accountFromId);
      const toAcc = activeAccounts.find((a) => a.id === accountToId);
      if (fromAcc && toAcc && fromAcc.currency !== toAcc.currency) {
        toast.error(
          `Moneda incompatible: ${fromAcc.currency} → ${toAcc.currency}. Por ahora solo se permiten transferencias entre cuentas con la misma moneda.`,
        );
        return;
      }
      createTransferMut.mutate(
        {
          account_from_id: accountFromId,
          account_to_id: accountToId,
          channel_id: channelId,
          amount,
          currency,
          transaction_date: transactionDate,
          accrual_month: accrualMonth,
          description,
        },
        {
          onSuccess: () => {
            toast.success("Transferencia registrada.");
            onSuccess?.();
          },
          onError: (err) => toast.error(err.message),
        },
      );
      return;
    }

    if (!accountId) {
      toast.error("Elegí una cuenta.");
      return;
    }

    let checkMetadata: CheckMetadataInput | null = null;
    if (showCheckSubForm) {
      if (checkNumber.trim().length === 0) {
        toast.error("Ingresá el número del cheque.");
        return;
      }
      if (!checkIssueDate || !checkDueDate) {
        toast.error("Ingresá fecha de emisión y fecha de cobro.");
        return;
      }
      checkMetadata = {
        check_kind: defaultCheckKind,
        check_number: checkNumber.trim(),
        bank_name: checkBank.trim() || undefined,
        drawer_name: checkDrawer.trim() || undefined,
        drawer_cuit: checkDrawerCuit.trim() || undefined,
        issue_date: checkIssueDate,
        due_date: checkDueDate,
      };
    }

    createTxMut.mutate(
      {
        account_id: accountId,
        channel_id: channelId,
        kind,
        amount,
        currency,
        transaction_date: transactionDate,
        accrual_month: accrualMonth,
        description,
        check_metadata: checkMetadata,
      },
      {
        onSuccess: () => {
          toast.success(kind === "income" ? "Ingreso registrado." : "Egreso registrado.");
          onSuccess?.();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Kind picker — three buttons */}
      <div className="grid grid-cols-3 gap-2">
        <KindButton
          active={kind === "income"}
          onClick={() => setKind("income")}
          label="Ingreso"
        />
        <KindButton
          active={kind === "expense"}
          onClick={() => setKind("expense")}
          label="Egreso"
        />
        <KindButton
          active={kind === "transfer"}
          onClick={() => setKind("transfer")}
          label="Transferencia"
        />
      </div>

      {/* Account(s) */}
      {kind === "transfer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Cuenta origen</Label>
            <Select value={accountFromId} onValueChange={setAccountFromId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir cuenta" />
              </SelectTrigger>
              <SelectContent position="popper">
                {activeAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      · {a.currency}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cuenta destino</Label>
            <Select value={accountToId} onValueChange={setAccountToId}>
              <SelectTrigger>
                <SelectValue placeholder="Elegir cuenta" />
              </SelectTrigger>
              <SelectContent position="popper">
                {activeAccounts
                  .filter((a) => a.id !== accountFromId)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {a.currency}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs">Cuenta</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Elegir cuenta" />
            </SelectTrigger>
            <SelectContent position="popper">
              {activeAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    · {a.currency}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Channel + amount + currency */}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_100px]">
        <div className="space-y-1">
          <Label className="text-xs">Canal</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
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
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Moneda</Label>
          <Select
            value={currency}
            onValueChange={(v) => setCurrency(v as TransactionCurrency)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {TRANSACTION_CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dates */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Fecha</Label>
          <Input
            type="date"
            value={transactionDate}
            onChange={(e) => onTransactionDateChange(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Mes devengado{" "}
            <span className="text-muted-foreground">(día 1)</span>
          </Label>
          <Input
            type="month"
            value={accrualMonth.slice(0, 7)}
            onChange={(e) => setAccrualMonth(`${e.target.value}-01`)}
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1">
        <Label className="text-xs">Descripción</Label>
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            kind === "transfer"
              ? "Ej. Pase de Caja a Banco Galicia"
              : kind === "income"
                ? "Ej. Cobro factura a cliente X"
                : "Ej. Pago combustible flota"
          }
        />
      </div>

      {/* Sub-form de cheque: aparece sólo cuando la cuenta destino es de
          cartera (checks o echeq) y el movimiento es income (carga manual
          de cheque de tercero). Crea un row en `checks` con
          source_kind='manual' y status='en_cartera'. */}
      {showCheckSubForm && (
        <div className="space-y-3 rounded-md border border-dashed border-muted bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Datos del cheque ({defaultCheckKind === "echeq" ? "electrónico" : "físico"})
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <div className="space-y-1">
              <Label className="text-xs">Número del cheque</Label>
              <Input
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
                placeholder="Ej. 00012345"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Banco</Label>
              <Input
                value={checkBank}
                onChange={(e) => setCheckBank(e.target.value)}
                placeholder="Ej. Banco Galicia"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1">
              <Label className="text-xs">Firmante</Label>
              <Input
                value={checkDrawer}
                onChange={(e) => setCheckDrawer(e.target.value)}
                placeholder="Razón social"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CUIT firmante</Label>
              <Input
                value={checkDrawerCuit}
                onChange={(e) => setCheckDrawerCuit(e.target.value)}
                placeholder="30-12345678-9"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Fecha de emisión</Label>
              <Input
                type="date"
                value={checkIssueDate}
                onChange={(e) => setCheckIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha de cobro</Label>
              <Input
                type="date"
                value={checkDueDate}
                onChange={(e) => setCheckDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onCancel?.()}
          disabled={isSaving}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Guardando…" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}

function KindButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted/50"
      }`}
    >
      {label}
    </button>
  );
}
