-- ---------------------------------------------------------------------------
-- The four setup playbooks of the routine (drafts the trader edits).
-- ---------------------------------------------------------------------------
create or replace function private.seed_routine_defaults(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  v_id uuid;
  i int;
begin
  for s in
    select * from (values
      ('euNews', 'EU news event', 'NEWS', array['DATA', 'CENTRAL_BANKS'],
       'Trade only scheduled high-impact European news during the EU session.',
       $t$- A high-impact event is on today's list for the EU window (no event → no EU trade).
- Narrative from Morning Bid Europe and the Claude Pre-Open says why it matters.
- 1h chart context marked: trend or range, key levels.$t$,
       $t$- Wait for the release; trade the first clear reaction in the narrative's direction.$t$,
       $t$- Beyond the release candle.$t$,
       array['High-impact event in the EU window', '1h context and levels marked before the release',
             'Reaction confirms the narrative', 'Stop beyond the release candle']),
      ('usOpen', 'US open — 1h plan', 'TECHNICAL', array['DATA']::text[],
       'Trade the US cash open from a plan made on the 1h chart.',
       $t$- Morning Bid US and the US Pre-Open read; narrative instruments checked on the 1h chart.
- If/then plan written before 14:30 Lisbon.$t$,
       $t$- Entry at a planned 1h level; no chasing the first candle.$t$,
       $t$- Beyond the planned level.$t$,
       array['1h levels marked before the open', 'If/then plan written', 'Entry at a planned level, not chased']),
      ('scalp', 'Midday scalp — 1-min supply/demand', 'TECHNICAL', array['FLOW']::text[],
       'Scalp 1-minute supply and demand from 12:00 to 15:00 New York, with the side that is winning.',
       $t$- Winning side so far: price vs VWAP and the day's open.
- Trend day: the first-hour range broken and held. If the higher timeframe agrees, go with it.$t$,
       $t$- Fresh 1-min supply/demand zone in the direction of the winning side.$t$,
       $t$- Beyond the zone.$t$,
       array['Winning side identified (VWAP / day open)', 'Trading with the winning side',
             'Fresh 1-min zone', 'Higher timeframe aligned on a trend day']),
      ('moc', 'MOC — 5-min breakout', 'FLOW', array['TECHNICAL']::text[],
       'Trade the 5-minute breakout after the 15:50 New York market-on-close imbalance.',
       $t$- MOC imbalance published at 15:50 New York (20:50 Lisbon most of the year).$t$,
       $t$- Breakout of the 5-minute range in the imbalance direction.$t$,
       $t$- Other side of the 5-minute range; flat by the close.$t$,
       array['Imbalance read at 15:50 ET', '5-min range defined', 'Breakout in the imbalance direction',
             'Flat by the close'])
    ) as v(setup, name, domain, secondary, summary, context_md, trigger_md, stop_md, checklist)
  loop
    continue when exists (
      select 1 from public.playbooks p
       where p.user_id = p_user and p.deleted_at is null and p.notes_json ->> 'routine_setup' = s.setup);
    insert into public.playbooks
      (user_id, name, primary_domain, secondary_domains, status, summary, context_md, trigger_md,
       stop_md, notes_json)
    values (p_user, s.name, s.domain, s.secondary, 'testing', s.summary, s.context_md, s.trigger_md,
            s.stop_md, jsonb_build_object('routine_setup', s.setup))
    returning id into v_id;
    for i in 1 .. cardinality(s.checklist) loop
      insert into public.playbook_checklist_items (user_id, playbook_id, text, sort)
      values (p_user, v_id, s.checklist[i], i);
    end loop;
    insert into public.playbook_versions (user_id, playbook_id, version, snapshot)
    select p.user_id, p.id, 1,
           jsonb_build_object(
             'name', p.name, 'primary_domain', p.primary_domain,
             'secondary_domains', to_jsonb(p.secondary_domains), 'markets', to_jsonb(p.markets),
             'status', p.status, 'summary', p.summary, 'context_md', p.context_md,
             'edge_md', p.edge_md, 'trigger_md', p.trigger_md, 'stop_md', p.stop_md,
             'targets_md', p.targets_md, 'avoid_md', p.avoid_md,
             'checklist', to_jsonb(s.checklist))
      from public.playbooks p where p.id = v_id;
  end loop;
end;
$$;
revoke all on function private.seed_routine_defaults(uuid) from public, anon, authenticated;

create or replace function private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_user_defaults(new.id);
  perform private.seed_phase3_defaults(new.id);
  perform private.seed_statement_defaults(new.id);
  perform private.seed_routine_defaults(new.id);
  return new;
end;
$$;

select private.seed_routine_defaults(id) from auth.users;

