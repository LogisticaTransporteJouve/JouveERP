import "server-only";

import { parseReceivedResults } from "./results-json";
import type { ParsedReceivedExport } from "./parse";

// Signs in to ARCA with clave fiscal and queries Mis Comprobantes → Recibidos,
// as the browser does (recorded by the owner on 2026-11-04):
//
//   auth.afip.gob.ar  login.xhtml (CUIT) → loginClave.xhtml (clave) → form
//                     that posts a jwt to the portal
//   portalcf          /portal/login (jwt) → /portal/api/servicios/{cuit}/
//                     servicio/mcmp/autorizacion → { token, sign }
//   fes.afip.gob.ar   index.do (token, sign) → setearContribuyente.do (the
//                     company being represented) → ajax.do generarConsulta,
//                     estimarResultados, listaResultados (JSON)

const AUTH_LOGIN = "https://auth.afip.gob.ar/contribuyente_/login.xhtml";
const PORTAL = "https://portalcf.cloud.afip.gob.ar/portal";
const MCMP = "https://fes.afip.gob.ar/mcmp/jsp";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 10;

export type ArcaRobotErrorCode =
  /** ARCA refused the CUIT or the clave: never retried with the same clave. */
  | "SIGN_IN_REJECTED"
  /** ARCA asks for a captcha or changed the login page. */
  | "SIGN_IN_FAILED"
  /** The user is not adhered to Mis Comprobantes in the portal. */
  | "SERVICE_NOT_AUTHORIZED"
  /** The user does not represent the company in Mis Comprobantes. */
  | "REPRESENTED_NOT_FOUND"
  /** The query did not run or answered in an unknown shape. */
  | "QUERY_FAILED"
  /** ARCA answered and refused to query the period (too old, or not
   *  served). */
  | "PERIOD_REFUSED"
  /** ARCA answered with another period than the one asked: its rows are
   *  not used. */
  | "PERIOD_MISMATCH"
  /** More results than ARCA hands in one page: query a shorter range. */
  | "TOO_MANY"
  | "NETWORK";

export type SignInStage = "before_clave" | "clave" | "after_clave";

export class ArcaRobotError extends Error {
  constructor(
    readonly code: ArcaRobotErrorCode,
    message: string,
    /** Where the sign-in was: before the clave was sent, while ARCA judged
     *  it, or after ARCA accepted it (the jwt came back). Only a failure at
     *  the clave can lock the user, so only that counts toward the stop. */
    readonly stage: SignInStage = "before_clave",
  ) {
    super(message);
    this.name = "ArcaRobotError";
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Cookies per domain, enough for ARCA's session cookies (paths ignored). */
class CookieJar {
  private readonly cookies = new Map<string, Map<string, string>>();

  store(url: string, headers: Headers) {
    const host = new URL(url).hostname;
    for (const raw of headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair!.indexOf("=");
      if (eq <= 0) continue;
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const domainAttr = attrs
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith("domain="));
      const domain = (domainAttr?.slice(7) ?? host)
        .replace(/^\./, "")
        .toLowerCase();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      const bucket = this.cookies.get(domain) ?? new Map<string, string>();
      if (expired) bucket.delete(name);
      else bucket.set(name, value);
      this.cookies.set(domain, bucket);
    }
  }

  header(url: string): string | null {
    const host = new URL(url).hostname.toLowerCase();
    const parts: string[] = [];
    for (const [domain, bucket] of this.cookies) {
      if (host !== domain && !host.endsWith(`.${domain}`)) continue;
      for (const [name, value] of bucket) parts.push(`${name}=${value}`);
    }
    return parts.length > 0 ? parts.join("; ") : null;
  }
}

type Page = { url: string; status: number; text: string };

/** ARCA answers from *.afip.gob.ar and, on a redirect of the login, from
 *  *.afip.gov.ar. Nothing else gets a request, let alone the clave. */
function isArcaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    ["afip.gob.ar", "afip.gov.ar"].some(
      (d) => host === d || host.endsWith(`.${d}`),
    )
  );
}

