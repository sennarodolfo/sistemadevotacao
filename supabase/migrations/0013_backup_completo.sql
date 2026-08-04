-- =================================================================
-- Migração 0013: Backup completo (votos, comprovantes, códigos)
-- =================================================================
-- Até aqui, o backup só continha a ESTRUTURA da eleição (nome, sessões,
-- candidatos) - não os dados da votação em si. Esta migração expande
-- admin_export_election / admin_import_election para incluir TODA a
-- base relacionada à eleição:
--
--   - sessions + candidates (já existia)
--   - votes                 -> cada voto individual (candidato/branco)
--   - voter_completions     -> quais sessões cada código já concluiu
--   - election_receipts     -> comprovantes finais emitidos
--   - voter_codes           -> códigos do eleitor (usados/disponíveis)
--   - manual_ballot_codes   -> cédulas manuais (usadas/disponíveis)
--
-- Restaurar um backup agora recria o estado EXATO de quando ele foi
-- gerado: mesmos votos, mesmos comprovantes, mesmos códigos com o
-- mesmo status de uso. A ordem de restauração respeita as dependências
-- (sessões/candidatos primeiro, depois votos/conclusões, que apontam
-- para eles).
-- =================================================================

-- ============== admin_export_election: backup completo ==============
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
    'backup_version', 2,
    'exported_at', now(),
    'election', (
      select json_build_object(
        'id', e.id,
        'name', e.name,
        'location_name', e.location_name
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
          'registered_voters', vs.registered_voters,
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

-- ============== admin_import_election: restauração completa ==============
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
          updated_at = now()
    where id = p_election_id;
  end if;

  -- Sessões + candidatos. Apagar as sessões existentes já apaga, em
  -- cascata, os votos e conclusões antigos dessas sessões - por isso
  -- votos/conclusões são reinseridos DEPOIS, a partir do backup.
  if v_sessions is not null then
    delete from public.voting_sessions where election_id = p_election_id;

    for v_session in select * from json_array_elements(v_sessions)
    loop
      insert into public.voting_sessions
        (id, election_id, title, description, votes_required, registered_voters, display_order, is_active)
      values (
        coalesce((v_session->>'id')::uuid, gen_random_uuid()),
        p_election_id,
        v_session->>'title',
        v_session->>'description',
        coalesce((v_session->>'votes_required')::integer, 1),
        nullif(v_session->>'registered_voters', '')::integer,
        coalesce((v_session->>'display_order')::integer, v_session_count),
        coalesce((v_session->>'is_active')::boolean, true)
      )
      returning id into v_session_id;

      v_session_count := v_session_count + 1;

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
  end if;

  -- Votos individuais (candidato ou branco). Limpa antes de reinserir,
  -- independente da limpeza em cascata acima (defensivo/idempotente).
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

  -- Conclusões de sessão (registro de "este código já votou nesta
  -- sessão"), necessárias pra manter a regra de bloqueio e permitir
  -- retomar corretamente após a restauração.
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

  -- Comprovantes finais emitidos
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

  -- Códigos do eleitor
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

  -- Cédulas manuais
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
end;
$$ language plpgsql security definer;
