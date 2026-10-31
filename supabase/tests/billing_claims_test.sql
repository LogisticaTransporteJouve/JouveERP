-- Freight and storage invoicing claim before issuing: a storage period is
-- claimed once per client and channel, and a billed (or being billed) load
-- keeps what its invoice says. Run as finance (storage) and operations
-- (shipments), the roles the RLS lets write each table. One transaction,
-- rolled back.

begin;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c7', 'finance@billing-claims.test'),
  ('00000000-0000-0000-0000-0000000000c8', 'ops@billing-claims.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000000c7', 'finance'),
  ('00000000-0000-0000-0000-0000000000c8', 'operations');

insert into public.invoicing_channels (id, business_unit_id, division, name, is_fiscal, is_active) values
  ('test_claim_a', 'dz_sons', 'jouve', 'Canal A', false, true),
  ('test_claim_b', 'dz_sons', 'jouve', 'Canal B', false, true);

insert into public.clients (id, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000c701', '30777777778', 'Cliente Claims', 'responsable_inscripto');

insert into public.shipments (id, client_id, freight_amount, invoicing_claimed_at) values
  ('00000000-0000-0000-0000-00000000c801', '00000000-0000-0000-0000-00000000c701', 100, now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c7","role":"authenticated"}', true);

select isnt(
  public.claim_storage_billing_period(
    '00000000-0000-0000-0000-00000000c701', 'test_claim_a', '2026-01-01', '2026-01-31'),
  null,
  'a free period is claimed'
);

select throws_ok(
  $$select public.claim_storage_billing_period(
      '00000000-0000-0000-0000-00000000c701', 'test_claim_a', '2026-01-15', '2026-02-10')$$,
  '23P01',
  'Ese período ya fue facturado (total o parcialmente) para este cliente en este canal.',
  'an overlapping claim on the same channel is refused'
);

select lives_ok(
  $$select public.claim_storage_billing_period(
      '00000000-0000-0000-0000-00000000c701', 'test_claim_b', '2026-01-15', '2026-02-10')$$,
  'the same days can be claimed on another channel'
);

select lives_ok(
  $$select public.claim_storage_billing_period(
      '00000000-0000-0000-0000-00000000c701', 'test_claim_a', '2026-02-11', '2026-02-28')$$,
  'an adjacent period is claimed'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c8","role":"authenticated"}', true);

select throws_ok(
  $$update public.shipments set freight_amount = 200
     where id = '00000000-0000-0000-0000-00000000c801'$$,
  '55006',
  null,
  'a load being billed keeps its freight'
);

select throws_ok(
  $$delete from public.shipments where id = '00000000-0000-0000-0000-00000000c801'$$,
  '55006',
  null,
  'a load being billed cannot be deleted'
);

select lives_ok(
  $$update public.shipments set notes = 'en camino', invoicing_claimed_at = null
     where id = '00000000-0000-0000-0000-00000000c801'$$,
  'notes change and the claim is released'
);

select lives_ok(
  $$delete from public.shipments where id = '00000000-0000-0000-0000-00000000c801'$$,
  'an unbilled load can be deleted'
);

select * from finish();

rollback;
