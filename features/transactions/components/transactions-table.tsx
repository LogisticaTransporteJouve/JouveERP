"use client";

import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type ColumnDef,
} from "@/components/ui/data-table";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TransactionListItem } from "@/features/transactions/actions/transactions-actions";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import { useTransactionsList } from "../hooks/use-transactions";
import { transactionsKeys } from "../lib/transactions-keys";
import {
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABEL,
  type TransactionKind,
} from "../schema";
import { NewTransactionDialog } from "./new-transaction-dialog";
import type { ChannelOption } from "./transaction-form";

const ANY_CHANNEL = "__any_channel__";
const ANY_ACCOUNT = "__any_account__";
const ANY_KIND = "__any_kind__";

// Money formatter centralizado en lib/format (formatMoney).

const KIND_TONE: Record<TransactionKind, string> = {
  income: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  expense: "bg-red-500/15 text-red-700 dark:text-red-300",
  transfer_in: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  transfer_out: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

const KIND_ICON: Record<TransactionKind, typeof ArrowUpCircle> = {
  income: ArrowDownCircle,
  expense: ArrowUpCircle,
  transfer_in: ArrowLeftRight,
  transfer_out: ArrowLeftRight,
};

function useTransactionColumns(): ColumnDef<TransactionListItem>[] {
  return useMemo(
    () => [
      {
        id: "transaction_date",
        header: "Fecha",
        enableSorting: false,
        meta: { headerClassName: "w-32" },
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
        meta: { headerClassName: "w-36" },
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
        meta: { cellClassName: "max-w-[260px] truncate text-sm" },
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
        meta: { align: "right", cellClassName: "font-mono text-sm" },
        cell: ({ row }) => {
          const isOutflow =
            row.original.kind === "expense" ||
            row.original.kind === "transfer_out";
          const sign = isOutflow ? -1 : 1;
          return (
            <span
              className={
                isOutflow
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {sign < 0 ? "-" : "+"}
              {formatMoney(Number(row.original.amount), row.original.currency)}
            </span>
          );
        },
      },
    ],
    [],
  );
}

export function TransactionsTable({
  channels,
  actorRoles,
  initialChannel,
  initialAccount,
  initialKind,
  initialDateFrom,
  initialDateTo,
}: {
  channels: ChannelOption[];
  actorRoles: Role[];
  initialChannel: string | null;
  initialAccount: string | null;
  initialKind: TransactionKind | null;
  initialDateFrom: string | null;
  initialDateTo: string | null;
}) {
  const [channelInput, setChannelInput] = useState(
    initialChannel ?? ANY_CHANNEL,
  );
  const [accountInput, setAccountInput] = useState(
    initialAccount ?? ANY_ACCOUNT,
  );
  const [kindInput, setKindInput] = useState<string>(initialKind ?? ANY_KIND);
  const [dateFrom, setDateFrom] = useState(initialDateFrom ?? "");
  const [dateTo, setDateTo] = useState(initialDateTo ?? "");

  const setUrlFilters = useUrlFilter();

  const channel = channelInput === ANY_CHANNEL ? null : channelInput;
  const account = accountInput === ANY_ACCOUNT ? null : accountInput;
  const kind =
    kindInput === ANY_KIND ? null : (kindInput as TransactionKind);

  const deferredChannel = useDeferredValue(channel);
  const deferredAccount = useDeferredValue(account);
  const deferredKind = useDeferredValue(kind);
  const deferredDateFrom = useDeferredValue(dateFrom);
  const deferredDateTo = useDeferredValue(dateTo);

  const canWrite = userCan(actorRoles, "transactions:write");

  const columns = useTransactionColumns();

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
      channel: channel ?? null,
      account: account ?? null,
      kind: kind ?? null,
      from: dateFrom || null,
      to: dateTo || null,
    });
  }, [channel, account, kind, dateFrom, dateTo, setUrlFilters]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={channelInput} onValueChange={setChannelInput}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={ANY_CHANNEL}>Todos los canales</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
            channelId={deferredChannel}
            accountId={deferredAccount}
            kind={deferredKind}
            dateFrom={deferredDateFrom || null}
            dateTo={deferredDateTo || null}
          />
        </Suspense>
      </div>
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
    <div className="flex items-center gap-1">
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
  channelId,
  accountId,
  kind,
  dateFrom,
  dateTo,
}: {
  columns: ColumnDef<TransactionListItem>[];
  channelId: string | null;
  accountId: string | null;
  kind: TransactionKind | null;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTransactionsList({
      channel_id: channelId,
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
