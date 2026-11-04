import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { signInToMisComprobantes, representedId, readForm, ArcaRobotError } =
  await import("./robot");

// Synthetic pages in the shape ARCA answered in the recorded sign-in.
const USER = "20111111112";
const COMPANY = "30711111118";
const PASSWORD = "clave-de-prueba";

const loginHtml = `<form id="F1" name="F1" method="post" action="/contribuyente_/login.xhtml;jsessionid=abc">
<input type="hidden" name="F1" value="F1" /><input id="F1:username" type="text" name="F1:username" />
<input type="submit" name="F1:btnSiguiente" value="Siguiente" />
<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="vs-1" /></form>`;

const claveHtml = `<form id="F1" name="F1" method="post" action="/contribuyente_/loginClave.xhtml" onsubmit="onsubmitf1();">
<input type="hidden" name="F1" value="F1" /><input id="F1:captcha" type="hidden" name="F1:captcha" />
<input id="F1:username" type="text" name="F1:username" value="${USER}" />
<input id="F1:password" type="password" name="F1:password" />
<input type="hidden" name="javax.faces.ViewState" value="vs-2" /></form>`;

const jwtHtml = `<html><body onload="document.forms[0].submit()">
<form method="post" action="https://portalcf.cloud.afip.gob.ar/portal/login"><input type="hidden" name="jwt" value="jwt-1" /></form></body></html>`;

const pickerHtml = `<form name="seleccionaEmpresaForm" action="setearContribuyente.do"><input type="hidden" name="idContribuyente" id="idcontribuyente">
<a href="#" onclick="document.getElementById('idcontribuyente').value='0';document.seleccionaEmpresaForm.submit();return false;">DZ &amp; SONS S.A. 30-71111111-8</a>
<a href="#" onclick="document.getElementById('idcontribuyente').value='1';document.seleccionaEmpresaForm.submit();return false;">PERSONA 20-11111111-2</a></form>`;

function row(cells: Record<number, string>): (string | null)[] {
  const r: (string | null)[] = Array.from({ length: 52 }, () => null);
  for (const [i, v] of Object.entries(cells)) r[Number(i)] = v;
  return r;
}

type Call = { url: string; method: string; body: string; cookie: string };

