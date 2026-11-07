"use client";

import { Check, FileText, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartAccountDialog } from "@/features/chart-of-accounts/components/chart-account-dialog";
import { useAccountOptions } from "@/features/accounts/hooks/use-accounts";
import { useChartOfAccounts } from "@/features/chart-of-accounts/hooks/use-chart-of-accounts";
import { CollectDialog } from "@/features/receipts/components/collect-dialog";

import { PayLoanFromLineDialog } from "./pay-loan-from-line-dialog";

import {
  useCreateLineTransaction,
  useMatchLine,
  useMatchLineToReceipt,
  usePayCardFromLine,
  useTransferFromLine,
  useDepositCheckFromLine,
  usePayLoanFromLine,
} from "../hooks/use-reconciliation";
import {
  useDeleteBankStatementCode,
  usePresetBankStatementCodes,
  useSaveBankStatementCode,
  useStatementCoding,
} from "../hooks/use-statement-codes";
import {
  conceptOf,
  counterpartyOf,
  detectBankPreset,
  proposeLine,
  type LineProposal,
} from "../lib/bank-codes";
import type { ReconciliationGates } from "../lib/gates";
import {
  BANK_CODE_KIND_LABEL,
  BANK_CODE_PRESETS,
  BANK_CODE_PRESET_LABEL,
  BANK_CODE_KINDS,
  bankCodePosts,
  isBankCodeKind,
  type BankCodeKind,
  type BankStatementCode,
  type PostingAccount,
  type StatementLine,
} from "../schema";

const NONE = "__none__";

/** The proposal of each open line, from the account's bank codes. */
export function useLineProposals(
  accountId: string,
  from: string,
  to: string,
  lines: readonly StatementLine[],
) {
  const coding = useStatementCoding(accountId, from, to);
  const proposals = useMemo(() => {
    const map = new Map<string, LineProposal>();
    if (!coding.data) return map;
    const byCuit = new Map(coding.data.clients.map((c) => [c.cuit, c]));
    for (const l of lines) {
      if (l.status === "open") {
        map.set(
          l.id,
          proposeLine(
            l,
            coding.data.codes,
            byCuit,
            coding.data.loan_installments,
            coding.data.company_cuit,
            coding.data.check_sale_transfers ?? [],
            coding.data.card_statements ?? [],
            coding.data.cartera_checks ?? [],
          ),
        );
      }
    }
    return map;
  }, [coding.data, lines]);
  useAutoPreset(accountId, coding.data?.codes, lines);
  return { coding, proposals };
}

/** An account with no codes yet gets its bank's known codes as soon as its
 *  statement shows which bank it is, once per account. A user who cannot
 *  write codes gets the error from the action and nothing changes. */
function useAutoPreset(
  accountId: string,
  codes: readonly BankStatementCode[] | undefined,
  lines: readonly StatementLine[],
) {
  const preset = usePresetBankStatementCodes();
  const tried = useRef(new Set<string>());
  const detected = codes?.length === 0 ? detectBankPreset(lines) : null;
  const { mutate } = preset;
  useEffect(() => {
    if (!detected || tried.current.has(accountId)) return;
    tried.current.add(accountId);
    mutate(
      { account_id: accountId, preset: detected },
      {
        onSuccess: ({ inserted }) => {
          if (inserted > 0) {
            toast.success(
              `Se cargaron los códigos de ${BANK_CODE_PRESET_LABEL[detected]}: las líneas ya se reconocen.`,
            );
          }
        },
      },
    );
  }, [accountId, detected, mutate]);
}

/** The fiscal channel a bank movement goes to by default. */
export function useFiscalChannel(): string {
  const { channels } = useScope();
  return channels.find((c) => c.is_active && c.is_fiscal)?.id ?? "";
}

