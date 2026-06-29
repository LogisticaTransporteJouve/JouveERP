// Generates an equal-installment schedule from a principal + count, stepping
// monthly from firstDueDate (day clamped to month length). The last installment
// absorbs the rounding remainder so the cuotas sum exactly to the principal.
// Each amount stays editable afterwards. Pure, no DB.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function addMonthsClamped(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y!, m! - 1 + n, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d!, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type GeneratedInstallment = {
  number: number;
  due_date: string;
  amount: number;
};

export function generateInstallments(
  principal: number,
  count: number,
  firstDueDate: string,
): GeneratedInstallment[] {
  const base = Math.floor((principal / count) * 100) / 100;
  const out: GeneratedInstallment[] = [];
  let allocated = 0;
  for (let i = 1; i <= count; i++) {
    const amount = i === count ? round2(principal - allocated) : base;
    allocated = round2(allocated + amount);
    out.push({
      number: i,
      due_date: addMonthsClamped(firstDueDate, i - 1),
      amount,
    });
  }
  return out;
}
