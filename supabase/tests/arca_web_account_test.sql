-- ARCA web account (20261104110601): only the service role saves or reads
-- the clave (Vault); a null clave keeps the stored one; a new clave or CUIT
-- resets the failures; a rejected clave stops automatic sign-ins; owner and
-- admin read the status; finance reads nothing. One
-- transaction, rolled back.

begin;

select plan(14);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ae001', 'owner@arca-web.test'),
  ('00000000-0000-0000-0000-0000000ae002', 'finance@arca-web.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000ae001', 'owner'),
  ('00000000-0000-0000-0000-0000000ae002', 'finance');

-- 1. Grants -----------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.set_arca_web_credentials(text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_arca_web_password()', 'execute')
  and not has_function_privilege('authenticated', 'public.record_arca_web_sign_in(boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.get_arca_web_password()', 'execute'),
  'neither authenticated nor anon can save, read or record the clave'
);

select ok(
  has_function_privilege('service_role', 'public.get_arca_web_password()', 'execute')
  and has_function_privilege('service_role', 'public.set_arca_web_credentials(text, uuid, text)', 'execute'),
  'the service role can'
);

select ok(
  not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'),
  'authenticated cannot read vault.decrypted_secrets'
);

select ok(
  has_table_privilege('authenticated', 'public.arca_web_account', 'select')
  and not has_table_privilege('authenticated', 'public.arca_web_account', 'insert')
  and not has_table_privilege('authenticated', 'public.arca_web_account', 'update')
  and not has_table_privilege('authenticated', 'public.arca_web_account', 'delete'),
  'authenticated only reads the account row'
);

-- 2. Round trip --------------------------------------------------------------------

select throws_ok(
  $$ select public.set_arca_web_credentials('30711111118', null) $$,
  '22023',
  'Falta la clave.',
  'the first save needs a clave'
);

select public.set_arca_web_credentials('30711111118', '00000000-0000-0000-0000-0000000ae001', 'clave-uno');

select is(public.get_arca_web_password(), 'clave-uno', 'the clave reads back');

select public.record_arca_web_sign_in(false, 'SIGN_IN_REJECTED');

select results_eq(
  $$ select status, consecutive_failures, last_error_code from public.arca_web_account $$,
  $$ values ('sign_in_failing'::text, 1::bigint, 'SIGN_IN_REJECTED'::text) $$,
  'a rejected clave is marked'
);

select is(public.get_arca_web_password(), null::text, 'and is not handed out until a new one is saved');

select public.set_arca_web_credentials('30711111118', '00000000-0000-0000-0000-0000000ae001');

select results_eq(
  $$ select (select decrypted_secret collate "default" from vault.decrypted_secrets where name = 'arca_web_password'), status
       from public.arca_web_account $$,
  $$ values ('clave-uno'::text, 'sign_in_failing'::text) $$,
  'saving without a clave keeps the stored one and the failing state'
);

select public.set_arca_web_credentials('30711111118', '00000000-0000-0000-0000-0000000ae001', 'clave-dos');

select results_eq(
  $$ select public.get_arca_web_password() collate "default", status, consecutive_failures from public.arca_web_account $$,
  $$ values ('clave-dos'::text, 'active'::text, 0::bigint) $$,
  'a new clave replaces the secret and resets the failures'
);

select is(
  (select count(*)::int from vault.secrets where name = 'arca_web_password'),
  1,
  'one secret, updated in place'
);

delete from public.arca_web_account;
select public.set_arca_web_credentials('30711111118', '00000000-0000-0000-0000-0000000ae001', 'clave-tres');
select results_eq(
  $$ select public.get_arca_web_password() collate "default",
            (select count(*)::int from vault.secrets where name = 'arca_web_password') $$,
  $$ values ('clave-tres'::text, 1) $$,
  'a secret left by a deleted row is reused, not created again'
);

-- 3. Who reads ---------------------------------------------------------------------

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000ae001","role":"authenticated"}', true);
select is(
  (select cuit from public.arca_web_account),
  '30711111118',
  'the owner reads the account status'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000ae002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.arca_web_account),
  0,
  'finance reads nothing'
);

reset role;

select * from finish();
rollback;
