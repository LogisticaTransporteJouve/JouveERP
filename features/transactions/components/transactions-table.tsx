"use client";

import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Link2,
  MoreHorizontal,
  Pencil,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";

import { ExportButton } from "@/components/export-button";
import { ListPending, ListToolbar } from "@/components/list-toolbar";
import { PeriodFilter } from "@/components/period-filter";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TransactionListItem } from "@/features/transactions/actions/transactions-actions";
import { useAccountOptions } from "@/features/accounts/hooks/use-accounts";
import { AccountOptionsError } from "@/features/accounts/components/account-options-gate";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useListParams } from "@/hooks/use-list-params";
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { toast } from "sonner";

import {
  useDeleteTransaction,
  useTransactionsList,
} from "../hooks/use-transactions";
import { transactionsKeys } from "../lib/transactions-keys";
import {
  DEFAULT_TRANSACTION_LIST_PARAMS,
  transactionListFilters,
  transactionListParamsToUrl,
  type TransactionListParams,
} from "../lib/transaction-list-filters";
import {
  RECONCILED_FILTERS,
  RECONCILED_FILTER_LABEL,
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABEL,
  isReconciledFilter,
  isTransactionKind,
  type TransactionFilters,
  type TransactionKind,
} from "../schema";
import { EditTransactionDialog } from "./edit-transaction-dialog";
import {
  RecategorizeExpenseDialog,
  type RecategorizableExpense,
} from "@/features/cost-centers/components/recategorize-expense-dialog";
import { EmployeeCashDialog } from "@/features/hr/components/employee-cash-dialog";
import { PayDialog } from "@/features/payment-orders/components/pay-dialog";
import { CollectDialog } from "@/features/receipts/components/collect-dialog";

import { NewTransactionDialog } from "./new-transaction-dialog";
import type { ChannelOption } from "./transaction-form";

const ANY_ACCOUNT = "__any_account__";
const ANY_KIND = "__any_kind__";
const ANY_RECONCILED = "__any_reconciled__";

// Money formatter centralizado en lib/format (formatMoney).

const KIND_TONE: Record<TransactionKind, string> = {
  income: "bg-muted text-muted-foreground dark:text-muted-foreground",
  expense: "bg-muted text-foreground dark:text-foreground",
  transfer_in: "bg-muted text-muted-foreground dark:text-muted-foreground",
  transfer_out: "bg-muted text-muted-foreground dark:text-muted-foreground",
};

const KIND_ICON: Record<TransactionKind, typeof ArrowUpCircle> = {
  income: ArrowDownCircle,
  expense: ArrowUpCircle,
  transfer_in: ArrowLeftRight,
  transfer_out: ArrowLeftRight,
};

type RowActions = {
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (tx: TransactionListItem) => void;
  onRecategorize: (tx: TransactionListItem) => void;
  onDelete: (tx: TransactionListItem) => void;
};

/** A movement a document owns (receipt, payment order, invoice, payroll,
 *  loan installment, check, own check cashed, account opening balance) is
 *  changed from that document, never here: the database refuses it. A
 *  transfer is edited as a pair (delete removes both). */
function editable(tx: TransactionListItem): boolean {
  return tx.source_document === null && tx.transfer_pair_id === null;
}
/** A reconciled movement is not deleted until its statement line is
 *  unmatched (guard_transaction_reconciled). */
function deletable(tx: TransactionListItem): boolean {
  return tx.source_document === null && !tx.reconciled;
}
/** A manual expense: its expense account and cost center can change even
 *  when it is reconciled. */
function recategorizable(tx: TransactionListItem): boolean {
  return tx.kind === "expense" && editable(tx);
}

function toRecategorizable(tx: TransactionListItem): RecategorizableExpense {
  return {
    source: "transactions",
    id: tx.id,
    label: [
      formatArgentineDate(tx.transaction_date),
      tx.description || tx.account_name,
      formatMoney(Number(tx.amount), tx.currency),
    ].join(" · "),
    expense_account_id: tx.expense_account_id,
    cost_center_id: tx.cost_center_id,
  };
}

