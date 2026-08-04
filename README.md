# Sistema de Votação Eletrônica com Supabase

Sistema de votação eletrônica **multi-sessão** com backend em **Supabase** (PostgreSQL + Auth + RPC), capaz de rodar em:

- 🌐 **Internet** — Supabase Cloud + Vercel (recomendado) ou Netlify
- 🏠 **Servidor local / LAN** — Supabase local via Docker

## ✨ Funcionalidades

- ✅ Modo multiusuário: qualquer pessoa cria sua conta (e-mail + senha) e gerencia suas próprias eleições, isoladas das demais, com link de votação próprio para compartilhar — continua 100% compatível com o modo clássico de "uma eleição só"
- ✅ Múltiplas sessões de votação em uma mesma eleição (ex: Presbíteros, Diáconos, etc.)
- ✅ Eleição por assembleia: número de membros presentes por sessão, com percentual de cada candidato calculado sobre esse total (não sobre o total de votos) e indicação de "Eleito" (50% + 1)
- ✅ Auditoria exportável em PDF, além da lista no painel
- ✅ Conferência de votos: identifica códigos (eleitor ou cédula manual) que não votaram em todas as sessões, com relatório exportável em PDF
- ✅ Foto opcional de cada candidato (upload no cadastro, com zoom ao clicar na votação)
- ✅ Autenticação do eleitor por código numérico configurável (4 a 8 dígitos, escolhido pelo admin), bloqueado apenas ao concluir TODAS as sessões — se parar no meio, pode retomar com o mesmo código em qualquer dispositivo
- ✅ Geração em lote de códigos de votação com exportação em PDF pronto para impressão e recorte
- ✅ Gestão individual de códigos: resetar (destravar sem apagar votos) ou apagar (remove o código e os votos feitos com ele) — inclusive em lote (todos de uma vez)
- ✅ Módulo de cédulas manuais (`#votacaomanual`): códigos de 4 dígitos próprios e distintos dos códigos do eleitor, PDF com o código + lista de candidatos para marcação em papel, código digitado uma única vez libera todas as sessões, e aparece na Auditoria identificado como "Mesário (manual)"
- ✅ Leitura de cédulas por foto (aba "Leitura de Cédulas"): fotografe ou envie a imagem de uma cédula manual preenchida — o sistema corrige a perspectiva, reconhece o código (OCR) e as marcações (leitura óptica), e o mesário confirma/corrige antes de os votos serem computados
- ✅ Senha própria e independente para a página de votação manual, alterável pelo painel admin sem precisar da senha antiga
- ✅ "Modo urna": bloqueia o botão Voltar do navegador e avisa antes de atualizar/fechar a aba, para o eleitor não perder o progresso da votação
- ✅ Comprovante de votação com código único (`VT-YYYYMMDD-XXXXXX`)
- ✅ Painel administrativo completo (CRUD de sessões, códigos, resultados, auditoria, segurança)
- ✅ Resultados com gráficos de barras (horizontal, com votos e porcentagem) e pizza + exportação Excel e PDF
- ✅ Clique no gráfico de barras abre uma janela separada com apuração em tempo real (auto-atualiza a cada 4s), ideal para projetar em outra tela para o público acompanhar
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
│   ├── migrations/0003_foto_candidatos.sql    # Foto opcional dos candidatos
│   ├── migrations/0004_gerenciar_codigos.sql  # Resetar/apagar códigos de votação
│   ├── migrations/0005_reset_apagar_todos_codigos.sql  # Resetar/apagar TODOS os códigos de uma vez
│   ├── migrations/0006_cedulas_manuais.sql    # Módulo de cédulas manuais (mesário)
│   ├── migrations/0007_senha_votacao_manual.sql  # Senha própria para a votação manual
│   ├── migrations/0008_eleitores_presentes.sql  # Nº de eleitores presentes por sessão (base do %)
│   ├── migrations/0009_conferencia_votos.sql  # Conferência de votos (códigos incompletos)
│   ├── migrations/0010_bloqueio_ao_concluir.sql  # Código só bloqueia ao concluir todas as sessões
│   ├── migrations/0011_corrige_conferencia_votos.sql  # Corrige conferência p/ códigos incompletos
│   ├── migrations/0012_corrige_restauracao_backup.sql  # Corrige restauração de backup
│   ├── migrations/0013_backup_completo.sql    # Backup completo (votos, comprovantes, códigos)
│   ├── migrations/0014_corrige_deploy_import.sql  # Corrige implantação da função de restauração
│   ├── migrations/0015_tamanho_codigo_configuravel.sql  # Tamanho do código configurável (4-8 dígitos)
│   ├── migrations/0016_contas_usuario.sql     # Contas de usuário e eleições próprias (multiusuário)
│   ├── migrations/0017_corrige_bug_votos_e_membros_presentes.sql  # Corrige perda de votos ao editar sessão + membros presentes por eleição
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
7. Crie **outra** query, abra o arquivo `supabase/migrations/0003_foto_candidatos.sql`, copie todo o conteúdo e rode também (adiciona o campo de foto do candidato).
8. Crie **outra** query, abra o arquivo `supabase/migrations/0004_gerenciar_codigos.sql`, copie todo o conteúdo e rode também (permite resetar/apagar códigos de votação).
9. Crie **outra** query, abra o arquivo `supabase/migrations/0005_reset_apagar_todos_codigos.sql`, copie todo o conteúdo e rode também (permite resetar/apagar TODOS os códigos de uma vez).
10. Crie **outra** query, abra o arquivo `supabase/migrations/0006_cedulas_manuais.sql`, copie todo o conteúdo e rode também (cria o módulo de cédulas manuais para o mesário).
11. Crie **outra** query, abra o arquivo `supabase/migrations/0007_senha_votacao_manual.sql`, copie todo o conteúdo e rode também (cria a senha própria da votação manual — padrão inicial `manual123`, troque depois no painel).
12. Crie **outra** query, abra o arquivo `supabase/migrations/0008_eleitores_presentes.sql`, copie todo o conteúdo e rode também (adiciona o número de eleitores presentes por sessão, base do cálculo de percentual).
13. Crie **outra** query, abra o arquivo `supabase/migrations/0009_conferencia_votos.sql`, copie todo o conteúdo e rode também (permite conferir quais códigos não votaram em todas as sessões).
14. Crie **outra** query, abra o arquivo `supabase/migrations/0010_bloqueio_ao_concluir.sql`, copie todo o conteúdo e rode também (o código só bloqueia ao concluir todas as sessões, permitindo retomar uma votação incompleta).
15. Crie **outra** query, abra o arquivo `supabase/migrations/0011_corrige_conferencia_votos.sql`, copie todo o conteúdo e rode também (corrige a Conferência de Votos para voltar a mostrar códigos incompletos).
16. Crie **outra** query, abra o arquivo `supabase/migrations/0012_corrige_restauracao_backup.sql`, copie todo o conteúdo e rode também (corrige a restauração de backup, que antes podia falhar silenciosamente).
17. Crie **outra** query, abra o arquivo `supabase/migrations/0013_backup_completo.sql`, copie todo o conteúdo e rode também (expande o backup para incluir votos, comprovantes e códigos, não só a estrutura da eleição).
18. Crie **outra** query, abra o arquivo `supabase/migrations/0014_corrige_deploy_import.sql`, copie todo o conteúdo e rode também (corrige um problema de implantação que podia deixar a restauração desatualizada — rode mesmo se já rodou a 0013).
19. Crie **outra** query, abra o arquivo `supabase/migrations/0015_tamanho_codigo_configuravel.sql`, copie todo o conteúdo e rode também (permite ao admin escolher de 4 a 8 dígitos para os códigos).
20. Crie **outra** query, abra o arquivo `supabase/migrations/0016_contas_usuario.sql`, copie todo o conteúdo e rode também (habilita o modo multiusuário — veja a seção "Modo multiusuário" abaixo).
21. Crie **outra** query, abra o arquivo `supabase/migrations/0017_corrige_bug_votos_e_membros_presentes.sql`, copie todo o conteúdo e rode também (corrige um bug importante: editar uma sessão zerava os votos já registrados; também move "membros presentes" para a aba Geral, valendo para todas as sessões).
22. Crie **outra** query, abra o arquivo `supabase/seed/seed.sql`, copie todo o conteúdo e rode também.
23. Após rodar o seed, a aba **"Messages"** (ou "Logs") embaixo vai mostrar o UUID da eleição criada. Copie esse UUID — você vai precisar dele no Passo 3 **só se for usar o modo clássico de uma eleição só** (veja abaixo).
24. Vá em **Settings → API** e copie:
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
5. **Antes de clicar em Deploy**, abra a seção **"Environment Variables"** e adicione estas variáveis:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://SEUPROJETO.supabase.co` (a URL do Passo 2) |
   | `VITE_SUPABASE_ANON_KEY` | a chave anon copiada no Passo 2 |
   | `VITE_ELECTION_ID` *(opcional)* | o UUID da eleição copiado no Passo 2 — só defina se quiser o modo clássico de uma eleição só fixa; deixe em branco/não defina para usar o modo multiusuário (recomendado para a maioria dos casos) |

