"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Account } from "@/features/accounts/schema";
import type { CheckChannelOption } from "@/features/checks/components/check-action-dialogs";

import type { IssuedCheck } from "../schema";
import { IssuedCheckForm } from "./issued-check-form";

export function EditIssuedCheckDialog({
  check,
  accounts,
  channels,
}: {
  check: IssuedCheck;
  accounts: Account[];
  channels: CheckChannelOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton label="Editar" variant="ghost">
          <Pencil className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Cheque {check.bank_name} · #{check.check_number}
          </DialogTitle>
          <DialogDescription>
            Editá los datos del cheque o reasignalo a otro proveedor.
          </DialogDescription>
        </DialogHeader>
        <IssuedCheckForm
          mode="edit"
          check={check}
          accounts={accounts}
          channels={channels}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