/** Under a line's description: what it is and the one-click action. */
export function LineProposalView({
  line,
  proposal,
  accountId,
  gates,
  onConfigure,
}: {
  line: StatementLine;
  proposal: LineProposal | undefined;
  accountId: string;
  gates: ReconciliationGates;
  onConfigure: (draft: CodeDraft) => void;
}) {
  const create = useCreateLineTransaction();
  const matchToReceipt = useMatchLineToReceipt();
  const payLoan = usePayLoanFromLine();
  const matchLine = useMatchLine();
  const payCard = usePayCardFromLine();
  const cardUndefined = proposal?.card
    ? proposal.card.currency === "USD"
      ? proposal.card.statement.undefined_usd
      : proposal.card.statement.undefined_ars
    : 0;
  const depositCheck = useDepositCheckFromLine();
  const [splitting, setSplitting] = useState(false);
  const fiscal = useFiscalChannel();
  if (!proposal) return null;

  function accept() {
    if (!proposal?.code?.chart_account_id) return;
    create.mutate(
      {
        line_id: line.id,
        channel_id: fiscal,
        expense_account_id: proposal.code.chart_account_id,
        description: line.description,
      },
      {
        onSuccess: () => toast.success("Línea registrada y conciliada."),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">
        {proposal.label}
        {proposal.missing ? ` · ${proposal.missing}` : ""}
      </span>
      {gates.canWrite && proposal.ready && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={create.isPending || !fiscal}
          onClick={accept}
        >
          <Check className="size-3.5" />
          Aceptar
        </Button>
      )}
      {gates.canPayLoans && proposal.installment && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={payLoan.isPending}
          onClick={() => {
            const installment = proposal.installment;
            if (!installment) return;
            // A debit of another amount is split first, as the bank did.
            if (Math.abs(installment.amount + line.amount) > 0.005) {
              setSplitting(true);
              return;
            }
            payLoan.mutate(
              { line_id: line.id, installment_id: installment.id },
              {
                onSuccess: () =>
                  toast.success(
                    `Cuota ${installment.number} pagada y conciliada.`,
                  ),
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <Check className="size-3.5" />
          Pagar cuota {proposal.installment.number}
        </Button>
      )}
      {gates.canDepositChecks && proposal.cartera_check && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={depositCheck.isPending}
          onClick={() =>
            depositCheck.mutate(
              { line_id: line.id, check_id: proposal.cartera_check!.id },
              {
                onSuccess: () =>
                  toast.success("Cheque depositado, acreditado y conciliado."),
                onError: (err) => toast.error(err.message),
              },
            )
          }
        >
          <Check className="size-3.5" />
          Depositar cheque {proposal.cartera_check.check_number}
        </Button>
      )}
      {gates.canTreasuryWrite && proposal.kind === "transfer" && (
        <OwnTransfer
          line={line}
          accountId={accountId}
          canReadAccounts={gates.canReadAccounts}
        />
      )}
      {gates.canTreasuryWrite && proposal.card && cardUndefined > 0 && (
        <span className="text-muted-foreground text-xs">
          {cardUndefined === 1
            ? "Falta 1 consumo o cargo"
            : `Faltan ${cardUndefined} consumos o cargos`}{" "}
          por definir en Tesorería › Tarjetas.
        </span>
      )}
      {gates.canTreasuryWrite && proposal.card && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={payCard.isPending || cardUndefined > 0}
          onClick={() =>
            payCard.mutate(
              {
                line_id: line.id,
                statement_id: proposal.card!.statement.id,
                currency: proposal.card!.currency,
              },
              {
                onSuccess: ({ movements }) =>
                  toast.success(
                    `${proposal.card!.currency === "USD" ? "Dólares" : "Pesos"} del resumen pagados: ${movements === 1 ? "1 movimiento" : `${movements} movimientos`} (gastos y adelantos) conciliados.`,
                  ),
                onError: (err) => toast.error(err.message),
              },
            )
          }
        >
          <Check className="size-3.5" />
          Pagar resumen
        </Button>
      )}
      {gates.canWrite && proposal.sale_transfers && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={matchLine.isPending}
          onClick={() =>
            matchLine.mutate(
              {
                line_id: line.id,
                transaction_ids: proposal.sale_transfers!.map((t) => t.id),
              },
              {
                onSuccess: () =>
                  toast.success("Crédito conciliado con los cheques vendidos."),
                onError: (err) => toast.error(err.message),
              },
            )
          }
        >
          <Check className="size-3.5" />
          Conciliar
        </Button>
      )}
      {splitting && proposal.installment && (
        <PayLoanFromLineDialog
          line={line}
          installment={proposal.installment}
          open={splitting}
          onOpenChange={setSplitting}
        />
      )}
      {gates.canCollect && proposal.kind === "receipt" && line.amount > 0 && (
        // A client found by the line's CUIT is the fiscal side's; without
        // one (an internal client has no CUIT) the user picks the side and
        // the client, or creates it from the picker.
        <CollectDialog
          initialClient={proposal.client}
          side={proposal.client ? "fiscal" : undefined}
          canEditRetentions={gates.canEditRetentions}
          fromBankLine={{
            date: line.line_date,
            amount: line.amount,
            account_id: accountId,
            channel_id: proposal.client ? fiscal || undefined : undefined,
            counterparty: proposal.client
              ? null
              : counterpartyOf(line.description),
          }}
          onCreated={(receiptId) =>
            matchToReceipt.mutate(
              { line_id: line.id, receipt_id: receiptId },
              {
                onSuccess: () =>
                  toast.success("Línea conciliada con el recibo."),
                onError: (err) =>
                  toast.error(
                    `El recibo se emitió pero la línea no se concilió: ${err.message}`,
                  ),
              },
            )
          }
          trigger={
            <Button type="button" size="sm" variant="outline" className="h-7">
              <FileText className="size-3.5" />
              Crear recibo
            </Button>
          }
        />
      )}
      {gates.canWrite &&
        (proposal.code === null ||
          (bankCodePosts(proposal.kind ?? "ignore") &&
            !proposal.code.chart_account_id)) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() =>
              onConfigure(
                proposal.code
                  ? draftOf(proposal.code)
                  : {
                      id: null,
                      bank_code: line.bank_code ?? "",
                      // With no code, the rule is the concept's fixed start.
                      description_pattern: line.bank_code
                        ? ""
                        : conceptOf(line.description),
                      kind: line.amount < 0 ? "tax" : "receipt",
                      chart_account_id: "",
                      label: line.description,
                    },
              )
            }
          >
            <Settings2 className="size-3.5" />
            {line.bank_code ? "Configurar código" : "Configurar concepto"}
          </Button>
        )}
    </div>
  );
}

