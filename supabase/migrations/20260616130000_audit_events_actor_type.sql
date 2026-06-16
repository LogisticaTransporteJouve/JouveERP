-- AI.0 — add actor_type to audit_events so AI-originated audit entries can be
-- distinguished from human and system actions (AI Intelligence, Fase I).
--
-- The MVP agent is read-only, so the only AI-audited action initially is the
-- guarded read-only SQL escape hatch (logAudit with actor_type='ai-agent').
-- Future write tools will each log with actor_type='ai-agent' too. Default
-- 'user' keeps every existing call site (logAudit) correct without changes.

alter table public.audit_events
  add column actor_type text not null default 'user'
  check (actor_type in ('user', 'ai-agent', 'system'));

comment on column public.audit_events.actor_type is
  'Who triggered the event: user (default) | ai-agent | system.';
