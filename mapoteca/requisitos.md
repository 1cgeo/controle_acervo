# Requisitos — Mapoteca (subsistema do Controle do Acervo)

Subsistema de gerenciamento de pedidos da mapoteca do 1º CGEO, **integrado ao controle_acervo**. Reaproveita o backend Node.js/Express existente (módulo `server/src/mapoteca/`) e adiciona um **frontend web vanilla JS dedicado** em `mapoteca/client/`, separado do `client/` (que é o dashboard do acervo).

Substitui o controle hoje feito em planilhas:
- `mapoteca/docs/Controle de Pedidos Mapoteca.xlsx`
- `mapoteca/docs/Controle de Material de Impressão.xlsx`

## 1. Visão geral

**Usuários**: militares e servidores da Seção de Mapoteca (operadores) e chefia (gestores). Autenticação via mesmo AUTH_SERVER externo do controle_acervo (`aplicacao='sca_web'`, conforme `especificacao_client_mapoteca.md` — localStorage usa prefixo `@mapoteca-*` para isolar do client do acervo).

**Objetivos**:
1. Registrar pedidos de cartas/produtos impressos (DIEx, Ofício, LAI).
2. Acompanhar ciclo de vida: pré-cadastro → DIEx recebido → em andamento → remetido → concluído/cancelado.
3. Controlar estoque e consumo de material de impressão (cartuchos, papel, cabeçotes) e manutenção dos plotters.
4. Gerar dashboards gerenciais — entregas por mês/ano/OM/produto/escala/operação, OMs distintas, operações apoiadas, custo de manutenção.
5. Capturar em cada pedido todos os campos hoje mantidos nas abas `2026Mil`, `2026Detalhado` e `2026Civ` das planilhas, **sem importar histórico**.

**Decisões fechadas com o usuário**:

| Tópico | Decisão |
|---|---|
| Arquitetura | **Integrada ao controle_acervo** — mesmo backend, mesmo DB, frontend separado |
| Banco | **Mesmo DB** do controle_acervo (schema `mapoteca` já existe em `er/mapoteca.sql`) |
| Backend | Módulo `server/src/mapoteca/` já existente, a ser ampliado |
| Frontend | **Novo** em `mapoteca/client/` (vanilla JS + Vite + Chart.js, espelhando `client/`) |
| Autenticação | Mesmo AUTH_SERVER do controle_acervo; JWT 1h; `aplicacao='sca_web'` |
| Perfis | **admin** vs **usuário** (sem RBAC granular) |
| Importação histórica | **Não** — capturar campos da planilha para pedidos futuros |
| Exportação XLSX/PDF | **Não** na v1 — dashboard web apenas |
| Operação | **Texto livre** (autocomplete por valores já usados) |
| Alertas de estoque mínimo | **Apenas badge na UI** |

**Não-objetivos**:
- Editar o catálogo de produtos — fica no módulo `acervo` (já existe `/api/acervo/*`). Mapoteca **consome** esses endpoints para buscar/validar `uuid_versao`.
- Gerenciar usuários — fica no AUTH_SERVER e no módulo `usuario/`.
- Exportar para XLSX/PDF.
- Migrar dados históricos das planilhas.

## 2. Requisitos funcionais

Referência da maior parte dos endpoints/páginas: `controle_acervo/especificacao_client_mapoteca.md` (seções 2–13). Esta seção consolida ajustes e novidades.

### RF01 — Autenticação
- RF01.1 Tela de login `/login`: `POST /api/login` com `{ usuario, senha, cliente: 'sca_web' }`.
- RF01.2 Resposta `{ token, administrador, uuid, username }`; JWT expira em **1h**.
- RF01.3 localStorage (prefixo `@mapoteca-` p/ isolar do client acervo): `@mapoteca-Token`, `@mapoteca-Token-Expiry` (now+1h), `@mapoteca-User-Authorization` (`ADMIN`|`USER`), `@mapoteca-User-uuid`, `@mapoteca-User-username`.
- RF01.4 Interceptor HTTP anexa `Authorization: Bearer`. Em 401/403 → logout + redirect `/login?from=<rota>`.
- RF01.5 Dois loaders: `authLoader` (token válido) e `adminLoader` (role=ADMIN). Rotas de escrita exigem admin conforme seção 13 da spec.
- RF01.6 Logout remove chaves, limpa store, redireciona.

