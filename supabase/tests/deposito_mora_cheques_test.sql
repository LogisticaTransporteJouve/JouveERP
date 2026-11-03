-- Roadmap 4.4 + 4.6: a pallet's area belongs to its warehouse, a blocked
-- pallet does not leave nor get deleted, area tariffs overlap only the
-- client's general one; late-interest charges never overlap per comprobante
-- and a void ND frees its period; a check sale moves the face value out of
-- the cartera, keeps the net in the account, owns its movements and a sold
-- check bounces back from the account the buyer is repaid from.
-- One transaction, rolled back.

begin;

select plan(45);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000045a1', 'finance@deposito.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000045a1', 'finance');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000045c1', false, null, 'Cliente Depósito Mora', null);

insert into public.warehouses (id, name) values
  ('00000000-0000-0000-0000-0000000045b1', 'Depósito Norte'),
  ('00000000-0000-0000-0000-0000000045b2', 'Depósito Sur');
insert into public.storage_areas (id, warehouse_id, name) values
  ('00000000-0000-0000-0000-0000000045e1', '00000000-0000-0000-0000-0000000045b1', 'Cámara de frío'),
  ('00000000-0000-0000-0000-0000000045e2', '00000000-0000-0000-0000-0000000045b2', 'Granel');

-- 1. Grants -------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.sell_checks(uuid[], uuid, date, text, text, text, numeric, numeric, text, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.sell_checks(uuid[], uuid, date, text, text, text, numeric, numeric, text, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.late_interest_candidates(date)', 'execute')
  and not has_function_privilege('anon', 'public.late_interest_candidates(date)', 'execute'),
  'only the service role sells checks and lists late-interest candidates'
);

select ok(
  not has_function_privilege('authenticated', 'public.guard_pallet_blocked()', 'execute')
  and not has_function_privilege('authenticated', 'public.guard_late_interest_charge()', 'execute')
  and not has_function_privilege('authenticated', 'public.late_interest_charge_is_live(public.late_interest_charges)', 'execute'),
  'nobody calls the guards directly'
);

-- 2. Areas, lots and blocks --------------------------------------------------------------

select throws_ok(
  $$insert into public.pallets (warehouse_id, client_id, code, entry_date, area_id)
    values ('00000000-0000-0000-0000-0000000045b1', '00000000-0000-0000-0000-0000000045c1',
            'DMC-X', '2026-10-01', '00000000-0000-0000-0000-0000000045e2')$$,
  '23503',
  null,
  'a pallet cannot sit in an area of another warehouse'
);

insert into public.pallets (id, warehouse_id, client_id, code, entry_date, area_id, lot_number, lot_expiry)
values ('00000000-0000-0000-0000-0000000045f1', '00000000-0000-0000-0000-0000000045b1',
        '00000000-0000-0000-0000-0000000045c1', 'DMC-1', '2026-10-01',
        '00000000-0000-0000-0000-0000000045e1', 'L-2026-10', '2027-04-30');

select is(
  (select lot_number || ' ' || lot_expiry::text from public.pallets
    where id = '00000000-0000-0000-0000-0000000045f1'),
  'L-2026-10 2027-04-30',
  'the pallet keeps its lot and expiry'
);

select throws_ok(
  $$update public.pallets set blocked_at = now()
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '23514',
  null,
  'a block needs its reason'
);

update public.pallets
   set blocked_at = now(), blocked_by = '00000000-0000-0000-0000-0000000045a1',
       block_reason = 'Mercadería dañada'
 where id = '00000000-0000-0000-0000-0000000045f1';

select throws_ok(
  $$update public.pallets set status = 'despachado', exit_date = '2026-10-20'
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '55006',
  'El pallet DMC-1 está bloqueado (Mercadería dañada): desbloquealo antes de darle salida.',
  'a blocked pallet cannot be dispatched'
);

select throws_ok(
  $$update public.pallets set exit_date = '2026-10-20'
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '55006',
  null,
  'nor get an exit date'
);

select throws_ok(
  $$delete from public.pallets where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '55006',
  null,
  'nor be deleted'
);

select throws_ok(
  $$update public.pallets set warehouse_id = '00000000-0000-0000-0000-0000000045b2'
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '23503',
  null,
  'moving the pallet to another warehouse needs its area cleared'
);

update public.pallets set blocked_at = null, blocked_by = null, block_reason = null
 where id = '00000000-0000-0000-0000-0000000045f1';

select lives_ok(
  $$update public.pallets set status = 'despachado', exit_date = '2026-10-20'
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  'once unblocked it leaves'
);

select throws_ok(
  $$update public.pallets set blocked_at = now(), block_reason = 'tarde'
     where id = '00000000-0000-0000-0000-0000000045f1'$$,
  '55006',
  'Solo se bloquea un pallet en depósito: el pallet DMC-1 ya salió.',
  'a pallet that left cannot be blocked'
);

-- 3. Area tariffs ------------------------------------------------------------------------

insert into public.client_tariffs (client_id, concept, unit, price, valid_from) values
  ('00000000-0000-0000-0000-0000000045c1', 'storage', 'pallet_day', 10, '2026-01-01');

select lives_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from, area_id)
    values ('00000000-0000-0000-0000-0000000045c1', 'storage', 'pallet_day', 25, '2026-01-01',
            '00000000-0000-0000-0000-0000000045e1')$$,
  'an area tariff may overlap the client''s tariff for every area'
);

