import "server-only";

// PDF rendering helpers. Importing this file from a route handler triggers
// the React Native-style Yoga layout engine that @react-pdf/renderer ships
// with — that's why this module is server-only. Browser bundles must never
// pull it in.

import { renderToBuffer } from "@react-pdf/renderer";

import {
  InvoiceDocument,
  type InvoiceTemplateData,
} from "./invoice-template";

export async function renderInvoicePdf(
  data: InvoiceTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
