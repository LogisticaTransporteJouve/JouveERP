"use client";

import { HandCoins } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import {
  PageSideProvider,
  useScope,
} from "@/components/providers/scope-provider";
import { SideSelect } from "@/components/side-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LIST_FORM_DIALOG } from "@/components/form-columns";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import type { PickedClient } from "@/features/invoices/components/client-picker";
import type { ScopeSide } from "@/lib/scope";

import type { AllocationDraft } from "./allocations-picker";
import { ReceiptForm } from "./receipt-form";

/**
 * "Cobrar a cliente": the receipt form opened from outside Recibos
 * (Tesorería, a comprobante, a cash movement). A shared page picks the side
 * here; a comprobante passes its own (`side`) and itself as the allocation.
 * The receipt is created by the same action as in Recibos.
 */
export function CollectDialog({
  side: fixedSide,
  initialClient,
  initialAllocations,
  trigger,
  canEditRetentions,
  defaultOpen = false,
  fromBankLine,
}: {
  side?: ScopeSide;
  initialClient?: PickedClient | null;
  initialAllocations?: AllocationDraft[];
  trigger?: React.ReactNode;
  /** retentions:write: without it the form offers no retentions editor. */
  canEditRetentions: boolean;
  /** Open on mount (a task's «Cobrar» links to the comprobante with it). */
  defaultOpen?: boolean;
  /** Opened from a bank statement line: its date, amount and account. */
  fromBankLine?: {
    date: string;
    amount: number;
    account_id: string;
    channel_id?: string;
  };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [side, setSide] = useState<ScopeSide>(fixedSide ?? "fiscal");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <HandCoins className="size-4" />
            Cobrar a cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={LIST_FORM_DIALOG}>
        <DialogHeader>
          <DialogTitle>Cobrar a cliente</DialogTitle>
          <DialogDescription>
            Emite un recibo: el cobro entra en la cuenta elegida y se imputa a
            los comprobantes (automático, elegidos o a cuenta).
          </DialogDescription>
        </DialogHeader>
        {!fixedSide && <SideSelect value={side} onChange={setSide} />}
        {open && (
          <Suspense
            fallback={
              <div className="py-8 text-center text-sm text-muted-foreground">
                Cargando…
              </div>
            }
          >
            <CollectForm
              key={side}
              side={side}
              initialClient={initialClient ?? null}
              initialAllocations={initialAllocations}
              canEditRetentions={canEditRetentions}
              fromBankLine={fromBankLine}
              onDone={() => setOpen(false)}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CollectForm({
  side,
  initialClient,
  initialAllocations,
  canEditRetentions,
  fromBankLine,
  onDone,
}: {
  side: ScopeSide;
  initialClient: PickedClient | null;
  initialAllocations?: AllocationDraft[];
  canEditRetentions: boolean;
  fromBankLine?: {
    date: string;
    amount: number;
    account_id: string;
    channel_id?: string;
  };
  onDone: () => void;
}) {
  const { channels } = useScope();
  const { data: accounts } = useAccountsList();
  const options = useMemo(
    () =>
      channels
        .filter((c) => c.is_active)
        .map((c) => ({ id: c.id, name: c.name })),
    [channels],
  );
  return (
    <PageSideProvider side={side}>
      <ReceiptForm
        mode="create"
        channels={options}
        accounts={accounts}
        initialClient={initialClient}
        initialAllocations={initialAllocations}
        canEditRetentions={canEditRetentions}
        fromBankLine={fromBankLine}
        onSuccess={onDone}
        onCancel={onDone}
      />
    </PageSideProvider>
  );
}