select throws_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from, area_id)
    values ('00000000-0000-0000-0000-0000000045c1', 'storage', 'pallet_day', 30, '2026-06-01',
            '00000000-0000-0000-0000-0000000045e1')$$,
  '23P01',
  null,
  'two tariffs of one area and concept do not overlap'
);

select throws_ok(
  $$insert into public.client_tariffs (client_id, concept, unit, price, valid_from, area_id)
    values ('00000000-0000-0000-0000-0000000045c1', 'freight', 'shipment', 100, '2026-01-01',
            '00000000-0000-0000-0000-0000000045e1')$$,
  '23514',
  null,
  'flete has no area'
);

select is(
  (select price from public.client_tariff_at('00000000-0000-0000-0000-0000000045c1', 'storage', '2026-06-01')),
  10::numeric,
  'client_tariff_at keeps returning the tariff for every area'
);

-- 4. RLS: finance reads no areas (it reads them through the service client) --------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000045a1","role":"authenticated"}', true);

select is((select count(*) from public.storage_areas), 0::bigint,
  'finance does not read storage_areas directly');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 5. Late interest -----------------------------------------------------------------------

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key)
values
  ('00000000-0000-0000-0000-0000000045d1', 'jouve_internal', '00000000-0000-0000-0000-0000000045c1',
   'factura', null, 9001, 99981, '2026-09-01', '2026-10-01', 2, 99, '0', 10000, 0, 10000, 'emitted',
   'mora-test-1');

create temp table t_cand on commit drop as
  select * from public.late_interest_candidates('2026-10-31');

select is(
  (select charge_from from t_cand where invoice_id = '00000000-0000-0000-0000-0000000045d1'),
  '2026-10-02'::date,
  'an overdue factura is charged from the day after its due date'
);

