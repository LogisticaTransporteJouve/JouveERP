"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Account } from "@/features/accounts/schema";

import type { IssuedCheck } from "../schema";
import { IssuedCheckForm } from "./issued-check-form";

export function EditIssuedCheckDialog({
  check,
  accounts,
}: {
  check: IssuedCheck;
  accounts: Account[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Editar">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
