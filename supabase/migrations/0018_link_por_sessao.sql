-- =================================================================
-- Migração 0018: Link individual por sessão (janela própria)
-- =================================================================
-- Até aqui, o eleitor digitava o código UMA vez e votava em todas as
-- sessões sequencialmente na MESMA janela/aba. A partir de agora, cada
-- sessão de votação passa a ter um LINK próprio e legível, no formato:
--
--     https://seuprojeto.vercel.app/nome-da-sessao
--
-- Esse link é pensado para ser aberto em uma janela/aba dedicada por
-- sessão (uma urna física por cargo, por exemplo). Cada janela exige
-- que o eleitor digite o código NOVAMENTE, mesmo que ele já tenha
-- votado em outra sessão nesta mesma eleição/dispositivo - ou seja, o
-- código continua valendo para quantas sessões forem necessárias, mas
-- só pode ser usado UMA VEZ POR SESSÃO. Isso já era garantido pelo
-- banco (unique(voter_token, session_id) em voter_completions + a
-- lógica de redeem_voter_code que só bloqueia o código quando TODAS as
-- sessões da eleição forem concluídas - ver migração 0010); esta
-- migração adiciona o que faltava: a identificação de cada sessão por
-- um slug único e público, e uma função para resolver esse slug sem
-- exigir senha (é um link de VOTAÇÃO, não de administração).
-- =================================================================

create extension if not exists "unaccent";

-- ============== COLUNA: voting_sessions.slug ==============
alter table public.voting_sessions add column if not exists slug text;

-- ============== FUNÇÃO: slugify_text ==============
-- Normaliza um texto livre (título da sessão) para um slug de URL:
-- minúsculas, sem acento, só [a-z0-9-], sem hífens nas pontas.
create or replace function public.slugify_text(p_text text)
returns text as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  )
$$ language sql stable;

-- ============== FUNÇÃO: ensure_unique_session_slug ==============
-- Gera um slug único GLOBALMENTE (entre todas as eleições/sessões),
-- já que o link final não carrega o ID da eleição. Se o slug base já
-- existir (em outra sessão que não seja p_session_id), acrescenta um
-- sufixo numérico (-2, -3, ...) até encontrar um livre.
create or replace function public.ensure_unique_session_slug(p_base text, p_session_id uuid default null)
returns text as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 1;
begin
  v_base := coalesce(public.slugify_text(p_base), 'sessao');
  v_candidate := v_base;
  while exists (
    select 1 from public.voting_sessions
    where slug = v_candidate and (p_session_id is null or id <> p_session_id)
  ) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n;
  end loop;
  return v_candidate;
end;
$$ language plpgsql;

-- ============== TRIGGER: preenche slug automaticamente ==============
-- Rede de segurança para qualquer INSERT que não passe pelas RPCs
-- admin_create_session/admin_import_election (ex: supabase/seed/seed.sql,
-- que insere direto na tabela) - se o slug vier vazio, gera um a partir
-- do título automaticamente, do mesmo jeito e com a mesma garantia de
-- unicidade global usada nas RPCs.
create or replace function public.set_default_session_slug()
returns trigger as $$
begin
  if new.slug is null or trim(new.slug) = '' then
    new.slug := public.ensure_unique_session_slug(new.title, new.id);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_session_slug on public.voting_sessions;
create trigger trg_session_slug
  before insert or update on public.voting_sessions
  for each row execute function public.set_default_session_slug();

-- Preenche slug das sessões já existentes (uma de cada vez, para as
-- checagens de unicidade enxergarem as anteriores já preenchidas).
do $$
declare
  r record;
begin
  for r in select id, title from public.voting_sessions where slug is null order by created_at loop
    update public.voting_sessions set slug = public.ensure_unique_session_slug(r.title, r.id) where id = r.id;
  end loop;
end $$;

alter table public.voting_sessions alter column slug set not null;
create unique index if not exists idx_sessions_slug on public.voting_sessions(slug);

-- ============== RPC: resolve_session_link ==============
-- Resolve um slug de URL (ex: "presbiteros-2026") para os dados
-- públicos daquela sessão + da eleição. Pública (sem senha), assim
-- como get_public_election - é o que qualquer pessoa com o link vê
-- antes de digitar o código.
create or replace function public.resolve_session_link(p_slug text)
returns json as $$
declare
  result json;
