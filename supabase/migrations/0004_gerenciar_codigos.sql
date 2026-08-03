-- =================================================================
-- Migração 0004: Resetar/Apagar códigos de votação
-- =================================================================
-- Duas ações distintas e complementares na gestão de códigos:
--
--   admin_reset_code  -> apenas destrava o código (is_used = false),
--                        SEM mexer em votos já registrados. Útil quando
--                        o código foi marcado como usado mas o eleitor
--                        não chegou a votar (ex: fechou o navegador logo
--                        após digitar o código), permitindo reutilizá-lo.
--
--   admin_delete_code -> apaga o código definitivamente e remove TODOS
--                        os votos, conclusões de sessão e comprovante
--                        final registrados com ele. Use quando o eleitor
--                        cometeu um erro e a votação feita com aquele
--                        código precisa ser desfeita por completo.
--
-- Ambas usam o mesmo voter_token determinístico gerado em redeem_voter_code
-- ('code-' || election_id || '-' || code) para localizar os registros.
-- =================================================================

-- ============== RPC: admin_reset_code ==============
create or replace function public.admin_reset_code(
  p_election_id uuid,
  p_password text,
  p_code text
) returns json as $$
declare
  ok boolean;
  v_norm text;
  v_id uuid;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) <> 4 then
    return json_build_object('error', 'invalid_format');
  end if;

  update public.voter_codes
    set is_used = false, used_at = null
  where election_id = p_election_id and code = v_norm
  returning id into v_id;

  if v_id is null then
    return json_build_object('error', 'code_not_found');
  end if;

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_reset_code(uuid, text, text) to anon, authenticated;

-- ============== RPC: admin_delete_code ==============
create or replace function public.admin_delete_code(
  p_election_id uuid,
  p_password text,
  p_code text
) returns json as $$
declare
  ok boolean;
  v_norm text;
  v_token text;
  v_deleted_votes integer := 0;
  v_deleted_completions integer := 0;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) <> 4 then
    return json_build_object('error', 'invalid_format');
  end if;

  if not exists (select 1 from public.voter_codes where election_id = p_election_id and code = v_norm) then
    return json_build_object('error', 'code_not_found');
  end if;

  v_token := 'code-' || p_election_id::text || '-' || v_norm;

  -- Comprovante final (se o eleitor tiver chegado a concluir a eleição)
  delete from public.election_receipts
  where voter_token = v_token and election_id = p_election_id;

  -- Conclusões de sessão (registro de "já votou nesta sessão")
  with del as (
    delete from public.voter_completions vc
    using public.voting_sessions vs
    where vc.session_id = vs.id
      and vs.election_id = p_election_id
      and vc.voter_token = v_token
    returning vc.id
  )
  select count(*) into v_deleted_completions from del;

  -- Votos individuais (candidato a candidato / branco)
  with del2 as (
    delete from public.votes v
    using public.voting_sessions vs
    where v.session_id = vs.id
      and vs.election_id = p_election_id
      and v.voter_token = v_token
    returning v.id
  )
  select count(*) into v_deleted_votes from del2;

  -- O código deixa de existir - libera o número de 4 dígitos para uma nova geração
  delete from public.voter_codes
  where election_id = p_election_id and code = v_norm;

  return json_build_object(
    'success', true,
    'deleted_votes', v_deleted_votes,
    'deleted_completions', v_deleted_completions
  );
end;
$$ language plpgsql security definer;

grant execute on function public.admin_delete_code(uuid, text, text) to anon, authenticated;
