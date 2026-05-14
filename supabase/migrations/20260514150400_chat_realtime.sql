-- Realtime publication para el subsistema de chat. Postgres Changes
-- respeta RLS, así que cada user solo recibe eventos de canales en los
-- que es miembro. chat_channel_members no va — los cambios de
-- membresía son raros y el refetch en mount alcanza.

alter publication supabase_realtime add table public.chat_channels;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_message_reactions;
