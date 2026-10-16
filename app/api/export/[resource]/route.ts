import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { buildXlsx } from "@/lib/export/xlsx";
import { xlsxResponse } from "@/lib/export/xlsx-response";
import { formatArgentineDate, formatArgentineDateTime } from "@/lib/format";
import { renderTableReportPdf } from "@/lib/pdf/table-report-render";

import { EXPORTERS, type ExportRange } from "../exporters";
import { cellText, exportSheet } from "../shared";

// Generic table export. Each table page hits
// /api/export/<resource>?from=&to=&format=&<params>; the exporter registry
// maps the resource to a permission + a data loader, and we render the shared
// table report as a PDF, or the same rows as Excel with `format=xlsx`. Date
// range is optional (empty = full history).
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  const ctx = await requireUserContext();
  const { resource } = await params;

  const exporter = EXPORTERS[resource];
  if (!exporter) {
    return NextResponse.json(
      { error: "Recurso no exportable." },
      { status: 404 },
    );
  }
  if (!userCan(ctx.roles, exporter.permission)) {
    return NextResponse.json({ error: "No tenés permiso." }, { status: 403 });
  }

  const url = new URL(req.url);
  const range: ExportRange = {
    from: url.searchParams.get("from") || null,
    to: url.searchParams.get("to") || null,
  };

  try {
    const out = await exporter.load(url.searchParams, range);
    const suffix = range.to && ISO_DAY.test(range.to) ? `-${range.to}` : "";

    if (url.searchParams.get("format") === "xlsx") {
      const file = await buildXlsx(exportSheet(out));
      return xlsxResponse(file, `${out.fileName}${suffix}.xlsx`);
    }

    const generatedAt = formatArgentineDateTime(new Date().toISOString());
    const dateRangeLabel =
      range.from || range.to
        ? `${range.from ? formatArgentineDate(range.from) : "inicio"} — ${
            range.to ? formatArgentineDate(range.to) : "hoy"
          }`
        : "Todo el historial";

    const buffer = await renderTableReportPdf({
      title: out.title,
      subtitle: out.subtitle,
      dateRangeLabel,
      generatedAt,
      columns: out.columns,
      rows: out.rows.map((row) => row.map(cellText)),
      totalsRow: out.totalsRow?.map(cellText),
      orientation: out.orientation,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${out.fileName}${suffix}.pdf"`,
        "Cache-Control": "private, max-age=0",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Error generando el archivo.",
      },
      { status: 500 },
    );
  }
}
