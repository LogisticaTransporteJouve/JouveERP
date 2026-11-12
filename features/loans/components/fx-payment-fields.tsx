"use client";

import { useCallback, useEffect, useState } from "react";

import { MoneyInput } from "@/components/money-input";
import { Label } from "@/components/ui/label";
import {
  amountToInput,
  formatArgentineDate,
  parseArAmount,
} from "@/lib/format";

import { useOfficialUsdRate } from "../hooks/use-loans";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** «Cotización» and «Monto en pesos» of a USD amount paid from a peso
 *  account: the rate starts at the official BCRA one on or before the date
 *  and stays editable; editing the pesos recomputes the rate. `pesos` is what
 *  leaves the account (null while there is no valid figure). */
export function useFxPayment({
  active,
  date,
  usdAmount,
}: {
  /** A USD amount paid from a peso account. */
  active: boolean;
  date: string;
  usdAmount: number;
}) {
  const official = useOfficialUsdRate(date, active);
  const officialRate = official.data?.rate ?? null;
  const [rateText, setRateText] = useState("");
  const [pesosText, setPesosText] = useState("");
  const [touched, setTouched] = useState(false);

  // Until the user edits a figure, the rate follows the official one.
  useEffect(() => {
    if (!active || touched || officialRate === null) return;
    setRateText(amountToInput(officialRate, 6));
    setPesosText(
      usdAmount > 0 ? amountToInput(round2(usdAmount * officialRate)) : "",
    );
  }, [active, touched, officialRate, usdAmount]);

  // A new USD amount keeps the rate and recomputes the pesos.
  useEffect(() => {
    if (!active || !touched) return;
    const rate = parseArAmount(rateText);
    if (rate !== null && rate > 0 && usdAmount > 0) {
      setPesosText(amountToInput(round2(usdAmount * rate)));
    }
    // Only the USD amount drives this recomputation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usdAmount]);

  const reset = useCallback(() => {
    setRateText("");
    setPesosText("");
    setTouched(false);
  }, []);

  function onRate(text: string) {
    setTouched(true);
    setRateText(text);
    const rate = parseArAmount(text);
    if (rate !== null && rate > 0 && usdAmount > 0) {
      setPesosText(amountToInput(round2(usdAmount * rate)));
    }
  }

  function onPesos(text: string) {
    setTouched(true);
    setPesosText(text);
    const pesos = parseArAmount(text);
    if (pesos !== null && pesos > 0 && usdAmount > 0) {
      setRateText(amountToInput(pesos / usdAmount, 6));
    }
  }

  const pesos = parseArAmount(pesosText);
  return {
    rateText,
    pesosText,
    onRate,
    onPesos,
    reset,
    pesos: pesos !== null && pesos > 0 ? round2(pesos) : null,
    official: official.data ?? null,
    officialPending: official.isPending && official.fetchStatus !== "idle",
  };
}

export function FxPaymentFields({
  idPrefix,
  fx,
}: {
  idPrefix: string;
  fx: ReturnType<typeof useFxPayment>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-rate`}>Cotización</Label>
        <MoneyInput
          id={`${idPrefix}-rate`}
          value={fx.rateText}
          decimals={6}
          onChange={fx.onRate}
        />
        <p className="text-muted-foreground text-xs">
          {fx.official
            ? `Oficial BCRA del ${formatArgentineDate(fx.official.rate_date)}`
            : fx.officialPending
              ? "Buscando la cotización oficial…"
              : "Sin cotización oficial cargada: ingresala."}
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-pesos`}>Monto en pesos</Label>
        <MoneyInput
          id={`${idPrefix}-pesos`}
          value={fx.pesosText}
          onChange={fx.onPesos}
        />
      </div>
    </div>
  );
}