### RF02 — Clientes
Conforme spec seção 7. Sem mudanças no schema/endpoints já existentes.

### RF03 — Pedidos (ajustes no schema existente)
Campos **novos** para capturar informações hoje só nas planilhas:

| Campo | Tabela | Tipo | Descrição |
|---|---|---|---|
| `demandante` | `mapoteca.pedido` | VARCHAR(255) | Quem encaminhou (ex: "CMS" encaminhando pedido do "18º BI Mtz") |
| `omds` | `mapoteca.pedido` | VARCHAR(255) | OM Direta Subordinada responsável (ex: "1º CGEO") |
| `previsto_pit` | `mapoteca.pedido` | BOOLEAN default FALSE | Pedido no Plano Interno de Trabalho (distingue PIT vs Extra-PIT) |
| `quantidade_fornecida` | `mapoteca.produto_pedido` | INTEGER nullable | Quantidade efetivamente entregue (pode divergir da prevista) |
| `tipo_midia_fornecida_id` | `mapoteca.produto_pedido` | SMALLINT FK | Mídia efetivamente usada quando difere da prevista |
| `forma_entrega_id` | `mapoteca.produto_pedido` | SMALLINT FK | Correios / Entrega em mãos / Retirado no CGEO / Outros |

Regras mantidas: geração do `localizador_pedido` em 14 chars no backend; CHECK `data_atendimento ≥ data_pedido`.

**Novas constraints** (a adicionar):
- RN-CANC: `situacao_pedido_id = 6` ⇒ `motivo_cancelamento IS NOT NULL` (CHECK + Joi)
- RN-CONC: `situacao_pedido_id = 5` ⇒ `data_atendimento IS NOT NULL` (CHECK + Joi)

### RF04 — Plotters e manutenção
Sem mudanças — endpoints já existentes cobrem.

### RF05 — Materiais, estoque e consumo
Ajustes em `mapoteca.tipo_material`:

| Campo | Tipo | Descrição |
|---|---|---|
| `estoque_minimo` | DECIMAL(10,2) nullable | Limiar p/ badge "abaixo do mínimo" (RF06-badge). NULL = sem alerta. |
| `meta_anual` | DECIMAL(10,2) nullable | Consumo anual previsto (usado em relatório Consumo × Necessário × Pendente). |
| `ativo` | BOOLEAN default TRUE | Permite desativar um tipo sem quebrar histórico. |

Seed inicial de `tipo_material` com ~21 itens extraídos da planilha (cartuchos T730 CY/MG/Y/MK/MK-300/GR/GR-300/PK; HP M470 Black/Ciano/Magenta/Yellow; cabeçotes Universal/MK-Y/CY-MG/G-PK; papéis Sulfite 90g/120g, Glossy, Banner, Tubo).

Triggers de consumo em `consumo_material` **permanecem inalterados** (já enforçam que consumo sai da Seção).

Badge de estoque mínimo: UI consulta `estoque_material` + `tipo_material.estoque_minimo` e exibe selo vermelho quando soma do material < mínimo.

### RF06 — Dashboard
Reaproveita os 8 endpoints existentes (spec seção 13.10). **Adicionar** endpoints para responder às perguntas explícitas do usuário:

| Endpoint novo | Retorno |
|---|---|
| `GET /api/mapoteca/dashboard/entregas_por_tipo_produto?ano=` | `[{ tipo_produto, escala, total_pedidos, total_produtos }]` — JOIN com `acervo.versao` / `dominio.tipo_produto` / `dominio.tipo_escala` |
| `GET /api/mapoteca/dashboard/entregas_por_midia?ano=` | `[{ tipo_midia, total_produtos }]` |
| `GET /api/mapoteca/dashboard/operacoes_apoiadas?ano=` | `[{ operacao, total_pedidos, total_produtos }]` (distinct `pedido.operacao`) |
| `GET /api/mapoteca/dashboard/resumo_anual?ano=` | `{ total_pedidos, total_entregas, oms_distintas_count, operacoes_distintas_count, custo_manutencao_total }` |

Auto-refetch dos cards/gráficos a cada 60s (padrão do client acervo atual).

