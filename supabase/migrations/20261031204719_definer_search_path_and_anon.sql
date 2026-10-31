SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Audit 2026-10-31, RLS M2/M3.
--
-- 1. Every SECURITY DEFINER function in public still on search_path = public
--    moves to search_path = ''. Each body was checked to be fully
--    schema-qualified (plpgsql_check and a re-create of the SQL bodies, both
--    under search_path = ''), so only the setting changes.
alter function public.add_chat_channel_members(uuid,uuid[]) set search_path = '';
alter function public.ai_chat_bump_session() set search_path = '';
alter function public.ai_usage_today() set search_path = '';
alter function public.apply_account_opening_balance(uuid,date,numeric,text,text) set search_path = '';
alter function public.apply_supplier_opening_balance(uuid,date,numeric,text) set search_path = '';
alter function public.apply_vacation_delta(uuid,integer) set search_path = '';
alter function public.bump_rate_limit_bucket(uuid,text,timestamp with time zone) set search_path = '';
alter function public.cleanup_padron_cache(interval) set search_path = '';
alter function public.cleanup_rate_limit_buckets(interval) set search_path = '';
alter function public.clear_account_opening_balance(uuid) set search_path = '';
alter function public.clear_supplier_opening_balance(uuid) set search_path = '';
alter function public.create_chat_group(text,text,uuid[]) set search_path = '';
alter function public.create_journal_entry(date,text,text,jsonb,text,uuid,text,boolean,uuid) set search_path = '';
alter function public.delete_journal_for_transaction() set search_path = '';
alter function public.emit_caea_invoice(uuid,integer,text,date) set search_path = '';
alter function public.ensure_group_has_admin() set search_path = '';
alter function public.get_my_notification_settings() set search_path = '';
alter function public.get_my_unread_notification_count() set search_path = '';
alter function public.get_or_create_self_channel() set search_path = '';
alter function public.guard_invoice_items_immutable() set search_path = '';
alter function public.guard_payment_order_cancel_cashed_check() set search_path = '';
alter function public.guard_receipt_cancel_phantom_checks() set search_path = '';
alter function public.handle_new_user_profile() set search_path = '';
alter function public.invoices_after_delete_journal() set search_path = '';
alter function public.is_employee_document_file(uuid) set search_path = '';
alter function public.list_chat_assignable_users() set search_path = '';
alter function public.list_chat_channels_for_user() set search_path = '';
alter function public.list_my_notifications(text,integer) set search_path = '';
alter function public.mark_all_my_notifications_read() set search_path = '';
alter function public.mark_chat_channel_read(uuid) set search_path = '';
alter function public.next_internal_invoice_numero_atomic(uuid,text,integer,text) set search_path = '';
alter function public.notification_type_enabled(uuid,text) set search_path = '';
alter function public.notify_on_chat_mention() set search_path = '';
alter function public.notify_on_chat_message() set search_path = '';
alter function public.open_or_create_dm(uuid) set search_path = '';
alter function public.payment_orders_after_delete_journal() set search_path = '';
alter function public.purchase_invoices_after_delete_journal() set search_path = '';
alter function public.receipts_after_delete_journal() set search_path = '';
alter function public.refresh_search_index() set search_path = '';
alter function public.refresh_search_index_if_dirty() set search_path = '';
alter function public.release_invoice_billing_links() set search_path = '';
alter function public.search_chat_messages(text,integer,uuid) set search_path = '';
alter function public.search_index_mark_dirty() set search_path = '';
alter function public.search_index_refresh_trigger() set search_path = '';
alter function public.sync_attendance_from_leave() set search_path = '';
alter function public.sync_vacation_balance_used() set search_path = '';
alter function public.update_chat_channel(uuid,text,text) set search_path = '';
alter function public.upsert_my_notification_setting(text,boolean) set search_path = '';
alter function public.user_has_role(text[]) set search_path = '';
alter function public.user_is_channel_member(uuid) set search_path = '';

-- 2. anon has no business calling these: they read the session user
--    (auth.uid()) or check a role inside, and an anonymous caller has
--    neither. No policy is granted to anon, so user_has_role and
--    user_is_channel_member never run for it either. authenticated keeps
--    EXECUTE: the app calls them as the signed-in user.
revoke execute on function public.add_chat_channel_members(uuid,uuid[]) from anon;
revoke execute on function public.apply_account_opening_balance(uuid,date,numeric,text,text) from anon;
revoke execute on function public.apply_supplier_opening_balance(uuid,date,numeric,text) from anon;
revoke execute on function public.clear_account_opening_balance(uuid) from anon;
revoke execute on function public.clear_supplier_opening_balance(uuid) from anon;
revoke execute on function public.create_chat_group(text,text,uuid[]) from anon;
revoke execute on function public.get_my_notification_settings() from anon;
revoke execute on function public.get_my_unread_notification_count() from anon;
revoke execute on function public.get_or_create_self_channel() from anon;
revoke execute on function public.list_chat_channels_for_user() from anon;
revoke execute on function public.list_my_notifications(text,integer) from anon;
revoke execute on function public.mark_all_my_notifications_read() from anon;
revoke execute on function public.mark_chat_channel_read(uuid) from anon;
revoke execute on function public.open_or_create_dm(uuid) from anon;
revoke execute on function public.search_chat_messages(text,integer,uuid) from anon;
revoke execute on function public.update_chat_channel(uuid,text,text) from anon;
revoke execute on function public.upsert_my_notification_setting(text,boolean) from anon;
revoke execute on function public.user_has_role(text[]) from anon;
revoke execute on function public.user_is_channel_member(uuid) from anon;
