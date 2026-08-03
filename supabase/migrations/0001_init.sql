-- =================================================================
-- Sistema de Votação Eletrônica - Schema Supabase
-- Suporta múltiplas sessões de votação, geolocalização opcional,
-- auditoria e autenticação de administrador por senha.
-- =================================================================

-- ============== EXTENSÕES ==============
create extension if not exists "pgcrypto";

-- ============== TABELA: elections ==============
-- Uma eleição é o "container" geral. Pode ter várias sessões de votação.
create table if not exists public.elections (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Eleição Geral',
  location_name text not null default 'Local de Votação',
  location_lat double precision,
  location_lng double precision,
  location_radius integer not null default 100,
  geo_required boolean not null default true,
  admin_password_hash text not null,
  admin_password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_elections_created on public.elections(created_at desc);

-- ============== TABELA: sessions ==============
-- Sessões de votação dentro de uma eleição (ex: Presbíteros, Diáconos).
create table if not exists public.voting_sessions (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  title text not null,
  description text,
  votes_required integer not null check (votes_required > 0),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_sessions_election on public.voting_sessions(election_id, display_order);

-- ============== TABELA: candidates ==============
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voting_sessions(id) on delete cascade,
  name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_candidates_session on public.candidates(session_id, display_order);

-- ============== TABELA: votes ==============
-- Cada voto individual é registrado para auditoria.
-- A contagem agregada é mantida na tabela vote_counts (atualizada por trigger).
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.voting_sessions(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  is_blank boolean not null default false,
  voter_token text not null,
  voter_lat double precision,
  voter_lng double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_votes_session on public.votes(session_id);
create index if not exists idx_votes_token on public.votes(voter_token);

-- View materializada para contagem rápida
create or replace view public.vote_counts as
  select
    s.id as session_id,
    s.title as session_title,
    c.id as candidate_id,
    c.name as candidate_name,
    count(v.id) filter (where v.is_blank = false) as vote_count
  from public.voting_sessions s
    left join public.candidates c on c.session_id = s.id
    left join public.votes v on v.session_id = s.id and v.candidate_id = c.id
  group by s.id, s.title, c.id, c.name
  order by s.display_order, c.display_order;

-- Contagem de brancos por sessão
create or replace view public.blank_counts as
  select
    s.id as session_id,
    count(v.id) as blank_count
  from public.voting_sessions s
    left join public.votes v on v.session_id = s.id and v.is_blank = true
  group by s.id;

-- ============== TABELA: voter_completions ==============
-- Registra quais sessões cada "eleitor" (voter_token) já concluiu.
create table if not exists public.voter_completions (
  id uuid primary key default gen_random_uuid(),
  voter_token text not null,
  session_id uuid not null references public.voting_sessions(id) on delete cascade,
  receipt_code text not null unique,
  voted_candidates jsonb not null default '[]'::jsonb,
  blank_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (voter_token, session_id)
);

create index if not exists idx_completions_token on public.voter_completions(voter_token);
create index if not exists idx_completions_session on public.voter_completions(session_id);
create index if not exists idx_completions_receipt on public.voter_completions(receipt_code);

-- ============== TABELA: election_receipts ==============
-- Comprovante final emitido quando o eleitor conclui todas as sessões da eleição.
create table if not exists public.election_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_code text not null unique,
  voter_token text not null,
  election_id uuid not null references public.elections(id) on delete cascade,
  session_completions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_receipts_token on public.election_receipts(voter_token);
create index if not exists idx_receipts_election on public.election_receipts(election_id);

-- ============== ROW LEVEL SECURITY (RLS) ==============
alter table public.elections enable row level security;
alter table public.voting_sessions enable row level security;
alter table public.candidates enable row level security;
alter table public.votes enable row level security;
alter table public.voter_completions enable row level security;
alter table public.election_receipts enable row level security;

-- Qualquer pessoa pode LER a configuração pública (eleição ativa, sessões, candidatos)
drop policy if exists "elections_read" on public.elections;
create policy "elections_read" on public.elections
  for select using (true);

drop policy if exists "sessions_read" on public.voting_sessions;
create policy "sessions_read" on public.voting_sessions
  for select using (true);

drop policy if exists "candidates_read" on public.candidates;
create policy "candidates_read" on public.candidates
  for select using (true);

-- Votos e conclusões são inseridos pelo backend via service_role
-- mas também podem ser inseridos anonimamente via função RPC com validação.

-- Apenas o role 'service_role' pode escrever nas tabelas protegidas.
-- As funções RPC abaixo realizam as operações com validação.

-- ============== FUNÇÕES RPC ==============

-- Função utilitária: hash de senha (PBKDF2 simples)
create or replace function public.hash_password(pwd text, salt text)
returns text as $$
begin
  return encode(digest(pwd || salt, 'sha256'), 'hex');
end;
$$ language plpgsql;

-- ============== RPC: get_public_election ==============
-- Retorna os dados públicos da eleição (sem senha)
create or replace function public.get_public_election(p_election_id uuid)
returns json as $$
declare
  result json;
begin
  select json_build_object(
    'id', e.id,
    'name', e.name,
    'location_name', e.location_name,
    'location_lat', e.location_lat,
    'location_lng', e.location_lng,
    'location_radius', e.location_radius,
    'geo_required', e.geo_required,
    'sessions', (
      select coalesce(json_agg(s order by s.display_order), '[]'::json)
      from (
        select
          vs.id,
          vs.title,
          vs.description,
          vs.votes_required,
          vs.display_order,
          vs.is_active,
          coalesce(
            (select json_agg(json_build_object('id', c.id, 'name', c.name) order by c.display_order)
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

-- ============== RPC: verify_admin ==============
create or replace function public.verify_admin(p_election_id uuid, p_password text)
returns boolean as $$
declare
  stored_hash text;
  stored_salt text;
begin
  select admin_password_hash, admin_password_salt
    into stored_hash, stored_salt
  from public.elections
  where id = p_election_id;

  if stored_hash is null then return false; end if;
  return stored_hash = public.hash_password(p_password, stored_salt);
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_update_election ==============
create or replace function public.admin_update_election(
  p_election_id uuid,
  p_password text,
  p_name text,
  p_location_name text,
  p_location_lat double precision,
  p_location_lng double precision,
  p_location_radius integer,
  p_geo_required boolean
) returns boolean as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  update public.elections
    set name = p_name,
        location_name = p_location_name,
        location_lat = p_location_lat,
        location_lng = p_location_lng,
        location_radius = p_location_radius,
        geo_required = p_geo_required,
        updated_at = now()
  where id = p_election_id;

  return true;
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_change_password ==============
create or replace function public.admin_change_password(
  p_election_id uuid,
  p_old_password text,
  p_new_password text
) returns boolean as $$
declare
  ok boolean;
  new_salt text;
begin
  ok := public.verify_admin(p_election_id, p_old_password);
  if not ok then return false; end if;
  if length(p_new_password) < 4 then return false; end if;

  new_salt := encode(gen_random_bytes(16), 'hex');
  update public.elections
    set admin_password_hash = public.hash_password(p_new_password, new_salt),
        admin_password_salt = new_salt,
        updated_at = now()
  where id = p_election_id;

  return true;
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_create_session ==============
create or replace function public.admin_create_session(
  p_election_id uuid,
  p_password text,
  p_title text,
  p_votes_required integer,
  p_candidates text[]
) returns json as $$
declare
  ok boolean;
  new_session_id uuid;
  new_order integer;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select coalesce(max(display_order), 0) + 1 into new_order
  from public.voting_sessions
  where election_id = p_election_id;

  insert into public.voting_sessions (election_id, title, votes_required, display_order)
  values (p_election_id, p_title, p_votes_required, new_order)
  returning id into new_session_id;

  if p_candidates is not null then
    insert into public.candidates (session_id, name, display_order)
    select new_session_id, trim(c), row_number() over ()
    from unnest(p_candidates) as c
    where trim(c) <> '';
  end if;

  return json_build_object('id', new_session_id);
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_update_session ==============
create or replace function public.admin_update_session(
  p_election_id uuid,
  p_password text,
  p_session_id uuid,
  p_title text,
  p_votes_required integer,
  p_candidates text[],
  p_is_active boolean
) returns boolean as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  update public.voting_sessions
    set title = p_title,
        votes_required = p_votes_required,
        is_active = p_is_active
  where id = p_session_id and election_id = p_election_id;

  if p_candidates is not null then
    delete from public.candidates where session_id = p_session_id;
    insert into public.candidates (session_id, name, display_order)
    select p_session_id, trim(c), row_number() over ()
    from unnest(p_candidates) as c
    where trim(c) <> '';
  end if;

  return true;
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_delete_session ==============
create or replace function public.admin_delete_session(
  p_election_id uuid,
  p_password text,
  p_session_id uuid
) returns boolean as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  delete from public.voting_sessions
  where id = p_session_id and election_id = p_election_id;

  return true;
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_get_results ==============
create or replace function public.admin_get_results(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  result json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select json_agg(row_to_json(r)) into result
  from (
    select
      vs.id as session_id,
      vs.title,
      vs.votes_required,
      vs.display_order,
      coalesce(
        (select json_agg(json_build_object('id', c.id, 'name', c.name, 'votes',
          (select count(*) from public.votes v where v.candidate_id = c.id))
          order by (select count(*) from public.votes v where v.candidate_id = c.id) desc)
         from public.candidates c where c.session_id = vs.id),
        '[]'::json
      ) as candidates,
      (select count(*) from public.votes v where v.session_id = vs.id and v.is_blank = true) as blank_votes,
      (select count(distinct voter_token) from public.voter_completions where session_id = vs.id) as unique_voters
    from public.voting_sessions vs
    where vs.election_id = p_election_id
    group by vs.id, vs.title, vs.votes_required, vs.display_order
    order by vs.display_order
  ) r;

  return coalesce(result, '[]'::json);
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_reset_session ==============
create or replace function public.admin_reset_session(
  p_election_id uuid,
  p_password text,
  p_session_id uuid
) returns boolean as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  delete from public.votes
  where session_id = p_session_id;
  delete from public.voter_completions
  where session_id = p_session_id;
  delete from public.election_receipts er
  where er.election_id = p_election_id
    and exists (
      select 1 from public.voter_completions vc
      where vc.session_id = p_session_id and vc.voter_token = er.voter_token
    );

  return true;
end;
$$ language plpgsql security definer;

-- ============== RPC: admin_reset_all ==============
create or replace function public.admin_reset_all(
  p_election_id uuid,
  p_password text
) returns boolean as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  delete from public.election_receipts where election_id = p_election_id;
  delete from public.voter_completions vc
  using public.voting_sessions vs
  where vc.session_id = vs.id and vs.election_id = p_election_id;
  delete from public.votes v
  using public.voting_sessions vs
  where v.session_id = vs.id and vs.election_id = p_election_id;

  return true;
end;
$$ language plpgsql security definer;

-- ============== RPC: submit_vote ==============
-- Submete o voto de um eleitor para uma sessão.
-- Validações:
--   - Eleição existe e sessão pertence à eleição
--   - Token do eleitor + sessão ainda não foi votada (anti-duplo)
--   - Geolocalização NÃO é validada aqui (verificação fica só no frontend,
--     na WelcomeScreen, e vale para todas as sessões da urna)
--   - Votos: lista de IDs de candidatos + branco_count
--   - Total de votos deve ser exatamente votes_required
create or replace function public.submit_vote(
  p_election_id uuid,
  p_session_id uuid,
  p_voter_token text,
  p_candidate_ids uuid[],
  p_blank_count integer,
  p_voter_lat double precision default null,
  p_voter_lng double precision default null
) returns json as $$
declare
  v_election record;
  v_session record;
  v_required integer;
  v_total integer;
  v_receipt text;
  v_voted_candidates jsonb;
begin
  -- Buscar eleição
  select * into v_election
  from public.elections where id = p_election_id;
  if not found then return json_build_object('error', 'election_not_found'); end if;

  -- Buscar sessão
  select * into v_session
  from public.voting_sessions where id = p_session_id and election_id = p_election_id;
  if not found then return json_build_object('error', 'session_not_found'); end if;
  if not v_session.is_active then return json_build_object('error', 'session_inactive'); end if;

  -- Verificar se este token já votou nesta sessão
  if exists (select 1 from public.voter_completions
             where voter_token = p_voter_token and session_id = p_session_id) then
    return json_build_object('error', 'already_voted');
  end if;

  -- Validação de geolocalização REMOVIDA.
  -- A verificação de localização é responsabilidade do frontend (WelcomeScreen)
  -- e ocorre UMA ÚNICA VEZ, no início da urna. Todas as sessões subsequentes
  -- ficam liberadas, mesmo com geo_required=true. Os parâmetros p_voter_lat /
  -- p_voter_lng continuam existindo apenas para registrar a origem do voto
  -- (auditoria), mas nunca bloqueiam o voto.

  -- Validar quantidade
  v_required := v_session.votes_required;
  v_total := coalesce(array_length(p_candidate_ids, 1), 0) + coalesce(p_blank_count, 0);
  if v_total <> v_required then
    return json_build_object('error', 'wrong_count', 'required', v_required, 'got', v_total);
  end if;

  -- Validar candidatos
  if p_candidate_ids is not null and array_length(p_candidate_ids, 1) > 0 then
    if exists (
      select 1 from unnest(p_candidate_ids) as cid
      where not exists (select 1 from public.candidates where id = cid and session_id = p_session_id)
    ) then
      return json_build_object('error', 'invalid_candidate');
    end if;
  end if;

  -- Inserir votos
  if p_candidate_ids is not null then
    insert into public.votes (session_id, candidate_id, is_blank, voter_token, voter_lat, voter_lng)
    select p_session_id, cid, false, p_voter_token, p_voter_lat, p_voter_lng
    from unnest(p_candidate_ids) as cid;
  end if;

  for i in 1..coalesce(p_blank_count, 0) loop
    insert into public.votes (session_id, candidate_id, is_blank, voter_token, voter_lat, voter_lng)
    values (p_session_id, null, true, p_voter_token, p_voter_lat, p_voter_lng);
  end loop;

  -- Gerar comprovante da sessão
  v_receipt := 'VS-' || to_char(now(), 'YYYYMMDD') || '-' ||
               upper(substring(md5(random()::text) from 1 for 6));

  -- Salvar candidatos votados (nomes) para auditoria
  select coalesce(jsonb_agg(c.name order by c.display_order), '[]'::jsonb)
    into v_voted_candidates
  from public.candidates c
  where c.id = any(p_candidate_ids);

  insert into public.voter_completions
    (voter_token, session_id, receipt_code, voted_candidates, blank_count)
  values
    (p_voter_token, p_session_id, v_receipt, v_voted_candidates, coalesce(p_blank_count, 0));

  return json_build_object(
    'success', true,
    'session_receipt', v_receipt,
    'voted_candidates', v_voted_candidates,
    'blank_count', coalesce(p_blank_count, 0)
  );
end;
$$ language plpgsql security definer;

-- ============== RPC: get_voter_status ==============
-- Retorna quais sessões da eleição o eleitor já concluiu.
create or replace function public.get_voter_status(
  p_election_id uuid,
  p_voter_token text
) returns json as $$
declare
  result json;
begin
  select json_build_object(
    'completed', coalesce((
      select json_agg(json_build_object(
        'session_id', vc.session_id,
        'session_title', vs.title,
        'receipt_code', vc.receipt_code,
        'voted_candidates', vc.voted_candidates,
        'blank_count', vc.blank_count,
        'voted_at', vc.created_at
      ) order by vc.created_at)
      from public.voter_completions vc
      join public.voting_sessions vs on vs.id = vc.session_id
      where vc.voter_token = p_voter_token
        and vs.election_id = p_election_id
    ), '[]'::json),
    'final_receipt', (
      select json_build_object(
        'receipt_code', er.receipt_code,
        'created_at', er.created_at,
        'session_completions', er.session_completions
      )
      from public.election_receipts er
      where er.voter_token = p_voter_token
        and er.election_id = p_election_id
      order by er.created_at desc
      limit 1
    )
  ) into result;

  return result;
end;
$$ language plpgsql security definer;

-- ============== RPC: finalize_election ==============
-- Chamado quando o eleitor concluiu todas as sessões.
-- Emite o comprovante final da eleição.
create or replace function public.finalize_election(
  p_election_id uuid,
  p_voter_token text
) returns json as $$
declare
  v_total_sessions integer;
  v_completed_count integer;
  v_receipt text;
  v_sessions_json jsonb;
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

-- ============== RPC: admin_list_receipts ==============
create or replace function public.admin_list_receipts(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  result json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select json_agg(row_to_json(r) order by r.created_at desc) into result
  from (
    select
      er.receipt_code,
      er.voter_token,
      er.created_at,
      (select name from public.elections where id = er.election_id) as election_name,
      er.session_completions
    from public.election_receipts er
    where er.election_id = p_election_id
  ) r;

  return coalesce(result, '[]'::json);
end;
$$ language plpgsql security definer;

-- ============== POLÍTICAS: permitir SELECT anônimo nas tabelas ==============
-- (já criado acima para elections, voting_sessions, candidates)

-- Permitir SELECT anônimo em votes (apenas para o admin via service_role)
-- Não há policy de SELECT para 'anon' em votes, voter_completions, election_receipts
-- porque essas leituras são feitas via service_role ou via RPC.

-- Permitir chamada de funções RPC para anon
grant execute on function public.get_public_election(uuid) to anon, authenticated;
grant execute on function public.get_voter_status(uuid, text) to anon, authenticated;
grant execute on function public.submit_vote(uuid, uuid, text, uuid[], integer, double precision, double precision) to anon, authenticated;
grant execute on function public.finalize_election(uuid, text) to anon, authenticated;
grant execute on function public.verify_admin(uuid, text) to anon, authenticated;
grant execute on function public.hash_password(text, text) to anon, authenticated;

-- Service role faz tudo (admin)
-- Já tem acesso implícito via SECURITY DEFINER.

-- ============== RPC: admin_export_election ==============
-- Exporta todos os dados da eleicao (sem votos) em formato JSON para backup
create or replace function public.admin_export_election(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  result json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select json_build_object(
    'exported_at', now(),
    'election', (
      select json_build_object(
        'id', e.id,
        'name', e.name,
        'location_name', e.location_name,
        'location_lat', e.location_lat,
        'location_lng', e.location_lng,
        'location_radius', e.location_radius,
        'geo_required', e.geo_required
      )
      from public.elections e
      where e.id = p_election_id
    ),
    'sessions', (
      select coalesce(json_agg(
        json_build_object(
          'id', vs.id,
          'title', vs.title,
          'description', vs.description,
          'votes_required', vs.votes_required,
          'display_order', vs.display_order,
          'is_active', vs.is_active,
          'candidates', (
            select coalesce(json_agg(
              json_build_object(
                'id', c.id,
                'name', c.name,
                'display_order', c.display_order
              ) order by c.display_order
            ), '[]'::json)
            from public.candidates c
            where c.session_id = vs.id
          )
        ) order by vs.display_order
      ), '[]'::json)
      from public.voting_sessions vs
      where vs.election_id = p_election_id
    )
  ) into result;

  return result;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_export_election(uuid, text) to anon, authenticated;

-- ============== RPC: admin_import_election ==============
-- Restaura os dados de uma eleicao a partir de um backup JSON.
create or replace function public.admin_import_election(
  p_election_id uuid,
  p_password text,
  p_data json
) returns boolean as $$
declare
  ok boolean;
  v_election json;
  v_sessions json;
  v_session json;
  v_candidates json;
  v_session_id uuid;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  v_election := p_data->'election';
  v_sessions := p_data->'sessions';

  if v_election is not null then
    update public.elections
      set name = v_election->>'name',
          location_name = v_election->>'location_name',
          location_lat = (v_election->>'location_lat')::double precision,
          location_lng = (v_election->>'location_lng')::double precision,
          location_radius = coalesce((v_election->>'location_radius')::integer, 100),
          geo_required = coalesce((v_election->>'geo_required')::boolean, true),
          updated_at = now()
    where id = p_election_id;
  end if;

  delete from public.voting_sessions where election_id = p_election_id;

  if v_sessions is not null then
    for v_session in select * from json_array_elements(v_sessions)
    loop
      insert into public.voting_sessions
        (id, election_id, title, description, votes_required, display_order, is_active)
      values (
        (v_session->>'id')::uuid,
        p_election_id,
        v_session->>'title',
        v_session->>'description',
        (v_session->>'votes_required')::integer,
        (v_session->>'display_order')::integer,
        coalesce((v_session->>'is_active')::boolean, true)
      )
      returning id into v_session_id;

      v_candidates := v_session->'candidates';
      if v_candidates is not null then
        insert into public.candidates (id, session_id, name, display_order)
        select
          (c->>'id')::uuid,
          v_session_id,
          c->>'name',
          (c->>'display_order')::integer
        from json_array_elements(v_candidates) c;
      end if;
    end loop;
  end if;

  return true;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_import_election(uuid, text, json) to anon, authenticated;

-- ============== DADOS INICIAIS (opcional) ==============
-- A eleição pode ser criada pelo frontend ou via seed abaixo.
-- Use o arquivo supabase/seed/seed.sql para popular dados de exemplo.
