"use client";

import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
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
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { useScopeIsFiscal } from "@/components/providers/scope-provider";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
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
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABEL,
  type TransactionKind,
} from "../schema";
import { EditTransactionDialog } from "./edit-transaction-dialog";
import { NewTransactionDialog } from "./new-transaction-dialog";
import type { ChannelOption } from "./transaction-form";

const ANY_ACCOUNT = "__any_account__";
const ANY_KIND = "__any_kind__";

// Money formatter centralizado en lib/format (formatMoney).

const KIND_TONE: Record<TransactionKind, string> = {
  income: "bg-muted text-muted-foreground dark:text-muted-foreground",
  expense: "bg-muted text-foreground dark:text-foreground",
  transfer_in: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  transfer_out: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
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
  onDelete: (tx: TransactionListItem) => void;
};

/** A movement a document owns (receipt, payment order, invoice, payroll,
 *  loan installment, check, own check cashed, account opening balance) is
 *  changed from that document, never here: the database refuses it. A
 *  transfer is edited as a pair (delete removes both). */
function editable(tx: TransactionListItem): boolean {
  return tx.source_document === null && tx.transfer_pair_id === null;
}
function deletable(tx: TransactionListItem): boolean {
  return tx.source_document === null;
}

function useTransactionColumns(
  actions: RowActions,
): ColumnDef<TransactionListItem>[] {
  const { canEdit, canDelete, onEdit, onDelete } = actions;
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
            href={`/transactions?account=${row.original.account_id}`}
            className="text-sm hover:underline"
            title="Filtrar por esta cuenta"
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
          </>
        ),
      },
      {
        id: "amount",
        header: "Monto",
        enableSorting: false,
        meta: {
          align: "right",
          cellClassName: "font-mono text-sm",
          mobile: "primary",
        },
        cell: ({ row }) => {
          const isOutflow =
            row.original.kind === "expense" ||
            row.original.kind === "transfer_out";
          const sign = isOutflow ? -1 : 1;
          return (
            <span
              className={
                isOutflow
                  ? "text-foreground dark:text-foreground"
                  : "text-muted-foreground dark:text-muted-foreground"
              }
            >
              {sign < 0 ? "-" : "+"}
              {formatMoney(Number(row.original.amount), row.original.currency)}
            </span>
          );
        },
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
                const showDelete = canDelete && deletable(tx);
                if (!showEdit && !showDelete) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Acciones del movimiento"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {showEdit && (
                        <DropdownMenuItem onClick={() => onEdit(tx)}>
                          <Pencil className="size-4" />
                          Editar
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
    [canEdit, canDelete, onEdit, onDelete],
  );
}

export function TransactionsTable({
  channels,
  actorAccess,
  initialAccount,
  initialKind,
  initialDateFrom,
  initialDateTo,
}: {
  channels: ChannelOption[];
  actorAccess: Access;
  initialAccount: string | null;
  initialKind: TransactionKind | null;
  initialDateFrom: string | null;
  initialDateTo: string | null;
}) {
  const [accountInput, setAccountInput] = useState(
    initialAccount ?? ANY_ACCOUNT,
  );
  const [kindInput, setKindInput] = useState<string>(initialKind ?? ANY_KIND);
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");

  const setUrlFilters = useUrlFilter();

  const account = accountInput === ANY_ACCOUNT ? null : accountInput;
  const kind = kindInput === ANY_KIND ? null : (kindInput as TransactionKind);

  const isFiscal = useScopeIsFiscal();
  const deferredAccount = useDeferredValue(account);
  const deferredKind = useDeferredValue(kind);
  const deferredDateFrom = useDeferredValue(dateFrom);
  const deferredDateTo = useDeferredValue(dateTo);

  const canWrite = userCan(actorAccess, "transactions:write");
  const canDelete = userCan(actorAccess, "transactions:delete");
  const confirm = useConfirm();
  const deleteMut = useDeleteTransaction();
  const [editing, setEditing] = useState<TransactionListItem | null>(null);

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

  const columns = useTransactionColumns({
    canEdit: canWrite,
    canDelete,
    onEdit: setEditing,
    onDelete,
  });

  // Realtime: any transaction insert/update/delete invalidates every
  // filter combo so saldos and movements stay in sync across tabs.
  useRealtimeInvalidate([
    {
      table: "transactions",
      queryKeys: [transactionsKeys.all],
    },
  ]);

  useEffect(() => {
    setUrlFilters({
      account: account ?? null,
      kind: kind ?? null,
      from: dateFrom || null,
      to: dateTo || null,
    });
  }, [account, kind, dateFrom, dateTo, setUrlFilters]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <AccountFilter value={accountInput} onChange={setAccountInput} />

        <Select value={kindInput} onValueChange={setKindInput}>
          <SelectTrigger className="w-[200px]">
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

        <DateRange
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
        />

        {canWrite && (
          <div className="ml-auto">
            <NewTransactionDialog channels={channels} />
          </div>
        )}
      </div>

      <div className="mt-4">
        <Suspense
          fallback={<DataTable columns={columns} data={[]} isLoading />}
        >
          <TransactionsTableRows
            columns={columns}
            isFiscal={isFiscal}
            accountId={deferredAccount}
            kind={deferredKind}
            dateFrom={deferredDateFrom || null}
            dateTo={deferredDateTo || null}
          />
        </Suspense>
      </div>

      <EditTransactionDialog
        transaction={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
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
  const { data: accounts } = useAccountsList();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]">
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

function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <DatePicker
        value={from}
        onChange={(v) => onChange(v, to)}
        placeholder="Desde"
        className="w-[170px]"
        clearable
      />
      <span className="text-xs text-muted-foreground">→</span>
      <DatePicker
        value={to}
        onChange={(v) => onChange(from, v)}
        placeholder="Hasta"
        className="w-[170px]"
        clearable
      />
    </div>
  );
}

function TransactionsTableRows({
  columns,
  isFiscal,
  accountId,
  kind,
  dateFrom,
  dateTo,
}: {
  columns: ColumnDef<TransactionListItem>[];
  isFiscal: boolean | null;
  accountId: string | null;
  kind: TransactionKind | null;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTransactionsList({
      is_fiscal: isFiscal,
      account_id: accountId,
      kind,
      date_from: dateFrom,
      date_to: dateTo,
    });

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