const outsideArca = () =>
  new ArcaRobotError(
    "SIGN_IN_FAILED",
    "ARCA redirigió a un sitio que no es de ARCA: se cortó el ingreso.",
  );

class Session {
  private readonly jar = new CookieJar();

  constructor(private readonly fetchImpl: FetchLike) {}

  async request(
    url: string,
    init: {
      method?: "GET" | "POST";
      form?: Record<string, string>;
      ajax?: boolean;
    } = {},
  ): Promise<Page> {
    let method = init.method ?? "GET";
    let body: string | undefined = init.form
      ? new URLSearchParams(init.form).toString()
      : undefined;
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isArcaUrl(current)) throw outsideArca();
      const headers: Record<string, string> = {
        accept: init.ajax
          ? "application/json, text/javascript, */*; q=0.01"
          : "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "es-AR,es;q=0.9",
        "user-agent": "Mozilla/5.0 (JouveERP)",
      };
      if (init.ajax) headers["x-requested-with"] = "XMLHttpRequest";
      if (body !== undefined) {
        headers["content-type"] = "application/x-www-form-urlencoded";
      }
      const cookie = this.jar.header(current);
      if (cookie) headers.cookie = cookie;
      let res: Response;
      try {
        res = await this.fetchImpl(current, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new ArcaRobotError("NETWORK", "No se pudo conectar con ARCA.");
      }
      this.jar.store(current, res.headers);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, current).toString();
        const sameOrigin = new URL(next).origin === new URL(current).origin;
        if (res.status === 307 || res.status === 308) {
          // These keep method and body: a form (the clave) never follows one
          // to another origin.
          if (body !== undefined && !sameOrigin) throw outsideArca();
        } else {
          method = "GET";
          body = undefined;
        }
        current = next;
        continue;
      }
      return { url: current, status: res.status, text: await res.text() };
    }
    throw new ArcaRobotError("NETWORK", "ARCA redirigió demasiadas veces.");
  }
}

type FormInput = { name: string; value: string };

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? decodeEntities(m[1]!) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The first form whose id or name is `id` (or the first form), with its
 *  resolved action and inputs. */
export function readForm(
  html: string,
  pageUrl: string,
  id?: string,
): { action: string; inputs: FormInput[] } | null {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)];
  const match = forms.find((f) => {
    if (!id) return true;
    const open = /<form\b[^>]*>/i.exec(f[0])![0];
    return attr(open, "id") === id || attr(open, "name") === id;
  });
  if (!match) return null;
  const open = /<form\b[^>]*>/i.exec(match[0])![0];
  const action = new URL(attr(open, "action") ?? pageUrl, pageUrl).toString();
  const inputs = [...match[0].matchAll(/<input\b[^>]*>/gi)].flatMap((m) => {
    const name = attr(m[0], "name");
    return name ? [{ name, value: attr(m[0], "value") ?? "" }] : [];
  });
  return { action, inputs };
}

const hasInput = (form: { inputs: FormInput[] }, name: string) =>
  form.inputs.some((i) => i.name === name);

const viewState = (form: { inputs: FormInput[] }) =>
  form.inputs.find((i) => i.name === "javax.faces.ViewState")?.value ?? "";

/** The picker's id for the company with this CUIT, from index.do. Null when
 *  the page has no picker (the user is the only contributor). */
