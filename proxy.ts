import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Match every path except Next assets, image optimizer, public icons,
    // and any file with a static extension.
    "/((?!_next/static|_next/image|favicon.ico|icon\\.jpeg|apple-icon\\.jpeg|jouve-logo\\.jpeg|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|map|txt)).*)",
  ],
};
