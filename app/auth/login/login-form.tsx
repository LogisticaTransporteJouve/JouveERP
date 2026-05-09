"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signInWithEmail, type SignInState } from "./actions";

const INITIAL_STATE: SignInState = { error: null };

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(
    signInWithEmail,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      {redirectTo ? (
        <input type="hidden" name="redirectTo" value={redirectTo} />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </div>
      {state.error ? (
        <p className="text-sm text-muted-foreground" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
      {process.env.NODE_ENV !== "production" && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium">Credenciales de test (sólo dev)</p>
          <p className="font-mono">tomas@jouve.test · Test1234!</p>
        </div>
      )}
    </form>
  );
}
