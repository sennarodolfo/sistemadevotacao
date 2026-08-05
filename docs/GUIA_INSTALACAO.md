# Guia de Instalação — Sistema de Votação Eletrônica

> Versão texto. O PDF binário original não foi extraído do zip; este arquivo
> é o manual de referência. Para gerar um PDF, rode `pandoc GUIA_INSTALACAO.md -o GUIA_INSTALCAO.pdf`
> localmente.

## 1. Pré-requisitos

- Conta no [Supabase](https://supabase.com) (grátis)
- Conta no [Vercel](https://vercel.com) ou [Netlify](https://netlify.com)
- Node.js 20+ (somente para rodar localmente)

## 2. Configurar o Supabase

1. Crie um projeto novo no Supabase (escolha região próxima).
2. Aguarde provisionamento (1-2 min).
3. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0001_init.sql` e rode.
4. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0002_codigo_autenticacao.sql` e rode (adiciona os códigos de votação de 4 dígitos e remove o bloqueio por geolocalização).
5. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0003_foto_candidatos.sql` e rode (adiciona o campo de foto do candidato).
6. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0004_gerenciar_codigos.sql` e rode (permite resetar/apagar códigos de votação).
7. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0005_reset_apagar_todos_codigos.sql` e rode (permite resetar/apagar TODOS os códigos de uma vez).
8. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0006_cedulas_manuais.sql` e rode (cria o módulo de cédulas manuais para o mesário).
9. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0007_senha_votacao_manual.sql` e rode (cria a senha própria da votação manual — padrão inicial `manual123`, troque depois no painel).
10. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0008_eleitores_presentes.sql` e rode (adiciona o número de eleitores presentes por sessão, base do cálculo de percentual).
11. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0009_conferencia_votos.sql` e rode (permite conferir quais códigos não votaram em todas as sessões).
12. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0010_bloqueio_ao_concluir.sql` e rode (o código só bloqueia ao concluir todas as sessões, permitindo retomar uma votação incompleta).
13. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0011_corrige_conferencia_votos.sql` e rode (corrige a Conferência de Votos para voltar a mostrar códigos incompletos).
14. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0012_corrige_restauracao_backup.sql` e rode (corrige a restauração de backup, que antes podia falhar silenciosamente).
15. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0013_backup_completo.sql` e rode (expande o backup para incluir votos, comprovantes e códigos).
16. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0014_corrige_deploy_import.sql` e rode (corrige um problema de implantação que podia deixar a restauração desatualizada — rode mesmo se já rodou a 0013).
17. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0015_tamanho_codigo_configuravel.sql` e rode (permite ao admin escolher de 4 a 8 dígitos para os códigos).
18. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0016_contas_usuario.sql` e rode (habilita o modo multiusuário — contas de organizador e eleições próprias).
19. Em **Authentication → Providers**, confirme que **Email** está habilitado (vem assim por padrão). Em **Authentication → Settings**, decida se quer exigir confirmação de e-mail no cadastro (recomendado em produção).
20. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0017_corrige_bug_votos_e_membros_presentes.sql` e rode (corrige um bug importante: editar uma sessão zerava os votos já registrados; move "membros presentes" para a aba Geral, valendo para todas as sessões).
21. **SQL Editor → New query**: cole o conteúdo de `supabase/migrations/0018_link_por_sessao.sql` e rode (cria o link individual de cada sessão, para votar em janela dedicada — ver seção "Link individual por sessão" no README).
22. **SQL Editor → New query**: cole o conteúdo de `supabase/seed/seed.sql` e rode.
23. Copie o UUID da eleição mostrado na mensagem final: este é seu `VITE_ELECTION_ID` — **só necessário se for usar o modo clássico de uma eleição só**. No modo multiusuário (recomendado), pule este passo.
24. **Settings → API** copie:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`

## 3. Deploy na Vercel

1. Suba o projeto para o GitHub.
2. Importe na Vercel.
3. **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ELECTION_ID` *(opcional — só para o modo clássico de uma eleição só)*
4. Deploy.

Acesse `/#login` para o organizador criar conta e gerenciar suas eleições (modo multiusuário), `/` para votar no modo clássico (se `VITE_ELECTION_ID` estiver definido), `#admin` para o painel (senha padrão: `admin123`) e `#votacaomanual` para a votação manual do mesário (senha própria, padrão: `manual123`).

## 4. Rodar localmente

```bash
cp .env.example .env
# edite .env
npm install
npm run dev
```

Acesse http://localhost:5173.

## 5. Docker (Supabase local)

```bash
cp .env.example .env
docker compose up -d
# Frontend: http://localhost:5173
# Studio:   http://localhost:54323
```

## 6. Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Página em branco | Env vars ausentes | Verifique o console (F12) e reconfigure na Vercel |
| "Eleição não encontrada" | UUID errado no `.env` | Rode o seed novamente e copie o UUID |
| "Não foi possível conectar" | URL ou chave Supabase errada | Revise `Settings → API` no Supabase |
| "Sessão fechada" | Admin fechou a sessão | Reabra pelo painel `#admin` |
| Não recebo e-mail de confirmação de cadastro | Confirmação de e-mail habilitada mas SMTP não configurado | Em `Authentication → Settings`, desabilite a confirmação de e-mail para testes, ou configure um provedor SMTP |
| Esqueci a senha de admin/manual de uma eleição criada pelo Dashboard | Senha só é mostrada uma vez na criação | No Dashboard, use "Redefinir senha admin"/"Redefinir senha manual" no card da eleição |
