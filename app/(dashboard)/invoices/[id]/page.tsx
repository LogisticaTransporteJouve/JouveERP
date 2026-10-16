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
import { CancelInvoiceDialog } from "@/features/invoices/components/cancel-invoice-dialog";
import { InvoiceJobStatus } from "@/features/invoices/components/invoice-job-status";
import {
  IssueNcNdDialog,
  type OriginInvoice,
} from "@/features/invoices/components/issue-nc-nd-dialog";
import { RegeneratePdfButton } from "@/features/invoices/components/regenerate-pdf-button";
import { getInvoiceDetailAction } from "@/features/invoices/actions/invoices-actions";
import type { IvaCondition } from "@/features/clients/schema";
import {
  INTERNAL_CANCELLABLE_STATUSES,
  INVOICE_KIND_LABEL,
  formatInvoiceNumero,
  type InvoiceStatus,
} from "@/features/invoices/schema";
import { ivaRatePercent, type IvaRateId } from "@/lib/afip/codes";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { formatArgentineDateTime, formatNumber2 } from "@/lib/format";

export const dynamic = "force-dynamic";

const formatARS = formatNumber2;

export default async function ComprobanteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const res = await getInvoiceDetailAction(id);
  if (!res.ok) notFound();
  const c = res.data;
  const canIssue = userCan(ctx.roles, "invoices:issue");
  const canCancel =
    userCan(ctx.roles, "invoices:cancel") &&
    !c.channel.is_fiscal &&
    INTERNAL_CANCELLABLE_STATUSES.includes(c.status);

  const invoiceLabel = `${INVOICE_KIND_LABEL[c.kind]} ${formatInvoiceNumero(c.kind, c.letter, c.punto_venta, c.numero, { whenNullNumero: "pendiente" })}`;

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/invoices">Comprobantes</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{invoiceLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {INVOICE_KIND_LABEL[c.kind]}{" "}
            <span className="font-mono text-base text-muted-foreground">
              {formatInvoiceNumero(c.kind, c.letter, c.punto_venta, c.numero, {
                whenNullNumero: "pendiente",
              })}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {c.channel.name} · {c.fecha}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InvoiceJobStatus
            id={c.id}
            initialStatus={c.status as InvoiceStatus}
          />
          {c.status === "emitted" && (
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/invoices/${c.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileDown />
                PDF
              </a>
            </Button>
          )}
          {canIssue && c.status === "emitted" && !c.pdf_hash && (
            <RegeneratePdfButton id={c.id} />
          )}
          {canCancel && <CancelInvoiceDialog id={c.id} label={invoiceLabel} />}
          {canIssue &&
            c.status === "emitted" &&
            c.kind === "factura" &&
            c.channel.is_fiscal &&
            c.letter &&
            (() => {
              const origin: OriginInvoice = {
                id: c.id,
                channel_id: c.channel.id,
                letter: c.letter as "A" | "B" | "C",
                punto_venta: c.punto_venta,
                fecha: c.fecha,
                concepto: c.concepto,
                moneda: c.moneda,
                cotizacion: c.cotizacion,
                doc_nro: c.doc_nro,
                client: {
                  id: c.client.id,
                  legal_name: c.client.legal_name,
                  iva_condition: c.client.iva_condition as IvaCondition,
                },
                items: c.items.map((it) => ({
                  description: it.description,
                  quantity: it.quantity,
                  unit_price: it.unit_price,
                  iva_rate_id: it.iva_rate_id,
                })),
              };
              return (
                <>
                  <IssueNcNdDialog origin={origin} kind="nc" />
                  <IssueNcNdDialog origin={origin} kind="nd" />
                </>
              );
            })()}
        </div>
      </div>

      {/* Cliente + emisor side by side */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Cliente</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <DetailRow label="Razón social" value={c.client.legal_name} />
            <DetailRow label="Doc" value={`${c.doc_tipo} · ${c.doc_nro}`} />
            <DetailRow
              label="Condición IVA"
              value={c.client.iva_condition.replace(/_/g, " ")}
            />
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Operación</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <DetailRow label="Fecha de emisión" value={c.fecha} />
            {c.fch_serv_desde && (
              <DetailRow label="Servicio desde" value={c.fch_serv_desde} />
            )}
            {c.fch_serv_hasta && (
              <DetailRow label="Servicio hasta" value={c.fch_serv_hasta} />
            )}
            {c.fch_vto_pago && (
              <DetailRow label="Vto. pago" value={c.fch_vto_pago} />
            )}
            <DetailRow
              label="Concepto"
              value={
                c.concepto === 1
                  ? "Productos"
                  : c.concepto === 2
                    ? "Servicios"
                    : "Productos y Servicios"
              }
            />
            <DetailRow
              label="Moneda"
              value={
                c.moneda === "PES"
                  ? "Pesos"
                  : `${c.moneda} @ ${formatARS(c.cotizacion)}`
              }
            />
          </dl>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">Ítems</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Descripción</th>
              <th className="px-4 py-2 text-right">Cant.</th>
              <th className="px-4 py-2 text-right">P. Unit.</th>
              <th className="px-4 py-2 text-right">IVA</th>
              <th className="px-4 py-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {c.items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-4 py-2">{item.description}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {formatARS(item.quantity)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  ${formatARS(item.unit_price)}
                </td>
                <td className="px-4 py-2 text-right">
                  {item.iva_rate_id !== null
                    ? `${ivaRatePercent(item.iva_rate_id as IvaRateId)}%`
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  ${formatARS(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals + AFIP card */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Totales</h2>
          <dl className="mt-3 space-y-1 text-sm font-mono">
            <DetailRow
              label="Neto"
              value={`$${formatARS(c.imp_neto)}`}
              monoValue
            />
            {c.imp_tot_conc > 0 && (
              <DetailRow
                label="No gravado"
                value={`$${formatARS(c.imp_tot_conc)}`}
                monoValue
              />
            )}
            {c.imp_op_ex > 0 && (
              <DetailRow
                label="Exento"
                value={`$${formatARS(c.imp_op_ex)}`}
                monoValue
              />
            )}
            <DetailRow
              label="IVA"
              value={`$${formatARS(c.imp_iva)}`}
              monoValue
            />
            {c.imp_trib > 0 && (
              <DetailRow
                label="Otros tributos"
                value={`$${formatARS(c.imp_trib)}`}
                monoValue
              />
            )}
            <div className="border-t pt-1 mt-1">
              <DetailRow
                label="Total"
                value={`$${formatARS(c.imp_total)}`}
                monoValue
                emphasize
              />
            </div>
          </dl>
        </div>

        {c.channel.is_fiscal ? (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Datos AFIP</h2>
            <dl className="mt-3 space-y-1 text-sm">
              {c.cae ? (
                <>
                  <DetailRow label="CAE" value={c.cae} mono />
                  {c.cae_vencimiento && (
                    <DetailRow
                      label="Vencimiento CAE"
                      value={c.cae_vencimiento}
                    />
                  )}
                  {c.emitted_at && (
                    <DetailRow
                      label="Emitido el"
                      value={formatArgentineDateTime(c.emitted_at)}
                    />
                  )}
                </>
              ) : c.status === "failed" ? (
                <Badge
                  variant="secondary"
                  className="bg-muted text-foreground dark:text-foreground"
                >
                  Falló: revisá observaciones
                </Badge>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pendiente de CAE…
                </p>
              )}
              {c.afip_observaciones != null && (
                <details className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Observaciones AFIP
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all">
                    {JSON.stringify(c.afip_observaciones, null, 2)}
                  </pre>
                </details>
              )}
            </dl>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Documento no fiscal</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              No se envió a AFIP. Es un comprobante interno de JouveERP.
            </p>
          </div>
        )}

        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Adjuntos</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Remitos, comprobantes de respaldo, otros documentos.
          </p>
          <div className="mt-3">
            <AttachmentsZone
              targetType="invoice"
              targetId={c.id}
              canWrite={userCan(ctx.roles, "files:write")}
              canDelete={userCan(ctx.roles, "files:write")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  monoValue,
  emphasize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  monoValue?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={`${mono || monoValue ? "font-mono" : ""} ${
          emphasize ? "font-semibold text-base" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
