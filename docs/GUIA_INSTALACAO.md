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
12. **SQL Editor → New query**: cole o conteúdo de `supabase/seed/seed.sql` e rode.
13. Copie o UUID da eleição mostrado na mensagem final: este é seu `VITE_ELECTION_ID`.
14. **Settings → API** copie:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`

## 3. Deploy na Vercel

1. Suba o projeto para o GitHub.
2. Importe na Vercel.
3. **Environment Variables**, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ELECTION_ID`
4. Deploy.

Acesse `/` para votar, `#admin` para o painel (senha padrão: `admin123`) e `#votacaomanual` para a votação manual do mesário (senha própria, padrão: `manual123`).

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
