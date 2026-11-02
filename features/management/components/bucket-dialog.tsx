"use client";

import { Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ManagementAccount } from "../actions/management-actions";
import { useSetManagementBucket } from "../hooks/use-management";
import { BUCKET_CHOICES, bucketChoiceValue } from "../schema";

const UNSET = "__unset__";

/** Account → management bucket catalog (owner and admin). Lists the result
 *  accounts and any account already mapped; unmapped ones first. */
export function BucketDialog({
  accounts,
  focusAccountId,
  trigger,
}: {
  accounts: ManagementAccount[];
  focusAccountId?: string | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mut = useSetManagementBucket();

  const listed = accounts
    .filter((a) => a.isResult || a.bucket !== null)
    .sort((a, b) => {
      if (a.id === focusAccountId) return -1;
      if (b.id === focusAccountId) return 1;
      return Number(a.bucket !== null) - Number(b.bucket !== null);
    });

  function onChange(accountId: string, value: string) {
    const choice = BUCKET_CHOICES.find((c) => c.value === value);
    if (!choice) return;
    mut.mutate(
      { accountId, bucket: choice.bucket, subbucket: choice.subbucket },
      {
        onSuccess: () => toast.success("Clasificación guardada."),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Tags className="size-4" />
            Clasificar cuentas
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clasificar cuentas para gestión</DialogTitle>
          <DialogDescription>
            A qué caja del resultado de gestión va cada cuenta del plan. No
            cambia asientos ni el EERR fiscal.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y text-sm">
          {listed.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {a.code}
                </span>
                {a.name}
              </span>
              <Select
                value={
                  a.bucket ? bucketChoiceValue(a.bucket, a.subbucket) : UNSET
                }
                onValueChange={(v) => onChange(a.id, v)}
                disabled={mut.isPending}
              >
                <SelectTrigger
                  className="w-full sm:w-72"
                  aria-label={`Caja de ${a.name}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {a.bucket === null && (
                    <SelectItem value={UNSET} disabled>
                      Sin clasificar
                    </SelectItem>
                  )}
                  {BUCKET_CHOICES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
