-- =================================================================
-- Migração 0006: Módulo de Cédulas Manuais
-- =================================================================
-- Cria um espaço de códigos TOTALMENTE SEPARADO dos códigos de votação
-- do eleitor (voter_codes): a tabela `manual_ballot_codes`. Cada código
-- de cédula manual segue o MESMO princípio dos códigos do eleitor -
-- numérico de 4 dígitos, uso único - mas gera um voter_token com um
-- prefixo diferente ('mcode-' em vez de 'code-'), então:
--   - Nunca pode ser confundido/reaproveitado como código de eleitor
--     (e vice-versa), mesmo que o número de 4 dígitos coincida.
--   - Ao ser validado no início da votação manual (redeem_manual_code),
--     o mesário digita o código UMA VEZ e o token resultante libera
--     TODAS as sessões, exatamente como acontece com o eleitor -
--     reaproveitando 100% da lógica já existente de submit_vote /
--     get_voter_status / finalize_election, sem duplicar código.
--   - O comprovante final gerado (election_receipts) também guarda o
--     voter_token 'mcode-...', então a cédula manual aparece
--     automaticamente na aba Auditoria junto com os comprovantes dos
--     eleitores, e o painel consegue identificar sua origem pelo prefixo.
--
-- admin_generate_codes (códigos do eleitor) também é atualizada para
-- nunca sortear um número já usado como código de cédula manual, e
-- admin_generate_manual_codes nunca sorteia um número já usado como
-- código de eleitor - os dois espaços nunca se sobrepõem numericamente
-- dentro da mesma eleição.
-- =================================================================

-- ============== TABELA: manual_ballot_codes ==============
create table if not exists public.manual_ballot_codes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  code text not null,
  is_used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (election_id, code)
);

create index if not exists idx_manual_codes_election on public.manual_ballot_codes(election_id);
create index if not exists idx_manual_codes_lookup on public.manual_ballot_codes(election_id, code);
create index if not exists idx_manual_codes_pending on public.manual_ballot_codes(election_id, is_used);

alter table public.manual_ballot_codes enable row level security;
-- Sem policy anônima: todo acesso passa pelas funções RPC (security definer).

-- ============== admin_generate_codes: evita colidir com códigos manuais ==============
create or replace function public.admin_generate_codes(
  p_election_id uuid,
  p_password text,
  p_quantity integer
) returns json as $$
declare
  ok boolean;
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

  v_max_attempts := p_quantity * 40 + 2000;

  while v_count < p_quantity and v_attempts < v_max_attempts loop
    v_attempts := v_attempts + 1;
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
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

-- ============== RPC: admin_generate_manual_codes ==============
create or replace function public.admin_generate_manual_codes(
  p_election_id uuid,
  p_password text,
  p_quantity integer
) returns json as $$
declare
  ok boolean;
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

  v_max_attempts := p_quantity * 40 + 2000;

  while v_count < p_quantity and v_attempts < v_max_attempts loop
    v_attempts := v_attempts + 1;
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
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

grant execute on function public.admin_generate_manual_codes(uuid, text, integer) to anon, authenticated;

-- ============== RPC: admin_list_manual_codes ==============
create or replace function public.admin_list_manual_codes(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  v_total integer;
  v_used integer;
  v_list json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select count(*), count(*) filter (where is_used)
    into v_total, v_used
  from public.manual_ballot_codes
  where election_id = p_election_id;

  select coalesce(json_agg(row_to_json(r) order by r.created_at desc), '[]'::json)
    into v_list
  from (
    select code, is_used, used_at, created_at
    from public.manual_ballot_codes
    where election_id = p_election_id
    order by created_at desc
    limit 10000
  ) r;

  return json_build_object(
    'codes', v_list,
    'total', coalesce(v_total, 0),
    'used', coalesce(v_used, 0),
    'available', coalesce(v_total, 0) - coalesce(v_used, 0)
  );
end;
$$ language plpgsql security definer;

grant execute on function public.admin_list_manual_codes(uuid, text) to anon, authenticated;

-- ============== RPC: redeem_manual_code ==============
-- Equivalente a redeem_voter_code, mas para o mesário na votação manual.
-- O token gerado ('mcode-...') é usado nas MESMAS funções submit_vote /
-- get_voter_status / finalize_election, liberando todas as sessões de
-- uma vez com um único código digitado.
create or replace function public.redeem_manual_code(
  p_election_id uuid,
  p_code text
) returns json as $$
declare
  v_id uuid;
  v_norm text;
begin
  v_norm := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_norm) <> 4 then
    return json_build_object('error', 'invalid_format');
  end if;

  update public.manual_ballot_codes
    set is_used = true, used_at = now()
  where election_id = p_election_id
    and code = v_norm
    and is_used = false
  returning id into v_id;

  if v_id is null then
    if exists (
      select 1 from public.manual_ballot_codes
      where election_id = p_election_id and code = v_norm
    ) then
      return json_build_object('error', 'code_already_used');
    else
      return json_build_object('error', 'code_not_found');
    end if;
  end if;

  return json_build_object(
    'success', true,
    'voter_token', 'mcode-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

grant execute on function public.redeem_manual_code(uuid, text) to anon, authenticated;

-- ============== RPC: admin_reset_manual_code ==============
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
  if length(v_norm) <> 4 then
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

grant execute on function public.admin_reset_manual_code(uuid, text, text) to anon, authenticated;

-- ============== RPC: admin_delete_manual_code ==============
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
  if length(v_norm) <> 4 then
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

grant execute on function public.admin_delete_manual_code(uuid, text, text) to anon, authenticated;

-- ============== RPC: admin_reset_all_manual_codes ==============
create or replace function public.admin_reset_all_manual_codes(
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
    update public.manual_ballot_codes
      set is_used = false, used_at = null
    where election_id = p_election_id and is_used = true
    returning id
  )
  select count(*) into v_count from upd;

  return json_build_object('success', true, 'reset_count', v_count);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_reset_all_manual_codes(uuid, text) to anon, authenticated;

-- ============== RPC: admin_delete_all_manual_codes ==============
create or replace function public.admin_delete_all_manual_codes(
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

  v_prefix := 'mcode-' || p_election_id::text || '-';

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
    delete from public.manual_ballot_codes
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

grant execute on function public.admin_delete_all_manual_codes(uuid, text) to anon, authenticated;
