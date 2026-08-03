-- =================================================================
-- Migração 0005: Resetar/Apagar TODOS os códigos de votação
-- =================================================================
-- Complementam admin_reset_code / admin_delete_code (migração 0004)
-- com as versões em lote, para quando for necessário agir sobre TODOS
-- os códigos de uma eleição de uma só vez.
--
--   admin_reset_all_codes  -> destrava TODOS os códigos usados
--                             (is_used = false), SEM apagar nenhum voto.
--
--   admin_delete_all_codes -> apaga TODOS os códigos da eleição e
--                             remove TODOS os votos, conclusões de
--                             sessão e comprovantes finais registrados
--                             com qualquer um deles. Ação irreversível,
--                             pensada para reiniciar a eleição do zero
--                             (ex: antes de gerar um lote novo).
-- =================================================================

-- ============== RPC: admin_reset_all_codes ==============
create or replace function public.admin_reset_all_codes(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  v_count integer;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  with upd as (
    update public.voter_codes
      set is_used = false, used_at = null
    where election_id = p_election_id and is_used = true
    returning id
  )
  select count(*) into v_count from upd;

  return json_build_object('success', true, 'reset_count', v_count);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_reset_all_codes(uuid, text) to anon, authenticated;

-- ============== RPC: admin_delete_all_codes ==============
create or replace function public.admin_delete_all_codes(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  v_prefix text;
  v_deleted_codes integer := 0;
  v_deleted_votes integer := 0;
  v_deleted_completions integer := 0;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  -- Todos os voter_tokens gerados a partir de um código desta eleição
  -- seguem o padrão 'code-<election_id>-XXXX'.
  v_prefix := 'code-' || p_election_id::text || '-';

  delete from public.election_receipts
  where election_id = p_election_id
    and voter_token like (v_prefix || '%');

  with del as (
    delete from public.voter_completions vc
    using public.voting_sessions vs
    where vc.session_id = vs.id
      and vs.election_id = p_election_id
      and vc.voter_token like (v_prefix || '%')
    returning vc.id
  )
  select count(*) into v_deleted_completions from del;

  with del2 as (
    delete from public.votes v
    using public.voting_sessions vs
    where v.session_id = vs.id
      and vs.election_id = p_election_id
      and v.voter_token like (v_prefix || '%')
    returning v.id
  )
  select count(*) into v_deleted_votes from del2;

  with del3 as (
    delete from public.voter_codes
    where election_id = p_election_id
    returning id
  )
  select count(*) into v_deleted_codes from del3;

  return json_build_object(
    'success', true,
    'deleted_codes', v_deleted_codes,
    'deleted_votes', v_deleted_votes,
    'deleted_completions', v_deleted_completions
  );
end;
$$ language plpgsql security definer;

grant execute on function public.admin_delete_all_codes(uuid, text) to anon, authenticated;