select throws_ok(
  $$insert into public.late_interest_charges
      (invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
    values ('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045c1',
            '2026-10-01', '2026-10-31', 3, 10000, 310, 'PES')$$,
  '23514',
  null,
  'interest does not run on the due date'
);

insert into public.late_interest_charges
  (id, invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
values ('00000000-0000-0000-0000-0000000045d9', '00000000-0000-0000-0000-0000000045d1',
        '00000000-0000-0000-0000-0000000045c1', '2026-10-02', '2026-10-31', 3, 10000, 300, 'PES');

select throws_ok(
  $$insert into public.late_interest_charges
      (invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
    values ('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045c1',
            '2026-10-15', '2026-11-05', 3, 10000, 210, 'PES')$$,
  '23P01',
  'Ya se cobraron intereses de ese comprobante del 02/10/2026 al 31/10/2026.',
  'a period already charged is not charged again'
);

select throws_ok(
  $$update public.late_interest_charges set monthly_rate = 5
     where id = '00000000-0000-0000-0000-0000000045d9'$$,
  '55006',
  null,
  'a charge is not edited'
);

select throws_ok(
  $$delete from public.late_interest_charges where id = '00000000-0000-0000-0000-0000000045d9'$$,
  '55006',
  null,
  'nor deleted while live'
);

select throws_ok(
  $$update public.late_interest_charges set nd_invoice_id = '00000000-0000-0000-0000-0000000045d1'
     where id = '00000000-0000-0000-0000-0000000045d9'$$,
  '23514',
  null,
  'only an ND on the overdue comprobante is linked'
);

insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-0000000045d2', 'jouve_internal', '00000000-0000-0000-0000-0000000045c1',
   'nd', null, 9001, 99982, '2026-10-31', 2, 99, '0', 300, 0, 300, 'emitted',
   '00000000-0000-0000-0000-0000000045d9', '00000000-0000-0000-0000-0000000045d1');

select lives_ok(
  $$update public.late_interest_charges set nd_invoice_id = '00000000-0000-0000-0000-0000000045d2'
     where id = '00000000-0000-0000-0000-0000000045d9'$$,
  'the ND is linked to its charge'
);

select throws_ok(
  $$insert into public.late_interest_charges
      (invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
    values ('00000000-0000-0000-0000-0000000045d2', '00000000-0000-0000-0000-0000000045c1',
            '2026-11-01', '2026-11-30', 3, 300, 9, 'PES')$$,
  '23514',
  'No se cobran intereses sobre una nota de débito de intereses.',
  'no interest on an interest ND'
);

create temp table t_cand2 on commit drop as
  select * from public.late_interest_candidates('2026-11-30');

select is(
  (select charge_from from t_cand2 where invoice_id = '00000000-0000-0000-0000-0000000045d1'),
  '2026-11-01'::date,
  'the next charge starts after the last charged day'
);

select is_empty(
  $$select 1 from t_cand2 where invoice_id = '00000000-0000-0000-0000-0000000045d2'$$,
  'an interest ND is not a candidate'
);

update public.invoices set status = 'cancelled'
 where id = '00000000-0000-0000-0000-0000000045d2';

select ok(
  (select released from public.late_interest_charges where id = '00000000-0000-0000-0000-0000000045d9'),
  'cancelling the ND releases its charge'
);

select lives_ok(
  $$insert into public.late_interest_charges
      (invoice_id, client_id, period_from, period_to, monthly_rate, base_amount, interest_amount, moneda)
    values ('00000000-0000-0000-0000-0000000045d1', '00000000-0000-0000-0000-0000000045c1',
            '2026-10-02', '2026-10-31', 3, 10000, 300, 'PES')$$,
  'a released period can be charged again'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000045a1","role":"authenticated"}', true);
select is((select count(*) from public.late_interest_charges), 2::bigint,
  'finance reads the charges');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 6. Check sales -------------------------------------------------------------------------

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-0000000045a7', 'Cartera venta', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-0000000045a8', 'Banco venta', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000000045a9', 'Otro banco venta', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-0000000045aa', 'Banco USD venta', 'bank', 'USD');

insert into public.checks
  (id, kind, check_number, bank_name, drawer_name, issue_date, due_date, amount, currency,
   source_kind, cartera_account_id, channel_id)
values
  ('00000000-0000-0000-0000-000000004561', 'fisico', 'VT-1', 'Banco X', 'Firmante', current_date, current_date + 60, 100, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000045a7', 'jouve_internal'),
  ('00000000-0000-0000-0000-000000004562', 'fisico', 'VT-2', 'Banco X', 'Firmante', current_date, current_date + 90, 50, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000045a7', 'jouve_internal'),
  ('00000000-0000-0000-0000-000000004563', 'fisico', 'VT-3', 'Banco X', 'Firmante', current_date, current_date + 30, 20, 'ARS',
   'manual', '00000000-0000-0000-0000-0000000045a7', 'jouve_internal');

create temp table t_sale on commit drop as
  select public.sell_checks(
    array['00000000-0000-0000-0000-000000004561', '00000000-0000-0000-0000-000000004562']::uuid[],
    '00000000-0000-0000-0000-0000000045a8', current_date, 'jouve_internal', 'Banco Y', null,
    10, 5, null, '00000000-0000-0000-0000-000000004571', null) as id;

select is(
  (select count(*) from public.checks
    where id in ('00000000-0000-0000-0000-000000004561', '00000000-0000-0000-0000-000000004562')
      and status = 'vendido'),
  2::bigint,
  'the sold checks leave the cartera as vendido'
);

select is(
  (select sum(case when kind in ('income', 'transfer_in') then amount else -amount end)
     from public.transactions where account_id = '00000000-0000-0000-0000-0000000045a8'),
  135::numeric,
  'the account keeps the net: face value less interest and commission'
);

select is(
  (select sum(amount) from public.transactions
    where account_id = '00000000-0000-0000-0000-0000000045a7' and kind = 'transfer_out'),
  150::numeric,
  'the face value leaves the cartera'
);

select is(
  (select net_amount from public.check_sales where id = (select id from t_sale)),
  135::numeric,
  'the sale records its net'
);

select is(
  public.sell_checks(
    array['00000000-0000-0000-0000-000000004561', '00000000-0000-0000-0000-000000004562']::uuid[],
    '00000000-0000-0000-0000-0000000045a8', current_date, 'jouve_internal', 'Banco Y', null,
    10, 5, null, '00000000-0000-0000-0000-000000004571', null),
  (select id from t_sale),
  'a retry with the same key returns the same sale'
);

select is(
  (select count(*) from public.transactions where check_sale_id = (select id from t_sale)),
  6::bigint,
  'and writes nothing more: a transfer pair per check and two expenses'
);

select ok(
  (select bool_and(expense_account_id is not distinct from (
            select c.id from public.chart_of_accounts c
             where c.system_role = 'intereses_pagados' and c.is_active
               and public.is_postable_expense_account(c.id)
             limit 1))
     from public.transactions
    where check_sale_id = (select id from t_sale) and kind = 'expense'),
  'interest and commission are imputed to Intereses pagados'
);

select throws_ok(
  $$select public.sell_checks(array['00000000-0000-0000-0000-000000004561']::uuid[],
      '00000000-0000-0000-0000-0000000045a8', current_date, 'jouve_internal', 'Banco Y', null,
      0, 0, null, '00000000-0000-0000-0000-000000004572', null)$$,
  '55006',
  null,
  'a check that left the cartera is not sold again'
);

select throws_ok(
  $$select public.sell_checks(array['00000000-0000-0000-0000-000000004563']::uuid[],
      '00000000-0000-0000-0000-0000000045a8', current_date, 'jouve_internal', 'Banco Y', null,
      15, 5, null, '00000000-0000-0000-0000-000000004573', null)$$,
  '23514',
  null,
  'the cost cannot reach the face value'
);

select throws_ok(
  $$select public.sell_checks(array['00000000-0000-0000-0000-000000004563']::uuid[],
      '00000000-0000-0000-0000-0000000045aa', current_date, 'jouve_internal', 'Banco Y', null,
      1, 0, null, '00000000-0000-0000-0000-000000004574', null)$$,
  '23514',
  null,
  'the account is in the currency of the checks'
);

select throws_ok(
  $$delete from public.transactions
     where id = (select id from public.transactions
                  where check_sale_id = (select id from t_sale) and kind = 'expense' limit 1)$$,
  '55006',
  null,
  'a movement of the sale is not deleted'
);

select throws_ok(
  $$update public.transactions set amount = 1
     where id = (select id from public.transactions
                  where check_sale_id = (select id from t_sale) and kind = 'expense' limit 1)$$,
  '55006',
  null,
  'nor edited'
);

select is(
  (select count(*) from public.v_transactions_tagged v
     join public.transactions t on t.id = v.id
    where t.check_sale_id = (select id from t_sale) and v.source_document = 'check_sale'),
  6::bigint,
  'Tesorería tags the movements as the sale''s'
);

select lives_ok(
  $$select public.reject_check('00000000-0000-0000-0000-000000004561', null, current_date, null, null)$$,
  'a sold check can bounce'
);

select is(
  (select account_id from public.transactions
    where rejected_check_id = '00000000-0000-0000-0000-000000004561'),
  '00000000-0000-0000-0000-0000000045a8'::uuid,
  'by default the buyer is repaid from the sale''s account'
);

select public.reject_check('00000000-0000-0000-0000-000000004562',
  '00000000-0000-0000-0000-0000000045a9', current_date, null, null);

select is(
  (select account_id from public.transactions
    where rejected_check_id = '00000000-0000-0000-0000-000000004562'),
  '00000000-0000-0000-0000-0000000045a9'::uuid,
  'or from the account the user picks'
);

select * from finish();
rollback;