### RF07 — Integração com catálogo (acervo)
Mapoteca e Acervo compartilham o mesmo DB → FK direto via `produto_pedido.uuid_versao → acervo.versao.uuid_versao` (já existente). **Sem proxy HTTP necessário**.

Enriquecimento do payload de `GET /pedido/:id`:
- JOIN em `acervo.versao`, `acervo.produto`, `dominio.tipo_produto`, `dominio.tipo_escala` já é feito no backend atual (retorna `produto_nome`, `mi`, `inom`, `escala`).
- A busca de produto no wizard de pedido: frontend chama `GET /api/produtos/busca?q=...` (endpoint já existente em `server/src/produto/`). Confirmar que retorna `uuid_versao` — caso não, acrescentar ao schema de resposta.

### RF08 — Busca pública por localizador
Endpoint `GET /api/mapoteca/pedido/localizador/:localizador` (sem autenticação) já existe. A nova UI vai expor uma página pública `/consultar/:localizador` (fora de `authLoader`) para que solicitantes acompanhem o pedido pelo localizador.

### RF09 — Auditoria
Mantida como está: `usuario_criacao_id` / `usuario_atualizacao_id` INTEGER → `dgeo.usuario.id`. (Novas tabelas, se surgirem, devem usar UUID conforme convenção do acervo — mas nenhuma está prevista.)

## 3. Requisitos não-funcionais

Todos os RNFs do controle_acervo se aplicam por herança (segurança, logging, Swagger, lint). Específicos da mapoteca-web:

- **RNF01 — UI em pt-BR** com acentos; mensagens claras; datas `DD/MM/YYYY`.
- **RNF02 — Layout responsivo** — desktop alvo; tablet aceitável.
- **RNF03 — Tema claro/escuro** via `data-theme`, persistido em `localStorage['mapoteca-theme-mode']`.
- **RNF04 — Feedback** via toast (nunca `alert()`); confirmação modal antes de exclusões.
- **RNF05 — Acessibilidade básica** — foco visível, `role="dialog"` em modais, labels associados a inputs.
- **RNF06 — Performance** — listagens com filtro server-side quando couber; busca client-side para tabelas pequenas; auto-refetch só no dashboard.
- **RNF07 — Build** — Vite 6; lint zero warnings antes de entrega; code splitting por rota.
- **RNF08 — Proxy dev** — Vite proxy `/api → http://localhost:3015` (mesmo do client acervo).

## 4. Regras de negócio críticas (resumo)

- **RN01** Consumo sempre sai da Seção (triggers já garantem).
- **RN02** Pedido concluído (situacao=5) exige `data_atendimento ≥ data_pedido`.
- **RN03** Pedido cancelado (situacao=6) exige `motivo_cancelamento`. *(novo)*
- **RN04** `localizador_pedido` único, 14 chars, gerado no backend, imutável.
- **RN05** `uuid_versao` em `produto_pedido` referencia `acervo.versao` (mesmo DB, FK real).
- **RN06** LAI (tipo_cliente=9): atalho "Novo pedido LAI" no frontend — pré-preenche tipo + situação inicial = 3.
- **RN07** `producao_especifica=true` → impressão sob demanda (não sai de estoque pronto).

## 5. Dados de referência

Existentes em `mapoteca.sql`: `tipo_cliente` (9), `situacao_pedido` (6), `tipo_midia` (7), `tipo_localizacao` (4).

**Adicionar**:
- `mapoteca.forma_entrega`: (1) Correios, (2) Entrega em mãos, (3) Retirado no CGEO, (4) Outros.
- Seed de `mapoteca.tipo_material` com ~21 itens (ver `PLANO_IMPLEMENTACAO.md`, Parte A).

## 6. Roadmap sugerido

Ver detalhes em `PLANO_IMPLEMENTACAO.md`.

- **Fase 1** — ER: ALTERs + novo seed; atualizar `domain_constants.js`.
- **Fase 2** — Backend: Joi schemas + controllers com novos campos; novos endpoints de dashboard; novo domínio `forma_entrega`.
- **Fase 3** — Frontend (maior esforço): esqueleto, auth, layout, 7 áreas CRUD, wizard de pedido, dashboard completo.
- **Fase 4** — Polimento, lint, docs atualizadas, Swagger.
