# Revisao Organizacional do Monorepo

Analise da organizacao do projeto com 4 componentes: backend (server/), dashboard web (client/), admin mapoteca (client_admin_mapoteca/) e plugin QGIS (ferramentas_acervo/).

---

## Resumo Executivo

A estrutura geral e funcional e segue boas praticas em varios aspectos — modulos do servidor sao consistentes, separacao de dominios e clara, e cada componente tem seu escopo bem definido. Porem, ha problemas significativos em tres areas: **duplicacao massiva entre os dois clientes React** (~900 linhas identicas), **inconsistencias de configuracao** (token expiry divergente, schema incompleto), e **ausencia de automacao unificada** (build parcial, sem dev unificado).

---

## 1. Duplicacao entre os Clientes React (Problema Principal)

### 1.1 Arquivos 100% Identicos

Estes arquivos sao copias exatas e deveriam ser compartilhados:

| Arquivo | Linhas | Localizacao |
|---|---|---|
| `lib/queryClient.ts` | 55 | Configuracao do React Query, `standardizeError()`, `createQueryKey()` |
| `types/api.ts` | 16 | `ApiResponse<T>`, `ApiError` |
| `components/ErrorBoundary.tsx` | 172 | Componente de tratamento de erros |

### 1.2 Arquivos 90-98% Identicos (diferem apenas em constantes)

| Arquivo | Similaridade | Diferenca |
|---|---|---|
| `contexts/ThemeContext.tsx` | 98% | Chave localStorage: `sca-theme-mode` vs `mapoteca-theme-mode` |
| `hooks/useAuth.ts` | 95% | Mapoteca exporta `getUUID` adicional |
| `stores/authStore.ts` | 90% | Chaves de storage e abstracao do token |
| `lib/axios.ts` | 85% | Client usa localStorage direto; mapoteca usa `tokenService` |
| `components/AuthLayout.tsx` | 95% | Mapoteca usa `useMemo` para path de imagem |
| `services/authService.ts` | 80% | **Token expiry: 1h vs 24h** (ver secao 2.1) |

### 1.3 Arquivos Estruturalmente Similares

| Arquivo | Similaridade | Observacao |
|---|---|---|
| `lib/theme.ts` | 30% | Estrutura similar mas client hardcoda cores; mapoteca usa constantes nomeadas (melhor) |
| `components/AppLayout.tsx` | 85% | Logica de drawer/sidebar similar |
| `vite.config.ts` | 65% | Plugins, proxy e rollupOptions iguais; diferem em aliases e porta |

### 1.4 Estimativa de Duplicacao

| Metrica | Valor |
|---|---|
| Linhas duplicadas (identicas ou quase) | ~900 |
| Arquivos com >80% duplicacao | 10 |
| Candidatos diretos para biblioteca compartilhada | 6 |

### 1.5 Divergencia de Versoes de Dependencias

As dependencias evoluiram independentemente, criando um fosso entre os clientes:

| Pacote | client/ | client_admin_mapoteca/ |
|---|---|---|
| React | 18.3 | **19.0** |
| MUI | 5.16 | **6.4** |
| React Router | 6.30 | **7.2** |
| Zustand | 4.5 | **5.0** |
| Vite | 5.4 | **6.2** |
| ESLint | 8.57 | **9.21** |
| TypeScript | 5.8 | 5.8 (igual) |

**Impacto:** Compartilhar codigo entre os clientes hoje requer cuidado com compatibilidade de versoes (React 18 vs 19, MUI 5 vs 6). A melhor estrategia e atualizar o `client/` antes de extrair codigo compartilhado.

---

## 2. Inconsistencias de Configuracao

### 2.1 Token Expiry Divergente (Bug)

O JWT do backend expira em **1 hora** (`server/src/login/login_ctrl.js:22`):
```javascript
expiresIn: '1h'
```

Cada cliente assume um tempo diferente:

