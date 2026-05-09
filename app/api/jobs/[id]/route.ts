import { NextResponse } from "next/server";

import { getInvoiceStatusAction } from "@/features/comprobantes/actions/comprobantes-actions";

// Polling endpoint used by the InvoiceJobStatus component (E.6) to discover
// when AFIP returns a CAE. The InvoiceForm fires the issuance, then the
// detail view polls this every 1.5s until status is no longer 'emitting'.
//
// Auth check happens inside the action via requireUserContext + userCan, so
// this route is just a thin transport.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await getInvoiceStatusAction(id);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 404 });
  }
  return NextResponse.json(res.data);
}