6. Clique em **Deploy**. Aguarde 1–2 minutos. Quando terminar, você recebe uma URL pública tipo `https://seu-projeto.vercel.app`.

### Passo 4 — Testar

1. Acesse a URL pública da Vercel. A tela de boas-vindas deve aparecer com o nome da eleição.
2. Para abrir o painel admin, acesse `https://sua-url.vercel.app/#admin` e entre com a senha `admin123` (altere depois no painel).
3. Para a votação manual do mesário, acesse `https://sua-url.vercel.app/#votacaomanual` (senha própria, padrão inicial `manual123` — altere na aba Geral do painel admin).
4. Vote como eleitor em outra aba/celular para verificar que está tudo funcional.

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

## 🗳️ Senha padrão da votação manual

- Senha inicial: **`manual123`** (independente da senha de admin)
- Altere pelo painel admin (aba "Geral" → "Alterar Senha da Votação Manual")

---

## 👥 Modo multiusuário

A partir da migração `0016`, o sistema aceita **contas de usuário reais** (via Supabase Auth): qualquer pessoa pode se cadastrar com e-mail e senha e criar suas próprias eleições, totalmente isoladas das de outros usuários — sem precisar mexer em variável de ambiente nem redeployar nada.

**Como usar:**

1. **Habilite o login por e-mail/senha** no seu projeto Supabase: **Authentication → Providers → Email** (já vem habilitado por padrão na maioria dos projetos novos). Em **Authentication → Settings**, decida se quer exigir confirmação de e-mail antes do primeiro login (recomendado em produção).
2. Acesse `https://sua-url.vercel.app/#login` — o organizador cria a conta (ou entra, se já tiver uma).
3. Ao entrar, cai no **Dashboard** (`#dashboard`): botão "Criar Nova Eleição" — dá um nome (e local, opcional) e o sistema gera a eleição já com senha de admin e senha de votação manual **aleatórias**, mostradas **uma única vez** na tela (com botão de copiar). Guarde-as — se perder, dá para gerar novas pelo próprio Dashboard ("Redefinir senha admin"/"Redefinir senha manual"), sem precisar da antiga.
4. Cada eleição criada já vem com um **link de votação próprio** (`#v/<id-da-eleição>`), mostrado no card da eleição no Dashboard, pronto para copiar e enviar aos eleitores — eles só precisam digitar o código de votação, exatamente como no modo clássico.
5. Os botões "Abrir Painel Admin" e "Votação Manual" no Dashboard levam direto para o painel daquela eleição específica (usando a senha gerada no passo 3).

