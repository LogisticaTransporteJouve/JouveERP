"use client";

import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight } from "lucide-react";
import { Suspense, useDeferredValue, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useUrlFilter } from "@/hooks/use-url-filter";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

import { useTransactionsList } from "../hooks/use-transactions";
import { transactionsKeys } from "../lib/transactions-keys";
import {
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABEL,
  type TransactionCurrency,
  type TransactionKind,
} from "../schema";
import { NewTransactionDialog } from "./new-transaction-dialog";
import type { ChannelOption } from "./transaction-form";

const ANY_CHANNEL = "__any_channel__";
const ANY_ACCOUNT = "__any_account__";
const ANY_KIND = "__any_kind__";

const formatters: Record<TransactionCurrency, Intl.NumberFormat> = {
  ARS: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }),
  USD: new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }),
};

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

      <div className="mt-4 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Fecha</TableHead>
              <TableHead className="w-36">Tipo</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="text-right">Monto</TableHead>
            </TableRow>
          </TableHeader>
          <Suspense fallback={<TransactionsTableSkeletonRows />}>
            <TransactionsTableRows
              channelId={deferredChannel}
              accountId={deferredAccount}
              kind={deferredKind}
              dateFrom={deferredDateFrom || null}
              dateTo={deferredDateTo || null}
            />
          </Suspense>
        </Table>
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
  channelId,
  accountId,
  kind,
  dateFrom,
  dateTo,
}: {
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

  const sentinelRef = useIntersectionObserver<HTMLTableRowElement>(
    () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    { rootMargin: "200px", enabled: hasNextPage && !isFetchingNextPage },
  );

  if (items.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell
            colSpan={6}
            className="py-10 text-center text-sm text-muted-foreground"
          >
            No hay movimientos que coincidan.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {items.map((row) => {
        const Icon = KIND_ICON[row.kind];
        const isOutflow = row.kind === "expense" || row.kind === "transfer_out";
        const sign = isOutflow ? -1 : 1;
        const formatter = formatters[row.currency];
        return (
          <TableRow key={row.id}>
            <TableCell className="text-sm text-muted-foreground">
              {formatArgentineDate(row.transaction_date)}
            </TableCell>
            <TableCell>
              <Badge variant="secondary" className={`gap-1 ${KIND_TONE[row.kind]}`}>
                <Icon className="size-3" />
                {TRANSACTION_KIND_LABEL[row.kind]}
              </Badge>
            </TableCell>
            <TableCell className="text-sm">{row.account_name}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {row.channel_name}
            </TableCell>
            <TableCell className="max-w-[260px] truncate text-sm">
              {row.description ?? (
                <span className="text-muted-foreground">—</span>
              )}
              {row.counterparty_legal_name && (
                <span className="block text-xs text-muted-foreground">
                  {row.counterparty_legal_name}
                </span>
              )}
            </TableCell>
            <TableCell className="text-right font-mono text-sm">
              <span
                className={
                  isOutflow
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }
              >
                {sign < 0 ? "-" : "+"}
                {formatter.format(Number(row.amount))}
              </span>
            </TableCell>
          </TableRow>
        );
      })}
      {hasNextPage && (
        <TableRow ref={sentinelRef}>
          <TableCell
            colSpan={6}
            className="py-3 text-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? "Cargando más…" : ""}
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}

function TransactionsTableSkeletonRows() {
  return (
    <TableBody>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}