/** "Aceptar todas": books every line whose code already says the account,
 *  except the ones a movement already loaded may explain (a suggestion):
 *  creating another would count the money twice. */
export function AcceptReadyButton({
  lines,
  proposals,
  suggested,
}: {
  lines: readonly StatementLine[];
  proposals: ReadonlyMap<string, LineProposal>;
  suggested: ReadonlySet<string>;
}) {
  const create = useCreateLineTransaction();
  const fiscal = useFiscalChannel();
  const [running, setRunning] = useState(false);
  const ready = lines.filter(
    (l) => proposals.get(l.id)?.ready && !suggested.has(l.id),
  );
  if (ready.length === 0) return null;

  async function run() {
    setRunning(true);
    let done = 0;
    const failed: string[] = [];
    for (const l of ready) {
      const accountId = proposals.get(l.id)?.code?.chart_account_id;
      if (!accountId) continue;
      try {
        await create.mutateAsync({
          line_id: l.id,
          channel_id: fiscal,
          expense_account_id: accountId,
          description: l.description,
        });
        done += 1;
      } catch (err) {
        failed.push(err instanceof Error ? err.message : String(err));
      }
    }
    setRunning(false);
    if (failed.length === 0) {
      toast.success(`${done} líneas registradas y conciliadas.`);
    } else {
      toast.error(`${done} registradas; ${failed.length} no: ${failed[0]}`);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={running || !fiscal}
      onClick={() => void run()}
    >
      <Check className="size-4" />
      {running
        ? "Registrando…"
        : `Aceptar impuestos y gastos (${ready.length})`}
    </Button>
  );
}

// ─── Codes dialog ────────────────────────────────────────────────────────────

export type CodeDraft = {
  id: string | null;
  bank_code: string;
  description_pattern: string;
  kind: BankCodeKind;
  chart_account_id: string;
  label: string;
};

function draftOf(c: BankStatementCode): CodeDraft {
  return {
    id: c.id,
    bank_code: c.bank_code,
    description_pattern: c.description_pattern,
    kind: c.kind,
    chart_account_id: c.chart_account_id ?? "",
    label: c.label ?? "",
  };
}

const EMPTY_DRAFT: CodeDraft = {
  id: null,
  bank_code: "",
  description_pattern: "",
  kind: "tax",
  chart_account_id: "",
  label: "",
};

/** "Códigos del banco": what each code of the account's statement is. */
export function BankCodesDialog({
  accountId,
  from,
  to,
  gates,
  open,
  onOpenChange,
  initialDraft,
}: {
  accountId: string;
  from: string;
  to: string;
  gates: ReconciliationGates;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens straight on this code's form. */
  initialDraft: CodeDraft | null;
}) {
  const coding = useStatementCoding(accountId, from, to);
  const preset = usePresetBankStatementCodes();
  const remove = useDeleteBankStatementCode();
  const [draft, setDraft] = useState<CodeDraft | null>(initialDraft);
  const codes = coding.data?.codes ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Códigos del banco</DialogTitle>
          <DialogDescription>
            Qué es cada código del extracto de esta cuenta. Un impuesto o un
            gasto bancario va a su cuenta contable (y a su lugar en Gestión); un
            cobro se convierte en recibo del cliente con el CUIT de la línea.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <CodeForm
            accountId={accountId}
            draft={draft}
            postingAccounts={coding.data?.posting_accounts ?? []}
            canManageChart={gates.canManageChart}
            onDone={() => setDraft(null)}
            onRefetch={() => void coding.refetch()}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {gates.canWrite && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft(EMPTY_DRAFT)}
                >
                  <Plus className="size-4" />
                  Agregar código
                </Button>
              )}
              {gates.canWrite &&
                BANK_CODE_PRESETS.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={preset.isPending}
                    onClick={() =>
                      preset.mutate(
                        { account_id: accountId, preset: p },
                        {
                          onSuccess: ({ inserted }) =>
                            toast.success(
                              inserted === 0
                                ? `Los códigos de ${BANK_CODE_PRESET_LABEL[p]} ya estaban.`
                                : `Se cargaron ${inserted} códigos de ${BANK_CODE_PRESET_LABEL[p]}.`,
                            ),
                          onError: (err) => toast.error(err.message),
                        },
                      )
                    }
                  >
                    Cargar códigos de {BANK_CODE_PRESET_LABEL[p]}
                  </Button>
                ))}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">Código</th>
                    <th className="px-3 py-2 text-left font-medium">Qué es</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Cuenta contable
                    </th>
                    {gates.canWrite && <th className="w-20" />}
                  </tr>
                </thead>
                <tbody>
                  {coding.isPending && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-muted-foreground px-3 py-4"
                      >
                        Cargando…
                      </td>
                    </tr>
                  )}
                  {coding.isError && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4">
                        {coding.error.message}
                      </td>
                    </tr>
                  )}
                  {coding.data && codes.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="text-muted-foreground px-3 py-4"
                      >
                        Todavía no hay códigos. Cargá los de Banco Macro o
                        agregá uno.
                      </td>
                    </tr>
                  )}
                  {codes.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">
                        {c.bank_code || "Por texto"}
                        {c.description_pattern && (
                          <span className="text-muted-foreground block font-sans">
                            dice «{c.description_pattern}»
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.label ?? "—"}
                        <span className="text-muted-foreground block text-xs">
                          {BANK_CODE_KIND_LABEL[c.kind]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {bankCodePosts(c.kind)
                          ? (c.chart_account_label ?? (
                              <span className="font-medium">Sin cuenta</span>
                            ))
                          : "—"}
                      </td>
                      {gates.canWrite && (
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <IconButton
                            label={`Editar el código ${c.bank_code || c.description_pattern}`}
                            variant="ghost"
                            onClick={() => setDraft(draftOf(c))}
                          >
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton
                            label={`Borrar el código ${c.bank_code || c.description_pattern}`}
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() =>
                              remove.mutate(c.id, {
                                onSuccess: () =>
                                  toast.success("Código borrado."),
                                onError: (err) => toast.error(err.message),
                              })
                            }
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CodeForm({
  accountId,
  draft,
  postingAccounts,
  canManageChart,
  onDone,
  onRefetch,
}: {
  accountId: string;
  draft: CodeDraft;
  postingAccounts: readonly PostingAccount[];
  canManageChart: boolean;
  onDone: () => void;
  onRefetch: () => void;
}) {
  const save = useSaveBankStatementCode();
  const [v, setV] = useState<CodeDraft>(draft);
  const [newAccount, setNewAccount] = useState(false);
  const posts = bankCodePosts(v.kind);
  const taxes = postingAccounts.filter((a) => a.group === "tax");
  const expenses = postingAccounts.filter((a) => a.group === "expense");

  function onSave() {
    save.mutate(
      {
        id: v.id,
        account_id: accountId,
        bank_code: v.bank_code,
        description_pattern: v.description_pattern,
        kind: v.kind,
        chart_account_id:
          posts && v.chart_account_id ? v.chart_account_id : null,
        label: v.label,
      },
      {
        onSuccess: () => {
          toast.success("Código guardado.");
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="code-bank-code">
            Código del banco (vacío si el banco no tiene)
          </Label>
          <Input
            id="code-bank-code"
            className="font-mono"
            value={v.bank_code}
            onChange={(e) => setV({ ...v, bank_code: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code-pattern">
            {v.bank_code.trim() === ""
              ? "El concepto dice (palabras enteras)"
              : "Solo si la descripción dice (palabras enteras, opcional)"}
          </Label>
          <Input
            id="code-pattern"
            placeholder="Ej. IVA BASICO"
            value={v.description_pattern}
            onChange={(e) =>
              setV({ ...v, description_pattern: e.target.value })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code-kind">Qué es</Label>
          <Select
            value={v.kind}
            onValueChange={(k) => {
              if (isBankCodeKind(k)) setV({ ...v, kind: k });
            }}
          >
            <SelectTrigger id="code-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BANK_CODE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {BANK_CODE_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code-label">Nombre</Label>
          <Input
            id="code-label"
            placeholder="Ej. SIRCREB"
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
          />
        </div>
        {posts && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="code-account">Cuenta contable</Label>
            <div className="flex flex-wrap gap-2">
              <Select
                value={v.chart_account_id || NONE}
                onValueChange={(id) =>
                  setV({ ...v, chart_account_id: id === NONE ? "" : id })
                }
              >
                <SelectTrigger id="code-account" className="min-w-0 flex-1">
                  <SelectValue placeholder="Elegí la cuenta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin cuenta</SelectItem>
                  {taxes.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Impuestos a favor</SelectLabel>
                      {taxes.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel>Gastos</SelectLabel>
                    {expenses.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {canManageChart && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewAccount(true)}
                >
                  <Plus className="size-4" />
                  Nueva cuenta
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              La cuenta define dónde cae en Gestión (por ejemplo, Impuestos o
              Gastos bancarios). Si no existe, creala acá.
            </p>
          </div>
        )}
      </div>
      {newAccount && (
        <Suspense fallback={null}>
          <NewChartAccount
            onClose={() => {
              setNewAccount(false);
              onRefetch();
            }}
          />
        </Suspense>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={
            save.isPending ||
            (v.bank_code.trim() === "" && v.description_pattern.trim() === "")
          }
          onClick={onSave}
        >
          {save.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function NewChartAccount({ onClose }: { onClose: () => void }) {
  const { data: accounts } = useChartOfAccounts();
  const parent = accounts.find((a) => a.code === "5.4");
  return (
    <ChartAccountDialog
      mode="create"
      parentSuggestion={parent}
      allAccounts={accounts}
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    />
  );
}

/** A line between two accounts of the company: pick the other one, and the
 *  transfer is booked and reconciled here, and on the other statement when
 *  it is loaded with one line of the same amount. */
function OwnTransfer({
  line,
  accountId,
  canReadAccounts,
}: {
  line: StatementLine;
  accountId: string;
  canReadAccounts: boolean;
}) {
  const { accounts, error, pending, retry } =
    useAccountOptions(canReadAccounts);
  const transfer = useTransferFromLine();
  const [other, setOther] = useState("");
  const own = accounts.find((a) => a.id === accountId);
  const options = accounts.filter(
    (a) =>
      a.is_active &&
      a.id !== accountId &&
      a.currency === own?.currency &&
      a.type !== "checks" &&
      a.type !== "echeq",
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={other} onValueChange={setOther}>
        <SelectTrigger className="h-7 w-48" aria-label="Otra cuenta">
          <SelectValue
            placeholder={
              line.amount < 0 ? "¿A qué cuenta fue?" : "¿De qué cuenta vino?"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={!other || transfer.isPending}
        onClick={() =>
          transfer.mutate(
            { line_id: line.id, other_account_id: other },
            {
              onSuccess: ({ other }) =>
                toast.success(
                  other === "matched"
                    ? "Transferencia registrada y conciliada en las dos cuentas."
                    : other === "several"
                      ? "Transferencia registrada. En la otra cuenta conciliala desde sus sugerencias."
                      : "Transferencia registrada. En la otra cuenta queda sugerida para conciliar cuando cargues su extracto.",
                ),
              onError: (err) => toast.error(err.message),
            },
          )
        }
      >
        <Check className="size-3.5" />
        Registrar transferencia
      </Button>
      {pending && accounts.length === 0 && (
        <span className="text-xs text-muted-foreground">Leyendo cuentas…</span>
      )}
      {error && (
        <span className="text-xs text-muted-foreground">
          {error}
          {retry && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-1"
              onClick={retry}
            >
              Reintentar
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
