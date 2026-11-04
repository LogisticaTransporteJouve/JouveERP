"use client";

import type { ReactNode } from "react";

import { useAccountOptions } from "../hooks/use-accounts";
import type { Account } from "../schema";

/** Renders a form that picks an account once the accounts are read, or why it
 *  cannot: a per-user deny of accounts:read shows its message inside the
 *  dialog instead of reaching the route's error screen. */
export function AccountOptionsGate({
  children,
}: {
  children: (accounts: Account[]) => ReactNode;
}) {
  const { accounts, error, pending } = useAccountOptions();
  if (error || pending) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {error ?? "Cargando…"}
      </p>
    );
  }
  return <>{children(accounts)}</>;
}
