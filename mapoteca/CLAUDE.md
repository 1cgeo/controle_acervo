# Mapoteca — guia de subprojeto

Este diretório agrupa tudo que é **específico do subsistema Mapoteca**: documentação de requisitos, planilhas de referência, plano de implementação e (a criar) o **frontend web** dedicado.

Este CLAUDE.md é complementar ao `../CLAUDE.md` raiz do controle_acervo. Leia aquele primeiro — convenções de servidor, banco e plugin QGIS estão lá.

## Conteúdo da pasta

```
mapoteca/
├── docs/                             # Planilhas atuais (fonte de verdade dos relatórios)
│   ├── Controle de Material de Impressão.xlsx
│   └── Controle de Pedidos Mapoteca.xlsx
├── CLAUDE.md                         # (este arquivo)
├── requisitos.md                     # Requisitos funcionais e não-funcionais da mapoteca
├── PLANO_IMPLEMENTACAO.md            # Plano em 3 partes: ER, backend, frontend
└── client/                           # (A CRIAR) Frontend vanilla JS + Vite
```

## Escopo do subsistema

A mapoteca é **parte do controle_acervo**, não um projeto separado:

- **Backend** → módulo `server/src/mapoteca/` (já existente, será ampliado).
- **Banco** → schema `mapoteca` no mesmo DB do controle_acervo (`er/mapoteca.sql`).
- **Frontend** → novo SPA vanilla JS em `mapoteca/client/` (a criar; **não confundir** com `client/` raiz, que é o dashboard do acervo).

A mapoteca **não duplica** o catálogo de produtos — usa diretamente `acervo.versao` por FK (mesmo DB). Para validação e busca, chama os endpoints já existentes em `/api/produtos/*` e `/api/acervo/*`.

## Frontend (a criar em `mapoteca/client/`)

**Stack** (igual ao `client/` raiz, que é a referência prática mais próxima):
- Vanilla JavaScript (ES modules, sem framework)
- Vite 6
- Chart.js 4 para gráficos do dashboard
- Roteamento hash-based (`#/login`, `#/dashboard`, etc.)
- CSS modular com design tokens + BEM + temas claro/escuro
- Estado em `localStorage` (prefixo `@mapoteca-*` para isolar do `@sca-*` do client acervo)

**Por que vanilla JS e não framework?** Consistência com a arquitetura atual do controle_acervo, ausência de toolchain pesado, fácil de manter pela equipe. O `client_admin_mapoteca` em React+MUI foi explicitamente **removido** — não recriar.

### Aliases Vite (seguir o padrão do `client/` raiz)

`@js/`, `@css/`, `@utils/`, `@components/`, `@pages/`, `@services/`, `@store/`, `@features/`.

### localStorage (prefixo obrigatório `@mapoteca-`)

| Chave | Valor |
|---|---|
| `@mapoteca-Token` | JWT |
| `@mapoteca-Token-Expiry` | ISO string (now + 1h) |
| `@mapoteca-User-Authorization` | `ADMIN` ou `USER` |
| `@mapoteca-User-uuid` | UUID do usuário |
| `@mapoteca-User-username` | login |
| `mapoteca-theme-mode` | `light` ou `dark` |

### Proxy dev

Vite `dev` em porta distinta do `client/` raiz (sugerido **3001**; raiz usa 3000). Proxy `/api → http://localhost:3015` (porta do server do controle_acervo).

## Convenções específicas

Todas as convenções de `../CLAUDE.md` se aplicam; as abaixo são adições ou ênfases:

### Idioma
- UI em **pt-BR com acentos corretos**.
- Comentários e JSDoc em **inglês** (padrão do projeto).
- Propriedades de domínio em **pt-BR** (`cliente`, `pedido`, `situacao_pedido`), snake_case em colunas SQL, camelCase em JS.

### Mutations sempre via admin
Conforme `../especificacao_client_mapoteca.md` seção 13: GET → `verifyLogin`, POST/PUT/DELETE → `verifyAdmin`. O frontend deve desabilitar/ocultar ações de escrita para usuários não-admin.

### Erros de consumo
Os triggers em `consumo_material` lançam exceções com mensagens específicas ("Estoque insuficiente na Seção: disponível X, solicitado Y"). O frontend deve **exibir essas mensagens verbatim** no toast — já são pt-BR e orientam o usuário a transferir material antes de consumir.

### localizador_pedido
Formato `XXXX-XXXX-XXXX` (alfanumérico sem caracteres ambíguos). Gerado no backend (já implementado em `utils/generate_localizador.js`). **Imutável**. Página pública `/consultar/:localizador` não exige auth.

### Badge de estoque mínimo
`tipo_material.estoque_minimo` (a adicionar) controla a exibição do badge. Null = sem alerta. A UI calcula `soma(estoque_material.quantidade) < estoque_minimo` e exibe badge vermelho no cabeçalho do item.

### Componentes reutilizáveis a criar
Inspirados no `client/` raiz:
- `components/layout/` — navbar, sidebar (com seção "Materiais" colapsável).
- `components/data-table/` — tabela com busca client-side, ordenação, paginação, seleção múltipla, exportar CSV, ações por linha.
- `components/charts/` — wrappers Chart.js (bar, pie, line) com `.update()` e `._cleanup()`.
- `components/modal-base/` — dialog base acessível (ESC fecha, focus trap).
- `components/wizard-stepper/` — stepper horizontal (para wizard de pedido).
- `utils/toast.js` — `showToast(msg, type)` em vez de `alert()`.

### Lint
Zero warnings obrigatório antes de abrir PR. Reaproveitar `eslint.config.js` do `client/` raiz (copiar e ajustar).

### Testes
Nenhum teste automatizado no `client/` raiz hoje. Para a mapoteca vale o mesmo — testes manuais via browser no dev. Priorizar cobertura via Jest **no backend** quando endpoints novos forem criados.

### Git
**Nunca commitar** sem pedido explícito do usuário. Ele revisa e commita manualmente. Vale para qualquer mudança (ER, backend, frontend).

## Comandos esperados (após criar `client/`)

A partir da raiz de `controle_acervo/`, adicionar scripts ao `package.json` raiz:

```bash
npm run install-mapoteca         # cd mapoteca/client && npm install
npm run dev-mapoteca             # cd mapoteca/client && npm run dev (porta 3001)
npm run build-mapoteca           # cd mapoteca/client && npm run build
```

Dentro de `mapoteca/client/`:
```bash
npm run dev                      # Vite dev server (porta 3001, proxy /api → :3015)
npm run build                    # Build de produção
npm run preview                  # Preview do build
npm run lint                     # ESLint (--max-warnings 0)
```

## Para o próximo Claude / desenvolvedor

Antes de mexer em qualquer coisa:

1. Leia `../CLAUDE.md` (raiz) — convenções gerais, schemas, padrões.
2. Leia `../especificacao_client_mapoteca.md` — rotas, endpoints, wireframes completos do frontend.
3. Leia `requisitos.md` (nesta pasta) — ajustes acordados com o usuário sobre a spec.
4. Leia `PLANO_IMPLEMENTACAO.md` — roadmap concreto em 3 partes (ER, backend, frontend).
5. Antes de alterar `er/mapoteca.sql`, confirme com o usuário se o ambiente é fresh-install (substituir) ou se precisa de ALTER TABLE preservando dados.
