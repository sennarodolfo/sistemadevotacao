-- =================================================================
-- Migração 0009: Conferência de Votos
-- =================================================================
-- Identifica, entre TODOS os códigos já utilizados (do eleitor e da
-- votação manual), quais NÃO completaram todas as sessões ativas da
-- eleição - por exemplo, o eleitor validou o código, votou em algumas
-- sessões mas fechou o navegador antes de terminar, ou esqueceu de
-- votar em uma sessão específica.
--
-- admin_check_incomplete_voters retorna, para cada código incompleto:
--   - origin: 'eleitor' ou 'mesário' (cédula manual)
--   - code: o código de 4 dígitos
--   - used_at: quando o código foi validado
--   - completed_sessions / total_sessions: quantas sessões concluiu
--   - completed_titles / missing_titles: quais sessões concluiu e
--     quais estão faltando
-- =================================================================

create or replace function public.admin_check_incomplete_voters(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  v_total_sessions integer;
  result json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select count(*) into v_total_sessions
  from public.voting_sessions
  where election_id = p_election_id and is_active = true;

  with all_tokens as (
    select 'eleitor'::text as origin, vc.code, ('code-' || p_election_id::text || '-' || vc.code) as voter_token, vc.used_at
    from public.voter_codes vc
    where vc.election_id = p_election_id and vc.is_used = true
    union all
    select 'mesário'::text as origin, mc.code, ('mcode-' || p_election_id::text || '-' || mc.code) as voter_token, mc.used_at
    from public.manual_ballot_codes mc
    where mc.election_id = p_election_id and mc.is_used = true
  )
  select json_agg(row_to_json(r) order by r.used_at) into result
  from (
    select
      t.origin,
      t.code,
      t.used_at,
      (
        select count(*)
        from public.voter_completions vc2
        join public.voting_sessions vs on vs.id = vc2.session_id
        where vc2.voter_token = t.voter_token
          and vs.election_id = p_election_id
          and vs.is_active = true
      ) as completed_sessions,
      (
        select coalesce(json_agg(json_build_object('session_id', vs.id, 'session_title', vs.title) order by vs.display_order), '[]'::json)
        from public.voting_sessions vs
        where vs.election_id = p_election_id and vs.is_active = true
          and exists (
            select 1 from public.voter_completions vc3
            where vc3.voter_token = t.voter_token and vc3.session_id = vs.id
          )
      ) as completed_titles,
      (
        select coalesce(json_agg(json_build_object('session_id', vs.id, 'session_title', vs.title) order by vs.display_order), '[]'::json)
        from public.voting_sessions vs
        where vs.election_id = p_election_id and vs.is_active = true
          and not exists (
            select 1 from public.voter_completions vc4
            where vc4.voter_token = t.voter_token and vc4.session_id = vs.id
          )
      ) as missing_titles
    from all_tokens t
  ) r
  where r.completed_sessions < v_total_sessions;

  return json_build_object(
    'total_sessions', v_total_sessions,
    'incomplete', coalesce(result, '[]'::json)
  );
end;
$$ language plpgsql security definer;

grant execute on function public.admin_check_incomplete_voters(uuid, text) to anon, authenticated;
