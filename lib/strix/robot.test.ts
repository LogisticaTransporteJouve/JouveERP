import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  StrixError,
  entitiesFromReports,
  isStrixUrl,
  parseKmRows,
  signInToStrix,
  tokenIdentity,
} = await import("./robot");

const ACCOUNT = "mrn:account:business:acct";
const PERSON = "mrn:person:me";

function fakeToken(meta: Record<string, string>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ meta })}.sig`;
}

const TOKEN = fakeToken({
  business_account_id: ACCOUNT,
  business_user_id: PERSON,
});

// Shapes as recorded from Strix on 2026-11-06 (values made up).
const REPORTS = [
  {
    id_informe: "old",
    tipo_informe: "kms_recorridos",
    timestamp_request: "2026-11-01T10:00:00",
    entidades: [
      { thing_id: "t1", domain: "AA111AA", label: "AA111AA" },
      { thing_id: "t3", domain: "CC333CC", label: "CC333CC" },
    ],
  },
  {
    id_informe: "new",
    tipo_informe: "kms_recorridos",
    timestamp_request: "2026-11-06T15:19:00",
    entidades: [
      { thing_id: "t1", domain: "AA111AA", label: "Camión 1" },
      { thing_id: "t2", domain: "BB222BB", label: "BB222BB" },
    ],
  },
  { id_informe: "x", tipo_informe: "otro", entidades: [{ thing_id: "t9" }] },
];

const RS_BODY = JSON.stringify(
  `{\n"0": {"thing_id": "t1", "dia": "2026-11-03", "kms": 217.9, "domain": "AA111AA"},\n"1": {"thing_id": "t2", "dia": "2026-11-04", "kms": 12, "domain": "BB222BB"},\n"2": {"thing_id": "t2", "dia": "2026-10-30", "kms": 50, "domain": "BB222BB"}\n}`,
);

const json = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function strixServer(opts: { tokenStatus?: number; states?: string[] } = {}) {
  const states = [...(opts.states ?? ["EN CURSO", "FINALIZADO"])];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/oauth/token")) {
      return opts.tokenStatus
        ? json({ error: "invalid_grant" }, opts.tokenStatus)
        : json({ access_token: TOKEN, expires_in: 3600 });
    }
    if (url.includes("/lista/?_from=")) return json(REPORTS);
    if (url.endsWith("/lista/informe/")) {
      return json([{ id_informe: "r1", status_request: states.shift() }]);
    }
    if (url.endsWith("/informe/")) return json({ id_informe: "r1" });
    if (url.endsWith("/rs/")) return json(RS_BODY);
    return json({}, 404);
  });
  return { fetch, calls };
}

const deps = (fetch: ReturnType<typeof strixServer>["fetch"]) => ({
  fetch,
  sleep: async () => {},
  pollTimes: 5,
});

describe("isStrixUrl", () => {
  it("accepts only https *.strix.com.ar", () => {
    expect(isStrixUrl("https://webapp-api.flotas.strix.com.ar/x")).toBe(true);
    expect(isStrixUrl("http://flotas.strix.com.ar/")).toBe(false);
    expect(isStrixUrl("https://strix.com.ar.evil.com/")).toBe(false);
  });
});

describe("tokenIdentity", () => {
  it("reads the account and person from the claims", () => {
    expect(tokenIdentity(TOKEN)).toEqual({
      accountId: ACCOUNT,
      userId: PERSON,
    });
    expect(tokenIdentity("nope")).toBeNull();
  });
});

describe("entitiesFromReports", () => {
  it("takes every vehicle of the km reports once, newest first", () => {
    expect(entitiesFromReports(REPORTS)).toEqual([
      { thing_id: "t1", domain: "AA111AA", label: "Camión 1" },
      { thing_id: "t2", domain: "BB222BB", label: "BB222BB" },
      { thing_id: "t3", domain: "CC333CC", label: "CC333CC" },
    ]);
    expect(entitiesFromReports(null)).toEqual([]);
  });
});

describe("parseKmRows", () => {
  it("reads the JSON string /rs/ answers and drops bad rows", () => {
    expect(
      parseKmRows(
        JSON.stringify({
          0: { domain: "AA111AA", dia: "2026-11-03", kms: 10.5 },
          1: { domain: "AA111AA", dia: "03/11/2026", kms: 1 },
          2: { domain: "AA111AA", dia: "2026-11-04", kms: -1 },
        }),
      ),
    ).toEqual([{ domain: "AA111AA", day: "2026-11-03", km: 10.5 }]);
    expect(parseKmRows("{bad")).toBeNull();
  });
});

describe("signInToStrix", () => {
  it("signs in, runs the km report and keeps the range's days", async () => {
    const server = strixServer();
    const robot = await signInToStrix(
      { username: "u@x.com", password: "secret" },
      deps(server.fetch),
    );
    const entities = await robot.vehicles();
    const rows = await robot.kmDriven("2026-11-01", "2026-11-06", entities);
    expect(rows).toEqual([
      { domain: "AA111AA", day: "2026-11-03", km: 217.9 },
      { domain: "BB222BB", day: "2026-11-04", km: 12 },
    ]);

    const request = server.calls.find(
      (c) => c.url.endsWith("/informe/") && !c.url.includes("lista"),
    );
    const body = JSON.parse(String(request?.init.body));
    expect(body).toMatchObject({
      account_id: ACCOUNT,
      user_id: PERSON,
      tipo_informe: "kms_recorridos",
      from_datetime: "01-11-2026 00:00",
      to_datetime: "06-11-2026 23:59",
    });
    expect(body.entities).toHaveLength(3);
    // The password goes to the token endpoint only.
    const withPassword = server.calls.filter((c) =>
      String(c.init.body ?? "").includes("secret"),
    );
    expect(withPassword.map((c) => c.url)).toEqual([
      "https://webapp-api.flotas.strix.com.ar/oauth/token",
    ]);
  });

  it("names a refused password", async () => {
    const server = strixServer({ tokenStatus: 400 });
    await expect(
      signInToStrix({ username: "u", password: "p" }, deps(server.fetch)),
    ).rejects.toMatchObject({ code: "SIGN_IN_REJECTED" });
  });

  it("stops waiting for a report that never finishes", async () => {
    const server = strixServer({ states: Array(10).fill("EN CURSO") });
    const robot = await signInToStrix(
      { username: "u", password: "p" },
      deps(server.fetch),
    );
    await expect(
      robot.kmDriven("2026-11-01", "2026-11-06", []),
    ).rejects.toBeInstanceOf(StrixError);
  });
});
