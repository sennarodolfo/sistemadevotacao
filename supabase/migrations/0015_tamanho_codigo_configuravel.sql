-- =================================================================
-- Migração 0015: Tamanho do código configurável (4 a 8 dígitos)
-- =================================================================
-- O admin passa a poder escolher quantos dígitos numéricos os códigos
-- terão (tanto os do eleitor quanto os das cédulas manuais) - mínimo 4,
-- máximo 8. A configuração fica em `elections.code_digits` e é usada
-- na GERAÇÃO de novos códigos (aba "Geral" do painel).
--
-- Códigos já gerados com um tamanho diferente continuam válidos para
-- votar/retomar mesmo depois de o admin trocar essa configuração: a
-- validação de entrada aceita qualquer comprimento entre 4 e 8 (não
-- fica presa ao valor atual), evitando que uma mudança de configuração
-- invalide códigos já impressos/distribuídos.
-- =================================================================

alter table public.elections add column if not exists code_digits integer not null default 4;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'elections_code_digits_range'
  ) then
    alter table public.elections
      add constraint elections_code_digits_range check (code_digits between 4 and 8);
  end if;
end $$;

-- ============== admin_update_election: + p_code_digits ==============
drop function if exists public.admin_update_election(uuid, text, text, text);

create or replace function public.admin_update_election(
  p_election_id uuid,
  p_password text,
  p_name text,
  p_location_name text,
  p_code_digits integer
) returns json as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  if p_code_digits is not null and (p_code_digits < 4 or p_code_digits > 8) then
    return json_build_object('error', 'invalid_code_digits');
  end if;

  update public.elections
    set name = p_name,
        location_name = p_location_name,
        code_digits = coalesce(p_code_digits, code_digits),
        updated_at = now()
  where id = p_election_id;

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_update_election(uuid, text, text, text, integer) to anon, authenticated;

