-- =================================================================
-- Migração 0002: Autenticação por código de 4 dígitos
-- + Remoção do bloqueio por geolocalização
-- =================================================================
-- Esta migração:
--   1) Cria a tabela voter_codes e as funções RPC para o admin gerar
--      códigos numéricos de 4 dígitos e para o eleitor validar (redeem)
--      um código no início da votação. O código validado passa a ser
--      a identificação do eleitor (voter_token) em todas as sessões
--      da urna e é marcado como usado imediatamente, impedindo que
--      seja digitado novamente por qualquer outro dispositivo.
--   2) Remove o mecanismo de BLOQUEIO por geolocalização (não impedia
--      efetivamente votos fora do local, apenas comparava lat/lng
--      informados pelo próprio navegador do eleitor). O campo
--      location_name é mantido apenas como texto informativo.
--      As colunas antigas (location_lat, location_lng, location_radius,
--      geo_required) permanecem na tabela por segurança/compatibilidade,
--      mas deixam de ser lidas ou exigidas pelo sistema.
-- =================================================================

-- ============== TABELA: voter_codes ==============
create table if not exists public.voter_codes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete cascade,
  code text not null,
  is_used boolean not null default false,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (election_id, code)
);

create index if not exists idx_voter_codes_election on public.voter_codes(election_id);
create index if not exists idx_voter_codes_lookup on public.voter_codes(election_id, code);
create index if not exists idx_voter_codes_pending on public.voter_codes(election_id, is_used);

alter table public.voter_codes enable row level security;
-- Não há policy de SELECT/INSERT/UPDATE anônima em voter_codes: todo acesso
-- passa pelas funções RPC abaixo (security definer), nunca direto pela tabela.

-- ============== RPC: admin_generate_codes ==============
-- Gera N códigos numéricos aleatórios de 4 dígitos (0000-9999), únicos
-- dentro da eleição. Retorna a lista dos códigos recém-criados (para
-- imprimir imediatamente em PDF) e um resumo da quantidade gerada.
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

  -- O espaço de códigos de 4 dígitos é limitado (10.000 combinações),
  -- então limitamos as tentativas para não entrar em loop quando o
  -- espaço disponível estiver perto de se esgotar.
  v_max_attempts := p_quantity * 40 + 2000;

  while v_count < p_quantity and v_attempts < v_max_attempts loop
    v_attempts := v_attempts + 1;
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      insert into public.voter_codes (election_id, code) values (p_election_id, v_code);
      v_codes := array_append(v_codes, v_code);
      v_count := v_count + 1;
    exception when unique_violation then
      -- código já existe nesta eleição, tenta outro
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

grant execute on function public.admin_generate_codes(uuid, text, integer) to anon, authenticated;

-- ============== RPC: admin_list_codes ==============
-- Lista os códigos já gerados para a eleição, com status de uso e
-- contadores agregados (total / usados / disponíveis).
create or replace function public.admin_list_codes(
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
  from public.voter_codes
  where election_id = p_election_id;

  select coalesce(json_agg(row_to_json(r) order by r.created_at desc), '[]'::json)
    into v_list
  from (
    select code, is_used, used_at, created_at
    from public.voter_codes
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

grant execute on function public.admin_list_codes(uuid, text) to anon, authenticated;

-- ============== RPC: redeem_voter_code ==============
-- Chamada pelo eleitor ao digitar o código de 4 dígitos no início da
-- votação. Valida e marca o código como usado ATOMICAMENTE (update
-- condicionado a is_used = false), impedindo que o mesmo código seja
-- reaproveitado por outro dispositivo/aba em uma corrida (race condition).
-- O "voter_token" retornado é determinístico (derivado do código) e passa
-- a ser usado em todas as chamadas existentes (submit_vote, get_voter_status,
-- finalize_election) exatamente como o token aleatório antigo - nenhuma
-- dessas funções precisou ser alterada.
create or replace function public.redeem_voter_code(
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

  update public.voter_codes
    set is_used = true, used_at = now()
  where election_id = p_election_id
    and code = v_norm
    and is_used = false
  returning id into v_id;

  if v_id is null then
    if exists (
      select 1 from public.voter_codes
      where election_id = p_election_id and code = v_norm
    ) then
      return json_build_object('error', 'code_already_used');
    else
      return json_build_object('error', 'code_not_found');
    end if;
  end if;

  return json_build_object(
    'success', true,
    'voter_token', 'code-' || p_election_id::text || '-' || v_norm
  );
end;
$$ language plpgsql security definer;

grant execute on function public.redeem_voter_code(uuid, text) to anon, authenticated;

-- =================================================================
-- REMOÇÃO DO BLOQUEIO POR GEOLOCALIZAÇÃO
-- =================================================================

-- ---- get_public_election: não expõe mais campos de geolocalização ----
create or replace function public.get_public_election(p_election_id uuid)
returns json as $$
declare
  result json;
begin
  select json_build_object(
    'id', e.id,
    'name', e.name,
    'location_name', e.location_name,
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

-- ---- admin_update_election: assinatura simplificada (sem geo) ----
drop function if exists public.admin_update_election(uuid, text, text, text, double precision, double precision, integer, boolean);

create or replace function public.admin_update_election(
  p_election_id uuid,
  p_password text,
  p_name text,
  p_location_name text
) returns boolean as $$
declare
  ok boolean;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;

  update public.elections
    set name = p_name,
        location_name = p_location_name,
        updated_at = now()
  where id = p_election_id;

  return true;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_update_election(uuid, text, text, text) to anon, authenticated;

-- ---- admin_export_election: backup sem campos de geo ----
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
        'location_name', e.location_name
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

-- ---- admin_import_election: restauração sem campos de geo ----
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
