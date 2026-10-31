-- SECURITY DEFINER hardening (20261031203522): the functions moved to
-- search_path = '' keep it, and anon cannot execute any public DEFINER
-- function, while authenticated keeps the chat/notification RPCs it calls.
-- Privileges are asserted with has_function_privilege, never by calling a
-- function without EXECUTE. One transaction, rolled back.

begin;

select plan(4);

select is(
  (select array_agg(p.oid::regprocedure::text order by 1)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in (
        'add_chat_channel_members', 'ai_chat_bump_session', 'ai_usage_today',
        'apply_account_opening_balance', 'apply_supplier_opening_balance',
        'apply_vacation_delta', 'bump_rate_limit_bucket', 'cleanup_padron_cache',
        'cleanup_rate_limit_buckets', 'clear_account_opening_balance',
        'clear_supplier_opening_balance', 'create_chat_group', 'create_journal_entry',
        'delete_journal_for_transaction', 'emit_caea_invoice', 'ensure_group_has_admin',
        'get_my_notification_settings', 'get_my_unread_notification_count',
        'get_or_create_self_channel', 'guard_invoice_items_immutable',
        'guard_payment_order_cancel_cashed_check', 'guard_receipt_cancel_phantom_checks',
        'handle_new_user_profile', 'invoices_after_delete_journal',
        'is_employee_document_file', 'list_chat_assignable_users',
        'list_chat_channels_for_user', 'list_my_notifications',
        'mark_all_my_notifications_read', 'mark_chat_channel_read',
        'next_internal_invoice_numero_atomic', 'notification_type_enabled',
        'notify_on_chat_mention', 'notify_on_chat_message', 'open_or_create_dm',
        'payment_orders_after_delete_journal', 'purchase_invoices_after_delete_journal',
        'receipts_after_delete_journal', 'refresh_search_index',
        'refresh_search_index_if_dirty', 'release_invoice_billing_links',
        'search_chat_messages', 'search_index_mark_dirty', 'search_index_refresh_trigger',
        'sync_attendance_from_leave', 'sync_vacation_balance_used', 'update_chat_channel',
        'upsert_my_notification_setting', 'user_has_role', 'user_is_channel_member')
      and not (p.proconfig is not null and 'search_path=""' = any (p.proconfig))),
  null,
  'the normalized DEFINER functions run with search_path = '''''
);

select is(
  (select array_agg(p.oid::regprocedure::text order by 1)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')),
  null,
  'anon executes no public SECURITY DEFINER function'
);

select ok(
  has_function_privilege('authenticated', 'public.list_my_notifications(text,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_unread_notification_count()', 'execute')
  and has_function_privilege('authenticated', 'public.mark_all_my_notifications_read()', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_notification_settings()', 'execute')
  and has_function_privilege('authenticated', 'public.upsert_my_notification_setting(text,boolean)', 'execute'),
  'authenticated keeps the notification RPCs'
);

select ok(
  has_function_privilege('authenticated', 'public.list_chat_channels_for_user()', 'execute')
  and has_function_privilege('authenticated', 'public.get_or_create_self_channel()', 'execute')
  and has_function_privilege('authenticated', 'public.open_or_create_dm(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_chat_group(text,text,uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.mark_chat_channel_read(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.add_chat_channel_members(uuid,uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.update_chat_channel(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.search_chat_messages(text,integer,uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.user_has_role(text[])', 'execute')
  and has_function_privilege('authenticated', 'public.user_is_channel_member(uuid)', 'execute'),
  'authenticated keeps the chat RPCs and the RLS helpers'
);

select * from finish();
rollback;
