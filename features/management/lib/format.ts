import { formatNumber2 } from "@/lib/format";

/** Signed pesos: "-$1.234,56". */
export const money = (n: number) =>
  n < 0 ? `-$${formatNumber2(-n)}` : `$${formatNumber2(n)}`;

const MONTH_LABEL = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

/** "2026-10" → "Oct 26". */
export const monthLabel = (period: string) =>
  `${MONTH_LABEL[Number(period.slice(5, 7)) - 1]} ${period.slice(2, 4)}`;
