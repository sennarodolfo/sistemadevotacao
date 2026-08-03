-- =================================================================
-- Migração 0003: Foto dos candidatos
-- =================================================================
-- Adiciona um campo de foto opcional para cada candidato. A imagem é
-- redimensionada/comprimida no navegador (canvas) ANTES do envio e
-- armazenada como data URI (base64) na própria coluna `photo_url` da
-- tabela `candidates` — não é necessário configurar Supabase Storage,
-- bucket ou policies adicionais; o upload passa pelas mesmas funções
-- RPC (security definer + verify_admin) já usadas por todo o painel
-- administrativo, mantendo o mesmo modelo de segurança do sistema.
--
-- Como o formato de `p_candidates` muda de `text[]` (só nomes) para
-- `jsonb` (nome + foto), as funções admin_create_session e
-- admin_update_session são recriadas com nova assinatura.
-- =================================================================

-- ============== candidates.photo_url ==============
alter table public.candidates add column if not exists photo_url text;

-- ============== admin_create_session (candidatos com foto) ==============
drop function if exists public.admin_create_session(uuid, text, text, integer, text[]);

create or replace function public.admin_create_session(
  p_election_id uuid,
  p_password text,
  p_title text,
  p_votes_required integer,
  p_candidates jsonb
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
    insert into public.candidates (session_id, name, photo_url, display_order)
    select new_session_id, trim(c->>'name'), nullif(trim(coalesce(c->>'photo_url', '')), ''), row_number() over ()
    from jsonb_array_elements(p_candidates) as c
    where trim(coalesce(c->>'name', '')) <> '';
  end if;

  return json_build_object('id', new_session_id);
end;
$$ language plpgsql security definer;

grant execute on function public.admin_create_session(uuid, text, text, integer, jsonb) to anon, authenticated;

-- ============== admin_update_session (candidatos com foto) ==============
drop function if exists public.admin_update_session(uuid, text, uuid, text, integer, text[], boolean);

create or replace function public.admin_update_session(
  p_election_id uuid,
  p_password text,
  p_session_id uuid,
  p_title text,
  p_votes_required integer,
  p_candidates jsonb,
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
    insert into public.candidates (session_id, name, photo_url, display_order)
    select p_session_id, trim(c->>'name'), nullif(trim(coalesce(c->>'photo_url', '')), ''), row_number() over ()
    from jsonb_array_elements(p_candidates) as c
    where trim(coalesce(c->>'name', '')) <> '';
  end if;

  return true;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_update_session(uuid, text, uuid, text, integer, jsonb, boolean) to anon, authenticated;

-- ============== get_public_election: inclui photo_url ==============
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

-- ============== admin_get_results: inclui photo_url ==============
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
        (select json_agg(json_build_object('id', c.id, 'name', c.name, 'photo_url', c.photo_url, 'votes',
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

-- ============== admin_export_election: inclui photo_url ==============
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
                'photo_url', c.photo_url,
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

-- ============== admin_import_election: restaura photo_url ==============
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
        insert into public.candidates (id, session_id, name, photo_url, display_order)
        select
          (c->>'id')::uuid,
          v_session_id,
          c->>'name',
          c->>'photo_url',
          (c->>'display_order')::integer
        from json_array_elements(v_candidates) c;
      end if;
    end loop;
  end if;

  return true;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_import_election(uuid, text, json) to anon, authenticated;
