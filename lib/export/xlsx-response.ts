import "server-only";

import { NextResponse } from "next/server";

import { XLSX_MIME } from "./xlsx";

/** An `.xlsx` file as a download response. */
export function xlsxResponse(file: Blob, fileName: string): NextResponse {
  return new NextResponse(file, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
