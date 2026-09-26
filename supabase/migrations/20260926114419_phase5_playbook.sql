-- Phase 5: playbooks — checklist on trades, notes, versioning per edit session.

alter table public.trades add column checklist jsonb not null default '{}'::jsonb
  check (jsonb_typeof(checklist) = 'object');
alter table public.playbooks add column notes_md text;
alter table public.playbook_versions add column edit_session uuid;

create index trades_playbook_version_idx on public.trades (playbook_id, playbook_version);

-- Latest snapshots include the checklist (older rows get the current one), so
-- the first real edit is compared against the full structured state.
update public.playbook_versions v
   set snapshot = v.snapshot || jsonb_build_object(
         'checklist',
         coalesce((select jsonb_agg(c.text order by c.sort, c.created_at)
                     from public.playbook_checklist_items c
                    where c.playbook_id = v.playbook_id and c.deleted_at is null), '[]'::jsonb))
 where not (v.snapshot ? 'checklist');

-- trade_facts expands t.*; recreate it so the new trades.checklist column appears.
drop view public.trade_facts;
create view public.trade_facts
with (security_invoker = true)
as
select
  t.*,
  i.symbol,
  i.asset_class,
  i.exchange,
  d.date as trade_date,
  p.name as playbook_name,
  p.status as playbook_status,
  e.title as event_title,
  e.category as event_category,
  e.primary_domain as event_domain,
  e.importance as event_importance,
  kl.level_type,
  kl.strength as level_strength,
  sp.id as prep_id,
  (sp.completed_at is not null) as prep_done,
  sp.regime,
  sp.prior_day_type,
  sp.vol_state,
  case
    when sp.sleep is not null and sp.energy is not null and sp.focus is not null
      then round((sp.sleep + sp.energy + sp.focus) / 3.0, 2)
  end as readiness,
  case when t.primary_domain is null then 0 else 1 + cardinality(t.secondary_domains) end as domain_count,
  coalesce(tg.tag_ids, '{}') as tag_ids,
  coalesce(tg.tag_names, '{}') as tag_names,
  case when t.net_pnl > 0 then true when t.net_pnl < 0 then false end as is_win,
  i.currency,
  coalesce(md.media_count, 0) as media_count
from public.trades t
join public.instruments i on i.id = t.instrument_id
left join public.trading_days d on d.id = t.day_id
left join public.playbooks p on p.id = t.playbook_id
left join public.calendar_events e on e.id = t.calendar_event_id and e.deleted_at is null
left join public.key_levels kl on kl.id = t.key_level_id and kl.deleted_at is null
left join lateral (
  select x.*
    from public.session_preps x
   where x.day_id = t.day_id and x.deleted_at is null
   order by (x.session = case when t.session = 'US' then 'US' else 'EU' end) desc, x.started_at
   limit 1
) sp on true
left join lateral (
  select array_agg(tt.tag_id order by g.name) as tag_ids, array_agg(g.name order by g.name) as tag_names
    from public.trade_tags tt
    join public.tags g on g.id = tt.tag_id and g.deleted_at is null
   where tt.trade_id = t.id
) tg on true
left join lateral (
  select count(*)::int as media_count
    from public.media m
   where m.owner_type = 'trade' and m.owner_id = t.id and m.deleted_at is null
) md on true
where t.deleted_at is null;

