"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileDown,
  FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/ui/month-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { periodBounds } from "@/lib/accounting-period";
import { downloadFromUrl } from "@/lib/export/download";
import { XLSX_MIME } from "@/lib/export/mime";
import { formatArgentineDateTime, formatPeriod } from "@/lib/format";

import { useMonthlyPackageStatus } from "../hooks/use-monthly-package";
import { needsAttention, type CheckCount } from "../schema";

/**
 * Contabilidad › Paquete del mes: the month's checklist and every file the
 * accountant needs in one place. `ivaDownloads` are the libro IVA rows the
 * page composes from that module's own buttons.
 */
export function MonthlyPackageView({
  period,
  ivaDownloads,
}: {
  period: string;
  ivaDownloads: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Paquete del mes
          </h1>
          <p className="text-muted-foreground text-sm">
            Lo que hay que revisar antes de mandarle el mes al contador, y todos
            los archivos que necesita.
          </p>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="package-period"
            className="text-muted-foreground text-xs"
          >
            Período
          </label>
          <PeriodPicker id="package-period" period={period} />
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Estado de {formatPeriod(period)}
        </h2>
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <Checklist period={period} />
        </Suspense>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              Descargas de {formatPeriod(period)}
            </h2>
            <p className="text-muted-foreground text-xs">
              Cada archivo trae solo ese mes. Para otro mes, elegilo acá.
            </p>
          </div>
          <PeriodPicker
            id="package-downloads-period"
            aria-label="Mes de las descargas"
            period={period}
          />
        </div>
        <div className="divide-y rounded-lg border bg-card">
          {ivaDownloads}
          <BookDownload
            title="Libro diario"
            description="Todos los asientos del período, línea por línea."
            resource="libro-diario"
            period={period}
          />
          <BookDownload
            title="Libro mayor"
            description="Cada cuenta con movimientos, desde su saldo anterior."
            resource="libro-mayor"
            period={period}
          />
          <BookDownload
            title="Balance de sumas y saldos"
            description="Saldos acumulados al cierre del período."
            resource="balance-sumas-saldos"
            period={period}
          />
        </div>
      </section>
    </div>
  );
}

/** The month the page shows; picking one reloads it for that month. */
function PeriodPicker({
  id,
  period,
  "aria-label": ariaLabel,
}: {
  id: string;
  period: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  return (
    <MonthPicker
      id={id}
      aria-label={ariaLabel}
      value={period}
      onChange={(value) => {
        if (value) router.push(`/accounting/package?period=${value}`);
      }}
      className="w-[180px]"
    />
  );
}

/** One line of the downloads list. */
export function DownloadRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function BookDownload({
  title,
  description,
  resource,
  period,
}: {
  title: string;
  description: string;
  resource: string;
  period: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const { from, to } = periodBounds(period);
  const qs = new URLSearchParams({ period, from, to });
  const base = `/api/export/${resource}`;

  async function exportXlsx() {
    setDownloading(true);
    try {
      await downloadFromUrl(
        `${base}?${qs.toString()}&format=xlsx`,
        `${resource}-${period}.xlsx`,
        XLSX_MIME,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo generar el Excel.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <DownloadRow title={title} description={description}>
      <Button asChild variant="outline" size="sm">
        <a
          href={`${base}?${qs.toString()}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileDown />
          PDF
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={downloading}
        onClick={exportXlsx}
      >
        <FileSpreadsheet />
        {downloading ? "Generando…" : "Excel"}
      </Button>
    </DownloadRow>
  );
}

function Checklist({ period }: { period: string }) {
  const { data } = useMonthlyPackageStatus(period);
  const invoicesPending =
    data.invoicesDraft === null ||
    data.invoicesEmitting === null ||
    data.invoicesFailed === null
      ? null
      : data.invoicesDraft + data.invoicesEmitting + data.invoicesFailed;

  return (
    <ul className="divide-y rounded-lg border bg-card">
      <CheckItem
        ok={data.closedReadFailed ? null : data.closedAt !== null}
        title="Período cerrado"
        detail={
          data.closedReadFailed
            ? "No se pudo leer el cierre."
            : data.closedAt
              ? `Cerrado el ${formatArgentineDateTime(data.closedAt)}.`
              : "Abierto: todavía se pueden cargar o cambiar asientos del mes."
        }
        href="/accounting/journal"
      />
      <CountItem
        count={data.pendingJournal}
        title="Asientos pendientes"
        ok="Todos los comprobantes del mes tienen su asiento."
        pending={(n) =>
          `${n} comprobante(s) autorizados esperan su asiento (el cron los reintenta).`
        }
        href="/accounting/journal"
      />
      <CountItem
        count={data.missingJournal}
        title="Asientos faltantes o desactualizados"
        ok="Ningún documento fiscal sin asiento o con un asiento viejo."
        pending={(n) =>
          `${n} documento(s) sin asiento o con uno que no coincide (de cualquier período).`
        }
        href="/accounting/journal"
      />
      <CountItem
        count={invoicesPending}
        title="Comprobantes sin autorizar"
        ok="Todos los comprobantes fiscales del mes están autorizados."
        pending={() =>
          `${data.invoicesDraft} en borrador, ${data.invoicesEmitting} emitiéndose y ${data.invoicesFailed} con error.`
        }
        href="/invoices"
      />
      <CountItem
        count={data.caeaUninformed}
        title="CAEA sin informar"
        ok="Nada emitido con CAEA queda sin informar a AFIP."
        pending={(n) => `${n} comprobante(s) con CAEA sin informar a AFIP.`}
        href="/invoices"
      />
      <CountItem
        count={data.purchasesWithoutLetter}
        title="Compras fiscales sin letra"
        ok="Todas las compras fiscales del mes tienen letra."
        pending={(n) =>
          `${n} compra(s) fiscales sin letra: no entran al libro IVA ni al CITI.`
        }
        href="/purchases"
      />
    </ul>
  );
}

function CountItem({
  count,
  title,
  ok,
  pending,
  href,
}: {
  count: CheckCount;
  title: string;
  ok: string;
  pending: (n: number) => string;
  href: string;
}) {
  return (
    <CheckItem
      ok={count === null ? null : !needsAttention(count)}
      title={title}
      detail={
        count === null ? "No se pudo leer." : count === 0 ? ok : pending(count)
      }
      href={href}
    />
  );
}

/** `ok` null = the check could not be read. */
function CheckItem({
  ok,
  title,
  detail,
  href,
}: {
  ok: boolean | null;
  title: string;
  detail: string;
  href: string;
}) {
  const Icon = ok === null ? CircleHelp : ok ? CheckCircle2 : AlertTriangle;
  return (
    <li className="flex items-start gap-3 p-3 text-sm">
      <Icon
        aria-label={ok === null ? "Sin datos" : ok ? "En orden" : "Revisar"}
        className={
          ok ? "text-muted-foreground mt-0.5 size-4" : "mt-0.5 size-4 shrink-0"
        }
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
      {ok === false && (
        <Button asChild variant="ghost" size="sm">
          <Link href={href}>Revisar</Link>
        </Button>
      )}
    </li>
  );
}
