import { beforeEach, describe, expect, it, vi } from "vitest";

import { AfipTransportError } from "./errors";

const h = vi.hoisted(() => ({ text: "" }));

vi.mock("./http", () => ({
  afipFetch: async () => ({ ok: true, status: 200, text: h.text }),
}));
vi.mock("./wsaa", () => ({
  getAccessTicket: async () => ({ token: "t", sign: "s" }),
}));
vi.mock("./env", () => ({
  getAfipCuit: () => "30712345678",
  getWsfev1Url: () => "https://wsfe.test/service.asmx",
}));

const { getVoucherInfo } = await import("./wsfev1");

function envelope(result: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
      <FECompConsultarResult>${result}</FECompConsultarResult>
    </FECompConsultarResponse>
  </soap:Body>
</soap:Envelope>`;
}

beforeEach(() => {
  h.text = "";
});

describe("getVoucherInfo", () => {
  it("returns null only when AFIP answers 602 (no existe)", async () => {
    h.text = envelope(
      "<Errors><Err><Code>602</Code><Msg>No existen datos</Msg></Err></Errors>",
    );
    await expect(getVoucherInfo(3, 1, 42)).resolves.toBeNull();
  });

  it("returns the voucher AFIP registered", async () => {
    h.text = envelope(
      "<ResultGet><PtoVta>3</PtoVta><CbteTipo>1</CbteTipo><CbteDesde>42</CbteDesde><CbteFch>20261103</CbteFch><ImpTotal>121</ImpTotal><CodAutorizacion>75000000000001</CodAutorizacion><FchVto>20261113</FchVto></ResultGet>",
    );
    await expect(getVoucherInfo(3, 1, 42)).resolves.toMatchObject({
      cbteNro: 42,
      impTotal: 121,
      iva: [],
    });
  });

  it("reads ARCA's per-alícuota IVA breakdown", async () => {
    h.text = envelope(
      "<ResultGet><PtoVta>3</PtoVta><CbteTipo>1</CbteTipo><CbteDesde>42</CbteDesde><CbteFch>20261103</CbteFch><ImpTotal>1226</ImpTotal><ImpNeto>1100</ImpNeto><ImpIVA>126</ImpIVA><Iva><AlicIva><Id>5</Id><BaseImp>100</BaseImp><Importe>21</Importe></AlicIva><AlicIva><Id>4</Id><BaseImp>1000</BaseImp><Importe>105</Importe></AlicIva></Iva><CodAutorizacion>75000000000001</CodAutorizacion></ResultGet>",
    );
    await expect(getVoucherInfo(3, 1, 42)).resolves.toMatchObject({
      iva: [
        { id: 5, baseImp: 100, importe: 21 },
        { id: 4, baseImp: 1000, importe: 105 },
      ],
    });

    h.text = envelope(
      "<ResultGet><CbteDesde>43</CbteDesde><Iva><AlicIva><Id>5</Id><BaseImp>100.5</BaseImp><Importe>21.11</Importe></AlicIva></Iva></ResultGet>",
    );
    await expect(getVoucherInfo(3, 1, 43)).resolves.toMatchObject({
      iva: [{ id: 5, baseImp: 100.5, importe: 21.11 }],
    });
  });

  it("treats an answer that is not a FECompConsultar result as unknown, not as no voucher", async () => {
    h.text = "<html><body>Servicio en mantenimiento</body></html>";
    await expect(getVoucherInfo(3, 1, 42)).rejects.toBeInstanceOf(
      AfipTransportError,
    );
  });

  it("treats a result with neither a voucher nor an error as unknown", async () => {
    h.text = envelope("");
    await expect(getVoucherInfo(3, 1, 42)).rejects.toBeInstanceOf(
      AfipTransportError,
    );
  });
});
