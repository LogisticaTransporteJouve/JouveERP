"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { safeRedirectPath } from "@/lib/security/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  redirectTo: z.string().optional(),
});

export type SignInState = { error: string | null };

export async function signInWithEmail(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "Email o contraseña inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // The domain only: the typed address (or a typo of a real one) is PII
    // the log sink does not need.
    logger.warn("login.failure", {
      emailDomain: parsed.data.email.split("@").pop(),
      reason: error.message,
    });
    return { error: "Credenciales inválidas." };
  }

  redirect(safeRedirectPath(parsed.data.redirectTo) ?? "/dashboard");
}
