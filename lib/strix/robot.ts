import "server-only";

// Signs in to Strix Flotas (the trucks' GPS) and runs its «Kmts recorridos»
// report, as the browser does (recorded by the owner on 2026-11-06):
//
//   webapp-api   POST /oauth/token (password grant) → access_token (1 h); its
//                claims carry the business account and the person
//   api-reports  GET  /lista/            → earlier reports, with the vehicles
//                                           (entidades) each one covered
//                POST /informe/          → id_informe (the report is queued)
//                POST /lista/informe/    → status_request until FINALIZADO
//                POST /rs/               → one row per vehicle and day
//
// The vehicle list reaches the page over a websocket, so the robot takes it
// from the earlier reports: every vehicle any «Kmts recorridos» covered.

const TOKEN_URL = "https://webapp-api.flotas.strix.com.ar/oauth/token";
const REPORTS = "https://api-reports-v2.prod.aws.flotas.strix.com.ar";
const ORIGIN = "https://flotas.strix.com.ar";
const REQUEST_TIMEOUT_MS = 30_000;
const REPORT_TYPE = "kms_recorridos";
/** How far back the earlier reports are listed: the page's longest «Días». */
const REPORTS_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export type StrixErrorCode =
  /** Strix refused the username or the password: never retried as is. */
  | "SIGN_IN_REJECTED"
  /** The sign-in answered in an unknown shape. */
  | "SIGN_IN_FAILED"
  /** Strix does not know JouveERP's app (STRIX_CLIENT_AUTH missing or
   *  stale): not the account's fault, so it never pauses the account. */
  | "CLIENT_REJECTED"
  /** No earlier «Kmts recorridos» report names any vehicle. */
  | "NO_VEHICLES"
  /** The report could not be requested, failed or answered oddly. */
  | "REPORT_FAILED"
  /** The report did not finish in time. */
  | "REPORT_TIMEOUT"
  | "NETWORK";

export class StrixError extends Error {
  constructor(
    readonly code: StrixErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StrixError";
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type StrixEntity = { thing_id: string; domain: string; label: string };

export type StrixKmRow = { domain: string; day: string; km: number };

/** Strix answers only from *.strix.com.ar over https. */
export function isStrixUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (host === "strix.com.ar" || host.endsWith(".strix.com.ar"))
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The business account and person in an access token's claims. */
export function tokenIdentity(
  token: string,
): { accountId: string; userId: string } | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(claims) || !isRecord(claims.meta)) return null;
  const accountId = claims.meta.business_account_id;
  const userId = claims.meta.business_user_id;
  return typeof accountId === "string" && typeof userId === "string"
    ? { accountId, userId }
    : null;
}

/** Every vehicle the earlier «Kmts recorridos» reports covered, newest
 *  report first, once each. */
export function entitiesFromReports(reports: unknown): StrixEntity[] {
  if (!Array.isArray(reports)) return [];
  const sorted = reports
    .filter(isRecord)
    .filter((r) => r.tipo_informe === REPORT_TYPE)
    .sort((a, b) =>
      String(b.timestamp_request ?? "").localeCompare(
        String(a.timestamp_request ?? ""),
      ),
    );
  const out = new Map<string, StrixEntity>();
  for (const r of sorted) {
    if (!Array.isArray(r.entidades)) continue;
    for (const e of r.entidades) {
      if (!isRecord(e)) continue;
      const { thing_id, domain, label } = e;
      if (typeof thing_id !== "string" || typeof domain !== "string") continue;
      if (out.has(thing_id)) continue;
      out.set(thing_id, {
        thing_id,
        domain,
        label: typeof label === "string" ? label : domain,
      });
    }
  }
  return [...out.values()];
}

/** The rows of a finished report. /rs/ answers a JSON string holding an
 *  object of rows keyed by index; a row without a patente, day or km is
 *  dropped. */
export function parseKmRows(body: unknown): StrixKmRow[] | null {
  let data: unknown = body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const rows = Array.isArray(data)
    ? data
    : isRecord(data)
      ? Object.values(data)
      : null;
  if (!rows) return null;
  const out: StrixKmRow[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const { domain, dia, kms } = r;
    const km = typeof kms === "number" ? kms : Number(kms);
    if (
      typeof domain !== "string" ||
      typeof dia !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dia) ||
      !Number.isFinite(km) ||
      km < 0
    ) {
      continue;
    }
    out.push({ domain, day: dia, km });
  }
  return out;
}

/** "2026-11-06" → "06-11-2026", the report's date format. */
function strixDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export type StrixRobot = {
  vehicles(): Promise<StrixEntity[]>;
  /** Km driven per vehicle and day between from and to (YYYY-MM-DD,
   *  inclusive). */
  kmDriven(
    from: string,
    to: string,
    entities: StrixEntity[],
  ): Promise<StrixKmRow[]>;
};

type Deps = {
  fetch?: FetchLike;
  /** Strix's web app client, as the «Basic» credentials its own login sends
   *  (STRIX_CLIENT_AUTH). */
  clientAuth?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How often and how many times the report's status is asked. */
  pollEveryMs?: number;
  pollTimes?: number;
};