begin
  select json_build_object(
    'election_id', e.id,
    'election_name', e.name,
    'code_digits', e.code_digits,
    'total_active_sessions', (
      select count(*) from public.voting_sessions vs2
      where vs2.election_id = e.id and vs2.is_active = true
    ),
    'session', json_build_object(
      'id', vs.id,
      'title', vs.title,
      'description', vs.description,
      'votes_required', vs.votes_required,
      'is_active', vs.is_active,
      'slug', vs.slug,
      'candidates', coalesce(
        (select json_agg(json_build_object('id', c.id, 'name', c.name, 'photo_url', c.photo_url) order by c.display_order)
         from public.candidates c where c.session_id = vs.id),
        '[]'::json
      )
    )
  ) into result
  from public.voting_sessions vs
  join public.elections e on e.id = vs.election_id
  where vs.slug = regexp_replace(lower(coalesce(p_slug, '')), '^/+|/+$', '', 'g');

  if result is null then
    return json_build_object('error', 'not_found');
  end if;

  return result;
end;
$$ language plpgsql security definer;

grant execute on function public.resolve_session_link(text) to anon, authenticated;

-- ============== get_public_election: + slug por sessão ==============
create or replace function public.get_public_election(p_election_id uuid)
returns json as $$
declare
  result json;
begin
  select json_build_object(
    'id', e.id,
    'name', e.name,
    'location_name', e.location_name,
    'code_digits', e.code_digits,
    'registered_voters', e.registered_voters,
    'sessions', (
      select coalesce(json_agg(s order by s.display_order), '[]'::json)
      from (
        select
          vs.id,
          vs.title,
          vs.description,
          vs.votes_required,
          vs.display_order,
          vs.is_active,
          vs.slug,
          coalesce(
            (select json_agg(json_build_object('id', c.id, 'name', c.name, 'photo_url', c.photo_url) order by c.display_order)
             from public.candidates c where c.session_id = vs.id),
            '[]'::json
          ) as candidates
        from public.voting_sessions vs
        where vs.election_id = e.id
        order by vs.display_order
      ) s
    )
  ) into result
  from public.elections e
  where e.id = p_election_id;

  return result;
end;
$$ language plpgsql security definer;

-- ============== admin_create_session: + p_slug (opcional) ==============
drop function if exists public.admin_create_session(uuid, text, text, integer, jsonb);

create or replace function public.admin_create_session(
  p_election_id uuid,
  p_password text,
  p_title text,
  p_votes_required integer,
  p_candidates jsonb,
  p_slug text default null
) returns json as $$
declare
  ok boolean;
  new_session_id uuid;
  new_order integer;
  v_slug text;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select coalesce(max(display_order), 0) + 1 into new_order
  from public.voting_sessions
  where election_id = p_election_id;

  v_slug := public.ensure_unique_session_slug(coalesce(nullif(trim(p_slug), ''), p_title));

  insert into public.voting_sessions (election_id, title, votes_required, display_order, slug)
  values (p_election_id, p_title, p_votes_required, new_order, v_slug)
  returning id into new_session_id;

  if p_candidates is not null then
    insert into public.candidates (session_id, name, photo_url, display_order)
    select new_session_id, trim(c->>'name'), nullif(trim(coalesce(c->>'photo_url', '')), ''), row_number() over ()
    from jsonb_array_elements(p_candidates) as c
    where trim(coalesce(c->>'name', '')) <> '';
  end if;

  return json_build_object('id', new_session_id, 'slug', v_slug);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_create_session(uuid, text, text, integer, jsonb, text) to anon, authenticated;

-- ============== admin_update_session: + p_slug (opcional) ==============
drop function if exists public.admin_update_session(uuid, text, uuid, text, integer, jsonb, boolean);