-- ============== get_public_election: inclui code_digits ==============
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
    'sessions', (
      select coalesce(json_agg(s order by s.display_order), '[]'::json)
      from (
        select
          vs.id,
          vs.title,
          vs.description,
          vs.votes_required,
          vs.registered_voters,
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

-- ============== admin_generate_codes: usa code_digits da eleição ==============
create or replace function public.admin_generate_codes(
  p_election_id uuid,
  p_password text,
  p_quantity integer
) returns json as $$
declare
  ok boolean;
  v_digits integer;
  v_code text;
  v_count integer := 0;
  v_codes text[] := '{}';
  v_attempts integer := 0;
  v_max_attempts integer;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  if p_quantity is null or p_quantity < 1 then
    return json_build_object('error', 'invalid_quantity');
  end if;
  if p_quantity > 5000 then
    return json_build_object('error', 'quantity_too_large');
  end if;

  select code_digits into v_digits from public.elections where id = p_election_id;
  v_digits := coalesce(v_digits, 4);

  v_max_attempts := p_quantity * 40 + 2000;

  while v_count < p_quantity and v_attempts < v_max_attempts loop
    v_attempts := v_attempts + 1;
    v_code := lpad(floor(random() * power(10, v_digits))::bigint::text, v_digits, '0');
    if exists (select 1 from public.manual_ballot_codes where election_id = p_election_id and code = v_code) then
      continue;
    end if;
    begin
      insert into public.voter_codes (election_id, code) values (p_election_id, v_code);
      v_codes := array_append(v_codes, v_code);
      v_count := v_count + 1;
    exception when unique_violation then
      null;
    end;
  end loop;

  return json_build_object(
    'codes', to_json(v_codes),
    'generated', v_count,
    'requested', p_quantity
  );
end;
$$ language plpgsql security definer;

-- ============== admin_generate_manual_codes: usa code_digits da eleição ==============
create or replace function public.admin_generate_manual_codes(
  p_election_id uuid,
  p_password text,
  p_quantity integer
) returns json as $$
declare
  ok boolean;
  v_digits integer;
  v_code text;
  v_count integer := 0;
  v_codes text[] := '{}';
  v_attempts integer := 0;
  v_max_attempts integer;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  if p_quantity is null or p_quantity < 1 then
    return json_build_object('error', 'invalid_quantity');
  end if;
  if p_quantity > 5000 then
    return json_build_object('error', 'quantity_too_large');
  end if;

  select code_digits into v_digits from public.elections where id = p_election_id;
  v_digits := coalesce(v_digits, 4);

  v_max_attempts := p_quantity * 40 + 2000;

  while v_count < p_quantity and v_attempts < v_max_attempts loop
    v_attempts := v_attempts + 1;
    v_code := lpad(floor(random() * power(10, v_digits))::bigint::text, v_digits, '0');
    if exists (select 1 from public.voter_codes where election_id = p_election_id and code = v_code) then
      continue;
    end if;
    begin
      insert into public.manual_ballot_codes (election_id, code) values (p_election_id, v_code);
      v_codes := array_append(v_codes, v_code);
      v_count := v_count + 1;
    exception when unique_violation then
      null;
    end;
  end loop;

  return json_build_object(
    'codes', to_json(v_codes),
    'generated', v_count,
    'requested', p_quantity
  );
end;
$$ language plpgsql security definer;

-- ============== redeem_voter_code: aceita 4 a 8 dígitos ==============
create or replace function public.redeem_voter_code(
  p_election_id uuid,
  p_code text
) returns json as $$
declare
  v_norm text;
  v_is_used boolean;
begin
  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) not between 4 and 8 then
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

  update public.voter_codes
    set first_redeemed_at = coalesce(first_redeemed_at, now())
  where election_id = p_election_id and code = v_norm;

  return json_build_object(
    'success', true,
    'voter_token', 'code-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

-- ============== redeem_manual_code: aceita 4 a 8 dígitos ==============
create or replace function public.redeem_manual_code(
  p_election_id uuid,
  p_code text
) returns json as $$
declare
  v_norm text;
  v_is_used boolean;
begin
  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) not between 4 and 8 then
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

-- ============== admin_reset_code / admin_delete_code: 4 a 8 dígitos ==============
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
  if length(v_norm) not between 4 and 8 then
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
  if length(v_norm) not between 4 and 8 then
    return json_build_object('error', 'invalid_format');
  end if;

  if not exists (select 1 from public.voter_codes where election_id = p_election_id and code = v_norm) then
    return json_build_object('error', 'code_not_found');
  end if;

  v_token := 'code-' || p_election_id::text || '-' || v_norm;

  delete from public.election_receipts
  where voter_token = v_token and election_id = p_election_id;

  with del as (
    delete from public.voter_completions vc
    using public.voting_sessions vs
    where vc.session_id = vs.id
      and vs.election_id = p_election_id
      and vc.voter_token = v_token
    returning vc.id
  )
  select count(*) into v_deleted_completions from del;

  with del2 as (
    delete from public.votes v
    using public.voting_sessions vs
    where v.session_id = vs.id
      and vs.election_id = p_election_id
      and v.voter_token = v_token
    returning v.id
  )
  select count(*) into v_deleted_votes from del2;

  delete from public.voter_codes
  where election_id = p_election_id and code = v_norm;

  return json_build_object(
    'success', true,
    'deleted_votes', v_deleted_votes,
    'deleted_completions', v_deleted_completions
  );
end;
$$ language plpgsql security definer;

-- ============== admin_reset_manual_code / admin_delete_manual_code: 4 a 8 dígitos ==============
create or replace function public.admin_reset_manual_code(
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
  if length(v_norm) not between 4 and 8 then
    return json_build_object('error', 'invalid_format');
  end if;

  update public.manual_ballot_codes
    set is_used = false, used_at = null
  where election_id = p_election_id and code = v_norm
  returning id into v_id;

  if v_id is null then
    return json_build_object('error', 'code_not_found');
  end if;

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

create or replace function public.admin_delete_manual_code(
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
  if length(v_norm) not between 4 and 8 then
    return json_build_object('error', 'invalid_format');
  end if;

  if not exists (select 1 from public.manual_ballot_codes where election_id = p_election_id and code = v_norm) then
    return json_build_object('error', 'code_not_found');
  end if;

  v_token := 'mcode-' || p_election_id::text || '-' || v_norm;

  delete from public.election_receipts
  where voter_token = v_token and election_id = p_election_id;

  with del as (
    delete from public.voter_completions vc
    using public.voting_sessions vs
    where vc.session_id = vs.id
      and vs.election_id = p_election_id
      and vc.voter_token = v_token
    returning vc.id
  )
  select count(*) into v_deleted_completions from del;

  with del2 as (
    delete from public.votes v
    using public.voting_sessions vs
    where v.session_id = vs.id
      and vs.election_id = p_election_id
      and v.voter_token = v_token
    returning v.id
  )
  select count(*) into v_deleted_votes from del2;

  delete from public.manual_ballot_codes
  where election_id = p_election_id and code = v_norm;

  return json_build_object(
    'success', true,
    'deleted_votes', v_deleted_votes,
    'deleted_completions', v_deleted_completions
  );
end;
$$ language plpgsql security definer;

-- ============== finalize_election: extrai o código sem presumir 4 dígitos ==============
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
  select count(*) into v_total_sessions
  from public.voting_sessions
  where election_id = p_election_id and is_active = true;

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
  -- O código é extraído como "tudo depois do prefixo conhecido", em vez
  -- de presumir 4 dígitos fixos - funciona com qualquer tamanho (4 a 8).
  v_code_prefix := 'code-' || p_election_id::text || '-';
  v_manual_prefix := 'mcode-' || p_election_id::text || '-';

  if p_voter_token like (v_code_prefix || '%') then
    v_code := substring(p_voter_token from length(v_code_prefix) + 1);
    update public.voter_codes
      set is_used = true, used_at = coalesce(used_at, now())
    where election_id = p_election_id and code = v_code;
  elsif p_voter_token like (v_manual_prefix || '%') then
    v_code := substring(p_voter_token from length(v_manual_prefix) + 1);
    update public.manual_ballot_codes
      set is_used = true, used_at = coalesce(used_at, now())
    where election_id = p_election_id and code = v_code;
  end if;

  select receipt_code into v_receipt
  from public.election_receipts
  where voter_token = p_voter_token and election_id = p_election_id
  order by created_at desc
  limit 1;

  if v_receipt is not null then
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
