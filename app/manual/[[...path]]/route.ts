import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { GUIDE_PAGES } from "@/features/guide/manual/content";
import { guideHrefForPath } from "@/features/guide/manual/model";
import { getCurrentUserContext } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { adaptManualPage, MANUAL_DIR, manualFile } from "@/lib/manual/serve";

// The HTML user manual (docs/manual/) for any logged-in user. Read from disk
// on each request (next.config.ts traces docs/manual/ into this function);
// only the files lib/manual/serve.ts allows are ever read.

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path: segments = [] } = await params;

  // The pages link their assets relatively: /manual has to be a file URL.
  if (segments.length === 0) {
    return NextResponse.redirect(new URL("/manual/index.html", request.url));
  }

  // The "?" of each screen: /manual/para?ruta=/invoices/42 opens the guide
  // section of that route. Only a path inside the app is ever redirected to.
  if (segments.length === 1 && segments[0] === "para") {
    const route = request.nextUrl.searchParams.get("ruta") ?? "";
    return NextResponse.redirect(
      new URL(guideHrefForPath(GUIDE_PAGES, route), request.url),
    );
  }

  const file = manualFile(segments);
  if (!file) {
    return new NextResponse("No encontrado.", { status: 404 });
  }

  const ctx = await getCurrentUserContext();
  if (!ctx) {
    if (!file.isPage) {
      return new NextResponse("Iniciá sesión.", { status: 401 });
    }
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  let body: string;
  try {
    body = await readFile(path.join(MANUAL_DIR, file.relative), "utf8");
  } catch (err) {
    const missing =
      err instanceof Error && "code" in err && err.code === "ENOENT";
    if (!missing) {
      logger.error("manual.read_failed", {
        userId: ctx.userId,
        file: file.relative,
        error: err,
      });
    }
    return new NextResponse(
      missing ? "No encontrado." : "No se pudo leer el manual.",
      { status: missing ? 404 : 500 },
    );
  }

  return new NextResponse(
    file.isPage ? adaptManualPage(body, request.headers.get("x-nonce")) : body,
    {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
