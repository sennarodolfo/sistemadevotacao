-- =================================================================
-- Migração 0017: Corrige perda de votos ao editar sessão + move
-- "membros presentes" para o nível da eleição (vale para todas as sessões)
-- =================================================================
-- BUG GRAVE encontrado: admin_update_session, ao salvar QUALQUER edição
-- de sessão (inclusive só mudar o número de membros presentes), sempre
-- fazia "DELETE de todos os candidatos + INSERT de volta com IDs NOVOS".
-- Como votes.candidate_id tem "on delete set null", isso desligava
-- (zerava) TODOS os votos já registrados daquela sessão a cada edição -
-- os votos continuavam existindo na tabela, mas órfãos (candidate_id
-- nulo), então paravam de contar para qualquer candidato.
--
-- Correção: admin_update_session agora faz UPSERT dos candidatos -
-- quem já existia (tem "id" e pertence à sessão) é ATUALIZADO no lugar
-- (preserva o ID, e portanto os votos já contados para ele); só quem é
-- novo na lista recebe um ID novo; só quem foi de fato removido da
-- lista é apagado (aí sim os votos dele ficam órfãos, o que é o
-- esperado quando o candidato deixa de existir).
--
-- Além disso: "membros presentes" deixa de ser um campo por SESSÃO e
-- passa a ser um campo único da ELEIÇÃO (aba "Geral"), usado para
-- calcular o percentual/maioria absoluta em TODAS as sessões - como
-- pedido, já que é o mesmo grupo de pessoas presentes na assembleia
-- inteira, não um número que muda sessão a sessão.
-- =================================================================

alter table public.elections add column if not exists registered_voters integer;

-- Preenche o valor da eleição a partir do maior valor já configurado em
-- alguma sessão (dado antigo, para não perder configuração existente).
update public.elections e
set registered_voters = sub.max_rv
from (
  select election_id, max(registered_voters) as max_rv
  from public.voting_sessions
  where registered_voters is not null
  group by election_id
) sub
where e.id = sub.election_id and e.registered_voters is null;

-- ============== admin_update_election: + p_registered_voters ==============
drop function if exists public.admin_update_election(uuid, text, text, text, integer);

create or replace function public.admin_update_election(
  p_election_id uuid,
  p_password text,
  p_name text,
  p_location_name text,
  p_code_digits integer,
  p_registered_voters integer
) returns json as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  if p_code_digits is not null and (p_code_digits < 4 or p_code_digits > 8) then
    return json_build_object('error', 'invalid_code_digits');
  end if;
  if p_registered_voters is not null and p_registered_voters < 0 then
    return json_build_object('error', 'invalid_registered_voters');
  end if;

  update public.elections
    set name = p_name,
        location_name = p_location_name,
        code_digits = coalesce(p_code_digits, code_digits),
        registered_voters = p_registered_voters,
        updated_at = now()
  where id = p_election_id;

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_update_election(uuid, text, text, text, integer, integer) to anon, authenticated;

-- ============== get_public_election: registered_voters no nível da eleição ==============
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

