-- =================================================================
-- Migração 0014: Corrige a implantação de admin_import_election
-- =================================================================
-- DIAGNÓSTICO: a migração 0012 mudou o tipo de retorno de
-- admin_import_election de boolean para json - e por isso incluiu um
-- `drop function if exists ... ` antes de recriá-la (Postgres exige
-- isso para trocar o tipo de retorno de uma função existente). A
-- migração 0013 (backup completo) recriou admin_import_election de
-- novo, mas SEM esse drop - assumindo que a 0012 já tinha rodado antes.
--
-- Se, por qualquer motivo, a 0012 não chegou a ser aplicada com sucesso
-- antes da 0013 (ordem trocada, execução parcial, etc.), rodar a 0013
-- falha com o erro do Postgres "cannot change return type of existing
-- function" bem NA HORA DE APLICAR A MIGRAÇÃO - e a função
-- admin_import_election continua com a versão antiga (só sessões e
-- candidatos, sem votos/comprovantes/códigos), mesmo que
-- admin_export_election (que nunca teve esse conflito de tipo) tenha
-- sido atualizada normalmente. Isso bate exatamente com o sintoma
-- relatado: o backup exportado já vem completo, mas restaurar não traz
-- os votos/códigos de volta.
--
-- Esta migração corrige isso de forma definitiva e seguro para rodar
-- não importa o estado atual: sempre apaga a função antes de recriar
-- (idempotente), e adiciona tratamento de erro para devolver a
-- mensagem exata do Postgres em vez de uma falha silenciosa, caso
-- outro problema apareça no futuro.
-- =================================================================

drop function if exists public.admin_import_election(uuid, text, json);
drop function if exists public.admin_import_election(uuid, text, jsonb);

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
  -- Em vez de deixar o erro estourar sem contexto, devolve a mensagem
  -- exata do Postgres - essencial pra diagnosticar qualquer problema
  -- futuro na restauração sem precisar adivinhar.
  return json_build_object('error', 'import_failed', 'detail', SQLERRM);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_import_election(uuid, text, json) to anon, authenticated;
