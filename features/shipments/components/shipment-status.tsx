import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "../schema";

type StatusConfig = {
  label: string;
  icon: LucideIcon;
  className: string;
};

export const SHIPMENT_STATUS_CONFIG: Record<ShipmentStatus, StatusConfig> = {
  not_started: {
    label: SHIPMENT_STATUS_LABELS.not_started,
    icon: Circle,
    className: "text-muted-foreground",
  },
  in_progress: {
    label: SHIPMENT_STATUS_LABELS.in_progress,
    icon: Truck,
    className: "text-foreground",
  },
  delivered: {
    label: SHIPMENT_STATUS_LABELS.delivered,
    icon: CheckCircle2,
    className: "text-foreground",
  },
  cancelled: {
    label: SHIPMENT_STATUS_LABELS.cancelled,
    icon: XCircle,
    className: "text-destructive",
  },
  reprogrammed: {
    label: SHIPMENT_STATUS_LABELS.reprogrammed,
    icon: CalendarClock,
    className: "text-muted-foreground",
  },
};

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const { label, icon: Icon, className } = SHIPMENT_STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <Icon className="size-4" />
      {label}
    </span>
  );
}
