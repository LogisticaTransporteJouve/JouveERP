"use client";

import { Power, PowerOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { useSetAccountActive } from "../hooks/use-accounts";
import type { Account } from "../schema";

export function ToggleAccountActiveButton({ account }: { account: Account }) {
  const mut = useSetAccountActive();

  function onToggle() {
    mut.mutate(
      { id: account.id, is_active: !account.is_active },
      {
        onSuccess: () => {
          toast.success(
            account.is_active ? "Cuenta desactivada." : "Cuenta reactivada.",
          );
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const Icon = account.is_active ? PowerOff : Power;
  const label = account.is_active ? "Desactivar" : "Reactivar";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      disabled={mut.isPending}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </Button>
  );
}