create or replace function public.admin_update_session(
  p_election_id uuid,
  p_password text,
  p_session_id uuid,
  p_title text,
  p_votes_required integer,
  p_candidates jsonb,
  p_is_active boolean,
  p_slug text default null
) returns json as $$
declare
  ok boolean;
  v_kept_ids uuid[] := '{}';
  c jsonb;
  v_order integer := 0;
  v_id uuid;
  v_name text;
  v_slug text;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  v_slug := public.ensure_unique_session_slug(coalesce(nullif(trim(p_slug), ''), p_title), p_session_id);

  update public.voting_sessions
    set title = p_title,
        votes_required = p_votes_required,
        is_active = p_is_active,
        slug = v_slug
  where id = p_session_id and election_id = p_election_id;

  if p_candidates is not null then
    for c in select * from jsonb_array_elements(p_candidates)
    loop
      v_name := trim(coalesce(c->>'name', ''));
      if v_name = '' then
        continue;
      end if;
      v_order := v_order + 1;

      if (c->>'id') is not null
         and exists (select 1 from public.candidates where id = (c->>'id')::uuid and session_id = p_session_id)
      then
        update public.candidates
          set name = v_name,
              photo_url = nullif(trim(coalesce(c->>'photo_url', '')), ''),
              display_order = v_order
          where id = (c->>'id')::uuid;
        v_kept_ids := array_append(v_kept_ids, (c->>'id')::uuid);
      else
        insert into public.candidates (session_id, name, photo_url, display_order)
        values (p_session_id, v_name, nullif(trim(coalesce(c->>'photo_url', '')), ''), v_order)
        returning id into v_id;
        v_kept_ids := array_append(v_kept_ids, v_id);
      end if;
    end loop;

    delete from public.candidates
    where session_id = p_session_id
      and not (id = any(v_kept_ids));
  end if;

  return json_build_object('success', true, 'slug', v_slug);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_update_session(uuid, text, uuid, text, integer, jsonb, boolean, text) to anon, authenticated;