| Componente | Assume | Arquivo | Linha |
|---|---|---|---|
| Backend (real) | **1 hora** | `server/src/login/login_ctrl.js` | 22 |
| Client dashboard | 1 hora (correto) | `client/src/services/authService.ts` | 24 |
| Client mapoteca | **24 horas (INCORRETO)** | `client_admin_mapoteca/src/services/tokenService.ts` | 109 |
| Client mapoteca (duplicado) | **24 horas (INCORRETO)** | `client_admin_mapoteca/src/services/authService.ts` | 28 |

**Consequencia:** O cliente mapoteca considera o token valido por 24h, mas o backend rejeita apos 1h. O usuario veria erros 401 inesperados em vez de ser redirecionado ao login.

### 2.2 Schema da Mapoteca Nao e Carregado na Instalacao

O script `create_config.js` (linhas 200-204) carrega os schemas nesta ordem:
```
versao.sql → dominio.sql → dgeo.sql → acervo.sql → acompanhamento.sql → permissao.sql
```

**`mapoteca.sql` nao esta incluido.** As tabelas da mapoteca (cliente, pedido, plotter, estoque_material, etc.) nao sao criadas na instalacao automatica. O administrador precisa executa-lo manualmente.

**Arquivo:** `create_config.js:199-206`

### 2.3 Portas de Desenvolvimento Inconsistentes

| Componente | Porta Padrao | Onde Definido |
|---|---|---|
| Server (config.env) | `PORT=3015` | `create_config.js` |
| Client proxy target | `3013` | `client/vite.config.ts` |
| Mapoteca proxy target | `3010` | `client_admin_mapoteca/vite.config.ts` |

Os proxies dos clientes apontam para portas (3013, 3010) que **nao correspondem** a porta padrao do servidor (3015). Isso funciona se o desenvolvedor configurar `.env` em cada cliente, mas o padrao "out of the box" nao funciona sem ajuste.

---

## 3. Automacao de Build e Dev Incompleta

### 3.1 Build Parcial

`create_build.js` so compila o `client/` e copia para `server/src/build/`. O `client_admin_mapoteca/` e ignorado.

**Sugestao:** Ou estender `create_build.js` para compilar ambos, ou documentar claramente o processo de deploy separado do mapoteca.

### 3.2 Dev Requer 3 Terminais

Nao existe script unificado para desenvolvimento. O desenvolvedor precisa abrir 3 terminais:
```bash
# Terminal 1
cd server && npm run dev
# Terminal 2
cd client && npm run dev
# Terminal 3
cd client_admin_mapoteca && npm run dev
```

O root `package.json` tem `concurrently` como dependencia mas so o usa para o server:
```json
"start-dev": "concurrently \"cd server && npm run dev\""
```

---

## 4. Servidor (Pontos Positivos e Menores Ajustes)

### 4.1 Consistencia dos Modulos (Bom)

Todos os modulos seguem o padrao de 4 arquivos (`index.js`, `*_ctrl.js`, `*_route.js`, `*_schema.js`). Isso facilita a manutencao e a navegacao.

### 4.2 Modulo Mapoteca Mistura Dominios

O diretorio `server/src/mapoteca/` contem controllers e rotas tanto para a mapoteca quanto para o dashboard da mapoteca:

```
mapoteca/
├── index.js
├── mapoteca_ctrl.js
├── mapoteca_route.js
├── mapoteca_schema.js
├── dashboard_ctrl.js      # ← dominio diferente
└── dashboard_route.js     # ← dominio diferente
```

O dashboard poderia ser um submodulo separado (`mapoteca/dashboard/`) seguindo o padrao do resto.

### 4.3 Dashboard do Acervo Nao Montado

O modulo `server/src/dashboard/` existe com 17 endpoints mas **nao esta registrado** em `routes.js`. Codigo morto ou funcionalidade incompleta.

---

## 5. Plugin QGIS

### 5.1 Estrutura Geral (Boa)

Separacao clara entre `core/` (infraestrutura) e `gui/` (dialogos). Cada funcionalidade tem seu proprio diretorio com dialog + UI file.

### 5.2 Muitos Subdiretorios sem Agrupamento