function useTransactionColumns(
  actions: RowActions,
): ColumnDef<TransactionListItem>[] {
  const { canEdit, canDelete, onEdit, onRecategorize, onDelete } = actions;
  return useMemo(
    () => [
      {
        id: "transaction_date",
        header: "Fecha",
        enableSorting: false,
        meta: { headerClassName: "w-32", mobile: "primary" },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatArgentineDate(row.original.transaction_date)}
          </span>
        ),
      },
      {
        id: "kind",
        header: "Tipo",
        enableSorting: false,
        meta: { headerClassName: "w-36", mobile: "secondary" },
        cell: ({ row }) => {
          const Icon = KIND_ICON[row.original.kind];
          return (
            <Badge
              variant="secondary"
              className={`gap-1 ${KIND_TONE[row.original.kind]}`}
            >
              <Icon className="size-3" />
              {TRANSACTION_KIND_LABEL[row.original.kind]}
            </Badge>
          );
        },
      },
      {
        id: "account_name",
        header: "Cuenta",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <Link
            href={`/accounts/${row.original.account_id}`}
            className="text-sm hover:underline"
            title="Ver la cuenta"
          >
            {row.original.account_name}
          </Link>
        ),
      },
      {
        id: "channel_name",
        header: "Canal",
        enableSorting: false,
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.channel_name}
          </span>
        ),
      },
      {
        id: "description",
        header: "Descripción",
        enableSorting: false,
        meta: {
          cellClassName: "max-w-[260px] truncate text-sm",
          mobile: "primary",
        },
        cell: ({ row }) => (
          <>
            {row.original.description ?? (
              <span className="text-muted-foreground">—</span>
            )}
            {row.original.counterparty_legal_name && (
              <span className="block text-xs text-muted-foreground">
                {row.original.counterparty_legal_name}
              </span>
            )}
            {row.original.reconciled && (
              <Badge
                variant="outline"
                className="mt-0.5 gap-1 text-xs font-normal"
                title="Conciliado con el extracto: se desconcilia en Tesorería › Conciliación"
              >
                <Link2 className="size-3" />
                Conciliado
              </Badge>
            )}
          </>
        ),
      },
      ...(["debit", "credit"] as const).map((side) => ({
        id: side,
        header: side === "debit" ? "Debe" : "Haber",
        enableSorting: false,
        meta: {
          align: "right" as const,
          cellClassName: "font-mono text-sm",
          mobile: "primary" as const,
        },
        cell: ({ row }: { row: { original: TransactionListItem } }) => {
          const isOutflow =
            row.original.kind === "expense" ||
            row.original.kind === "transfer_out";
          if (isOutflow !== (side === "credit")) return null;
          return formatMoney(
            Number(row.original.amount),
            row.original.currency,
          );
        },
      })),
      {
        id: "balance_after",
        header: "Saldo",
        enableSorting: false,
        meta: {
          align: "right",
          cellClassName: "font-mono text-sm text-muted-foreground",
          mobile: "secondary",
        },
        cell: ({ row }) =>
          row.original.balance_after === null
            ? null
            : formatMoney(row.original.balance_after, row.original.currency),
      },
      ...(canEdit || canDelete
        ? [
            {
              id: "actions",
              header: "",
              enableSorting: false,
              meta: { headerClassName: "w-12", align: "right" as const },
              cell: ({ row }: { row: { original: TransactionListItem } }) => {
                const tx = row.original;
                const showEdit = canEdit && editable(tx);
                const showRecategorize = canEdit && recategorizable(tx);
                const showDelete = canDelete && deletable(tx);
                if (!showEdit && !showDelete) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        label="Acciones del movimiento"
                        variant="ghost"
                      >
                        <MoreHorizontal className="size-4" />
                      </IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {showEdit && (
                        <DropdownMenuItem onClick={() => onEdit(tx)}>
                          <Pencil className="size-4" />
                          Editar
                        </DropdownMenuItem>
                      )}
                      {showRecategorize && (
                        <DropdownMenuItem onClick={() => onRecategorize(tx)}>
                          <Tags className="size-4" />
                          Recategorizar
                        </DropdownMenuItem>
                      )}
                      {showDelete && (
                        <DropdownMenuItem onClick={() => onDelete(tx)}>
                          <Trash2 className="size-4" />
                          Borrar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              },
            } satisfies ColumnDef<TransactionListItem>,
          ]
        : []),
    ],
    [canEdit, canDelete, onEdit, onRecategorize, onDelete],
  );
}

