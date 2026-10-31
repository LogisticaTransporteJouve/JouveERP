import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Relative on purpose: behind `next start -H <ip>` request.url names a
  // different host (localhost), and the CSP's form-action 'self' blocks a form
  // submission that redirects to another origin.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/auth/login" },
  });
}
