# Sistema de Votação Eletrônica com Supabase

Sistema de votação eletrônica **multi-sessão** com backend em **Supabase** (PostgreSQL + Auth + RPC), capaz de rodar em:

- 🌐 **Internet** — Supabase Cloud + Vercel (recomendado) ou Netlify
- 🏠 **Servidor local / LAN** — Supabase local via Docker

## ✨ Funcionalidades

- ✅ Múltiplas sessões de votação em uma mesma eleição (ex: Presbíteros, Diáconos, etc.)
- ✅ Autenticação do eleitor por código numérico de 4 dígitos (uso único, gerado pelo admin)
- ✅ Geração em lote de códigos de votação com exportação em PDF pronto para impressão e recorte
- ✅ Comprovante de votação com código único (`VT-YYYYMMDD-XXXXXX`)
- ✅ Painel administrativo completo (CRUD de sessões, códigos, resultados, auditoria, segurança)
- ✅ Resultados com gráficos de barras e pizza + exportação Excel e PDF
- ✅ PDF do comprovante de votação baixado direto no dispositivo
- ✅ Senha de admin com hash + salt no banco
- ✅ Tela de erro amigável se faltar configuração

## 📁 Estrutura

```
votacao-supabase/
├── src/                          # Frontend React (Vite)
│   ├── components/Icon.jsx
│   ├── views/                    # Telas (Welcome, Voting, Admin, Results...)
│   ├── lib/                      # Cliente Supabase e helpers
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   ├── migrations/0001_init.sql              # Schema do banco
│   ├── migrations/0002_codigo_autenticacao.sql  # Códigos de votação + remoção do bloqueio por geo
│   └── seed/seed.sql             # Dados iniciais
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── netlify.toml
└── .env.example
```

---

## 🚀 Deploy em 3 passos (GitHub → Vercel → Supabase)

### Passo 1 — Subir o projeto para o GitHub

1. Crie um repositório novo no GitHub (privado ou público, como preferir).
2. Suba **toda a pasta `votacao-supabase/`** para esse repositório. **Não inclua `node_modules`**.

```bash
cd votacao-supabase
git init
git add .
git commit -m "Sistema de Votação Eletrônica"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```

### Passo 2 — Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com) e crie uma conta gratuita.
2. Clique em **"New Project"**, escolha uma senha forte para o banco e selecione a região mais próxima.
3. Aguarde o projeto ser provisionado (cerca de 1–2 minutos).
4. No menu lateral, vá em **SQL Editor** e clique em **"New query"**.
5. Abra o arquivo `supabase/migrations/0001_init.sql` deste projeto, copie todo o conteúdo e cole no editor. Clique em **Run** (ou Ctrl+Enter).
6. Crie **outra** query, abra o arquivo `supabase/migrations/0002_codigo_autenticacao.sql`, copie todo o conteúdo e rode também (cria os códigos de votação de 4 dígitos e remove o bloqueio por geolocalização).
7. Crie **outra** query, abra o arquivo `supabase/seed/seed.sql`, copie todo o conteúdo e rode também.
8. Após rodar o seed, a aba **"Messages"** (ou "Logs") embaixo vai mostrar o UUID da eleição criada. Copie esse UUID — você vai precisar dele no Passo 3.
9. Vá em **Settings → API** e copie:
   - **Project URL** (ex: `https://abcdefgh.supabase.co`) — esse é o seu `VITE_SUPABASE_URL`
   - **anon public key** (uma string JWT longa começando com `eyJhbGc...`) — esse é o seu `VITE_SUPABASE_ANON_KEY`

### Passo 3 — Deploy na Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login com a mesma conta do GitHub.
2. Clique em **"Add New → Project"**.
3. Selecione o repositório que você criou no Passo 1 e clique em **"Import"**.
4. Na tela de configuração:
   - **Framework Preset**: Vite (deve ser detectado automaticamente)
   - **Build Command**: `npm run build` (padrão)
   - **Output Directory**: `dist` (padrão)
