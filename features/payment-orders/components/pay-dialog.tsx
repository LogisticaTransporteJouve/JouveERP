"use client";

import { Banknote } from "lucide-react";
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
import type {
  PickedSupplier,
  SuggestedNewSupplier,
} from "@/features/suppliers/components/supplier-picker";
import type { ScopeSide } from "@/lib/scope";

import type { AllocationDraft } from "./allocations-picker";
import { PaymentOrderForm } from "./payment-order-form";

type FromBankLine = {
  date: string;
  amount: number;
  account_id: string;
  channel_id?: string;
  counterparty?: SuggestedNewSupplier | null;
};

/**
 * "Pagar a proveedor": the payment order form opened from outside Órdenes de
 * pago (Tesorería, a purchase, a cash movement). A shared page picks the side
 * here; a purchase passes its own (`side`) and itself as the allocation. The
 * OP is created by the same action as in Órdenes de pago.
 */
export function PayDialog({
  side: fixedSide,
  initialSupplier,
  initialAllocations,
  trigger,
  defaultOpen = false,
  fromBankLine,
  onCreated,
}: {
  side?: ScopeSide;
  initialSupplier?: PickedSupplier | null;
  initialAllocations?: AllocationDraft[];
  trigger?: React.ReactNode;
  /** Open on mount (a task's «Pagar» links to the purchase with it). */
  defaultOpen?: boolean;
  /** Opened from a bank statement debit: its date, amount and account. */
  fromBankLine?: FromBankLine;
  /** Runs with the new order's id once it is issued. */
  onCreated?: (paymentOrderId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [side, setSide] = useState<ScopeSide>(fixedSide ?? "fiscal");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Banknote className="size-4" />
            Pagar a proveedor
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={LIST_FORM_DIALOG}>
        <DialogHeader>
          <DialogTitle>Pagar a proveedor</DialogTitle>
          <DialogDescription>
            Emite una orden de pago: el pago sale de la cuenta elegida y se
            imputa a las facturas (automático, elegidas o a cuenta).
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
            <PayForm
              key={side}
              side={side}
              initialSupplier={initialSupplier ?? null}
              initialAllocations={initialAllocations}
              fromBankLine={fromBankLine}
              onCreated={onCreated}
              onDone={() => setOpen(false)}
            />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({
  side,
  initialSupplier,
  initialAllocations,
  fromBankLine,
  onCreated,
  onDone,
}: {
  side: ScopeSide;
  initialSupplier: PickedSupplier | null;
  initialAllocations?: AllocationDraft[];
  fromBankLine?: FromBankLine;
  onCreated?: (paymentOrderId: string) => void;
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
  // A bank line whose side the user picks here goes to that side's channel.
  const sideChannel = channels.find(
    (c) => c.is_active && c.is_fiscal === (side === "fiscal"),
  )?.id;
  const bankLine =
    fromBankLine && !fromBankLine.channel_id && sideChannel
      ? { ...fromBankLine, channel_id: sideChannel }
      : fromBankLine;
  return (
    <PageSideProvider side={side}>
      <PaymentOrderForm
        mode="create"
        channels={options}
        accounts={accounts}
        initialSupplier={initialSupplier}
        initialAllocations={initialAllocations}
        fromBankLine={bankLine}
        onSuccess={(id) => {
          onCreated?.(id);
          onDone();
        }}
        onCancel={onDone}
      />
    </PageSideProvider>
  );
}
