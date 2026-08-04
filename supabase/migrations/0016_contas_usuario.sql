-- =================================================================
-- Migração 0016: Contas de usuário e eleições próprias (multiusuário)
-- =================================================================
-- Até aqui, o sistema era "de uma eleição só" (VITE_ELECTION_ID fixo no
-- deploy). Esta migração adiciona contas de usuário REAIS via Supabase
-- Auth (e-mail + senha, com confirmação de e-mail conforme a
-- configuração do projeto): cada usuário autenticado pode criar suas
-- próprias eleições, geridas de forma independente - sem enxergar nem
-- interferir nas eleições de outros usuários.
--
-- Design: a autenticação do ELEITOR continua exatamente como já era
-- (código de votação, sem precisar de conta) - só a camada de
-- ADMINISTRAÇÃO ganha uma camada de contas por cima. O painel
-- administrativo de cada eleição continua funcionando com a senha de
-- admin própria da eleição (nada muda ali); a novidade é o "Dashboard"
-- onde o usuário logado cria eleições e pega o link de votação de cada
-- uma, sem precisar de variável de ambiente fixa.
--
-- owner_id vincula a eleição ao usuário dono (auth.users, tabela
-- gerenciada pelo Supabase Auth). Fica NULL para eleições antigas
-- criadas antes desta migração (ex: via seed.sql) - continuam
-- funcionando normalmente no modo "uma eleição só".
-- =================================================================

alter table public.elections add column if not exists owner_id uuid references auth.users(id) on delete cascade;
create index if not exists idx_elections_owner on public.elections(owner_id);

-- ============== Reforço de privacidade: elections_read ==============
-- A policy original ("for select using (true)") deixava QUALQUER
-- pessoa ler a tabela elections inteira direto via REST - incluindo os
-- hashes de senha de TODAS as eleições de TODOS os usuários. O app
-- nunca precisou disso (sempre usa a função get_public_election, que é
-- security definer e não depende dessa policy). Restringe a leitura
-- direta a "o próprio dono vendo a própria eleição".
drop policy if exists "elections_read" on public.elections;
create policy "elections_read" on public.elections
  for select using (owner_id is not null and owner_id = auth.uid());

-- ============== RPC: create_my_election ==============
-- Cria uma nova eleição pertencente ao usuário logado. Gera senhas de
-- admin e de votação manual ALEATÓRIAS, retornadas em texto puro só
-- NESTA resposta (nunca mais - só o hash fica salvo) para o usuário
-- guardar. O painel admin da eleição funciona exatamente como qualquer
-- outra eleição, usando essa senha.
create or replace function public.create_my_election(
  p_name text,
  p_location_name text
) returns json as $$
declare
  v_admin_password text;
  v_manual_password text;
  v_admin_salt text;
  v_manual_salt text;
  v_election_id uuid;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if p_name is null or trim(p_name) = '' then
    return json_build_object('error', 'invalid_name');
  end if;

  v_admin_password := upper(substring(encode(gen_random_bytes(6), 'hex') from 1 for 8));
  v_manual_password := upper(substring(encode(gen_random_bytes(6), 'hex') from 1 for 8));
  v_admin_salt := encode(gen_random_bytes(16), 'hex');
  v_manual_salt := encode(gen_random_bytes(16), 'hex');

  insert into public.elections (
    name, location_name, owner_id,
    admin_password_hash, admin_password_salt,
    manual_password_hash, manual_password_salt,
    geo_required
  ) values (
    trim(p_name),
    coalesce(nullif(trim(p_location_name), ''), 'Local de Votação'),
    auth.uid(),
    public.hash_password(v_admin_password, v_admin_salt), v_admin_salt,
    public.hash_password(v_manual_password, v_manual_salt), v_manual_salt,
    false
  )
  returning id into v_election_id;

  return json_build_object(
    'success', true,
    'election_id', v_election_id,
    'admin_password', v_admin_password,
    'manual_password', v_manual_password
  );
end;
$$ language plpgsql security definer;

grant execute on function public.create_my_election(text, text) to authenticated;

-- ============== RPC: list_my_elections ==============
create or replace function public.list_my_elections()
returns json as $$
declare
  result json;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  select coalesce(json_agg(json_build_object(
    'id', e.id,
    'name', e.name,
    'location_name', e.location_name,
    'created_at', e.created_at,
    'session_count', (select count(*) from public.voting_sessions vs where vs.election_id = e.id),
    'voter_code_count', (select count(*) from public.voter_codes vc where vc.election_id = e.id),
    'receipt_count', (select count(*) from public.election_receipts er where er.election_id = e.id)
  ) order by e.created_at desc), '[]'::json) into result
  from public.elections e
  where e.owner_id = auth.uid();

  return json_build_object('elections', result);
end;
$$ language plpgsql security definer;

grant execute on function public.list_my_elections() to authenticated;

-- ============== RPC: delete_my_election ==============
-- Apaga uma eleição (e, em cascata, tudo relacionado a ela: sessões,
-- candidatos, votos, comprovantes, códigos) - só se o chamador for o
-- dono. Ação irreversível.
create or replace function public.delete_my_election(p_election_id uuid)
returns json as $$
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  delete from public.elections
  where id = p_election_id and owner_id = auth.uid();

  if not found then
    return json_build_object('error', 'not_found');
  end if;

  return json_build_object('success', true);
end;
$$ language plpgsql security definer;

grant execute on function public.delete_my_election(uuid) to authenticated;

-- ============== RPC: reset_my_election_admin_password ==============
-- Gera uma NOVA senha de admin aleatória para uma eleição do usuário
-- logado - útil quando a senha mostrada na criação foi perdida. Não
-- precisa saber a senha antiga: a posse da conta (auth.uid() = owner_id)
-- já é a prova de identidade suficiente.
create or replace function public.reset_my_election_admin_password(p_election_id uuid)
returns json as $$
declare
  v_password text;
  v_salt text;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if not exists (select 1 from public.elections where id = p_election_id and owner_id = auth.uid()) then
    return json_build_object('error', 'not_found');
  end if;

  v_password := upper(substring(encode(gen_random_bytes(6), 'hex') from 1 for 8));
  v_salt := encode(gen_random_bytes(16), 'hex');

  update public.elections
    set admin_password_hash = public.hash_password(v_password, v_salt),
        admin_password_salt = v_salt,
        updated_at = now()
  where id = p_election_id;

  return json_build_object('success', true, 'admin_password', v_password);
end;
$$ language plpgsql security definer;

grant execute on function public.reset_my_election_admin_password(uuid) to authenticated;

-- ============== RPC: reset_my_election_manual_password ==============
create or replace function public.reset_my_election_manual_password(p_election_id uuid)
returns json as $$
declare
  v_password text;
  v_salt text;
begin
  if auth.uid() is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  if not exists (select 1 from public.elections where id = p_election_id and owner_id = auth.uid()) then
    return json_build_object('error', 'not_found');
  end if;

  v_password := upper(substring(encode(gen_random_bytes(6), 'hex') from 1 for 8));
  v_salt := encode(gen_random_bytes(16), 'hex');

  update public.elections
    set manual_password_hash = public.hash_password(v_password, v_salt),
        manual_password_salt = v_salt,
        updated_at = now()
  where id = p_election_id;

  return json_build_object('success', true, 'manual_password', v_password);
end;
$$ language plpgsql security definer;

grant execute on function public.reset_my_election_manual_password(uuid) to authenticated;