5. **Antes de clicar em Deploy**, abra a seção **"Environment Variables"** e adicione estas 3 variáveis:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://SEUPROJETO.supabase.co` (a URL do Passo 2) |
   | `VITE_SUPABASE_ANON_KEY` | a chave anon copiada no Passo 2 |
   | `VITE_ELECTION_ID` | o UUID da eleição copiado no Passo 2 |

6. Clique em **Deploy**. Aguarde 1–2 minutos. Quando terminar, você recebe uma URL pública tipo `https://seu-projeto.vercel.app`.

### Passo 4 — Testar

1. Acesse a URL pública da Vercel. A tela de boas-vindas deve aparecer com o nome da eleição.
2. Para abrir o painel admin, acesse `https://sua-url.vercel.app/#admin` e entre com a senha `admin123` (altere depois no painel).
3. Vote como eleitor em outra aba/celular para verificar que está tudo funcional.

> ⚠️ **Se a página ficar em branco**, abra o DevTools (F12) → Console. O sistema agora loga o status das variáveis de ambiente automaticamente:
> ```
> [Urna Eletrônica] { env: { url: "OK", key: "OK", election: "OK" } ... }
> ```
> Se algum item estiver como `"AUSENTE"`, volte ao Passo 3 e reconfigure as variáveis. **Lembre-se: alterar variáveis exige um novo deploy** (a Vercel não recompila automaticamente).

---

## 🛠️ Rodar localmente (opcional)

```bash
# 1. Copie o .env
cp .env.example .env
# Edite o .env com os valores do seu projeto Supabase

# 2. Instale as dependências
npm install

# 3. Rode em modo desenvolvimento
npm run dev
# Abre em http://localhost:5173
```

## 🐳 Rodar com Supabase local (Docker)

```bash
cp .env.example .env
# Edite o .env se quiser alterar senha do banco
docker compose up -d
# Frontend: http://localhost:5173
# Studio:   http://localhost:54323
```

Para rodar o seed após o `docker compose up`:
```bash
docker exec -i votacao-db psql -U postgres -d postgres < supabase/seed/seed.sql
```

---

## 🔐 Variáveis de ambiente

| Nome | Obrigatório | Descrição |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | URL do projeto Supabase (ex: `https://abc.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Chave pública `anon` (em Settings → API) |
| `VITE_ELECTION_ID` | ✅ | UUID da eleição (gerado pelo seed) |

Para o **Docker local** há também `POSTGRES_PASSWORD`, `JWT_SECRET` e `SUPABASE_ANON_KEY`, mas essas NÃO são usadas pelo Vite.

---

## 📊 Senha padrão do admin

- Senha inicial: **`admin123`**
- Altere após o primeiro acesso pelo painel admin (aba "Geral" → "Alterar Senha")

---

## 🆘 Solução de problemas

### "Página em branco após deploy"
1. Abra DevTools (F12) → Console. Procure o log `[Urna Eletrônica]`.
2. Verifique se as 3 variáveis de ambiente estão configuradas no painel da Vercel (Settings → Environment Variables).
3. **Após adicionar/alterar variáveis, faça um novo deploy** — a Vercel não recompila sozinha.
4. Confirme que o `VITE_ELECTION_ID` é um UUID válido (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`), não o placeholder `00000000-...`.

### "Erro ao carregar" / "Não foi possível conectar ao Supabase"
- Confirme que o `VITE_SUPABASE_URL` está correto (com `https://` e sem barra no final).
- Confirme que a chave `anon` foi copiada inteira (sem espaços extras no início ou fim).
- Verifique se o projeto Supabase está **ativo** (não pausado).

### "Eleição não encontrada"
- O `VITE_ELECTION_ID` aponta para um UUID que não existe no banco.
- Rode o seed novamente no SQL Editor do Supabase e copie o UUID gerado.

### Build local falha com erro de memória
```bash
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

---

## 📚 Mais documentação

Veja `docs/GUIA_INSTALACAO.pdf` para o manual completo em PDF.

## 📝 Licença

MIT
