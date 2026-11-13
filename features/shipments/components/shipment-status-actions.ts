import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";

import {
  SHIPMENT_NEXT_STATUSES,
  type ShipmentStatus,
  type ShipmentTargetStatus,
} from "../schema";

import type { ShipmentStatusAction } from "./shipment-status-dialog";

// A carga is not started by hand: it is «En curso» on its trip's date, and
// from there it can be delivered, cancelled or reprogrammed.
const TARGET_ACTION: Record<ShipmentTargetStatus, ShipmentStatusAction | null> =
  {
    in_progress: null,
    delivered: "deliver",
    cancelled: "cancel",
    reprogrammed: "reprogram",
  };

/** The status actions a user can take on a carga in `status`. */
export function statusActions(status: ShipmentStatus): ShipmentStatusAction[] {
  return SHIPMENT_NEXT_STATUSES[status].flatMap((s) => {
    const action = TARGET_ACTION[s];
    return action ? [action] : [];
  });
}

export const ACTION_LABEL: Record<ShipmentStatusAction, string> = {
  deliver: "Entregar",
  cancel: "Cancelar",
  reprogram: "Reprogramar",
};

export const ACTION_ICON: Record<ShipmentStatusAction, typeof CheckCircle2> = {
  deliver: CheckCircle2,
  cancel: XCircle,
  reprogram: CalendarClock,
};
