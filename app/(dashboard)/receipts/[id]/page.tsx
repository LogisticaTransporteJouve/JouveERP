import { FileDown } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import {
  ACCOUNT_TYPE_LABEL,
  type AccountNameJoin,
  type AccountType,
} from "@/features/accounts/schema";
import type { InvoiceRefJoin } from "@/features/invoices/schema";
import { getReceiptByIdAction } from "@/features/receipts/actions/receipts-actions";
import { formatReceiptNumber } from "@/features/receipts/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate, formatMoneyWithCode } from "@/lib/format";

export const dynamic = "force-dynamic";

const money = formatMoneyWithCode;

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const res = await getReceiptByIdAction(id);
  if (!res.ok) notFound();
  if (!res.data) notFound();

  const { receipt, payment_lines, allocations, retentions } = res.data;
  const number = formatReceiptNumber(receipt.punto_venta, receipt.numero);
  const isCanceled = receipt.status === "canceled";

  const paymentSum = payment_lines.reduce((a, l) => a + Number(l.amount), 0);
  const retentionSum = retentions.reduce((a, r) => a + Number(r.amount), 0);
  const allocatedSum = allocations.reduce(
    (a, x) => a + Number(x.amount_applied),
    0,
  );
  const total = Number(receipt.total_amount);
  const aCuenta = total - allocatedSum;

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/receipts">Recibos</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{number}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Recibo{" "}
            <span className="font-mono text-base text-muted-foreground">
              {number}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatArgentineDate(receipt.receipt_date)}
            {isCanceled && (
              <Badge
                variant="secondary"
                className="ml-2 bg-muted text-foreground dark:text-foreground"
              >
                Anulado
              </Badge>
            )}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href={`/api/receipts/${receipt.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileDown />
            PDF
          </a>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="text-sm font-medium">Medios de pago</h2>
          {payment_lines.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Sin líneas de pago.
            </p>
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              {payment_lines.map((l) => {
                const account = (l as unknown as AccountNameJoin).account;
                const typeLabel =
                  account?.type &&
                  ACCOUNT_TYPE_LABEL[account.type as AccountType];
                return (
                  <div
                    key={l.id}
                    className="flex items-center justify-between border-b py-1 last:border-b-0"
                  >
                    <span>
                      <span className="font-medium">
                        {account?.name ?? "—"}
                      </span>
                      {typeLabel && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          · {typeLabel}
                        </span>
                      )}
                      {l.reference && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          · {l.reference}
                        </span>
                      )}
                    </span>
                    <span className="font-mono">
                      {money(Number(l.amount), receipt.currency)}
                    </span>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Totales</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row
              label="Pago real"
              value={money(paymentSum, receipt.currency)}
            />
            <Row
              label="Retenciones"
              value={money(retentionSum, receipt.currency)}
            />
            <Row
              label="Total"
              value={money(total, receipt.currency)}
              emphasize
            />
            <Row
              label="Imputado"
              value={money(allocatedSum, receipt.currency)}
            />
            <Row label="A cuenta" value={money(aCuenta, receipt.currency)} />
          </dl>
        </div>
      </div>

      {retentions.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Retenciones / Percepciones</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {retentions.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border-b py-1 last:border-b-0"
              >
                <span>
                  <span className="font-medium">{r.kind}</span> · {r.tax_type}
                  {r.jurisdiction && ` · ${r.jurisdiction}`} ·{" "}
                  <span className="text-muted-foreground">
                    Cert. {r.certificate_number}
                  </span>
                </span>
                <span className="font-mono">
                  {money(Number(r.amount), receipt.currency)}
                </span>
              </div>
            ))}
          </dl>
        </div>
      )}

      {allocations.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Imputaciones</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {allocations.map((a) => {
              const inv = (a as unknown as InvoiceRefJoin).invoice;
              const pos = String(inv?.punto_venta ?? 0).padStart(4, "0");
              const num = String(inv?.numero ?? 0).padStart(8, "0");
              const letter = inv?.letter ?? "";
              const label =
                inv?.kind === "factura"
                  ? `Factura ${letter} ${pos}-${num}`
                  : inv?.kind === "credit_note"
                    ? `NC ${letter} ${pos}-${num}`
                    : inv?.kind === "debit_note"
                      ? `ND ${letter} ${pos}-${num}`
                      : `${pos}-${num}`;
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between border-b py-1 last:border-b-0"
                >
                  <span>
                    <span className="font-medium">
                      {label.trim().replace(/\s+/g, " ")}
                    </span>
                    {inv?.fecha && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · {formatArgentineDate(inv.fecha)}
                      </span>
                    )}
                  </span>
                  <span className="font-mono">
                    {money(Number(a.amount_applied), receipt.currency)}
                  </span>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {receipt.notes && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Notas</h2>
          <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
            {receipt.notes}
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Adjuntos</h2>
        <div className="mt-3">
          <AttachmentsZone
            targetType="receipt"
            targetId={receipt.id}
            canWrite={userCan(ctx.access, "files:write")}
            canDelete={userCan(ctx.access, "files:write")}
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        emphasize ? "border-t border-b py-1 font-semibold" : ""
      }`}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
