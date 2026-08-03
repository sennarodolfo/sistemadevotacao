-- =================================================================
-- Migração 0007: Senha própria para a Votação Manual
-- =================================================================
-- Até aqui, a página #votacaomanual usava a MESMA senha do painel
-- administrativo (verify_admin). Esta migração cria uma senha
-- INDEPENDENTE só para o mesário, armazenada com o mesmo esquema de
-- hash+salt já usado para a senha de admin:
--
--   verify_manual                 -> valida a senha da votação manual
--                                    (chamada pela tela de login de
--                                    #votacaomanual, sem precisar da
--                                    senha de admin).
--   admin_change_manual_password  -> troca a senha da votação manual.
--                                    Exige a senha de ADMIN (não a senha
--                                    manual antiga) porque a troca é
--                                    feita de dentro do painel
--                                    administrativo, já autenticado -
--                                    isso também permite ao admin
--                                    "resetar" a senha do mesário mesmo
--                                    que ele a tenha esquecido.
--
-- Eleições já existentes recebem uma senha manual padrão
-- ('manual123'), que deve ser trocada pelo admin depois.
-- =================================================================

alter table public.elections add column if not exists manual_password_hash text;
alter table public.elections add column if not exists manual_password_salt text;

-- Preenche uma senha padrão para eleições que ainda não têm uma
do $$
declare
  r record;
  v_salt text;
begin
  for r in select id from public.elections where manual_password_hash is null loop
    v_salt := encode(gen_random_bytes(16), 'hex');
    update public.elections
      set manual_password_hash = public.hash_password('manual123', v_salt),
          manual_password_salt = v_salt
      where id = r.id;
  end loop;
end $$;

alter table public.elections alter column manual_password_hash set not null;
alter table public.elections alter column manual_password_salt set not null;

-- ============== RPC: verify_manual ==============
create or replace function public.verify_manual(p_election_id uuid, p_password text)
returns boolean as $$
declare
  stored_hash text;
  stored_salt text;
begin
  select manual_password_hash, manual_password_salt
    into stored_hash, stored_salt
  from public.elections
  where id = p_election_id;

  if stored_hash is null then return false; end if;
  return stored_hash = public.hash_password(p_password, stored_salt);
end;
$$ language plpgsql security definer;

grant execute on function public.verify_manual(uuid, text) to anon, authenticated;

-- ============== RPC: admin_change_manual_password ==============
create or replace function public.admin_change_manual_password(
  p_election_id uuid,
  p_password text,
  p_new_password text
) returns boolean as $$
declare
  ok boolean;
  new_salt text;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return false; end if;
  if length(p_new_password) < 4 then return false; end if;

  new_salt := encode(gen_random_bytes(16), 'hex');
  update public.elections
    set manual_password_hash = public.hash_password(p_new_password, new_salt),
        manual_password_salt = new_salt,
        updated_at = now()
  where id = p_election_id;

  return true;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_change_manual_password(uuid, text, text) to anon, authenticated;