-- ============== admin_export_election: + slug por sessão ==============
create or replace function public.admin_export_election(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  result json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select json_build_object(
    'backup_version', 4,
    'exported_at', now(),
    'election', (
      select json_build_object(
        'id', e.id,
        'name', e.name,
        'location_name', e.location_name,
        'registered_voters', e.registered_voters
      )
      from public.elections e
      where e.id = p_election_id
    ),
    'sessions', (
      select coalesce(json_agg(
        json_build_object(
          'id', vs.id,
          'title', vs.title,
          'description', vs.description,
          'votes_required', vs.votes_required,
          'display_order', vs.display_order,
          'is_active', vs.is_active,
          'slug', vs.slug,
          'candidates', (
            select coalesce(json_agg(
              json_build_object(
                'id', c.id,
                'name', c.name,
                'photo_url', c.photo_url,
                'display_order', c.display_order
              ) order by c.display_order
            ), '[]'::json)
            from public.candidates c
            where c.session_id = vs.id
          )
        ) order by vs.display_order
      ), '[]'::json)
      from public.voting_sessions vs
      where vs.election_id = p_election_id
    ),
    'votes', (
      select coalesce(json_agg(json_build_object(
        'id', v.id,
        'session_id', v.session_id,
        'candidate_id', v.candidate_id,
        'is_blank', v.is_blank,
        'voter_token', v.voter_token,
        'created_at', v.created_at
      )), '[]'::json)
      from public.votes v
      join public.voting_sessions vs on vs.id = v.session_id
      where vs.election_id = p_election_id
    ),
    'voter_completions', (
      select coalesce(json_agg(json_build_object(
        'id', vc.id,
        'voter_token', vc.voter_token,
        'session_id', vc.session_id,
        'receipt_code', vc.receipt_code,
        'voted_candidates', vc.voted_candidates,
        'blank_count', vc.blank_count,
        'created_at', vc.created_at
      )), '[]'::json)
      from public.voter_completions vc
      join public.voting_sessions vs on vs.id = vc.session_id
      where vs.election_id = p_election_id
    ),
    'election_receipts', (
      select coalesce(json_agg(json_build_object(
        'id', er.id,
        'receipt_code', er.receipt_code,
        'voter_token', er.voter_token,
        'session_completions', er.session_completions,
        'created_at', er.created_at
      )), '[]'::json)
      from public.election_receipts er
      where er.election_id = p_election_id
    ),
    'voter_codes', (
      select coalesce(json_agg(json_build_object(
        'code', vco.code,
        'is_used', vco.is_used,
        'used_at', vco.used_at,
        'first_redeemed_at', vco.first_redeemed_at,
        'created_at', vco.created_at
      )), '[]'::json)
      from public.voter_codes vco
      where vco.election_id = p_election_id
    ),
    'manual_ballot_codes', (
      select coalesce(json_agg(json_build_object(
        'code', mbc.code,
        'is_used', mbc.is_used,
        'used_at', mbc.used_at,
        'first_redeemed_at', mbc.first_redeemed_at,
        'created_at', mbc.created_at
      )), '[]'::json)
      from public.manual_ballot_codes mbc
      where mbc.election_id = p_election_id
    )
  ) into result;

  return result;
end;
$$ language plpgsql security definer;

-- ============== admin_import_election: restaura + gera/preserva slug por sessão ==============
-- Corpo idêntico ao da migração 0017 (mesma lógica de restauração,
-- incluindo o tratamento de erro), só acrescentando a coluna slug no
-- INSERT de voting_sessions: usa o slug do backup se vier preenchido
-- (backups feitos a partir desta migração em diante), senão gera um
-- novo a partir do título - sempre garantindo unicidade global.
drop function if exists public.admin_import_election(uuid, text, json);

create or replace function public.admin_import_election(
  p_election_id uuid,
  p_password text,
  p_data json
) returns json as $$
declare
  ok boolean;
  v_election json;
  v_sessions json;
  v_session json;
  v_candidates json;
  v_session_id uuid;
  v_session_count integer := 0;
  v_candidate_count integer := 0;
  v_votes json;
  v_vote_count integer := 0;
  v_completions json;
  v_completion_count integer := 0;
  v_receipts json;
  v_receipt_count integer := 0;
  v_voter_codes json;
  v_voter_code_count integer := 0;
  v_manual_codes json;
  v_manual_code_count integer := 0;
  v_legacy_rv integer;
  v_slug text;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  if p_data is null then
    return json_build_object('error', 'empty_backup');
  end if;

  v_election := p_data->'election';
  v_sessions := p_data->'sessions';

  if v_election is null and v_sessions is null then
    return json_build_object('error', 'invalid_backup');
  end if;

  if v_election is not null then
    update public.elections
      set name = coalesce(v_election->>'name', name),
          location_name = v_election->>'location_name',
          registered_voters = nullif(v_election->>'registered_voters', '')::integer,
          updated_at = now()
    where id = p_election_id;
  end if;

  if v_sessions is not null then
    delete from public.voting_sessions where election_id = p_election_id;

    for v_session in select * from json_array_elements(v_sessions)
    loop
      v_slug := public.ensure_unique_session_slug(coalesce(nullif(trim(v_session->>'slug'), ''), v_session->>'title'));

      insert into public.voting_sessions
        (id, election_id, title, description, votes_required, display_order, is_active, slug)
      values (
        coalesce((v_session->>'id')::uuid, gen_random_uuid()),
        p_election_id,
        v_session->>'title',
        v_session->>'description',
        coalesce((v_session->>'votes_required')::integer, 1),
        coalesce((v_session->>'display_order')::integer, v_session_count),
        coalesce((v_session->>'is_active')::boolean, true),
        v_slug
      )
      returning id into v_session_id;

      v_session_count := v_session_count + 1;

      if v_legacy_rv is null and v_session->>'registered_voters' is not null then
        v_legacy_rv := nullif(v_session->>'registered_voters', '')::integer;
      end if;

      v_candidates := v_session->'candidates';
      if v_candidates is not null then
        insert into public.candidates (id, session_id, name, photo_url, display_order)
        select
          coalesce((c->>'id')::uuid, gen_random_uuid()),
          v_session_id,
          c->>'name',
          c->>'photo_url',
          coalesce((c->>'display_order')::integer, 0)
        from json_array_elements(v_candidates) c;

        v_candidate_count := v_candidate_count + (select count(*) from json_array_elements(v_candidates));
      end if;
    end loop;

    if v_legacy_rv is not null then
      update public.elections
        set registered_voters = coalesce(registered_voters, v_legacy_rv)
        where id = p_election_id;
    end if;
  end if;

  v_votes := p_data->'votes';
  if v_votes is not null then
    delete from public.votes v
      using public.voting_sessions vs
      where v.session_id = vs.id and vs.election_id = p_election_id;

    insert into public.votes (id, session_id, candidate_id, is_blank, voter_token, created_at)
    select
      coalesce((x->>'id')::uuid, gen_random_uuid()),
      (x->>'session_id')::uuid,
      nullif(x->>'candidate_id', '')::uuid,
      coalesce((x->>'is_blank')::boolean, false),
      x->>'voter_token',
      coalesce((x->>'created_at')::timestamptz, now())
    from json_array_elements(v_votes) x
    where x->>'session_id' is not null and x->>'voter_token' is not null;

    select count(*) into v_vote_count from json_array_elements(v_votes);
  end if;

  v_completions := p_data->'voter_completions';
  if v_completions is not null then
    delete from public.voter_completions vc
      using public.voting_sessions vs
      where vc.session_id = vs.id and vs.election_id = p_election_id;

    insert into public.voter_completions (id, voter_token, session_id, receipt_code, voted_candidates, blank_count, created_at)
    select
      coalesce((x->>'id')::uuid, gen_random_uuid()),
      x->>'voter_token',
      (x->>'session_id')::uuid,
      x->>'receipt_code',
      coalesce((x->'voted_candidates')::jsonb, '[]'::jsonb),
      coalesce((x->>'blank_count')::integer, 0),
      coalesce((x->>'created_at')::timestamptz, now())
    from json_array_elements(v_completions) x
    where x->>'session_id' is not null and x->>'voter_token' is not null and x->>'receipt_code' is not null
    on conflict (receipt_code) do nothing;

    select count(*) into v_completion_count from json_array_elements(v_completions);
  end if;

  v_receipts := p_data->'election_receipts';
  if v_receipts is not null then
    delete from public.election_receipts where election_id = p_election_id;

    insert into public.election_receipts (id, receipt_code, voter_token, election_id, session_completions, created_at)
    select
      coalesce((x->>'id')::uuid, gen_random_uuid()),
      x->>'receipt_code',
      x->>'voter_token',
      p_election_id,
      coalesce((x->'session_completions')::jsonb, '[]'::jsonb),
      coalesce((x->>'created_at')::timestamptz, now())
    from json_array_elements(v_receipts) x
    where x->>'receipt_code' is not null and x->>'voter_token' is not null
    on conflict (receipt_code) do nothing;

    select count(*) into v_receipt_count from json_array_elements(v_receipts);
  end if;

  v_voter_codes := p_data->'voter_codes';
  if v_voter_codes is not null then
    delete from public.voter_codes where election_id = p_election_id;

    insert into public.voter_codes (election_id, code, is_used, used_at, first_redeemed_at, created_at)
    select
      p_election_id,
      x->>'code',
      coalesce((x->>'is_used')::boolean, false),
      (x->>'used_at')::timestamptz,
      (x->>'first_redeemed_at')::timestamptz,
      coalesce((x->>'created_at')::timestamptz, now())
    from json_array_elements(v_voter_codes) x
    where x->>'code' is not null
    on conflict (election_id, code) do nothing;

    select count(*) into v_voter_code_count from json_array_elements(v_voter_codes);
  end if;

  v_manual_codes := p_data->'manual_ballot_codes';
  if v_manual_codes is not null then
    delete from public.manual_ballot_codes where election_id = p_election_id;

    insert into public.manual_ballot_codes (election_id, code, is_used, used_at, first_redeemed_at, created_at)
    select
      p_election_id,
      x->>'code',
      coalesce((x->>'is_used')::boolean, false),
      (x->>'used_at')::timestamptz,
      (x->>'first_redeemed_at')::timestamptz,
      coalesce((x->>'created_at')::timestamptz, now())
    from json_array_elements(v_manual_codes) x
    where x->>'code' is not null
    on conflict (election_id, code) do nothing;

    select count(*) into v_manual_code_count from json_array_elements(v_manual_codes);
  end if;

  return json_build_object(
    'success', true,
    'sessions_restored', v_session_count,
    'candidates_restored', v_candidate_count,
    'votes_restored', v_vote_count,
    'completions_restored', v_completion_count,
    'receipts_restored', v_receipt_count,
    'voter_codes_restored', v_voter_code_count,
    'manual_codes_restored', v_manual_code_count
  );
exception when others then
  return json_build_object('error', 'import_failed', 'detail', SQLERRM);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_import_election(uuid, text, json) to anon, authenticated;

-- Força o PostgREST a recarregar o cache do schema imediatamente (ver
-- migração 0017) - evita "Could not find the function ... in the
-- schema cache" logo após aplicar esta migração.
NOTIFY pgrst, 'reload schema';
