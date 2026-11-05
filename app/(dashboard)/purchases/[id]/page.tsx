import { Banknote } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listPendingInvoicesForSupplierAction } from "@/features/payment-orders/actions/payment-orders-actions";
import { PayDialog } from "@/features/payment-orders/components/pay-dialog";
import { PAYMENT_ORDER_FORM_PERMISSIONS } from "@/features/payment-orders/lib/payment-order-form";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import { getPurchaseImputationsAction } from "@/features/purchase-invoices/actions/impute-remitos-actions";
import { ImputeRemitosDialog } from "@/features/purchase-invoices/components/impute-remitos-dialog";
import {
  getPurchaseInvoiceAllocationsAction,
  getPurchaseInvoiceByIdAction,
  getPurchaseInvoiceItemsAction,
  getPurchaseInvoiceOpenAction,
} from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import {
  purchaseKindLabel,
  PURCHASE_IVA_RATE_LABEL,
  PURCHASE_TRIBUTE_FIELDS,
  PURCHASE_TRIBUTE_LABEL,
  formatInvoiceNumber,
} from "@/features/purchase-invoices/schema";
import { formatPaymentOrderNumber } from "@/features/payment-orders/schema";
import { requireUserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { canChangeAttachments } from "@/lib/files/attachment-targets";
import {
  amountToInput,
  formatArgentineDate,
  formatMoneyWithCode,
  formatNumber2,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const money = formatMoneyWithCode;

export default async function PurchaseInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "purchase_invoices:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  // Payments are measured only for a role that reads OPs: under RLS anyone
  // else (the fiscal_reader) would read none and see every purchase unpaid.
  const canReadPayments = userCan(ctx.access, "payment_orders:read");
  const [invRes, allocRes, openRes, itemsRes, imputationsRes] =
    await Promise.all([
      getPurchaseInvoiceByIdAction(id),
      canReadPayments ? getPurchaseInvoiceAllocationsAction(id) : null,
      canReadPayments ? getPurchaseInvoiceOpenAction(id) : null,
      getPurchaseInvoiceItemsAction(id),
      getPurchaseImputationsAction(id),
    ]);
  if (!invRes.ok || !invRes.data) notFound();
  const invoice = invRes.data;
  const allocations = allocRes?.ok ? allocRes.data : [];
  const open = openRes?.ok ? openRes.data : null;
  const items = itemsRes.ok ? itemsRes.data : null;
  const imputations = imputationsRes.ok ? imputationsRes.data : null;

  const supabase = await createClient();
  // Every user reads every channel: no row means the read failed, and then
  // neither the side (fiscal or internal) nor its actions are known.
  const { data: channelRow } = await supabase
    .from("invoicing_channels")
    .select("id, name, is_fiscal")
    .eq("id", invoice.channel_id)
    .maybeSingle();
  const isInternal = channelRow?.is_fiscal === false;

  const number = formatInvoiceNumber(invoice);
  const isCancelled = invoice.status === "cancelled";
  // What is owed exists only for a live factura or ND, as for «Pagar».
  const isPayable =
    !isCancelled && (invoice.kind === "factura" || invoice.kind === "nd");
  const showsBalance = canReadPayments && isPayable;
  const canImpute =
    imputations !== null &&
    channelRow?.is_fiscal === true &&
    invoice.kind === "factura" &&
    invoice.moneda === "PES" &&
    !isCancelled &&
    userCan(ctx.access, "purchase_invoices:write") &&
    userCan(ctx.access, "payment_orders:write");

  // "Pagar" opens the OP form with this purchase picked for what it still
  // owes (the same pending list the OP form reads).
  let payOpen: { outstanding: number } | null = null;
  let pendingFailed = false;
  if (
    isPayable &&
    channelRow &&
    userCanAll(ctx.access, PAYMENT_ORDER_FORM_PERMISSIONS)
  ) {
    const pendingRes = await listPendingInvoicesForSupplierAction(
      invoice.supplier_id,
      channelRow.id,
    );
    pendingFailed = !pendingRes.ok;
    const mine = pendingRes.ok
      ? pendingRes.data.find((p) => p.id === invoice.id)
      : undefined;
    if (mine && mine.outstanding > 0)
      payOpen = { outstanding: mine.outstanding };
  }

  // The parts a purchase states beyond neto and IVA; zeros are left out.
  const breakdown = invoice.amount_breakdown;
  const breakdownRows = (
    [
      ["No gravado", breakdown?.imp_no_gravado],
      ["Exento", breakdown?.imp_op_exentas],
      ...PURCHASE_TRIBUTE_FIELDS.map(
        (field) =>
          [`· ${PURCHASE_TRIBUTE_LABEL[field]}`, breakdown?.[field]] as const,
      ),
    ] satisfies (readonly [string, number | undefined])[]
  ).map(([label, value]) =>
    value ? (
      <Row key={label} label={label} value={money(value, invoice.moneda)} />
    ) : null,
  );

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
            {channelRow
              ? purchaseKindLabel(invoice.kind, isInternal)
              : "Comprobante de compra"}{" "}
            <span className="font-mono text-base text-muted-foreground">
              {number}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatArgentineDate(invoice.fecha)}
            {channelRow && (
              <Badge
                variant={isInternal ? "outline" : "secondary"}
                className="ml-2 text-xs"
              >
                {isInternal ? "Gasto interno" : channelRow.name}
              </Badge>
            )}
            {isCancelled && (
              <Badge
                variant="secondary"
                className="ml-2 bg-muted text-foreground dark:text-foreground"
              >
                Anulada
              </Badge>
            )}
          </p>
          {!channelRow && (
            <p className="text-sm text-muted-foreground">
              No se pudo leer el canal de la compra: no se muestran «Pagar» ni
              «Imputar remitos».
            </p>
          )}
          {pendingFailed && (
            <p className="text-sm text-muted-foreground">
              No se pudo leer lo pendiente de pago: no se muestra «Pagar».
            </p>
          )}
          {imputations?.imputedTo && (
            <p className="text-sm text-muted-foreground">
              Imputado a la factura{" "}
              <Link
                href={`/purchases/${imputations.imputedTo.id}`}
                className="font-mono font-medium text-foreground hover:underline"
              >
                {imputations.imputedTo.label}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImpute && (
            <ImputeRemitosDialog
              facturaId={invoice.id}
              facturaLabel={number}
              available={
                invoice.imp_total -
                (imputations?.remitos ?? []).reduce(
                  (acc, r) => acc + r.amount,
                  0,
                )
              }
            />
          )}
          {payOpen && channelRow && (
            <PayDialog
              side={channelRow.is_fiscal ? "fiscal" : "internal"}
              initialSupplier={{
                id: invoice.supplier_id,
                legal_name: invoice.supplier_legal_name,
                display_name: null,
                cuit: invoice.supplier_cuit,
                iva_condition: null,
                is_fiscal: channelRow.is_fiscal,
              }}
              initialAllocations={[
                {
                  purchase_invoice_id: invoice.id,
                  amount_applied: amountToInput(payOpen.outstanding),
                },
              ]}
              trigger={
                <Button>
                  <Banknote className="size-4" />
                  Pagar
                </Button>
              }
            />
          )}
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
            {breakdownRows.slice(0, 2)}
            <Row label="IVA" value={money(invoice.imp_iva, invoice.moneda)} />
            <Row
              label="Otros tributos"
              value={money(invoice.imp_trib, invoice.moneda)}
            />
            {breakdownRows.slice(2)}
            <Row
              label="Total"
              value={money(invoice.imp_total, invoice.moneda)}
              emphasize
            />
            {showsBalance && open && (
              <>
                <Row label="Pagado" value={money(open.paid, invoice.moneda)} />
                {open.credited > 0 && (
                  <Row
                    label="Acreditado"
                    value={money(open.credited, invoice.moneda)}
                  />
                )}
                {open.opening_applied > 0 && (
                  <Row
                    label="Saldo inicial aplicado"
                    value={money(open.opening_applied, invoice.moneda)}
                  />
                )}
                <Row
                  label="Saldo"
                  value={money(Math.max(0, open.open_amount), invoice.moneda)}
                />
              </>
            )}
            {showsBalance && !open && (
              <>
                <Row label="Pagado" value="—" />
                <Row label="Saldo" value="—" />
              </>
            )}
          </dl>
          {showsBalance && !open ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No se pudieron leer los pagos.
            </p>
          ) : (
            canReadPayments &&
            !allocRes?.ok && (
              <p className="mt-2 text-xs text-muted-foreground">
                No se pudieron leer las órdenes de pago imputadas.
              </p>
            )
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Ítems</h2>
          {items?.length === 0 && (
            <Badge variant="secondary" className="text-xs">
              Sin detalle (cargada solo por totales)
            </Badge>
          )}
        </div>
        {items === null ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No se pudieron leer los ítems.
          </p>
        ) : items.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">
                    Descripción
                  </th>
                  <th className="px-2 py-2 text-right font-medium w-20">
                    Cant.
                  </th>
                  <th className="px-2 py-2 text-right font-medium w-28">
                    P. unit
                  </th>
                  <th className="px-2 py-2 text-left font-medium w-20">IVA</th>
                  <th className="px-2 py-2 text-right font-medium w-28">
                    Neto
                  </th>
                  <th className="px-2 py-2 text-right font-medium w-28">IVA</th>
                  <th className="px-2 py-2 text-right font-medium w-28">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-b-0">
                    <td className="px-2 py-1">{it.description}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {formatNumber2(it.quantity)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {formatNumber2(it.unit_price)}
                    </td>
                    <td className="px-2 py-1">
                      {it.iva_rate_id != null
                        ? PURCHASE_IVA_RATE_LABEL[it.iva_rate_id]
                        : "No gr."}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                      {formatNumber2(it.line_neto)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                      {formatNumber2(it.line_iva)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {formatNumber2(it.line_total)}
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
                        className="ml-2 bg-muted text-foreground dark:text-foreground"
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

      {imputations && imputations.remitos.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Remitos internos imputados</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {imputations.remitos.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border-b py-1 last:border-b-0"
              >
                <span>
                  <Link
                    href={`/purchases/${r.id}`}
                    className="font-mono font-medium hover:underline"
                  >
                    {r.label}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">
                    · acreditado con{" "}
                    <Link
                      href={`/purchases/${r.nc_id}`}
                      className="hover:underline"
                    >
                      nota de crédito interna
                    </Link>
                  </span>
                </span>
                <span className="font-mono">
                  {money(r.amount, invoice.moneda)}
                </span>
              </div>
            ))}
          </dl>
        </div>
      )}
      {!imputationsRes.ok && (
        <p className="text-sm text-muted-foreground">
          No se pudieron leer los remitos imputados.
        </p>
      )}

      {invoice.notes && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Notas</h2>
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
            {invoice.notes}
          </p>
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">Adjuntos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Factura del proveedor, remito, otros documentos.
        </p>
        <div className="mt-3">
          <AttachmentsZone
            targetType="purchase_invoice"
            targetId={invoice.id}
            canWrite={
              canChangeAttachments(ctx.access, "purchase_invoice") &&
              !isCancelled
            }
            canDelete={canChangeAttachments(ctx.access, "purchase_invoice")}
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
