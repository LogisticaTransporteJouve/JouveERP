import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import {
  TableReportDocument,
  type TableReportData,
} from "./table-report-template";

export async function renderTableReportPdf(
  data: TableReportData,
): Promise<Buffer> {
  return renderToBuffer(<TableReportDocument {...data} />);
}
