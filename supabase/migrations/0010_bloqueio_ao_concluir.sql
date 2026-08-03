-- =================================================================
-- Migração 0010: Código só bloqueia ao concluir TODAS as sessões
-- =================================================================
-- Até aqui, o código (do eleitor ou da cédula manual) era marcado como
-- usado no MOMENTO em que era digitado - antes mesmo do eleitor votar
-- em qualquer sessão. Isso significava que, se o eleitor fechasse o
-- navegador ou trocasse de dispositivo no meio da votação, o código
-- ficava "preso": ele não conseguia mais digitá-lo em lugar nenhum,
-- mesmo sem ter completado a votação, e dependia do admin resetar o
-- código manualmente (aba Códigos/Cédulas Manuais).
--
-- Com esta migração:
--   - redeem_voter_code / redeem_manual_code passam a APENAS validar o
--     código (existe? já está bloqueado?) e retornar o token - sem mais
--     marcar is_used=true na hora de digitar. Isso permite ao eleitor
--     digitar o MESMO código novamente (em qualquer dispositivo) para
--     retomar de onde parou, já que o voter_token é determinístico
--     (sempre o mesmo para aquele código) e get_voter_status/submit_vote
--     já sabem pular as sessões já concluídas / impedir voto duplicado
--     por sessão.
--   - finalize_election (chamada só quando TODAS as sessões ativas
--     foram concluídas) passa a marcar o código correspondente como
--     is_used=true, used_at=now() nesse momento - só AÍ o código fica
--     definitivamente bloqueado para novas tentativas.
-- =================================================================

-- ============== RPC: redeem_voter_code (sem lock na entrada) ==============
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

  -- NÃO marca como usado aqui: o código só é bloqueado quando TODAS as
  -- sessões forem concluídas (ver finalize_election). Isso permite ao
  -- eleitor reentrar com o mesmo código para retomar uma votação
  -- incompleta, de qualquer dispositivo.
  return json_build_object(
    'success', true,
    'voter_token', 'code-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

-- ============== RPC: redeem_manual_code (sem lock na entrada) ==============
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

  return json_build_object(
    'success', true,
    'voter_token', 'mcode-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

-- ============== RPC: finalize_election (bloqueia o código ao concluir) ==============
create or replace function public.finalize_election(
  p_election_id uuid,
  p_voter_token text
) returns json as $$
declare
  v_total_sessions integer;
  v_completed_count integer;
  v_receipt text;
  v_sessions_json jsonb;
  v_code_prefix text;
  v_manual_prefix text;
  v_code text;
begin
  -- Total de sessões ativas da eleição
  select count(*) into v_total_sessions
  from public.voting_sessions
  where election_id = p_election_id and is_active = true;

  -- Quantas o eleitor concluiu
  select count(*) into v_completed_count
  from public.voter_completions vc
  join public.voting_sessions vs on vs.id = vc.session_id
  where vc.voter_token = p_voter_token
    and vs.election_id = p_election_id
    and vs.is_active = true;

  if v_completed_count < v_total_sessions then
    return json_build_object('error', 'incomplete', 'completed', v_completed_count, 'total', v_total_sessions);
  end if;

  -- Todas as sessões foram concluídas: bloqueia definitivamente o
  -- código de origem (eleitor ou cédula manual), se o token vier de um.
  -- used_at só é definido na primeira vez (coalesce), preservando o
  -- horário original em chamadas repetidas/idempotentes.
  v_code_prefix := 'code-' || p_election_id::text || '-';
  v_manual_prefix := 'mcode-' || p_election_id::text || '-';

  if p_voter_token like (v_code_prefix || '____') and length(p_voter_token) = length(v_code_prefix) + 4 then
    v_code := right(p_voter_token, 4);
    update public.voter_codes
      set is_used = true, used_at = coalesce(used_at, now())
    where election_id = p_election_id and code = v_code;
  elsif p_voter_token like (v_manual_prefix || '____') and length(p_voter_token) = length(v_manual_prefix) + 4 then
    v_code := right(p_voter_token, 4);
    update public.manual_ballot_codes
      set is_used = true, used_at = coalesce(used_at, now())
    where election_id = p_election_id and code = v_code;
  end if;

  -- Verificar se já existe comprovante final
  select receipt_code into v_receipt
  from public.election_receipts
  where voter_token = p_voter_token and election_id = p_election_id
  order by created_at desc
  limit 1;

  if v_receipt is not null then
    -- Já existe, retornar o existente
    select jsonb_agg(jsonb_build_object(
      'session_id', vc.session_id,
      'session_title', vs.title,
      'receipt_code', vc.receipt_code,
      'voted_candidates', vc.voted_candidates,
      'blank_count', vc.blank_count
    ) order by vs.display_order) into v_sessions_json
    from public.voter_completions vc
    join public.voting_sessions vs on vs.id = vc.session_id
    where vc.voter_token = p_voter_token
      and vs.election_id = p_election_id;

    return json_build_object(
      'receipt_code', v_receipt,
      'session_completions', v_sessions_json
    );
  end if;

  -- Gerar novo comprovante
  v_receipt := 'VT-' || to_char(now(), 'YYYYMMDD') || '-' ||
               upper(substring(md5(random()::text) from 1 for 6));

  select jsonb_agg(jsonb_build_object(
    'session_id', vc.session_id,
    'session_title', vs.title,
    'receipt_code', vc.receipt_code,
    'voted_candidates', vc.voted_candidates,
    'blank_count', vc.blank_count
  ) order by vs.display_order) into v_sessions_json
  from public.voter_completions vc
  join public.voting_sessions vs on vs.id = vc.session_id
  where vc.voter_token = p_voter_token
    and vs.election_id = p_election_id;

  insert into public.election_receipts
    (receipt_code, voter_token, election_id, session_completions)
  values
    (v_receipt, p_voter_token, p_election_id, v_sessions_json);

  return json_build_object(
    'receipt_code', v_receipt,
    'session_completions', v_sessions_json
  );
end;
$$ language plpgsql security definer;