O diretorio `gui/` tem 28 subdiretorios no mesmo nivel. Uma organizacao por dominio melhoraria a navegacao:

```
gui/
├── produtos/              # adicionar_produto, bulk_produtos, informacao_produto, etc.
├── operacoes_em_massa/    # bulk_carrega_*, bulk_versoes_*
├── administracao/         # usuarios, volumes, volume_tipo_produto, projetos, lotes
├── download/              # download_produtos, situacao_geral
└── manutencao/            # materialized_views, verificar_inconsistencias, etc.
```

### 5.3 Arquivos `__init__.py`

Os subdiretorios sob `gui/` podem precisar de `__init__.py` para imports relativos funcionarem corretamente como pacotes Python. Verificar se os imports atuais dependem de manipulacao de `sys.path`.

---

## 6. Banco de Dados

### 6.1 Schema Bem Organizado (Bom)

Separacao clara por dominio (`acervo.sql`, `mapoteca.sql`, `dominio.sql`, `dgeo.sql`) com ordem de execucao documentada.

---

## 7. Recomendacoes Priorizadas

### Prioridade Alta (bugs e riscos)

| # | Acao | Impacto |
|---|---|---|
| 1 | **Corrigir token expiry da mapoteca** de 24h para 1h | Bug que causa erros 401 inesperados |
| 2 | **Adicionar `mapoteca.sql`** ao `create_config.js` | Instalacao incompleta |
| 3 | **Alinhar portas** de proxy dos clientes com porta padrao do servidor | Dev "out of the box" nao funciona |
| 4 | **Montar dashboard do acervo** em `routes.js` ou remover o modulo | Codigo morto |

### Prioridade Media (manutencao e DX)

| # | Acao | Beneficio |
|---|---|---|
| 5 | **Atualizar `client/`** para React 19 + MUI 6 | Alinhar com mapoteca; pre-requisito para compartilhar codigo |
| 6 | **Extrair biblioteca compartilhada** (`queryClient`, `types/api`, `ErrorBoundary`, `ThemeContext`, `useAuth`) | Eliminar ~900 linhas duplicadas |
| 7 | **Estender `create_build.js`** para compilar ambos os clientes | Build completo em um comando |
| 8 | **Adicionar script `dev` unificado** com `concurrently` | DX: um terminal em vez de tres |
| 9 | **Implementar sistema de migracoes** para o banco | Alteracoes de schema rastreaveis |

### Prioridade Baixa (organizacao)

| # | Acao | Beneficio |
|---|---|---|
| 10 | Separar dashboard da mapoteca em submodulo no servidor | Consistencia do padrao de modulos |
| 11 | Agrupar subdiretorios do `gui/` do plugin por dominio | Navegacao mais intuitiva |
| 12 | Expandir README.md com conteudo do CLAUDE.md | Onboarding de novos desenvolvedores |
| 13 | Criar `.env.example` na raiz com todas as variaveis | Documentacao de configuracao |
| 14 | Extrair `tokenService` do mapoteca para o client (padrao melhor) | Gerenciamento de token centralizado |

---

## 9. Sobre a Estrategia de Monorepo

A estrutura atual e um **monorepo informal** — todos os componentes no mesmo repositorio mas sem ferramentas de workspace. Para o tamanho atual do projeto (4 componentes, equipe pequena), isso e aceitavel. Porem, se a duplicacao crescer, considerar:

**Opcao A — npm workspaces (minima mudanca):**
```
packages/
  shared/          # queryClient, types, ErrorBoundary, useAuth, ThemeContext
    package.json
client/
  package.json     # depends on @sca/shared
client_admin_mapoteca/
  package.json     # depends on @sca/shared
server/
  package.json
```

**Opcao B — Manter separado mas alinhar versoes:**
Sem workspaces formais, mas com um checklist/script que garanta que dependencias compartilhadas estejam na mesma versao.

A **Opcao A** e recomendada se a equipe planeja manter ambos os clientes ativamente. A **Opcao B** e suficiente se o segundo cliente e raramente modificado.