export function representedId(
  html: string,
  cuit: string,
): string | null | "missing" {
  const parts = html.split(
    /getElementById\('idcontribuyente'\)\.value='(\d+)'/i,
  );
  if (parts.length === 1) return null;
  for (let k = 1; k < parts.length; k += 2) {
    const panel = (parts[k + 1] ?? "").replace(/\D/g, "");
    if (panel.includes(cuit)) return parts[k]!;
  }
  return "missing";
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function json(page: Page): unknown {
  try {
    return JSON.parse(page.text);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type ArcaRobot = {
  /** Received vouchers issued between from and to (YYYY-MM-DD). */
  queryReceived(from: string, to: string): Promise<ParsedReceivedExport>;
};

/** Signs in and opens Mis Comprobantes for the company `representedCuit`.
 *  Throws ArcaRobotError. */
export async function signInToMisComprobantes(
  credentials: { cuit: string; password: string; representedCuit: string },
  fetchImpl: FetchLike = fetch,
): Promise<ArcaRobot> {
  const session = new Session(fetchImpl);
  const { cuit, password, representedCuit } = credentials;

  // 1. CUIT.
  const loginPage = await session.request(AUTH_LOGIN);
  const loginForm = readForm(loginPage.text, loginPage.url, "F1");
  if (!loginForm || !hasInput(loginForm, "F1:username")) {
    throw new ArcaRobotError(
      "SIGN_IN_FAILED",
      "La página de ingreso de ARCA cambió.",
    );
  }
  const clavePage = await session.request(loginForm.action, {
    method: "POST",
    form: {
      F1: "F1",
      "F1:username": cuit,
      "F1:btnSiguiente": "Siguiente",
      "javax.faces.ViewState": viewState(loginForm),
    },
  });
  const claveForm = readForm(clavePage.text, clavePage.url, "F1");
  if (!claveForm || !hasInput(claveForm, "F1:password")) {
    // The CUIT form shown again is ARCA refusing the CUIT; any other page
    // (maintenance, a new step) is not a rejection.
    if (claveForm && hasInput(claveForm, "F1:username")) {
      throw new ArcaRobotError("SIGN_IN_REJECTED", "ARCA no aceptó el CUIT.");
    }
    throw new ArcaRobotError(
      "SIGN_IN_FAILED",
      "ARCA no mostró el paso de la clave.",
    );
  }
  if (/<img[^>]+captcha/i.test(clavePage.text)) {
    throw new ArcaRobotError(
      "SIGN_IN_FAILED",
      "ARCA pide un captcha para ingresar.",
    );
  }

  // 2. Clave onwards: a failure from here on is tagged with where it was.
  let stage: SignInStage = "clave";
  try {
    // 2. Clave: a good one answers with a form that posts a jwt to the portal.
    const afterClave = await session.request(claveForm.action, {
      method: "POST",
      form: {
        F1: "F1",
        "F1:captcha": "",
        "F1:username": cuit,
        "F1:password": password,
        "F1:btnIngresar": "Ingresar",
        "javax.faces.ViewState": viewState(claveForm),
      },
    });
    const jwtForm = readForm(afterClave.text, afterClave.url);
    const jwt = jwtForm?.inputs.find((i) => i.name === "jwt")?.value;
    if (!jwtForm || !jwt) {
      const again = readForm(afterClave.text, afterClave.url, "F1");
      if (again && hasInput(again, "F1:password")) {
        throw new ArcaRobotError(
          "SIGN_IN_REJECTED",
          "ARCA no aceptó la clave.",
        );
      }
      throw new ArcaRobotError(
        "SIGN_IN_FAILED",
        "ARCA no completó el ingreso (puede pedir cambiar la clave o aceptar términos).",
      );
    }
    // ARCA accepted the clave: what fails after this is not about it.
    stage = "after_clave";
    await session.request(jwtForm.action, { method: "POST", form: { jwt } });

    // 3. Ticket for Mis Comprobantes.
    const auth = json(
      await session.request(
        `${PORTAL}/api/servicios/${cuit}/servicio/mcmp/autorizacion`,
        { ajax: true },
      ),
    );
    if (
      !isRecord(auth) ||
      typeof auth.token !== "string" ||
      typeof auth.sign !== "string"
    ) {
      throw new ArcaRobotError(
        "SERVICE_NOT_AUTHORIZED",
        "El usuario no tiene Mis Comprobantes habilitado en ARCA.",
      );
    }
    const index = await session.request(`${MCMP}/index.do`, {
      method: "POST",
      form: { token: auth.token, sign: auth.sign },
    });

    // 4. The company the user represents.
    const id = representedId(index.text, representedCuit);
    if (id === "missing") {
      throw new ArcaRobotError(
        "REPRESENTED_NOT_FOUND",
        "El usuario no representa a la empresa en Mis Comprobantes.",
      );
    }
    if (id !== null) {
      await session.request(
        `${MCMP}/setearContribuyente.do?idContribuyente=${id}`,
      );
    }
  } catch (err) {
    if (err instanceof ArcaRobotError && err.stage === "before_clave") {
      throw new ArcaRobotError(err.code, err.message, stage);
    }
    throw err;
  }

  return {
    async queryReceived(from, to) {
      const params = new URLSearchParams({
        f: "generarConsulta",
        t: "R",
        fechaEmision: `${formatDate(from)} - ${formatDate(to)}`,
        tiposComprobantes: "",
        cuitConsultada: representedCuit,
      });
      const consulta = json(
        await session.request(`${MCMP}/ajax.do?${params}`, { ajax: true }),
      );
      const idConsulta =
        isRecord(consulta) &&
        consulta.estado === "ok" &&
        isRecord(consulta.datos) &&
        typeof consulta.datos.idConsulta === "string"
          ? consulta.datos.idConsulta
          : null;
      if (!idConsulta) {
        // An answer in ARCA's own shape that is not "ok" is ARCA refusing
        // the period; anything else is a broken answer.
        throw isRecord(consulta) && typeof consulta.estado === "string"
          ? new ArcaRobotError(
              "PERIOD_REFUSED",
              "ARCA no aceptó consultar ese período.",
            )
          : new ArcaRobotError(
              "QUERY_FAILED",
              "ARCA no aceptó la consulta de comprobantes recibidos.",
            );
      }
      const estimate = json(
        await session.request(
          `${MCMP}/ajax.do?f=estimarResultados&id=${idConsulta}`,
          { ajax: true },
        ),
      );
      if (
        !isRecord(estimate) ||
        estimate.estado !== "ok" ||
        !isRecord(estimate.datos) ||
        typeof estimate.datos.serverSide !== "boolean"
      ) {
        throw new ArcaRobotError(
          "QUERY_FAILED",
          "ARCA no confirmó cuántos comprobantes hay en el período.",
        );
      }
      if (estimate.datos.serverSide) {
        throw new ArcaRobotError(
          "TOO_MANY",
          "Hay demasiados comprobantes en el período: elegí uno más corto.",
        );
      }
      const results = json(
        await session.request(
          `${MCMP}/ajax.do?f=listaResultados&id=${idConsulta}&_=${Date.now()}`,
          { ajax: true },
        ),
      );
      // Every row ARCA counted, or none: a short page would read as a month
      // with fewer vouchers.
      const listed =
        isRecord(results) &&
        isRecord(results.datos) &&
        Array.isArray(results.datos.data)
          ? results.datos.data.length
          : null;
      if (
        !isRecord(results) ||
        typeof results.recordsTotal !== "number" ||
        listed !== results.recordsTotal
      ) {
        throw new ArcaRobotError(
          "QUERY_FAILED",
          "ARCA devolvió una cantidad de comprobantes distinta de la que informó.",
        );
      }
      // The rows must be of the period asked: an answer for another one (an
      // earlier query ARCA hands back) would file the wrong months.
      const asked = { desde: formatDate(from), hasta: formatDate(to) };
      const consultaEcho =
        isRecord(results.datos) && isRecord(results.datos.consulta)
          ? results.datos.consulta
          : null;
      if (
        !consultaEcho ||
        consultaEcho.filtroFechaDesde !== asked.desde ||
        consultaEcho.filtroFechaHasta !== asked.hasta
      ) {
        throw new ArcaRobotError(
          "PERIOD_MISMATCH",
          "ARCA devolvió comprobantes de otro período que el pedido.",
        );
      }
      const parsed = parseReceivedResults(results);
      if (typeof parsed === "string") {
        throw new ArcaRobotError("QUERY_FAILED", parsed);
      }
      return parsed;
    },
  };
}
