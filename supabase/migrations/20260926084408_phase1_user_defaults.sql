-- Phase 1: default reference data per user (instruments, tag vocabulary,
-- rules, draft playbooks, settings). This is the trader's own vocabulary, not
-- fake data: no trades, preps or stats are ever seeded here.
--
-- Idempotent: each block only runs when the user has none of that kind yet,
-- so deleting a seeded tag/rule/playbook never brings it back unexpectedly
-- unless the whole group is empty.

create or replace function private.seed_user_defaults(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g_context uuid;
  g_detail uuid;
  g_mistake uuid;
  g_emotion uuid;
  pb uuid;
begin
  -- Settings -----------------------------------------------------------------
  insert into public.user_settings (user_id) values (p_user) on conflict (user_id) do nothing;

  -- Instruments (tick values verified against CME/CBOT/NYMEX/COMEX/Eurex specs;
  -- fees start at 0 until set in Settings) ----------------------------------
  if not exists (select 1 from public.instruments where user_id = p_user) then
    insert into public.instruments
      (user_id, symbol, name, exchange, asset_class, tick_size, tick_value, currency, exchange_tz, price_format, sort_order)
    values
      (p_user, 'ES',   'E-mini S&P 500',             'CME',   'equity_index', 0.25,       12.50,   'USD', 'America/Chicago', 'decimal',        10),
      (p_user, 'MES',  'Micro E-mini S&P 500',       'CME',   'equity_index', 0.25,       1.25,    'USD', 'America/Chicago', 'decimal',        20),
      (p_user, 'NQ',   'E-mini Nasdaq-100',          'CME',   'equity_index', 0.25,       5.00,    'USD', 'America/Chicago', 'decimal',        30),
      (p_user, 'MNQ',  'Micro E-mini Nasdaq-100',    'CME',   'equity_index', 0.25,       0.50,    'USD', 'America/Chicago', 'decimal',        40),
      (p_user, 'RTY',  'E-mini Russell 2000',        'CME',   'equity_index', 0.10,       5.00,    'USD', 'America/Chicago', 'decimal',        50),
      (p_user, 'YM',   'E-mini Dow ($5)',            'CBOT',  'equity_index', 1,          5.00,    'USD', 'America/Chicago', 'decimal',        60),
      (p_user, 'CL',   'Crude Oil (WTI)',            'NYMEX', 'energy',       0.01,       10.00,   'USD', 'America/Chicago', 'decimal',        70),
      (p_user, 'NG',   'Henry Hub Natural Gas',      'NYMEX', 'energy',       0.001,      10.00,   'USD', 'America/Chicago', 'decimal',        80),
      (p_user, 'GC',   'Gold',                       'COMEX', 'metals',       0.10,       10.00,   'USD', 'America/Chicago', 'decimal',        90),
      (p_user, 'SI',   'Silver',                     'COMEX', 'metals',       0.005,      25.00,   'USD', 'America/Chicago', 'decimal',        100),
      (p_user, 'HG',   'Copper',                     'COMEX', 'metals',       0.0005,     12.50,   'USD', 'America/Chicago', 'decimal',        110),
      (p_user, 'ZT',   '2-Year T-Note',              'CBOT',  'rates',        0.00390625, 7.8125,  'USD', 'America/Chicago', 'thirty_seconds', 120),
      (p_user, 'ZF',   '5-Year T-Note',              'CBOT',  'rates',        0.0078125,  7.8125,  'USD', 'America/Chicago', 'thirty_seconds', 130),
      (p_user, 'ZN',   '10-Year T-Note',             'CBOT',  'rates',        0.015625,   15.625,  'USD', 'America/Chicago', 'thirty_seconds', 140),
      (p_user, 'ZB',   'U.S. Treasury Bond',         'CBOT',  'rates',        0.03125,    31.25,   'USD', 'America/Chicago', 'thirty_seconds', 150),
      (p_user, 'UB',   'Ultra U.S. Treasury Bond',   'CBOT',  'rates',        0.03125,    31.25,   'USD', 'America/Chicago', 'thirty_seconds', 160),
      (p_user, '6E',   'Euro FX',                    'CME',   'fx',           0.00005,    6.25,    'USD', 'America/Chicago', 'decimal',        170),
      (p_user, '6J',   'Japanese Yen',               'CME',   'fx',           0.0000005,  6.25,    'USD', 'America/Chicago', 'decimal',        180),
      (p_user, '6B',   'British Pound',              'CME',   'fx',           0.0001,     6.25,    'USD', 'America/Chicago', 'decimal',        190),
      (p_user, '6A',   'Australian Dollar',          'CME',   'fx',           0.00005,    5.00,    'USD', 'America/Chicago', 'decimal',        200),
      (p_user, 'BTC',  'Bitcoin (CME)',              'CME',   'crypto',       5,          25.00,   'USD', 'America/Chicago', 'decimal',        210),
      (p_user, 'ETH',  'Ether (CME)',                'CME',   'crypto',       0.50,       25.00,   'USD', 'America/Chicago', 'decimal',        220),
      (p_user, 'FGBL', 'Euro-Bund',                  'Eurex', 'rates',        0.01,       10.00,   'EUR', 'Europe/Berlin',   'decimal',        230);
  end if;

  -- Tag vocabulary -------------------------------------------------------------
  if not exists (select 1 from public.tag_groups where user_id = p_user) then
    insert into public.tag_groups (user_id, name, kind, color, sort) values (p_user, 'Context', 'context', '#60A5FA', 10) returning id into g_context;
    insert into public.tag_groups (user_id, name, kind, color, sort) values (p_user, 'Order flow / technical', 'detail', '#A78BFA', 20) returning id into g_detail;
    insert into public.tag_groups (user_id, name, kind, color, sort) values (p_user, 'Mistakes', 'mistake', '#F87171', 30) returning id into g_mistake;
    insert into public.tag_groups (user_id, name, kind, color, sort) values (p_user, 'Emotion / state', 'emotion', '#94A3B8', 40) returning id into g_emotion;

    insert into public.tags (user_id, group_id, name, sort)
    select p_user, g_context, t.name, t.ord * 10
      from unnest(array[
        'trend day', 'balance day', 'open drive', 'open test drive', 'open rejection reverse',
        'open auction in range', 'open auction out of range', 'gap up', 'gap down',
        'inside prior value', 'outside prior value', 'pre-event', 'post-event', 'liquidation',
        'short covering', 'rotational'
      ]) with ordinality as t(name, ord);

    insert into public.tags (user_id, group_id, name, sort)
    select p_user, g_detail, t.name, t.ord * 10
      from unnest(array[
        'absorption', 'iceberg', 'stop run', 'initiative buying', 'initiative selling',
        'delta divergence', 'exhaustion', 'failed auction', 'excess', 'poor high/low',
        'single prints', 'beginning zone first test', 'retest', 'breakout', 'VWAP'
      ]) with ordinality as t(name, ord);

    insert into public.tags (user_id, group_id, name, sort)
    select p_user, g_mistake, t.name, t.ord * 10
      from unnest(array[
        'early entry', 'late entry', 'chased', 'moved stop', 'no stop', 'oversized',
        'revenge trade', 'overtrading', 'cut winner early', 'held loser', 'traded chop',
        'traded into news', 'ignored plan', 'FOMO'
      ]) with ordinality as t(name, ord);

    insert into public.tags (user_id, group_id, name, sort)
    select p_user, g_emotion, t.name, t.ord * 10
      from unnest(array[
        'calm', 'confident', 'hesitant', 'fearful', 'frustrated', 'euphoric', 'tired', 'distracted'
      ]) with ordinality as t(name, ord);
  end if;

  -- Rules ----------------------------------------------------------------------
  if not exists (select 1 from public.rules where user_id = p_user) then
    insert into public.rules (user_id, text, category, sort)
    values (p_user, 'Be flat before any major scheduled news release.', 'risk', 10);
  end if;

  -- Draft playbooks ------------------------------------------------------------
  if not exists (select 1 from public.playbooks where user_id = p_user) then
    insert into public.playbooks
      (user_id, name, primary_domain, secondary_domains, markets, status, summary,
       context_md, edge_md, trigger_md, stop_md, targets_md, avoid_md)
    values (
      p_user,
      'First test of beginning zone — passive limit pullback',
      'TECHNICAL', '{}', array['ES'], 'testing',
      'Passive limit order on the first return to the origin zone of a fast, directional move.',
      $t$- A fast, directional move has just printed, born from liquidation or an information catalyst.
- The move left a clear beginning zone (origin) and has not come back to it yet.
- Market is not in rotational / balance mode.$t$,
      $t$Participants who initiated the move defend their origin on the first return; late traders who missed the move add on the retest. The first test has the cleanest reaction; later tests weaken.$t$,
      $t$Resting limit order at the edge of the beginning zone on the FIRST test only. Look for absorption / passive buyers (sellers) holding at the zone.$t$,
      $t$Beyond the far side of the beginning zone. Invalid if price trades cleanly through the zone.$t$,
      $t$First target: the extreme of the directional move. Manage the runner toward the next higher-timeframe reference.$t$,
      $t$- Second or later test of the zone.
- Choppy / balancing conditions.
- Within the pre-release window of a major scheduled event (be flat).$t$
    ) returning id into pb;

    insert into public.playbook_checklist_items (user_id, playbook_id, text, sort) values
      (p_user, pb, 'Directional move born from liquidation or a catalyst?', 10),
      (p_user, pb, 'Is this the FIRST test of the beginning zone?', 20),
      (p_user, pb, 'No major scheduled release before the trade can play out?', 30),
      (p_user, pb, 'Stop beyond the zone and size within the risk plan?', 40);

    insert into public.playbooks
      (user_id, name, primary_domain, secondary_domains, markets, status, summary,
       context_md, edge_md, trigger_md, stop_md, targets_md, avoid_md)
    values (
      p_user,
      'Month-end fixing window flow',
      'FLOW', '{}', array['6E', '6B', 'FGBL', 'ZN', 'GC', 'CL', 'ES'], 'idea',
      'Study and trade the flows around London month-end fixing windows.',
      $t$Last business day of the month (and quarter/year end). London fixing windows (London time):
- FX: 15:45–16:00
- EU bonds: 16:10–16:15
- Brent: 16:20–16:30
- EU equities: 16:25–16:35
- Gold: 18:25–18:30
- WTI: 19:20–19:30
- Treasuries: 19:55–20:00
- US equities: 20:50–21:00$t$,
      $t$Benchmark-driven rebalancing forces size to trade in narrow windows regardless of price.$t$,
      null, null, null,
      $t$No clear month-end imbalance / no directional pressure into the window.$t$
    );
  end if;

  -- Version 1 snapshot for any playbook without history
  insert into public.playbook_versions (user_id, playbook_id, version, snapshot)
  select p.user_id, p.id, p.version,
         jsonb_build_object(
           'name', p.name, 'primary_domain', p.primary_domain, 'secondary_domains', p.secondary_domains,
           'markets', p.markets, 'status', p.status, 'summary', p.summary, 'context_md', p.context_md,
           'edge_md', p.edge_md, 'trigger_md', p.trigger_md, 'stop_md', p.stop_md,
           'targets_md', p.targets_md, 'avoid_md', p.avoid_md
         )
    from public.playbooks p
   where p.user_id = p_user
     and not exists (select 1 from public.playbook_versions v where v.playbook_id = p.id);
end;
$$;

revoke all on function private.seed_user_defaults(uuid) from public, anon, authenticated;

create or replace function private.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_user_defaults(new.id);
  return new;
end;
$$;

revoke all on function private.on_auth_user_created() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.on_auth_user_created();

-- Existing accounts (production: the owner account created in Phase 0).
select private.seed_user_defaults(id) from auth.users;