-- ============== admin_get_results: registered_voters vem da eleição ==============
create or replace function public.admin_get_results(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  result json;
  v_registered_voters integer;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select registered_voters into v_registered_voters
  from public.elections where id = p_election_id;

  select json_agg(row_to_json(r)) into result
  from (
    select
      vs.id as session_id,
      vs.title,
      vs.votes_required,
      v_registered_voters as registered_voters,
      vs.display_order,
      coalesce(
        (select json_agg(json_build_object('id', c.id, 'name', c.name, 'photo_url', c.photo_url, 'votes',
          (select count(*) from public.votes v where v.candidate_id = c.id))
          order by (select count(*) from public.votes v where v.candidate_id = c.id) desc)
         from public.candidates c where c.session_id = vs.id),
        '[]'::json
      ) as candidates,
      (select count(*) from public.votes v where v.session_id = vs.id and v.is_blank = true) as blank_votes,
      (select count(distinct voter_token) from public.voter_completions where session_id = vs.id) as unique_voters
    from public.voting_sessions vs
    where vs.election_id = p_election_id
    group by vs.id, vs.title, vs.votes_required, vs.display_order
    order by vs.display_order
  ) r;

  return coalesce(result, '[]'::json);
end;
$$ language plpgsql security definer;

-- ============== admin_create_session: sem registered_voters (agora é da eleição) ==============
drop function if exists public.admin_create_session(uuid, text, text, integer, integer, jsonb);

create or replace function public.admin_create_session(
  p_election_id uuid,
  p_password text,
  p_title text,
  p_votes_required integer,
  p_candidates jsonb
) returns json as $$
declare
  ok boolean;
  new_session_id uuid;
  new_order integer;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select coalesce(max(display_order), 0) + 1 into new_order
  from public.voting_sessions
  where election_id = p_election_id;

  insert into public.voting_sessions (election_id, title, votes_required, display_order)
  values (p_election_id, p_title, p_votes_required, new_order)
  returning id into new_session_id;

  if p_candidates is not null then
    insert into public.candidates (session_id, name, photo_url, display_order)
    select new_session_id, trim(c->>'name'), nullif(trim(coalesce(c->>'photo_url', '')), ''), row_number() over ()
    from jsonb_array_elements(p_candidates) as c
    where trim(coalesce(c->>'name', '')) <> '';
  end if;

  return json_build_object('id', new_session_id);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_create_session(uuid, text, text, integer, jsonb) to anon, authenticated;

-- ============== admin_update_session: UPSERT de candidatos (corrige o bug) ==============
drop function if exists public.admin_update_session(uuid, text, uuid, text, integer, integer, jsonb, boolean);

create or replace function public.admin_update_session(
  p_election_id uuid,
  p_password text,
  p_session_id uuid,
  p_title text,
  p_votes_required integer,
  p_candidates jsonb,
  p_is_active boolean
) returns boolean as $$
declare
  ok boolean;
  v_kept_ids uuid[] := '{}';
  c jsonb;
  v_order integer := 0;
  v_id uuid;
  v_name text;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  update public.voting_sessions
    set title = p_title,
        votes_required = p_votes_required,
        is_active = p_is_active
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
        -- Candidato já existia nesta sessão: ATUALIZA no lugar, preservando
        -- o ID (e portanto os votos já registrados para ele) - é isso que
        -- corrige o bug de votos "sumindo" ao editar a sessão.
        update public.candidates
          set name = v_name,
              photo_url = nullif(trim(coalesce(c->>'photo_url', '')), ''),
              display_order = v_order
          where id = (c->>'id')::uuid;
        v_kept_ids := array_append(v_kept_ids, (c->>'id')::uuid);
      else
        -- Candidato novo (não tinha ID ou o ID não pertence a esta sessão): insere.
        insert into public.candidates (session_id, name, photo_url, display_order)
        values (p_session_id, v_name, nullif(trim(coalesce(c->>'photo_url', '')), ''), v_order)
        returning id into v_id;
        v_kept_ids := array_append(v_kept_ids, v_id);
      end if;
    end loop;

    -- Remove só quem realmente saiu da lista (não foi mantido/criado
    -- acima) - os votos desse candidato ficam órfãos, o que é o
    -- comportamento correto quando ele é removido de propósito.
    delete from public.candidates
    where session_id = p_session_id
      and not (id = any(v_kept_ids));
  end if;

  return true;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_update_session(uuid, text, uuid, text, integer, jsonb, boolean) to anon, authenticated;

-- ============== admin_export_election: registered_voters no nível da eleição ==============
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
    'backup_version', 3,
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

-- ============== admin_import_election: registered_voters no nível da eleição ==============
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
      insert into public.voting_sessions
        (id, election_id, title, description, votes_required, display_order, is_active)
      values (
        coalesce((v_session->>'id')::uuid, gen_random_uuid()),
        p_election_id,
        v_session->>'title',
        v_session->>'description',
        coalesce((v_session->>'votes_required')::integer, 1),
        coalesce((v_session->>'display_order')::integer, v_session_count),
        coalesce((v_session->>'is_active')::boolean, true)
      )
      returning id into v_session_id;

      v_session_count := v_session_count + 1;

      -- Compatibilidade com backups antigos (backup_version 2), que
      -- guardavam "membros presentes" por sessão - se a eleição não
      -- tiver o valor (backup ainda mais antigo ou vazio), aproveita o
      -- primeiro valor de sessão encontrado.
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
