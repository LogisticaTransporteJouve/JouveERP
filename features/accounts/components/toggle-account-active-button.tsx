"use client";

import { Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { setAccountActiveAction } from "../actions/accounts-actions";
import type { Account } from "../schema";

export function ToggleAccountActiveButton({ account }: { account: Account }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onToggle() {
    startTransition(async () => {
      const res = await setAccountActiveAction({
        id: account.id,
        is_active: !account.is_active,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        account.is_active ? "Cuenta desactivada." : "Cuenta reactivada.",
      );
      router.refresh();
    });
  }

  const Icon = account.is_active ? PowerOff : Power;
  const label = account.is_active ? "Desactivar" : "Reactivar";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      disabled={isPending}
      aria-label={label}
      title={label}
    >
      <Icon className="size-4" />
    </Button>
  );
}
