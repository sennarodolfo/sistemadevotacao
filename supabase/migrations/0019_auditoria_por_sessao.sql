-- =================================================================
-- Migração 0019: Auditoria agrupada por sessão
-- =================================================================
-- Com o link individual por sessão (migração 0018), um eleitor pode
-- votar em uma sessão sem ainda ter concluído as demais - ou seja, sem
-- que o comprovante FINAL da eleição (election_receipts, só gerado ao
-- concluir TODAS as sessões) exista ainda. A Auditoria, que até aqui
-- listava só esses comprovantes finais, precisa passar a listar o
-- comprovante de CADA SESSÃO (voter_completions.receipt_code, gerado
-- a cada voto por submit_vote - sempre existiu, só não tinha uma
-- listagem própria), organizado por sessão.
-- =================================================================

create or replace function public.admin_list_session_receipts(
  p_election_id uuid,
  p_password text
) returns json as $$
declare
  ok boolean;
  result json;
begin
  ok := public.verify_admin(p_election_id, p_password);
  if not ok then return json_build_object('error', 'unauthorized'); end if;

  select coalesce(json_agg(s order by s.display_order), '[]'::json) into result
  from (
    select
      vs.id as session_id,
      vs.title as session_title,
      vs.display_order,
      coalesce(
        (select json_agg(json_build_object(
            'receipt_code', vc.receipt_code,
            'voter_token', vc.voter_token,
            'voted_candidates', vc.voted_candidates,
            'blank_count', vc.blank_count,
            'created_at', vc.created_at
          ) order by vc.created_at desc)
         from public.voter_completions vc
         where vc.session_id = vs.id),
        '[]'::json
      ) as receipts
    from public.voting_sessions vs
    where vs.election_id = p_election_id
    order by vs.display_order
  ) s;

  return result;
end;
$$ language plpgsql security definer;

grant execute on function public.admin_list_session_receipts(uuid, text) to anon, authenticated;

NOTIFY pgrst, 'reload schema';
