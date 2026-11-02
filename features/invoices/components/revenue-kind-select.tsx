"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useSetRevenueKind } from "../hooks/use-invoices";
import {
  isRevenueKind,
  REVENUE_KIND_LABEL,
  REVENUE_KINDS,
  type RevenueKind,
} from "../schema";

/** Service or asset sale, for the Resultado de gestión. Editable on an
 *  emitted comprobante: it changes no fiscal data. */
export function RevenueKindSelect({
  itemId,
  value,
}: {
  itemId: string;
  value: RevenueKind;
}) {
  const router = useRouter();
  const mut = useSetRevenueKind();
  const [current, setCurrent] = useState<RevenueKind>(value);

  function onChange(next: string) {
    if (!isRevenueKind(next) || next === current) return;
    const previous = current;
    setCurrent(next);
    mut.mutate(
      { item_id: itemId, revenue_kind: next },
      {
        onSuccess: () => {
          toast.success("Clasificación guardada.");
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
    <Select value={current} onValueChange={onChange} disabled={mut.isPending}>
      <SelectTrigger
        className="h-8 w-48"
        aria-label="Clasificación para gestión"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {REVENUE_KINDS.map((k) => (
          <SelectItem key={k} value={k}>
            {REVENUE_KIND_LABEL[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
