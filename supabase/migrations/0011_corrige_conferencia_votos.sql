-- =================================================================
-- Migração 0011: Corrige a Conferência de Votos para códigos incompletos
-- =================================================================
-- BUG introduzido pela migração 0010: como o código só é marcado
-- is_used=true ao concluir TODAS as sessões, a "Conferência de Votos"
-- (que só olhava códigos com is_used=true) parou de encontrar os
-- códigos que ainda estão incompletos - exatamente os que ela deveria
-- mostrar. Um código com sessão pendente continua, corretamente, com
-- is_used=false (para permitir retomar) - mas isso o tornava invisível
-- para a conferência.
--
-- Correção: passamos a rastrear separadamente QUANDO um código foi
-- digitado pela primeira vez (first_redeemed_at), independente de ele
-- já ter concluído tudo ou não. A Conferência de Votos passa a usar
-- esse campo (em vez de is_used) para encontrar todo código que já
-- começou a votar - completo ou não - e reportar quais sessões faltam.
-- Isso também cobre o caso de um código digitado mas que não chegou a
-- votar em NENHUMA sessão (fechou a página logo após digitar o código).
-- =================================================================

alter table public.voter_codes add column if not exists first_redeemed_at timestamptz;
alter table public.manual_ballot_codes add column if not exists first_redeemed_at timestamptz;

-- ============== Backfill: códigos já digitados ANTES desta migração ==============
-- Entre a migração 0010 (código só bloqueia ao concluir tudo) e esta
-- correção, redeem_voter_code/redeem_manual_code ainda não gravavam
-- first_redeemed_at. Sem isso, eleitores que já estavam com votação em
-- andamento ficariam invisíveis para a conferência até digitar o
-- código de novo. Preenchemos com a data do voto mais antigo (para quem
-- já votou em alguma sessão) ou com used_at (para quem já concluiu tudo).
update public.voter_codes vc
set first_redeemed_at = sub.min_created
from (
  select vc2.election_id, vc2.code, min(comp.created_at) as min_created
  from public.voter_codes vc2
  join public.voter_completions comp
    on comp.voter_token = 'code-' || vc2.election_id::text || '-' || vc2.code
  group by vc2.election_id, vc2.code
) sub
where vc.election_id = sub.election_id and vc.code = sub.code and vc.first_redeemed_at is null;

update public.manual_ballot_codes mc
set first_redeemed_at = sub.min_created
from (
  select mc2.election_id, mc2.code, min(comp.created_at) as min_created
  from public.manual_ballot_codes mc2
  join public.voter_completions comp
    on comp.voter_token = 'mcode-' || mc2.election_id::text || '-' || mc2.code
  group by mc2.election_id, mc2.code
) sub
where mc.election_id = sub.election_id and mc.code = sub.code and mc.first_redeemed_at is null;

update public.voter_codes
  set first_redeemed_at = used_at
  where first_redeemed_at is null and used_at is not null;

update public.manual_ballot_codes
  set first_redeemed_at = used_at
  where first_redeemed_at is null and used_at is not null;

-- ============== redeem_voter_code: registra a 1ª digitação ==============
create or replace function public.redeem_voter_code(
  p_election_id uuid,
  p_code text
) returns json as $$
declare
  v_norm text;
  v_is_used boolean;
begin
  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) <> 4 then
    return json_build_object('error', 'invalid_format');
  end if;

  select is_used into v_is_used
  from public.voter_codes
  where election_id = p_election_id and code = v_norm;

  if v_is_used is null then
    return json_build_object('error', 'code_not_found');
  end if;

  if v_is_used then
    return json_build_object('error', 'code_already_used');
  end if;

  -- Registra a primeira vez que o código foi digitado (não sobrescreve
  -- em reentradas para retomar). Não bloqueia o código - isso só
  -- acontece em finalize_election, ao concluir todas as sessões.
  update public.voter_codes
    set first_redeemed_at = coalesce(first_redeemed_at, now())
  where election_id = p_election_id and code = v_norm;

  return json_build_object(
    'success', true,
    'voter_token', 'code-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

-- ============== redeem_manual_code: registra a 1ª digitação ==============
create or replace function public.redeem_manual_code(
  p_election_id uuid,
  p_code text
) returns json as $$
declare
  v_norm text;
  v_is_used boolean;
begin
  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) <> 4 then
    return json_build_object('error', 'invalid_format');
  end if;

  select is_used into v_is_used
  from public.manual_ballot_codes
  where election_id = p_election_id and code = v_norm;

  if v_is_used is null then
    return json_build_object('error', 'code_not_found');
  end if;

  if v_is_used then
    return json_build_object('error', 'code_already_used');
  end if;

  update public.manual_ballot_codes
    set first_redeemed_at = coalesce(first_redeemed_at, now())
  where election_id = p_election_id and code = v_norm;

  return json_build_object(
    'success', true,
    'voter_token', 'mcode-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

-- ============== admin_check_incomplete_voters: usa first_redeemed_at ==============
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
    select 'eleitor'::text as origin, vc.code, ('code-' || p_election_id::text || '-' || vc.code) as voter_token, vc.first_redeemed_at as started_at
    from public.voter_codes vc
    where vc.election_id = p_election_id and vc.first_redeemed_at is not null
    union all
    select 'mesário'::text as origin, mc.code, ('mcode-' || p_election_id::text || '-' || mc.code) as voter_token, mc.first_redeemed_at as started_at
    from public.manual_ballot_codes mc
    where mc.election_id = p_election_id and mc.first_redeemed_at is not null
  )
  select json_agg(row_to_json(r) order by r.started_at) into result
  from (
    select
      t.origin,
      t.code,
      t.started_at,
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
