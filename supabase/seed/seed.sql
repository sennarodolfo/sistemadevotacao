-- =================================================================
-- SEED: Eleição de exemplo para testes
-- =================================================================
-- Como rodar:
--   1) Supabase Cloud: SQL Editor > New query > cole este conteúdo > Run
--   2) Supabase CLI:    supabase db reset (este arquivo roda automaticamente)
--   3) Após rodar, copie o ID exibido e defina como VITE_ELECTION_ID
--
-- IMPORTANTE: Se você já rodou este seed antes e quer manter os dados,
-- apague a parte "do $$" e use apenas o SELECT abaixo para pegar o ID.
-- =================================================================

do $$
declare
  v_election_id uuid;
  v_session_pres uuid;
  v_session_diac uuid;
  v_salt text;
  -- Hash determinístico de "admin123" (salt abaixo)
  v_hash text;
begin
  -- Salt fixo para que o hash seja reproduzível. Se você trocar a senha
  -- padrão, altere o hash na sequência (gere via /admin/#change-password).
  v_salt := 'votacao-2026-default-salt';
  v_hash := encode(digest('admin123' || v_salt, 'sha256'), 'hex');

  -- Remove seed anterior (se existir) para permitir re-rodar
  delete from public.elections where name = 'Eleição de Liderança 2026';

  insert into public.elections (
    name,
    location_name,
    location_lat,
    location_lng,
    location_radius,
    geo_required,
    admin_password_hash,
    admin_password_salt
  ) values (
    'Eleição de Liderança 2026',
    'Igreja - Salão Principal',
    -23.5505,
    -46.6333,
    100,
    false,
    v_hash,
    v_salt
  ) returning id into v_election_id;

  -- Sessão 1: Presbíteros
  insert into public.voting_sessions (election_id, title, votes_required, display_order, description)
  values (v_election_id, 'Presbíteros', 3, 1, 'Eleição para o Conselho de Presbíteros')
  returning id into v_session_pres;

  insert into public.candidates (session_id, name, display_order) values
    (v_session_pres, 'João da Silva', 1),
    (v_session_pres, 'Pedro Souza', 2),
    (v_session_pres, 'Carlos Mendes', 3),
    (v_session_pres, 'Antônio Costa', 4),
    (v_session_pres, 'Paulo Oliveira', 5);

  -- Sessão 2: Diáconos
  insert into public.voting_sessions (election_id, title, votes_required, display_order, description)
  values (v_election_id, 'Diáconos', 2, 2, 'Eleição para o Ministério de Diáconos')
  returning id into v_session_diac;

  insert into public.candidates (session_id, name, display_order) values
    (v_session_diac, 'Marcos Lima', 1),
    (v_session_diac, 'Lucas Pereira', 2),
    (v_session_diac, 'André Santos', 3),
    (v_session_diac, 'Tiago Rodrigues', 4);

  -- Mensagem final com o ID para copiar
  raise notice '================================================';
  raise notice 'ELEIÇÃO CRIADA COM SUCESSO';
  raise notice 'ID da eleição: %', v_election_id;
  raise notice 'Senha do admin: admin123';
  raise notice '';
  raise notice 'Copie o UUID acima e defina como VITE_ELECTION_ID';
  raise notice 'na Vercel/Netlify, depois faça um novo deploy.';
  raise notice '================================================';
end $$;

-- Para consultar o ID a qualquer momento:
-- SELECT id, name, created_at FROM public.elections ORDER BY created_at DESC;
