"use client";

import { RotateCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useAccountOptions } from "../hooks/use-accounts";
import type { Account } from "../schema";

/** Why the accounts cannot be picked, with «Reintentar» when there is a
 *  read to retry (a per-user deny has none). */
export function AccountOptionsError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: (() => void) | null;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <span>{message}</span>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          Reintentar
        </Button>
      )}
    </div>
  );
}

/** Renders a form that picks an account once the accounts are read, or why it
 *  cannot: a per-user deny of accounts:read or a failed read shows its
 *  message inside the dialog instead of reaching the route's error screen.
 *  A failed refetch keeps the form mounted with the accounts already read. */
export function AccountOptionsGate({
  children,
}: {
  children: (accounts: Account[]) => ReactNode;
}) {
  const { accounts, error, pending, retry } = useAccountOptions();
  if (pending) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Cargando…
      </p>
    );
  }
  if (error) {
    return (
      <AccountOptionsError message={error} onRetry={retry} className="py-6" />
    );
  }
  return <>{children(accounts)}</>;
}
