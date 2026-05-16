import { FileDown } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  ACCOUNT_TYPE_LABEL,
  type AccountType,
} from "@/features/accounts/schema";
import { getPaymentOrderByIdAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { formatPaymentOrderNumber } from "@/features/payment-orders/schema";
import {
  PURCHASE_INVOICE_KIND_LABEL,
  formatInvoiceNumber,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceLetter,
} from "@/features/purchase-invoices/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n: number, currency: string) => `${currency} ${fmt.format(n)}`;

export default async function PaymentOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "payment_orders:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const res = await getPaymentOrderByIdAction(id);
  if (!res.ok || !res.data) notFound();

  const { paymentOrder, payment_lines, allocations } = res.data;
  const number = formatPaymentOrderNumber(
    paymentOrder.punto_venta,
    paymentOrder.numero,
  );
  const isCancelled = paymentOrder.status === "canceled";
  const total = Number(paymentOrder.total_amount);
  const paySum = payment_lines.reduce((a, l) => a + Number(l.amount), 0);
  const allocSum = allocations.reduce(
    (a, x) => a + Number(x.amount_applied),
    0,
  );
  const aCuenta = total - allocSum;

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/payment-orders">
              Órdenes de pago
            </BreadcrumbLink>
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
            Orden de pago{" "}
            <span className="font-mono text-base text-muted-foreground">
              {number}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatArgentineDate(paymentOrder.payment_date)}
            {isCancelled && (
              <Badge
                variant="secondary"
                className="ml-2 bg-red-500/15 text-red-700 dark:text-red-300"
              >
                Anulada
              </Badge>
            )}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href={`/api/payment-orders/${paymentOrder.id}/pdf`}
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
          <h2 className="text-sm font-medium">Proveedor</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row
              label="Razón social"
              value={
                <Link
                  href={`/suppliers/${paymentOrder.supplier_id}`}
                  className="font-medium hover:underline"
                >
                  {paymentOrder.supplier_legal_name}
                </Link>
              }
            />
            {paymentOrder.supplier_cuit && (
              <Row label="CUIT" value={paymentOrder.supplier_cuit} mono />
            )}
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Totales</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row label="Pago real" value={money(paySum, paymentOrder.currency)} />
            <Row
              label="Total"
              value={money(total, paymentOrder.currency)}
              emphasize
            />
            <Row label="Imputado" value={money(allocSum, paymentOrder.currency)} />
            <Row
              label="A cuenta"
              value={money(aCuenta, paymentOrder.currency)}
            />
          </dl>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Medios de pago</h2>
        {payment_lines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Sin líneas de pago.
          </p>
        ) : (
          <dl className="mt-3 space-y-2 text-sm">
            {payment_lines.map((l) => {
              const account = (
                l as unknown as {
                  account: { name: string; type: string } | null;
                }
              ).account;
              const typeLabel =
                account?.type &&
                ACCOUNT_TYPE_LABEL[account.type as AccountType];

              const endorsed = (
                l as unknown as {
                  endorsed_check: {
                    id: string;
                    kind: "fisico" | "echeq";
                    check_number: string;
                    bank_name: string;
                    due_date: string;
                    drawer_name: string;
                  } | null;
                }
              ).endorsed_check;
              const issued = (
                l as unknown as {
                  issued_check: {
                    id: string;
                    kind: "fisico" | "echeq";
                    check_number: string;
                    bank_name: string;
                    due_date: string;
                    status: string;
                  } | null;
                }
              ).issued_check;

              return (
                <div
                  key={l.id}
                  className="flex items-center justify-between border-b py-1 last:border-b-0"
                >
                  <span className="min-w-0">
                    {endorsed ? (
                      <>
                        <span className="font-medium">
                          Endoso ·{" "}
                          {endorsed.kind === "echeq" ? "ECHEQ" : "Cheque"}{" "}
                          {endorsed.bank_name}
                        </span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          #{endorsed.check_number}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          Librador: {endorsed.drawer_name} · vto{" "}
                          {formatArgentineDate(endorsed.due_date)}
                        </div>
                      </>
                    ) : issued ? (
                      <>
                        <span className="font-medium">
                          {issued.kind === "echeq" ? "ECHEQ propio" : "Cheque propio"}{" "}
                          · {issued.bank_name}
                        </span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          #{issued.check_number}
                        </span>
                        <div className="text-xs text-muted-foreground">
                          Vto {formatArgentineDate(issued.due_date)} ·{" "}
                          {issued.status === "emitted"
                            ? "emitido"
                            : issued.status === "cashed"
                              ? "cobrado"
                              : issued.status === "rejected"
                                ? "rechazado"
                                : "anulado"}
                          {" "}
                          · Chequera: {account?.name ?? "—"}
                        </div>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
                  </span>
                  <span className="shrink-0 font-mono">
                    {money(Number(l.amount), paymentOrder.currency)}
                  </span>
                </div>
              );
            })}
          </dl>
        )}
      </div>

      {allocations.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Imputaciones</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {allocations.map((a) => {
              const inv = (
                a as unknown as {
                  purchase_invoice: {
                    letter: PurchaseInvoiceLetter | null;
                    kind: PurchaseInvoiceKind;
                    punto_venta: number;
                    numero: number;
                    fecha: string;
                  } | null;
                }
              ).purchase_invoice;
              const number = inv
                ? formatInvoiceNumber({
                    kind: inv.kind,
                    letter: inv.letter,
                    punto_venta: inv.punto_venta,
                    numero: inv.numero,
                  })
                : "—";
              const kindLabel = inv
                ? PURCHASE_INVOICE_KIND_LABEL[inv.kind]
                : "";
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between border-b py-1 last:border-b-0"
                >
                  <span>
                    <Link
                      href={`/purchases/${a.purchase_invoice_id}`}
                      className="font-medium hover:underline"
                    >
                      {kindLabel}{" "}
                      <span className="font-mono">{number}</span>
                    </Link>
                    {inv?.fecha && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · {formatArgentineDate(inv.fecha)}
                      </span>
                    )}
                  </span>
                  <span className="font-mono">
                    {money(Number(a.amount_applied), paymentOrder.currency)}
                  </span>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {paymentOrder.notes && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Notas</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
            {paymentOrder.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  emphasize?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        emphasize ? "border-t border-b py-1 font-semibold" : ""
      }`}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}
