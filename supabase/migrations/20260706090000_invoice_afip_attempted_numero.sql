-- AFIP numbering: durable record of the number an emission sent to AFIP.
--
-- issue-invoice now reads FECompUltimoAutorizado and calls FECAESolicitar in
-- ONE Inngest step, so the per-punto-de-venta step concurrency limit
-- serializes the whole read-then-authorize window (it used to span two steps,
-- and two runs could interleave between them and pick the same number).
--
-- The number cannot live in `numero` until AFIP authorizes it: a rejected
-- emission would hold the slot in the unique numbering index (see the
-- persist-cae note in issue-invoice). It is recorded here instead, BEFORE the
-- AFIP call, so a retry after a lost response knows which number to look up
-- with FECompConsultar and can adopt that CAE rather than emitting the same
-- invoice twice. Not unique: a number an emission attempted but AFIP never
-- registered is legitimately attempted again by the next emission.
--
-- No new table and no RLS change: the column is written only by the Inngest
-- function through the service role, and reads follow the existing invoices
-- policies.

alter table public.invoices
  add column afip_attempted_numero int;

comment on column public.invoices.afip_attempted_numero is
  'Number last sent to AFIP (FECAESolicitar) for this invoice, recorded before the call. Recovery input for issue-invoice; numero holds the authorized number.';

-- Recovery lookup: "did another invoice attempt or hold this number on this
-- punto de venta / comprobante type?"
create index invoices_afip_attempted_numero_idx
  on public.invoices (punto_venta, cbte_tipo_afip, afip_attempted_numero)
  where afip_attempted_numero is not null;