**Compatibilidade:** quem já roda o sistema no modo clássico (uma eleição só, com `VITE_ELECTION_ID` definido) **não precisa mudar nada** — continua funcionando exatamente como antes, em paralelo ao modo multiusuário.

---

## 📷 Leitura de cédulas por foto

Na aba **"Leitura de Cédulas"** do painel admin, o mesário fotografa (ou envia um arquivo de) uma cédula manual preenchida e o sistema:

1. Pede para tocar nos **4 cantos** da cédula na foto (o mesmo mecanismo usado por apps de escanear documentos) — isso corrige a perspectiva/ângulo da foto.
2. Reconhece o **código de 4 dígitos** impresso (OCR, via [Tesseract.js](https://github.com/naptha/tesseract.js), rodando 100% no navegador).
3. Reconhece **quais quadradinhos foram marcados** (leitura óptica de marcação/OMR: mede o quanto cada quadrado está "escurecido" e separa marcado de não-marcado automaticamente).
4. Mostra tudo em uma tela de conferência — código editável e cada candidato com uma caixinha marcável/desmarcável — para o **mesário confirmar ou corrigir** antes de enviar.
5. Só ao clicar em "Confirmar e Registrar Votos" os votos entram no banco (mesmas regras e RPCs da votação manual comum — aparece na Auditoria como "Mesário (manual)").

**Importante saber:**
- O reconhecimento é uma **ajuda**, não uma autoridade: nada é gravado sem a confirmação explícita do mesário na tela de revisão.
- A precisão depende de boa iluminação, foco e da cédula estar bem enquadrada — fotos tortas, tremidas ou com sombra fazem o reconhecimento errar mais (por isso o passo manual de marcar os 4 cantos é importante).
- O Tesseract.js baixa o pacote de idioma (poucos MB) na primeira leitura de código — o computador do painel admin precisa de internet nesse momento (o mesmo computador que já acessa o Supabase).
- Funciona com o layout de cédula gerado pela aba "Cédulas Manuais" deste sistema; cédulas impressas fora do padrão (ou com o layout de sessões alterado depois de impressas) podem não ser lidas corretamente.

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
