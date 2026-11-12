"use client";

import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { normalizeShipmentStatuses } from "../lib/list-params";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "../schema";

/** The Cargas «Estado» filter: any of the picked statuses; none = all. */
export function ShipmentStatusFilter({
  value,
  onChange,
}: {
  value: ShipmentStatus[];
  onChange: (next: ShipmentStatus[]) => void;
}) {
  function toggle(status: ShipmentStatus, checked: boolean) {
    onChange(
      normalizeShipmentStatuses(
        checked ? [...value, status] : value.filter((s) => s !== status),
      ),
    );
  }

  const label =
    value.length === 0
      ? "Cualquier estado"
      : value.map((s) => SHIPMENT_STATUS_LABELS[s]).join(" + ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label="Estado"
          className="max-w-64 justify-between gap-2 font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {SHIPMENT_STATUSES.map((status) => {
          const id = `shipment-status-${status}`;
          return (
            <label
              key={status}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                id={id}
                checked={value.includes(status)}
                onCheckedChange={(checked) => toggle(status, checked === true)}
              />
              {SHIPMENT_STATUS_LABELS[status]}
            </label>
          );
        })}
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => onChange([])}
          >
            Cualquier estado
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