export function TransactionsTable({
  channels,
  actorAccess,
  initialParams,
  fixedAccountId,
}: {
  channels: ChannelOption[];
  actorAccess: Access;
  initialParams: TransactionListParams;
  /** Shown inside an account's page: always that account, and no account
   *  or reconciliation filter (the statement tab reconciles). */
  fixedAccountId?: string;
}) {
  const defaults = useMemo(
    () =>
      fixedAccountId
        ? {
            ...DEFAULT_TRANSACTION_LIST_PARAMS,
            accountId: fixedAccountId,
            period: { preset: "this_month" as const, from: null, to: null },
          }
        : DEFAULT_TRANSACTION_LIST_PARAMS,
    [fixedAccountId],
  );
  const { params, committed, update, reset, isFiltered } = useListParams({
    initial: initialParams,
    defaults,
    toUrl: transactionListParamsToUrl,
  });
  const isFiscal = useScopeIsFiscal();
  const filters = useMemo(
    () => transactionListFilters(committed, isFiscal),
    [committed, isFiscal],
  );
  const deferredFilters = useDeferredValue(filters);

  const canWrite = userCan(actorAccess, "transactions:write");
  const canDelete = userCan(actorAccess, "transactions:delete");
  // A per-user deny of accounts:read hides what picks an account (the
  // account filter, Cobrar, Pagar, Adelanto, Nuevo), not the movements.
  const canPickAccount = userCan(actorAccess, "accounts:read");
  const canCollect = canPickAccount && userCan(actorAccess, "receipts:write");
  const canEditRetentions = userCan(actorAccess, "retentions:write");
  const canPay = canPickAccount && userCan(actorAccess, "payment_orders:write");
  const canAdvance =
    canPickAccount && canWrite && userCan(actorAccess, "hr:write");
  const confirm = useConfirm();
  const deleteMut = useDeleteTransaction();
  const [editing, setEditing] = useState<TransactionListItem | null>(null);
  const [recategorizing, setRecategorizing] =
    useState<RecategorizableExpense | null>(null);
  const onRecategorize = useCallback(
    (tx: TransactionListItem) => setRecategorizing(toRecategorizable(tx)),
    [],
  );

  const onDelete = useCallback(
    async (tx: TransactionListItem) => {
      const ok = await confirm({
        title: "Borrar movimiento",
        description:
          tx.transfer_pair_id !== null
            ? "Es una transferencia: se borran los dos movimientos. Esta acción no se puede deshacer."
            : "Esta acción no se puede deshacer.",
        confirmLabel: "Borrar",
        tone: "destructive",
      });
      if (!ok) return;
      deleteMut.mutate(tx.id, {
        onSuccess: () => toast.success("Movimiento borrado."),
        onError: (err) => toast.error(err.message),
      });
    },
    [confirm, deleteMut],
  );

  const allColumns = useTransactionColumns({
    canEdit: canWrite,
    canDelete,
    onEdit: setEditing,
    onRecategorize,
    onDelete,
  });
  const columns = useMemo(
    () =>
      allColumns.filter((c) =>
        fixedAccountId ? c.id !== "account_name" : c.id !== "balance_after",
      ),
    [allColumns, fixedAccountId],
  );

  // Realtime: any transaction insert/update/delete invalidates every
  // filter combo so saldos and movements stay in sync across tabs.
  useRealtimeInvalidate([
    {
      table: "transactions",
      queryKeys: [transactionsKeys.all],
    },
  ]);

  return (
    <>
      <ListToolbar
        isFiltered={isFiltered}
        onClear={reset}
        actions={
          <>
            <ExportButton resource="transactions" />
            {canCollect && (
              <CollectDialog canEditRetentions={canEditRetentions} />
            )}
            {canPay && <PayDialog />}
            {canAdvance && <EmployeeCashDialog kind="advance" />}
            {canAdvance && <EmployeeCashDialog kind="loan" />}
            {canWrite && canPickAccount && (
              <NewTransactionDialog
                channels={channels}
                canCollect={canCollect}
                canPay={canPay}
                canEditRetentions={canEditRetentions}
              />
            )}
          </>
        }
      >
        {params.id && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => update({ id: null })}
            title="Mostrar todos los movimientos"
          >
            Un solo movimiento
            <X className="size-4" />
          </Button>
        )}
        <PeriodFilter
          value={params.period}
          onChange={(period) => update({ period })}
        />
        {canPickAccount && !fixedAccountId && (
          <AccountFilter
            value={params.accountId ?? ANY_ACCOUNT}
            onChange={(v) =>
              update({ accountId: v === ANY_ACCOUNT ? null : v })
            }
          />
        )}
        <Select
          value={params.kind ?? ANY_KIND}
          onValueChange={(v) =>
            update({ kind: isTransactionKind(v) ? v : null })
          }
        >
          <SelectTrigger className="w-[200px]" aria-label="Tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY_KIND}>Cualquier tipo</SelectItem>
            {TRANSACTION_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {TRANSACTION_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!fixedAccountId && (
          <Select
            value={params.reconciled ?? ANY_RECONCILED}
            onValueChange={(v) =>
              update({ reconciled: isReconciledFilter(v) ? v : null })
            }
          >
            <SelectTrigger className="w-[200px]" aria-label="Conciliación">
              <SelectValue placeholder="Conciliación" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={ANY_RECONCILED}>Conciliados o no</SelectItem>
              {RECONCILED_FILTERS.map((r) => (
                <SelectItem key={r} value={r}>
                  {RECONCILED_FILTER_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </ListToolbar>

      <div className="mt-4">
        <Suspense
          fallback={<DataTable columns={columns} data={[]} isLoading />}
        >
          <ListPending pending={deferredFilters !== filters}>
            <TransactionsTableRows
              columns={columns}
              filters={deferredFilters}
            />
          </ListPending>
        </Suspense>
      </div>

      <EditTransactionDialog
        transaction={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
      <RecategorizeExpenseDialog
        expense={recategorizing}
        onOpenChange={(open) => {
          if (!open) setRecategorizing(null);
        }}
      />
    </>
  );
}

function AccountFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { accounts, error, retry } = useAccountOptions();
  if (error) return <AccountOptionsError message={error} onRetry={retry} />;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]" aria-label="Cuenta">
        <SelectValue placeholder="Cuenta" />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={ANY_ACCOUNT}>Todas las cuentas</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TransactionsTableRows({
  columns,
  filters,
}: {
  columns: ColumnDef<TransactionListItem>[];
  filters: TransactionFilters;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTransactionsList(filters);

  const sentinelRef = useIntersectionObserver<HTMLDivElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(row) => row.id}
      emptyMessage="No hay movimientos que coincidan."
      footer={
        hasNextPage ? (
          <div
            ref={sentinelRef}
            className="py-4 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </div>
        ) : null
      }
    />
  );
}