function fakeArca(opts: { claveOk?: boolean; serverSide?: boolean } = {}) {
  const calls: Call[] = [];
  const respond = (
    body: string,
    init: { status?: number; headers?: Record<string, string> } = {},
  ) => {
    const headers = new Headers(init.headers);
    return new Response(body, { status: init.status ?? 200, headers });
  };
  const fetchImpl = async (url: string, init: RequestInit) => {
    const body = typeof init.body === "string" ? init.body : "";
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method: init.method ?? "GET",
      body,
      cookie: headers.get("cookie") ?? "",
    });
    const u = new URL(url);
    const form = new URLSearchParams(body);
    if (u.pathname.startsWith("/contribuyente_/login.xhtml")) {
      if (init.method === "POST") return respond(claveHtml);
      return respond(loginHtml, {
        headers: { "set-cookie": "JSESSIONID=s1; Path=/; Secure" },
      });
    }
    if (u.pathname === "/contribuyente_/loginClave.xhtml") {
      const ok = opts.claveOk !== false && form.get("F1:password") === PASSWORD;
      return respond(ok ? jwtHtml : claveHtml);
    }
    if (u.pathname === "/portal/login") {
      return respond("", {
        status: 302,
        headers: {
          location: "https://portalcf.cloud.afip.gob.ar/portal/app/",
          "set-cookie": "PORTAL=p1; Path=/portal; Secure",
        },
      });
    }
    if (u.pathname === "/portal/app/") return respond("<html></html>");
    if (u.pathname.endsWith("/servicio/mcmp/autorizacion")) {
      return respond(JSON.stringify({ token: "tok", sign: "sig" }));
    }
    if (u.pathname === "/mcmp/jsp/index.do") return respond(pickerHtml);
    if (u.pathname === "/mcmp/jsp/setearContribuyente.do") {
      return respond("<html>menu</html>");
    }
    if (u.pathname === "/mcmp/jsp/ajax.do") {
      const f = u.searchParams.get("f");
      if (f === "generarConsulta") {
        return respond(
          JSON.stringify({
            estado: "ok",
            datos: { idConsulta: "77", estado: "PE" },
          }),
        );
      }
      if (f === "estimarResultados") {
        return respond(
          JSON.stringify({
            estado: "ok",
            datos: { serverSide: opts.serverSide ?? false },
          }),
        );
      }
      if (f === "listaResultados") {
        return respond(
          JSON.stringify({
            estado: "ok",
            datos: {
              data: [
                row({
                  0: "01/11/2026",
                  1: "11",
                  3: "3",
                  4: "121",
                  5: "121",
                  8: "86439009998337",
                  11: "30733333339",
                  12: "Proveedor SA",
                  16: "1",
                  17: "$",
                  50: "95000",
                }),
              ],
            },
          }),
        );
      }
    }
    return respond("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

const credentials = {
  cuit: USER,
  password: PASSWORD,
  representedCuit: COMPANY,
};

describe("signInToMisComprobantes", () => {
  it("signs in, picks the company by CUIT and reads the received vouchers", async () => {
    const { calls, fetchImpl } = fakeArca();
    const robot = await signInToMisComprobantes(credentials, fetchImpl);
    const out = await robot.queryReceived("2026-11-01", "2026-11-30");

    expect(out.vouchers).toHaveLength(1);
    expect(out.vouchers[0]).toMatchObject({ letter: "C", imp_total: 95000 });

    const byPath = (p: string) => calls.find((c) => c.url.includes(p))!;
    // The CUIT step and the clave step carry the ViewState of their page.
    expect(
      new URLSearchParams(byPath("login.xhtml;jsessionid").body).get(
        "javax.faces.ViewState",
      ),
    ).toBe("vs-1");
    expect(byPath("login.xhtml;jsessionid").cookie).toBe("JSESSIONID=s1");
    const clave = new URLSearchParams(byPath("loginClave.xhtml").body);
    expect(clave.get("javax.faces.ViewState")).toBe("vs-2");
    expect(clave.get("F1:username")).toBe(USER);
    // The portal session reaches the ticket request.
    expect(byPath("/mcmp/autorizacion").cookie).toContain("PORTAL=p1");
    expect(new URLSearchParams(byPath("index.do").body).get("sign")).toBe(
      "sig",
    );
    expect(byPath("setearContribuyente.do").url).toMatch(/idContribuyente=0$/);
    const consulta = new URL(byPath("generarConsulta").url).searchParams;
    expect(consulta.get("fechaEmision")).toBe("01/11/2026 - 30/11/2026");
    expect(consulta.get("cuitConsultada")).toBe(COMPANY);
    // The clave goes to ARCA's login and nowhere else.
    expect(
      calls.filter((c) => c.body.includes(PASSWORD)).map((c) => c.url),
    ).toEqual(["https://auth.afip.gob.ar/contribuyente_/loginClave.xhtml"]);
  });

  it("reports a rejected clave as SIGN_IN_REJECTED and stops there", async () => {
    const { calls, fetchImpl } = fakeArca({ claveOk: false });
    await expect(
      signInToMisComprobantes(credentials, fetchImpl),
    ).rejects.toMatchObject({ code: "SIGN_IN_REJECTED" });
    expect(calls.some((c) => c.url.includes("portalcf"))).toBe(false);
  });

  it("does not take a maintenance page after the CUIT for a rejection", async () => {
    const { fetchImpl } = fakeArca();
    const maintenance = async (url: string, init: RequestInit) =>
      url.includes("login.xhtml;jsessionid")
        ? new Response("<html>Servicio en mantenimiento</html>")
        : fetchImpl(url, init);
    await expect(
      signInToMisComprobantes(credentials, maintenance),
    ).rejects.toMatchObject({ code: "SIGN_IN_FAILED" });
  });

  it("refuses a period with more results than one page", async () => {
    const { fetchImpl } = fakeArca({ serverSide: true });
    const robot = await signInToMisComprobantes(credentials, fetchImpl);
    await expect(
      robot.queryReceived("2026-01-01", "2026-12-31"),
    ).rejects.toMatchObject({ code: "TOO_MANY" });
  });

  it("refuses when the user does not represent the company", async () => {
    const { fetchImpl } = fakeArca();
    await expect(
      signInToMisComprobantes(
        { ...credentials, representedCuit: "30799999998" },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "REPRESENTED_NOT_FOUND" });
  });

  it("turns a network failure into NETWORK", async () => {
    const err = await signInToMisComprobantes(credentials, async () => {
      throw new TypeError("fetch failed");
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArcaRobotError);
    expect(err).toMatchObject({ code: "NETWORK" });
  });
});

describe("page helpers", () => {
  it("reads a form's action and inputs whatever the attribute order", () => {
    const form = readForm(loginHtml, "https://auth.afip.gob.ar/x");
    expect(form?.action).toBe(
      "https://auth.afip.gob.ar/contribuyente_/login.xhtml;jsessionid=abc",
    );
    expect(
      form?.inputs.find((i) => i.name === "javax.faces.ViewState"),
    ).toEqual({ name: "javax.faces.ViewState", value: "vs-1" });
  });

  it("finds the picker id by CUIT, with or without hyphens", () => {
    expect(representedId(pickerHtml, COMPANY)).toBe("0");
    expect(representedId(pickerHtml, "20111111112")).toBe("1");
    expect(representedId(pickerHtml, "30799999998")).toBe("missing");
    expect(representedId("<html>sin selector</html>", COMPANY)).toBeNull();
  });
});
