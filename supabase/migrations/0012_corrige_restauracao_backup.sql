-- =================================================================
-- Migração 0012: Corrige a restauração de backup
-- =================================================================
-- Diagnóstico do bug relatado: o EXPORT sempre funcionava (por isso o
-- arquivo saía com tamanho > 0kb), mas o RESTORE tinha dois problemas:
--
--   1) admin_import_election retornava apenas um BOOLEAN (true/false).
--      O frontend NUNCA checava esse valor - se a restauração falhasse
--      silenciosamente (ex: senha de admin expirada na sessão do
--      navegador, fazendo verify_admin retornar false), a tela
--      mostrava "Backup restaurado com sucesso" mesmo SEM restaurar
--      nada. A falha ficava invisível.
--
--   2) `delete from voting_sessions` rodava incondicionalmente, mesmo
--      quando o backup não trazia a chave "sessions" - podendo apagar
--      as sessões atuais sem repor nada, num backup incompleto/antigo.
--
-- Correção: admin_import_election passa a retornar um JSON com o
-- resultado (sucesso + quantas sessões/candidatos foram restaurados,
-- ou um código de erro claro), e o frontend passa a CHECAR essa
-- resposta e mostrar exatamente o que aconteceu.
-- =================================================================

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

  -- Só apaga as sessões atuais se o backup realmente trouxer sessões
  -- para repor no lugar (evita zerar tudo com um backup incompleto).
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

  return json_build_object(
    'success', true,
    'sessions_restored', v_session_count,
    'candidates_restored', v_candidate_count
  );
end;
$$ language plpgsql security definer;

grant execute on function public.admin_import_election(uuid, text, json) to anon, authenticated;
