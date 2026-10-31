SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A5: the fiscal_reader role, for an external accountant. It reads the fiscal
-- books (comprobantes, compras, libros IVA, asientos, balances) and the basic
-- client/supplier data, and writes nothing: it gets SELECT policies only, and
-- no DEFINER writer lists it in its role check. Every channel-bearing row it
-- can read belongs to a fiscal channel; the internal channels themselves are
-- hidden from it. The matrix entry is in lib/auth/permissions.ts.

insert into public.roles (id, display_name, description, rank)
values ('fiscal_reader', 'Contador externo',
        'Read-only access to fiscal data: invoices, purchases, IVA books and accounting.', 6)
on conflict (id) do nothing;

-- Channels and points of sale: every role keeps seeing all of them; a
-- fiscal_reader (or a user with no role) only the fiscal ones.
drop policy "Authenticated users can view invoicing channels" on public.invoicing_channels;
create policy "Authenticated users can view invoicing channels" on public.invoicing_channels
  for select to authenticated
  using (
    (select public.user_has_role(array['owner','admin','finance','operations','warehouse','driver']))
    or is_fiscal
  );

drop policy "Authenticated users can view puntos de venta" on public.sales_points;
create policy "Authenticated users can view puntos de venta" on public.sales_points
  for select to authenticated
  using (
    (select public.user_has_role(array['owner','admin','finance','operations','warehouse','driver']))
    or public.is_channel_fiscal(channel_id)
  );

-- Reference data without a channel.
create policy "fiscal_reader select" on public.clients
  for select to authenticated
  using ((select public.user_has_role(array['fiscal_reader'])));

create policy "fiscal_reader select" on public.suppliers
  for select to authenticated
  using ((select public.user_has_role(array['fiscal_reader'])));

create policy "fiscal_reader select" on public.chart_of_accounts
  for select to authenticated
  using ((select public.user_has_role(array['fiscal_reader'])));

create policy "fiscal_reader select" on public.accounting_closed_periods
  for select to authenticated
  using ((select public.user_has_role(array['fiscal_reader'])));

-- Fiscal documents and their children.
create policy "fiscal_reader select fiscal" on public.invoices
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and public.is_channel_fiscal(channel_id)
  );

create policy "fiscal_reader select fiscal" on public.invoice_items
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_items.invoice_id
         and public.is_channel_fiscal(i.channel_id)
    )
  );

create policy "fiscal_reader select fiscal" on public.purchase_invoices
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and public.is_channel_fiscal(channel_id)
  );

create policy "fiscal_reader select fiscal" on public.purchase_invoice_items
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and exists (
      select 1 from public.purchase_invoices pi
       where pi.id = purchase_invoice_items.purchase_invoice_id
         and public.is_channel_fiscal(pi.channel_id)
    )
  );

create policy "fiscal_reader select fiscal" on public.journal_entries
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and public.is_channel_fiscal(channel_id)
  );

create policy "fiscal_reader select fiscal" on public.journal_entry_lines
  for select to authenticated
  using (
    (select public.user_has_role(array['fiscal_reader']))
    and exists (
      select 1 from public.journal_entries je
       where je.id = journal_entry_lines.journal_entry_id
         and public.is_channel_fiscal(je.channel_id)
    )
  );
