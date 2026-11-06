import { describe, expect, it } from "vitest";

import { buildKmRange, type KmVehicle } from "./km-range";

const truck = (
  id: string,
  patente: string,
  extra: Partial<KmVehicle> = {},
): KmVehicle => ({
  id,
  patente,
  alias: null,
  vehicle_type: "camion",
  is_active: true,
  ...extra,
});

describe("buildKmRange", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };

  it("sums each vehicle's km inside the range", () => {
    const res = buildKmRange(
      range,
      [truck("a", "BB222BB"), truck("b", "AA111AA")],
      [
        { vehicle_id: "a", day: "2026-10-02", km: 100.5 },
        { vehicle_id: "a", day: "2026-10-03", km: 0 },
        { vehicle_id: "a", day: "2026-10-05", km: 50.2 },
        { vehicle_id: "a", day: "2026-11-01", km: 999 },
        { vehicle_id: "a", day: "2026-09-30", km: 999 },
      ],
    );
    expect(res.rows.map((r) => r.patente)).toEqual(["AA111AA", "BB222BB"]);
    expect(res.rows[1]).toMatchObject({
      km: 150.7,
      days: 2,
      last_day: "2026-10-05",
    });
    expect(res.rows[0]).toMatchObject({ km: 0, days: 0, last_day: null });
    expect(res.total).toBe(150.7);
  });

  it("skips trailers and inactive vehicles unless they have km", () => {
    const res = buildKmRange(
      range,
      [
        truck("t", "TT000TT", { vehicle_type: "acoplado" }),
        truck("i", "II000II", { is_active: false }),
        truck("k", "KK000KK", { is_active: false }),
      ],
      [{ vehicle_id: "k", day: "2026-10-10", km: 12 }],
    );
    expect(res.rows.map((r) => r.patente)).toEqual(["KK000KK"]);
  });
});