async function call(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<Response> {
  if (!isStrixUrl(url)) {
    throw new StrixError("NETWORK", "Se cortó un pedido fuera de Strix.");
  }
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new StrixError("NETWORK", "No se pudo conectar con Strix.");
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Signs in with the stored user. The password goes only to Strix's token
 *  endpoint and never leaves this function. */
export async function signInToStrix(
  credentials: { username: string; password: string },
  deps: Deps = {},
): Promise<StrixRobot> {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const pollEveryMs = deps.pollEveryMs ?? 3_000;
  const pollTimes = deps.pollTimes ?? 30;

  // Strix's token endpoint authenticates the app as well as the user: the
  // same client its web login sends.
  const clientAuth = deps.clientAuth ?? process.env.STRIX_CLIENT_AUTH;
  if (!clientAuth) {
    throw new StrixError(
      "CLIENT_REJECTED",
      "Falta STRIX_CLIENT_AUTH para entrar a Strix.",
    );
  }
  const res = await call(fetchImpl, TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "*/*",
      authorization: `Basic ${clientAuth}`,
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      origin: ORIGIN,
    },
    body: new URLSearchParams({
      username: credentials.username,
      password: credentials.password,
      grant_type: "password",
      client_device_id: crypto.randomUUID(),
    }).toString(),
  });
  const body = await readJson(res);
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // OAuth names which credential failed: the app's or the user's.
    if (isRecord(body) && body.code === "invalid_client") {
      throw new StrixError(
        "CLIENT_REJECTED",
        "Strix no reconoce la app de JouveERP.",
      );
    }
    throw new StrixError(
      "SIGN_IN_REJECTED",
      "Strix rechazó el usuario o la clave.",
    );
  }
  const token =
    res.ok && isRecord(body) && typeof body.access_token === "string"
      ? body.access_token
      : null;
  const identity = token ? tokenIdentity(token) : null;
  if (!token || !identity) {
    throw new StrixError(
      "SIGN_IN_FAILED",
      `Strix contestó el ingreso de una forma desconocida (HTTP ${res.status}).`,
    );
  }

  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: ORIGIN,
    token,
  };
  const post = async (path: string, payload: unknown) => {
    const r = await call(fetchImpl, `${REPORTS}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      throw new StrixError(
        "REPORT_FAILED",
        `Strix contestó HTTP ${r.status} en ${path}.`,
      );
    }
    return readJson(r);
  };

  return {
    async vehicles() {
      // `_from` is the list's lower bound (the page's «Días» filter), not a
      // cache buster: «now» lists nothing.
      const since = (deps.now ?? Date.now)() - REPORTS_LOOKBACK_MS;
      const r = await call(fetchImpl, `${REPORTS}/lista/?_from=${since}`, {
        method: "GET",
        headers,
      });
      if (!r.ok) {
        throw new StrixError(
          "REPORT_FAILED",
          `Strix contestó HTTP ${r.status} al listar los informes.`,
        );
      }
      return entitiesFromReports(await readJson(r));
    },

    async kmDriven(from, to, entities) {
      const requested = await post("/informe/", {
        report_last_valid_signal: 30,
        nombre_informe: "Kmts recorridos",
        account_id: identity.accountId,
        tipo_informe: REPORT_TYPE,
        zonas: [],
        detalles: {},
        entities: entities.map((e) => ({
          ...e,
          tipo_entidad: "mrn:thing:vehicle",
        })),
        from_datetime: `${strixDate(from)} 00:00`,
        to_datetime: `${strixDate(to)} 23:59`,
        user_id: identity.userId,
        send_email: false,
        email_address: "",
      });
      const id =
        isRecord(requested) && typeof requested.id_informe === "string"
          ? requested.id_informe
          : null;
      if (!id) {
        throw new StrixError(
          "REPORT_FAILED",
          "Strix no devolvió el número del informe.",
        );
      }

      for (let i = 0; ; i++) {
        if (i >= pollTimes) {
          throw new StrixError(
            "REPORT_TIMEOUT",
            "El informe de Strix no terminó a tiempo.",
          );
        }
        await sleep(pollEveryMs);
        const list = await post("/lista/informe/", { ids: [id] });
        const report = Array.isArray(list)
          ? list.find((r) => isRecord(r) && r.id_informe === id)
          : null;
        const state = isRecord(report) ? report.status_request : null;
        if (state === "FINALIZADO") break;
        if (state !== "EN CURSO" && state !== "PENDIENTE") {
          throw new StrixError(
            "REPORT_FAILED",
            `El informe de Strix quedó en estado ${String(state ?? "desconocido")}.`,
          );
        }
      }

      const rows = parseKmRows(
        await post("/rs/", {
          id_informe: id,
          tipo_transformacion: "vertical",
          tipo_informe: REPORT_TYPE,
          url: `${REPORTS}/rs/`,
        }),
      );
      if (!rows) {
        throw new StrixError(
          "REPORT_FAILED",
          "Strix devolvió el informe en un formato desconocido.",
        );
      }
      return rows.filter((r) => r.day >= from && r.day <= to);
    },
  };
}
