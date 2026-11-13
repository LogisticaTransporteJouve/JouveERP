"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

import { useSetInvoiceOperational } from "../hooks/use-invoices";

/** «Corresponde a la actividad de Jouve» of an issued comprobante. It is not
 *  AFIP data: the entry is re-posted, unless its period is closed. */
export function InvoiceOperationalToggle({
  invoiceId,
  value,
}: {
  invoiceId: string;
  value: boolean;
}) {
  const router = useRouter();
  const mut = useSetInvoiceOperational();
  const [current, setCurrent] = useState(value);

  function onChange(next: boolean) {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    mut.mutate(
      { id: invoiceId, is_operational: next },
      {
        onSuccess: () => {
          toast.success(
            next
              ? "Cuenta como ingreso de Jouve."
              : "Ya no cuenta como ingreso: va a «Cuenta particular de socios».",
          );
          router.refresh();
        },
        onError: (err) => {
          setCurrent(previous);
          toast.error(err.message);
        },
      },
    );
  }

  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={`operational-${invoiceId}`}
        checked={current}
        disabled={mut.isPending}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <div className="space-y-1">
        <Label htmlFor={`operational-${invoiceId}`}>
          Corresponde a la actividad de Jouve
        </Label>
        <p className="text-xs text-muted-foreground">
          Destildado, sigue en el Libro IVA y en la cuenta del cliente, pero no
          cuenta como ingreso (va a «Cuenta particular de socios»).
        </p>
      </div>
    </div>
  );
}