-- Save a playbook (fields + checklist) in one transaction and keep its
-- version history: a change to structured fields creates version N+1 once per
-- editing session; later saves in the same session update that version.
-- Notes alone never create a version.
create or replace function public.save_playbook(p jsonb, p_session uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_ids uuid[];
  v_snap jsonb;
  v_last record;
  v_version int;
begin
  if v_id is null or coalesce(trim(p ->> 'name'), '') = '' or (p ->> 'primary_domain') is null then
    raise exception 'save_playbook: id, name and primary domain are required' using errcode = '22023';
  end if;

  insert into public.playbooks as pb (
    id, name, primary_domain, secondary_domains, markets, status, summary,
    context_md, edge_md, trigger_md, stop_md, targets_md, avoid_md, notes_md
  ) values (
    v_id, trim(p ->> 'name'), p ->> 'primary_domain',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'secondary_domains') x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'markets') x), '{}'),
    coalesce(nullif(p ->> 'status', ''), 'idea'),
    nullif(p ->> 'summary', ''), nullif(p ->> 'context_md', ''), nullif(p ->> 'edge_md', ''),
    nullif(p ->> 'trigger_md', ''), nullif(p ->> 'stop_md', ''), nullif(p ->> 'targets_md', ''),
    nullif(p ->> 'avoid_md', ''), nullif(p ->> 'notes_md', '')
  )
  on conflict (id) do update set
    name = excluded.name, primary_domain = excluded.primary_domain,
    secondary_domains = excluded.secondary_domains, markets = excluded.markets,
    status = excluded.status, summary = excluded.summary, context_md = excluded.context_md,
    edge_md = excluded.edge_md, trigger_md = excluded.trigger_md, stop_md = excluded.stop_md,
    targets_md = excluded.targets_md, avoid_md = excluded.avoid_md, notes_md = excluded.notes_md,
    deleted_at = null;

  -- Checklist (client ids; removed items soft-deleted)
  select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(p -> 'checklist', '[]')) x;
  update public.playbook_checklist_items set deleted_at = now()
   where playbook_id = v_id and deleted_at is null and not (id = any (v_ids));
  insert into public.playbook_checklist_items as c (id, playbook_id, text, sort)
  select (x ->> 'id')::uuid, v_id, trim(x ->> 'text'), ord::int
    from jsonb_array_elements(coalesce(p -> 'checklist', '[]')) with ordinality as t (x, ord)
   where coalesce(trim(x ->> 'text'), '') <> ''
  on conflict (id) do update set text = excluded.text, sort = excluded.sort, deleted_at = null
  where c.playbook_id = v_id;

  -- Structured snapshot (what versions and diffs are about)
  select jsonb_build_object(
           'name', pb.name, 'primary_domain', pb.primary_domain,
           'secondary_domains', to_jsonb(pb.secondary_domains), 'markets', to_jsonb(pb.markets),
           'status', pb.status, 'summary', pb.summary, 'context_md', pb.context_md,
           'edge_md', pb.edge_md, 'trigger_md', pb.trigger_md, 'stop_md', pb.stop_md,
           'targets_md', pb.targets_md, 'avoid_md', pb.avoid_md,
           'checklist', coalesce((select jsonb_agg(c.text order by c.sort, c.created_at)
                                    from public.playbook_checklist_items c
                                   where c.playbook_id = pb.id and c.deleted_at is null), '[]'::jsonb))
    into v_snap
    from public.playbooks pb where pb.id = v_id;

  select v.id, v.version, v.snapshot, v.edit_session into v_last
    from public.playbook_versions v
   where v.playbook_id = v_id and v.deleted_at is null
   order by v.version desc limit 1;

  if v_last.id is null then
    v_version := 1;
    insert into public.playbook_versions (playbook_id, version, snapshot, edit_session)
    values (v_id, 1, v_snap, p_session);
  elsif v_last.snapshot = v_snap then
    v_version := v_last.version;
  elsif v_last.edit_session is not distinct from p_session and p_session is not null then
    v_version := v_last.version;
    update public.playbook_versions set snapshot = v_snap where id = v_last.id;
  else
    v_version := v_last.version + 1;
    insert into public.playbook_versions (playbook_id, version, snapshot, edit_session)
    values (v_id, v_version, v_snap, p_session);
  end if;

  update public.playbooks set version = v_version where id = v_id and version <> v_version;
  return v_version;
end;
$$;

revoke all on function public.save_playbook(jsonb, uuid) from public, anon;
grant execute on function public.save_playbook(jsonb, uuid) to authenticated;
