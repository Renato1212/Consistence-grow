-- Phase 2: image thumbnails and trash queries.

alter table public.media add column thumb_path text;

create index trades_user_deleted_idx on public.trades (user_id, deleted_at) where deleted_at is not null;
create index media_user_deleted_idx on public.media (user_id, deleted_at) where deleted_at is not null;

-- trade_facts: add instrument currency and media count (appended columns).
create or replace view public.trade_facts
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
