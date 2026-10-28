import "server-only";

import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";

const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** The gate and query every libro IVA download shares: `accounting:read`,
 *  a `YYYY-MM` period and an optional channel. */
export async function readLibroIvaRequest(
  req: Request,
): Promise<
  | { ok: true; period: string; channel: string | null }
  | { ok: false; response: NextResponse }
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "accounting:read")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "No tenés permiso para ver el libro IVA." },
        { status: 403 },
      ),
    };
  }

  const url = new URL(req.url);
  const period = url.searchParams.get("period");
  if (!period || !PERIOD_RE.test(period)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Parámetro period inválido (esperado YYYY-MM)." },
        { status: 400 },
      ),
    };
  }
  return { ok: true, period, channel: url.searchParams.get("channel") };
}
