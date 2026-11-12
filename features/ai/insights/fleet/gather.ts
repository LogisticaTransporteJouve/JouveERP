import "server-only";

import { paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";

import { must } from "../gather";
import {
  detectFleetDocExpiry,
  type FleetDocRow,
  type FleetFinding,
} from "./detect";

// Every read is drained (PostgREST stops at max_rows) and a failed one
// throws: the analyst keeps the previous cards of that kind instead of
// deleting them on a figure that silently became empty.

function first<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Fleet documents about to expire (or expired). */
export async function gatherFleetDocExpiry(
  today: string,
): Promise<FleetFinding[]> {
  const service = getServiceClient();
  const docs = must(
    await paginateRange((from, to) =>
      service
        .from("fleet_documents")
        .select(
          "id, kind, expires_at, vehicle:vehicles(patente), driver:drivers(full_name)",
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    "fleet.fleet_documents",
  );
  const docRows: FleetDocRow[] = docs.map((d) => {
    const vehicle = first(d.vehicle);
    const driver = first(d.driver);
    const who = vehicle?.patente ?? driver?.full_name ?? "—";
    return { id: d.id, expires_at: d.expires_at, label: `${who} (${d.kind})` };
  });
  return detectFleetDocExpiry(docRows, today);
}
