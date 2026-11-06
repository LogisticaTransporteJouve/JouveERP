import { describe, expect, it } from "vitest";

import { latestFunctionBodies } from "./sql-guards";

const v1 = `-- old guard
create or replace function public.close_period(p text) returns void
language plpgsql as $$
begin
  raise exception 'El período ya está cerrado';
end $$;`;

const v2 = `create or replace function close_period(p text) returns void
language plpgsql as $fn$
begin
  -- 'El período ya está cerrado' was the old wording
  raise exception 'Ese período ya se cerró';
end $fn$;`;

describe("latestFunctionBodies", () => {
  it("keeps only the last definition of a function, so a reworded guard drops the old message", () => {
    const body = latestFunctionBodies([
      { name: "20260102_b.sql", sql: v2 },
      { name: "20260101_a.sql", sql: v1 },
    ]).get("public.close_period");
    expect(body).toContain("Ese período ya se cerró");
    expect(body).not.toContain("El período ya está cerrado");
  });

  it("keeps each overload's last body: another argument list is another function", () => {
    const overload = `create function public.close_period(p text, q numeric) returns void
language plpgsql as $$
begin
  perform public.close_period(p);
  raise exception 'El total cambió';
end $$;`;
    const body = latestFunctionBodies([
      { name: "20260101_a.sql", sql: v1 },
      { name: "20260103_c.sql", sql: overload },
    ]).get("public.close_period");
    expect(body).toContain("El período ya está cerrado");
    expect(body).toContain("El total cambió");
  });

  it("drops the body of a dropped overload", () => {
    const body = latestFunctionBodies([
      { name: "20260101_a.sql", sql: v1 },
      {
        name: "20260104_d.sql",
        sql: "drop function if exists public.close_period(text);",
      },
    ]).get("public.close_period");
    expect(body ?? "").not.toContain("El período ya está cerrado");
  });

  it("ignores comments", () => {
    const body = latestFunctionBodies([{ name: "a.sql", sql: v2 }]).get(
      "public.close_period",
    );
    expect(body).not.toContain("old wording");
  });
});
