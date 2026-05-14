-- Endorsement de cheques ahora ocurre vía create_payment_order con line_kind
-- 'endorse_check'. La RPC standalone `endorse_check` queda obsoleta.

drop function if exists public.endorse_check(uuid, date, text, text, text, text);
