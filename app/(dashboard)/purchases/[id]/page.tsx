import Link from "next/link";
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
import {
  getPurchaseInvoiceAllocationsAction,
  getPurchaseInvoiceByIdAction,
  getPurchaseInvoiceItemsAction,
} from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import {
  PURCHASE_INVOICE_KIND_LABEL,
  PURCHASE_IVA_RATE_LABEL,
  formatInvoiceNumber,
} from "@/features/purchase-invoices/schema";
import { formatPaymentOrderNumber } from "@/features/payment-orders/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const fmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n: number, currency: string) => `${currency} ${fmt.format(n)}`;

export default async function PurchaseInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "purchase_invoices:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const [invRes, allocRes, itemsRes] = await Promise.all([
    getPurchaseInvoiceByIdAction(id),
    getPurchaseInvoiceAllocationsAction(id),
    getPurchaseInvoiceItemsAction(id),
  ]);
  if (!invRes.ok || !invRes.data) notFound();
  const invoice = invRes.data;
  const allocations = allocRes.ok ? allocRes.data : [];
  const items = itemsRes.ok ? itemsRes.data : [];

  const number = formatInvoiceNumber(invoice);
  const isCancelled = invoice.status === "cancelled";

  const paidByActive = allocations
    .filter((a) => a.payment_order_status !== "canceled")
    .reduce((acc, a) => acc + a.amount_applied, 0);
  const outstanding = Math.max(0, invoice.imp_total - paidByActive);

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/purchases">Compras</BreadcrumbLink>
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
            {PURCHASE_INVOICE_KIND_LABEL[invoice.kind]}{" "}
            <span className="font-mono text-base text-muted-foreground">
              {number}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatArgentineDate(invoice.fecha)}
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
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="text-sm font-medium">Proveedor</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row
              label="Razón social"
              value={
                <Link
                  href={`/suppliers/${invoice.supplier_id}`}
                  className="font-medium hover:underline"
                >
                  {invoice.supplier_legal_name}
                </Link>
              }
            />
            <Row label="CUIT" value={invoice.supplier_cuit} mono />
            {invoice.cae_proveedor && (
              <Row label="CAE" value={invoice.cae_proveedor} mono />
            )}
            {invoice.cae_vto_proveedor && (
              <Row
                label="Vto. CAE"
                value={formatArgentineDate(invoice.cae_vto_proveedor)}
              />
            )}
            {invoice.fch_vto_pago && (
              <Row
                label="Vto. pago"
                value={formatArgentineDate(invoice.fch_vto_pago)}
              />
            )}
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Totales</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <Row label="Neto" value={money(invoice.imp_neto, invoice.moneda)} />
            <Row label="IVA" value={money(invoice.imp_iva, invoice.moneda)} />
            <Row
              label="Otros tributos"
              value={money(invoice.imp_trib, invoice.moneda)}
            />
            <Row
              label="Total"
              value={money(invoice.imp_total, invoice.moneda)}
              emphasize
            />
            <Row label="Pagado" value={money(paidByActive, invoice.moneda)} />
            <Row label="Saldo" value={money(outstanding, invoice.moneda)} />
          </dl>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Ítems</h2>
          {items.length === 0 && (
            <Badge variant="secondary" className="text-xs">
              Sin detalle (cargada solo por totales)
            </Badge>
          )}
        </div>
        {items.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">Descripción</th>
                  <th className="px-2 py-2 text-right font-medium w-20">Cant.</th>
                  <th className="px-2 py-2 text-right font-medium w-28">P. unit</th>
                  <th className="px-2 py-2 text-left font-medium w-20">IVA</th>
                  <th className="px-2 py-2 text-right font-medium w-28">Neto</th>
                  <th className="px-2 py-2 text-right font-medium w-28">IVA</th>
                  <th className="px-2 py-2 text-right font-medium w-28">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-b-0">
                    <td className="px-2 py-1">{it.description}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {fmt.format(it.quantity)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {fmt.format(it.unit_price)}
                    </td>
                    <td className="px-2 py-1">
                      {it.iva_rate_id != null
                        ? PURCHASE_IVA_RATE_LABEL[it.iva_rate_id]
                        : "No gr."}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                      {fmt.format(it.line_neto)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                      {fmt.format(it.line_iva)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {fmt.format(it.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Esta factura tiene solo los totales del header. Para tener detalle
            por alícuota (libro IVA Compras), edítala y activá &ldquo;Cargar con
            detalle por ítem&rdquo;.
          </p>
        )}
      </div>

      {invoice.motivo_nc_nd && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Motivo NC/ND</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap">
            {invoice.motivo_nc_nd}
          </p>
        </div>
      )}

      {allocations.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Órdenes de pago imputadas</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {allocations.map((a) => {
              const isCancelledOp = a.payment_order_status === "canceled";
              return (
                <div
                  key={a.payment_order_id}
                  className="flex items-center justify-between border-b py-1 last:border-b-0"
                >
                  <span>
                    <Link
                      href={`/payment-orders/${a.payment_order_id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {formatPaymentOrderNumber(
                        a.payment_order_punto_venta,
                        a.payment_order_numero,
                      )}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      · {formatArgentineDate(a.payment_order_date)}
                    </span>
                    {isCancelledOp && (
                      <Badge
                        variant="secondary"
                        className="ml-2 bg-red-500/15 text-red-700 dark:text-red-300"
                      >
                        Anulada
                      </Badge>
                    )}
                  </span>
                  <span
                    className={
                      isCancelledOp
                        ? "font-mono text-muted-foreground line-through"
                        : "font-mono"
                    }
                  >
                    {money(a.amount_applied, invoice.moneda)}
                  </span>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {invoice.notes && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Notas</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
            {invoice.notes}
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
