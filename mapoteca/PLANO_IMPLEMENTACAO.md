# Plano de Implementação — Mapoteca

Plano em 3 partes para (A) alterar o ER, (B) ampliar o backend e (C) implementar o frontend vanilla JS em `mapoteca/client/`. As partes podem ser executadas em ordem (ER → Backend → Frontend), que é a recomendada, já que alterações de schema destravam o backend e as rotas existentes/novas destravam a UI.

Documentos de referência:
- `../CLAUDE.md` — convenções do controle_acervo
- `../especificacao_client_mapoteca.md` — rotas, payloads, wireframes
- `./requisitos.md` — ajustes acordados com o usuário
- `./CLAUDE.md` — convenções específicas deste subprojeto
- `./docs/*.xlsx` — planilhas com dados reais que o sistema deve capturar

---

## Parte A — Modificações no ER (`er/mapoteca.sql`)

### A.1 — Nova tabela de domínio `mapoteca.forma_entrega`

```sql
CREATE TABLE mapoteca.forma_entrega (
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.forma_entrega (code, nome) VALUES
    (1, 'Correios'),
    (2, 'Entrega em mãos'),
    (3, 'Retirado no CGEO'),
    (4, 'Outros');
```

### A.2 — Novos campos em `mapoteca.pedido`

Para capturar informações hoje só nas planilhas (2026Mil, 2026Detalhado):

```sql
ALTER TABLE mapoteca.pedido
    ADD COLUMN demandante VARCHAR(255),
    ADD COLUMN omds VARCHAR(255),
    ADD COLUMN previsto_pit BOOLEAN NOT NULL DEFAULT FALSE;
```

**Novas CHECK constraints** (regras RN-CANC e RN-CONC):

```sql
ALTER TABLE mapoteca.pedido
    ADD CONSTRAINT check_pedido_cancelamento
        CHECK (situacao_pedido_id <> 6 OR motivo_cancelamento IS NOT NULL),
    ADD CONSTRAINT check_pedido_conclusao
        CHECK (situacao_pedido_id <> 5 OR data_atendimento IS NOT NULL);
```

**Novos índices** para filtros frequentes:

```sql
CREATE INDEX idx_pedido_data_pedido ON mapoteca.pedido(data_pedido);
CREATE INDEX idx_pedido_data_atendimento ON mapoteca.pedido(data_atendimento);
CREATE INDEX idx_pedido_operacao ON mapoteca.pedido(operacao) WHERE operacao IS NOT NULL;
CREATE INDEX idx_pedido_palavras_chave ON mapoteca.pedido USING GIN (palavras_chave);
```

### A.3 — Novos campos em `mapoteca.produto_pedido`

Para reconciliação previsto × fornecido (coluna "Qnt Fornecida" / "Material Fornecido" / "Forma da Entrega" da planilha 2026Detalhado):

```sql
ALTER TABLE mapoteca.produto_pedido
    ADD COLUMN quantidade_fornecida INTEGER
        CHECK (quantidade_fornecida IS NULL OR quantidade_fornecida >= 0),
    ADD COLUMN tipo_midia_fornecida_id SMALLINT REFERENCES mapoteca.tipo_midia (code),
    ADD COLUMN forma_entrega_id SMALLINT REFERENCES mapoteca.forma_entrega (code);

CREATE INDEX idx_produto_pedido_uuid_versao ON mapoteca.produto_pedido(uuid_versao);
```

### A.4 — Novos campos em `mapoteca.tipo_material`

Para badge de estoque mínimo (RF05.5) e comparativo Consumo × Necessário da planilha de material:

```sql
ALTER TABLE mapoteca.tipo_material
    ADD COLUMN estoque_minimo DECIMAL(10, 2),
    ADD COLUMN meta_anual DECIMAL(10, 2),
    ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN mapoteca.tipo_material.estoque_minimo IS
    'Limiar para alertar estoque baixo na UI (badge). NULL = sem alerta.';
COMMENT ON COLUMN mapoteca.tipo_material.meta_anual IS
    'Consumo anual previsto. Usado em relatório Consumo × Necessário × Pendente.';
```

### A.5 — Seed de `tipo_material`

Baseado em `mapoteca/docs/Controle de Material de Impressão.xlsx`:

```sql
-- Cartuchos Plotter T730
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
    ('Cartucho CY - T730',         'Cartucho Ciano para plotter HP T730 (P2V62A)'),
    ('Cartucho MG - T730',         'Cartucho Magenta para plotter HP T730 (P2V63A)'),
    ('Cartucho Y - T730',          'Cartucho Yellow para plotter HP T730 (P2V64A)'),
    ('Cartucho MK - T730',         'Cartucho Matte Black 130ml para plotter HP T730 (P2V65A)'),
    ('Cartucho MK - T730 300ml',   'Cartucho Matte Black 300ml para plotter HP T730'),
    ('Cartucho GR - T730',         'Cartucho Gray para plotter HP T730 (P2V66A)'),
    ('Cartucho GR - T730 300ml',   'Cartucho Gray 300ml para plotter HP T730'),
    ('Cartucho PK - T730',         'Cartucho Photo Black para plotter HP T730 (P2V67A)');

-- Cartuchos HP M470
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
    ('Cartucho Black - HP M470',   'Cartucho Black para impressora HP M470 (W2020XC)'),
    ('Cartucho Ciano - HP M470',   'Cartucho Ciano para impressora HP M470 (W2021XC)'),
    ('Cartucho Magenta - HP M470', 'Cartucho Magenta para impressora HP M470 (W2023XC)'),
    ('Cartucho Yellow - HP M470',  'Cartucho Yellow para impressora HP M470 (W2022XC)');

-- Cabeçotes
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
    ('Cabeçote Universal',   'Cabeçote Universal novo (P2V27A, ficha C2982)'),
    ('Cabeçote MK/Y usado',  'Cabeçote MK/Y reutilizado'),
    ('Cabeçote CY/MG usado', 'Cabeçote CY/MG reutilizado'),
    ('Cabeçote G/PK usado',  'Cabeçote G/PK reutilizado');

-- Papéis
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
    ('Papel Sulfite 90g',   'Papel sulfite 90g/m² para plotter'),
    ('Papel Sulfite 120g',  'Papel sulfite 120g/m² para plotter'),
    ('Papel Glossy',        'Papel glossy para plotter'),
    ('Banner (tecido)',     'Banner em tecido'),
    ('Tyvek',     'Banner em tecido');
```

### A.6 — Estratégia de aplicação

Duas opções a confirmar com o usuário:

- **Opção 1 (fresh install, recomendado para dev)**: reescrever `er/mapoteca.sql` incorporando tudo acima. `CREATE TABLE mapoteca.pedido (...)` passa a ter `demandante`, `omds`, `previsto_pit`; `tipo_material` ganha os 3 campos direto no CREATE; seeds vão na sequência. Mantém a execução `versao → dominio → dgeo → acervo → acompanhamento → mapoteca → permissao`.
- **Opção 2 (ambiente com dados)**: criar um novo arquivo `er/mapoteca_v2.sql` **apenas com os ALTER/INSERT acima** e documentá-lo em `CLAUDE.md` raiz como passo de atualização. Fresh install executa `mapoteca.sql` + `mapoteca_v2.sql`.

Como o controle_acervo hoje não tem sistema de migrations e o CLAUDE.md documenta uma lista sequencial fixa, a **Opção 1** é mais limpa. O usuário decide.

### A.7 — Checklist de aceitação do ER

- [ ] `mapoteca.forma_entrega` criada com 4 valores.
- [ ] `mapoteca.pedido` tem `demandante`, `omds`, `previsto_pit`, mais os 2 CHECKs.
- [ ] `mapoteca.produto_pedido` tem `quantidade_fornecida`, `tipo_midia_fornecida_id`, `forma_entrega_id`.
- [ ] `mapoteca.tipo_material` tem `estoque_minimo`, `meta_anual`, `ativo`.
- [ ] Índices novos criados.
- [ ] Seed de `tipo_material` populado (~21 itens).
- [ ] Triggers de `consumo_material` permanecem intocados.
- [ ] `dominio_constants.js` (ver Parte B) atualizado.

---

## Parte B — Modificações no Backend (`server/src/mapoteca/`)

A maioria dos endpoints já existe e funciona. As mudanças abaixo são **aditivas**.

### B.1 — `utils/domain_constants.js`

Adicionar as novas tabelas de domínio e reforçar as existentes caso estejam ausentes:

```javascript
// server/src/utils/domain_constants.js
module.exports = {
  // ... constantes existentes (STATUS_ARQUIVO, TIPO_ARQUIVO, SITUACAO_PEDIDO, etc.)

  FORMA_ENTREGA: {
    CORREIOS: 1,
    ENTREGA_EM_MAOS: 2,
    RETIRADO_NO_CGEO: 3,
    OUTROS: 4
  },

  TIPO_LOCALIZACAO: {
    SECAO: 1,
    ALMOXARIFADO: 2,
    AQUISICAO_REALIZADA: 3,
    SALDO_NO_EMPENHO: 4
  }
}
```

### B.2 — `mapoteca_schema.js` — Joi schemas

**Pedido** (criar e atualizar):
- Adicionar `demandante: Joi.string().max(255).allow(null, '')`
- Adicionar `omds: Joi.string().max(255).allow(null, '')`
- Adicionar `previsto_pit: Joi.boolean().default(false)`
- Joi condicional: `motivo_cancelamento: Joi.when('situacao_pedido_id', { is: 6, then: Joi.string().required(), otherwise: Joi.string().allow(null, '') })`
- Joi condicional: `data_atendimento: Joi.when('situacao_pedido_id', { is: 5, then: Joi.date().required(), otherwise: Joi.date().allow(null) })`

**ProdutoPedido** (criar e atualizar):
- Adicionar `quantidade_fornecida: Joi.number().integer().min(0).allow(null)`
- Adicionar `tipo_midia_fornecida_id: Joi.number().integer().allow(null)`
- Adicionar `forma_entrega_id: Joi.number().integer().allow(null)`

**TipoMaterial** (criar e atualizar):
- Adicionar `estoque_minimo: Joi.number().min(0).allow(null)`
- Adicionar `meta_anual: Joi.number().min(0).allow(null)`
- Adicionar `ativo: Joi.boolean().default(true)`

**Dashboard** (query params dos novos endpoints):
- `anoQuery: Joi.object({ ano: Joi.number().integer().min(2000).max(2100).default(() => new Date().getFullYear()) })`

### B.3 — `mapoteca_ctrl.js` — controladores

**Ajustes nas queries existentes** (INSERT/UPDATE/SELECT):

- `criaPedido` / `atualizaPedido`: incluir `demandante, omds, previsto_pit` nas colunas.
- `getPedidos` / `getPedidoById`: retornar os campos novos no SELECT.
- `criaProdutoPedido` / `atualizaProdutoPedido`: incluir `quantidade_fornecida, tipo_midia_fornecida_id, forma_entrega_id`.
- `getPedidoById` / `getProdutosPorPedido`: JOIN com `mapoteca.forma_entrega` e `mapoteca.tipo_midia` (alias `tipo_midia_fornecida`) para retornar `forma_entrega_nome` e `tipo_midia_fornecida_nome`.
- `criaTipoMaterial` / `atualizaTipoMaterial`: incluir `estoque_minimo, meta_anual, ativo`.
- `getTiposMaterial`: retornar os 3 campos novos + calcular `abaixo_minimo BOOLEAN` (`estoque_minimo IS NOT NULL AND estoque_total < estoque_minimo`) para a badge.

**Novos métodos de domínio**:

```javascript
controller.getFormaEntrega = async () => {
  return db.conn.any('SELECT code, nome FROM mapoteca.forma_entrega ORDER BY code')
}
```

### B.4 — `mapoteca_route.js` — novas rotas

**Domínio novo** (público, sem auth, mesmo padrão das outras rotas de domínio):

```javascript
router.get('/dominio/forma_entrega', asyncHandler(async (req, res) => {
  const dados = await mapotecaCtrl.getFormaEntrega()
  return res.sendJsonAndLog(true, 'Formas de entrega retornadas', httpCode.OK, dados)
}))
```

Acrescentar Swagger JSDoc no mesmo padrão dos outros domínios.

**Endpoint de transferência de material** (decisão: Abordagem B — endpoint dedicado com transação, sem tabela de histórico):

```javascript
// mapoteca_route.js
router.post(
  '/estoque_material/transferir',
  verifyAdmin,
  schemaValidation({ body: mapotecaSchema.transferenciaEstoque }),
  asyncHandler(async (req, res) => {
    await mapotecaCtrl.transferirMaterial(req.body, req.usuarioId)
    return res.sendJsonAndLog(true, 'Transferência realizada com sucesso', httpCode.OK)
  })
)
```

Joi schema em `mapoteca_schema.js`:

```javascript
models.transferenciaEstoque = Joi.object().keys({
  tipo_material_id: Joi.number().integer().required(),
  origem_id: Joi.number().integer().valid(1, 2, 3, 4).required(),
  destino_id: Joi.number().integer().valid(1, 2, 3, 4).required(),
  quantidade: Joi.number().min(0).greater(0).required()
}).custom((value, helpers) =>
  value.origem_id === value.destino_id
    ? helpers.error('any.invalid', { message: 'Origem e destino não podem ser iguais' })
    : value
)
```

Controller em `mapoteca_ctrl.js` (transação com lock `FOR UPDATE` e upsert no destino):

```javascript
controller.transferirMaterial = async (data, usuarioId) => {
  const { tipo_material_id, origem_id, destino_id, quantidade } = data

  return db.conn.tx(async t => {
    const origem = await t.oneOrNone(
      `SELECT id, quantidade
       FROM mapoteca.estoque_material
       WHERE tipo_material_id = $<tipo_material_id>
         AND localizacao_id = $<origem_id>
       FOR UPDATE`,
      { tipo_material_id, origem_id }
    )

    if (!origem) {
      throw new AppError(
        'Não há estoque na localização de origem para este material',
        httpCode.BadRequest
      )
    }

    if (parseFloat(origem.quantidade) < quantidade) {
      throw new AppError(
        `Quantidade insuficiente na origem. Disponível: ${origem.quantidade}, solicitado: ${quantidade}`,
        httpCode.BadRequest
      )
    }

    await t.none(
      `UPDATE mapoteca.estoque_material
       SET quantidade = quantidade - $<quantidade>,
           data_atualizacao = NOW(),
           usuario_atualizacao_id = $<usuarioId>
       WHERE id = $<id>`,
      { id: origem.id, quantidade, usuarioId }
    )

    await t.none(
      `INSERT INTO mapoteca.estoque_material
         (tipo_material_id, localizacao_id, quantidade, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($<tipo_material_id>, $<destino_id>, $<quantidade>, $<usuarioId>, $<usuarioId>)
       ON CONFLICT (tipo_material_id, localizacao_id)
       DO UPDATE SET quantidade = mapoteca.estoque_material.quantidade + EXCLUDED.quantidade,
                     data_atualizacao = NOW(),
                     usuario_atualizacao_id = EXCLUDED.usuario_atualizacao_id`,
      { tipo_material_id, destino_id, quantidade, usuarioId }
    )
  })
}
```

**Notas**:
- `FOR UPDATE` na SELECT da origem serializa transferências simultâneas do mesmo material.
- `ON CONFLICT ... DO UPDATE` faz upsert no destino — funciona porque já existe UNIQUE `(tipo_material_id, localizacao_id)`.
- Não há tabela de histórico na v1. Para adicionar no futuro, basta criar `mapoteca.transferencia_material` e gravar nessa transação. É uma mudança aditiva — não quebra nada existente.

**Testes Jest a adicionar** (`server/src/__tests__/routes/mapoteca.test.js`):
- transferência feliz: origem decrementa e destino (inexistente) é criado com a quantidade.
- transferência para localização que já existe: destino incrementa.
- origem sem estoque → 400 com mensagem de insuficiência.
- origem inexistente → 400 com mensagem clara.
- `origem_id === destino_id` → 400 (Joi).
- `quantidade <= 0` → 400 (Joi).
- não-admin → 403.

### B.5 — `dashboard_ctrl.js` + `dashboard_route.js` — novos endpoints

**B.5.1** `GET /api/mapoteca/dashboard/entregas_por_tipo_produto?ano=`

Entregas = `produto_pedido` em pedidos com situação 4 (Remetido) ou 5 (Concluído), no ano.

```sql
SELECT
  tp.nome AS tipo_produto,
  te.nome AS escala,
  COUNT(DISTINCT ped.id) AS total_pedidos,
  SUM(COALESCE(pp.quantidade_fornecida, pp.quantidade)) AS total_produtos
FROM mapoteca.produto_pedido pp
JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
JOIN acervo.produto prod ON prod.id = v.produto_id
JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
WHERE ped.situacao_pedido_id IN (4, 5)
  AND EXTRACT(YEAR FROM ped.data_atendimento) = $<ano>
GROUP BY tp.nome, te.nome
ORDER BY tp.nome, te.nome;
```

**B.5.2** `GET /api/mapoteca/dashboard/entregas_por_midia?ano=`

```sql
SELECT
  tm.nome AS tipo_midia,
  SUM(COALESCE(pp.quantidade_fornecida, pp.quantidade)) AS total_produtos
FROM mapoteca.produto_pedido pp
JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
LEFT JOIN mapoteca.tipo_midia tm ON tm.code = COALESCE(pp.tipo_midia_fornecida_id, pp.tipo_midia_id)
WHERE ped.situacao_pedido_id IN (4, 5)
  AND EXTRACT(YEAR FROM ped.data_atendimento) = $<ano>
GROUP BY tm.nome
ORDER BY total_produtos DESC;
```

**B.5.3** `GET /api/mapoteca/dashboard/operacoes_apoiadas?ano=`

```sql
SELECT
  ped.operacao,
  COUNT(DISTINCT ped.id) AS total_pedidos,
  COALESCE(SUM(pp_sum.total_produtos), 0) AS total_produtos
FROM mapoteca.pedido ped
LEFT JOIN (
  SELECT pedido_id, SUM(COALESCE(quantidade_fornecida, quantidade)) AS total_produtos
  FROM mapoteca.produto_pedido
  GROUP BY pedido_id
) pp_sum ON pp_sum.pedido_id = ped.id
WHERE ped.operacao IS NOT NULL AND ped.operacao <> ''
  AND EXTRACT(YEAR FROM ped.data_pedido) = $<ano>
GROUP BY ped.operacao
ORDER BY total_pedidos DESC;
```

**B.5.4** `GET /api/mapoteca/dashboard/resumo_anual?ano=`

```javascript
controller.getResumoAnual = async (ano) => {
  return db.conn.task(async t => {
    const totalPedidos = await t.one(
      `SELECT COUNT(*) AS n FROM mapoteca.pedido
       WHERE EXTRACT(YEAR FROM data_pedido) = $<ano>`, { ano })

    const totalEntregas = await t.one(
      `SELECT COALESCE(SUM(COALESCE(pp.quantidade_fornecida, pp.quantidade)), 0) AS n
       FROM mapoteca.produto_pedido pp
       JOIN mapoteca.pedido ped ON ped.id = pp.pedido_id
       WHERE ped.situacao_pedido_id IN (4, 5)
         AND EXTRACT(YEAR FROM ped.data_atendimento) = $<ano>`, { ano })

    const omsDistintas = await t.one(
      `SELECT COUNT(DISTINCT cliente_id) AS n
       FROM mapoteca.pedido
       WHERE EXTRACT(YEAR FROM data_pedido) = $<ano>`, { ano })

    const operacoesDistintas = await t.one(
      `SELECT COUNT(DISTINCT operacao) AS n
       FROM mapoteca.pedido
       WHERE operacao IS NOT NULL AND operacao <> ''
         AND EXTRACT(YEAR FROM data_pedido) = $<ano>`, { ano })

    const custoManutencao = await t.one(
      `SELECT COALESCE(SUM(valor), 0) AS total
       FROM mapoteca.manutencao_plotter
       WHERE EXTRACT(YEAR FROM data_manutencao) = $<ano>`, { ano })

    return {
      ano,
      total_pedidos: parseInt(totalPedidos.n, 10),
      total_entregas: parseInt(totalEntregas.n, 10),
      oms_distintas_count: parseInt(omsDistintas.n, 10),
      operacoes_distintas_count: parseInt(operacoesDistintas.n, 10),
      custo_manutencao_total: parseFloat(custoManutencao.total)
    }
  })
}
```

Registrar todos em `dashboard_route.js` com `verifyLogin` + `schemaValidation({ query: anoQuery })`.

### B.6 — `api_documentation.md`

Documentar:
- Novo domínio `GET /api/mapoteca/dominio/forma_entrega`.
- Novos campos em `pedido`, `produto_pedido`, `tipo_material`.
- 4 novos endpoints de dashboard.
- Novos CHECKs (cancelamento e conclusão).

### B.7 — Testes (Jest)

Arquivos em `server/src/__tests__/routes/mapoteca.test.js` e `mapoteca_dashboard.test.js`:

- [ ] `POST /pedido` com `situacao_pedido_id=6` sem `motivo_cancelamento` → 400.
- [ ] `POST /pedido` com `situacao_pedido_id=5` sem `data_atendimento` → 400.
- [ ] `POST /pedido` com `demandante, omds, previsto_pit` → 201 e valores persistidos.
- [ ] `POST /produto_pedido` com `quantidade_fornecida, tipo_midia_fornecida_id, forma_entrega_id` → 201 e retorno enriquecido.
- [ ] `GET /pedido/:id` retorna produtos com `forma_entrega_nome`.
- [ ] `GET /dashboard/resumo_anual?ano=2026` retorna os 5 números.
- [ ] `GET /dashboard/entregas_por_tipo_produto` não quebra quando `acervo.versao` não encontra algum UUID (degradação graceful).
- [ ] Trigger de consumo: insert com estoque insuficiente → erro 400 com mensagem específica.

### B.8 — Checklist de aceitação do Backend

- [ ] `domain_constants.js` com `FORMA_ENTREGA` e `TIPO_LOCALIZACAO`.
- [ ] Joi schemas atualizados (pedido, produto_pedido, tipo_material, dashboard query).
- [ ] Controllers refletindo novos campos nos SELECT/INSERT/UPDATE.
- [ ] `getFormaEntrega()` + rota `GET /dominio/forma_entrega`.
- [ ] 4 novos endpoints de dashboard implementados e testados.
- [ ] Swagger JSDoc atualizado (incluindo novos campos e rotas).
- [ ] `api_documentation.md` atualizado.
- [ ] `npm test` verde.
- [ ] Lint sem warnings.

---

## Parte C — Frontend web (`mapoteca/client/`)

Implementação do zero, vanilla JS + Vite + Chart.js, espelhando o padrão do `client/` raiz. Desacoplado do client do acervo via:
- Pasta separada `mapoteca/client/`
- Porta dev distinta (sugerido 3001)
- Prefixo de localStorage `@mapoteca-`

Todas as rotas, payloads e layouts seguem `../especificacao_client_mapoteca.md` com os ajustes de `requisitos.md`.

### C.1 — Estrutura de diretórios

```
mapoteca/client/
├── index.html                        # Entry SPA
├── vite.config.js                    # Aliases + proxy /api → :3015 + port 3001
├── package.json                      # vite, chart.js, eslint
├── eslint.config.js                  # Copiar do client/ raiz
├── public/
│   └── backgrounds/                  # Ilustração do login (copiar/adaptar do client raiz)
└── src/
    ├── css/
    │   ├── style.css                 # Entry — imports dos demais
    │   ├── design-tokens.css         # Variáveis (tema claro/escuro)
    │   ├── base.css                  # Reset + tipografia
    │   ├── login.css
    │   ├── layout.css                # Navbar + sidebar
    │   ├── dashboard.css
    │   ├── tables.css
    │   ├── charts.css
    │   ├── modal.css
    │   ├── wizard.css
    │   ├── forms.css
    │   └── error-pages.css
    └── js/
        ├── index.js                  # Bootstrap (theme, router, layout, fetch user)
        ├── router.js                 # Hash router + authLoader + adminLoader
        ├── config.js                 # API_BASE_URL, constantes
        ├── services/
        │   ├── api-client.js         # fetch wrapper + auth interceptor
        │   ├── cache.js              # TTL Map (stale 60s p/ dashboard, 5min p/ listas, 30min p/ domínios)
        │   ├── mapoteca-service.js   # chamadas dos endpoints /api/mapoteca/*
        │   ├── dashboard-service.js  # chamadas de /api/mapoteca/dashboard/*
        │   └── produto-service.js    # busca no catálogo (/api/produtos/busca)
        ├── store/
        │   ├── auth-store.js         # localStorage @mapoteca-*
        │   └── event-bus.js          # pub/sub simples
        ├── utils/
        │   ├── dom.js                # el(), $()
        │   ├── format.js             # formatDate, formatCurrency, formatNumber
        │   ├── theme.js              # aplicar/salvar tema
        │   ├── toast.js              # showToast(msg, type, duration)
        │   ├── escape.js             # escapeHtml
        │   └── localizador.js        # validar formato XXXX-XXXX-XXXX
        ├── components/
        │   ├── layout/
        │   │   ├── navbar.js
        │   │   ├── sidebar.js
        │   │   └── main-layout.js
        │   ├── charts/               # wrappers Chart.js com .update() e ._cleanup()
        │   │   ├── bar-chart.js
        │   │   ├── pie-chart.js
        │   │   └── line-chart.js
        │   ├── data-table/           # busca client-side, sort, paginação, seleção, export CSV
        │   ├── modal/
        │   │   ├── modal-base.js
        │   │   ├── confirm-dialog.js
        │   │   └── prompt-dialog.js
        │   ├── wizard-stepper/       # stepper horizontal para wizard de pedido
        │   ├── form-fields/          # input, select, date-picker, textarea, chip-input
        │   └── status-chip/          # chips coloridos por situacao_pedido_id
        └── pages/
            ├── login.js
            ├── unauthorized.js
            ├── not-found.js
            ├── consultar-pedido.js  # rota pública /consultar/:localizador
            ├── dashboard/
            │   ├── index.js          # page controller
            │   ├── summary-cards.js  # 4 cards do topo
            │   ├── chart-status.js   # pizza — distribuição por status
            │   ├── chart-estoque.js  # barras — estoque por localização
            │   ├── chart-timeline.js # linha — pedidos por semana
            │   ├── tabela-pendentes.js
            │   └── resumo-anual.js   # RF06.10: novos cards
            ├── clientes/
            │   ├── list.js
            │   ├── details.js
            │   └── dialog-cliente.js
            ├── pedidos/
            │   ├── list.js
            │   ├── wizard.js         # 4 etapas: básico → adicional → produtos → confirmação
            │   ├── details.js
            │   ├── dialog-edit.js
            │   └── dialog-produto.js
            ├── materiais/
            │   ├── list.js
            │   ├── details.js
            │   └── dialog-material.js
            ├── estoque/
            │   ├── list.js
            │   ├── dialog-estoque.js
            │   └── dialog-transferir.js
            ├── consumo/
            │   ├── list.js
            │   └── dialog-consumo.js
            └── plotters/
                ├── list.js
                ├── details.js
                ├── dialog-plotter.js
                └── dialog-manutencao.js
```

### C.2 — vite.config.js (esqueleto)

```javascript
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:3015',
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      '@':           resolve(__dirname, 'src'),
      '@js':         resolve(__dirname, 'src/js'),
      '@css':        resolve(__dirname, 'src/css'),
      '@utils':      resolve(__dirname, 'src/js/utils'),
      '@services':   resolve(__dirname, 'src/js/services'),
      '@store':      resolve(__dirname, 'src/js/store'),
      '@components': resolve(__dirname, 'src/js/components'),
      '@pages':      resolve(__dirname, 'src/js/pages')
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'chart-vendor': ['chart.js']
        }
      }
    }
  }
})
```

### C.3 — Rotas (hash-based)

```
#/login                       Public
#/                            Redirect → #/dashboard (authLoader)
#/dashboard                   authLoader + adminLoader
#/clientes                    authLoader + adminLoader
#/clientes/:id                authLoader + adminLoader
#/pedidos                     authLoader + adminLoader
#/pedidos/novo                authLoader + adminLoader
#/pedidos/:id                 authLoader + adminLoader
#/materiais                   authLoader + adminLoader
#/materiais/:id               authLoader + adminLoader
#/estoque                     authLoader + adminLoader
#/consumo                     authLoader + adminLoader
#/plotters                    authLoader + adminLoader
#/plotters/:id                authLoader + adminLoader
#/consultar/:localizador      Public (RF08 — acompanhamento pelo solicitante)
#/unauthorized                Public (403)
#/404                         Public
*                             Redirect → #/404
```

### C.4 — Fases de implementação

Estimativas em dias-desenvolvedor (DX) full-time. Cada fase termina com lint zero warnings + teste manual no browser.

| Fase | Entregáveis | DX |
|---|---|---|
| **C.F1 Setup & infra** | `package.json`, `vite.config.js`, `index.html`, `style.css` + tokens, `eslint.config.js`, scripts no `package.json` raiz (`install-mapoteca`, `dev-mapoteca`, `build-mapoteca`). Loja básica (`auth-store`, `event-bus`) e utilities (`dom`, `format`, `escape`, `toast`). | 2 |
| **C.F2 Auth & layout** | Login (`pages/login.js`) com integração `POST /api/login` → localStorage. Router com `authLoader` + `adminLoader`. Interceptor 401/403 em `api-client.js`. Navbar + sidebar colapsável (seção Materiais colapsável). Toggle tema claro/escuro. Páginas `/unauthorized` e `/404`. | 3 |
| **C.F3 Clientes** | List + busca + paginação + export CSV. Details com estatísticas e pedidos recentes. Dialog criar/editar usando `GET /dominio/tipo_cliente`. DELETE com confirmação. | 3 |
| **C.F4 Pedidos — listagem + detalhes** | List com chips coloridos por situação. Details com 4 cards (datas, cliente, documento, entrega) + tabela de produtos. Edição via dialog. Exclusão com confirmação. Integração com `consultar-pedido.js` (pública). | 4 |
| **C.F5 Pedidos — wizard 4 etapas** | Stepper horizontal reutilizável. Etapa 1 (básico): form + selects de `tipo_cliente`/`situacao_pedido`. Etapa 2: chips para `palavras_chave` + text fields. Etapa 3: adicionar produtos — busca no catálogo acervo (`produto-service.js → GET /api/produtos/busca`), seleciona `uuid_versao`, informa `quantidade`, `tipo_midia_id`, `producao_especifica`, e os novos campos (`quantidade_fornecida`, `tipo_midia_fornecida_id`, `forma_entrega_id`). Etapa 4: confirmação com resumo. `POST /pedido` → `POST /produto_pedido` (loop). | 5 |
| **C.F6 Materiais + Estoque + Consumo** | `tipo_material` CRUD com badge "abaixo do mínimo". Estoque por localização (cards no topo + tabela). Transferir material entre localizações (dialog que chama 2 updates em cascata — ou endpoint dedicado se criado). Consumo com filtros (data_inicio, data_fim, tipo_material_id). Tratar erros dos triggers com toast pt-BR verbatim. | 5 |
| **C.F7 Plotters** | List + Details com stats. Dialog criar/editar plotter. Adicionar manutenção inline no detalhe do plotter. | 2 |
| **C.F8 Dashboard** | 4 summary cards (`/order_status`). Pizza de status. Barra de estoque por localização. Linha de timeline. Tabela de pendentes com badge "Atrasado". Novos: resumo anual (RF06.10: total pedidos, entregas, OMs, operações, custo manutenção), entregas por tipo de produto × escala (stacked bar), entregas por mídia (bar), operações apoiadas (horizontal bar). Auto-refetch 60s. | 5 |
| **C.F9 Polimento** | Responsividade (tablet), acessibilidade (focus trap em modal, ESC fecha), mensagens pt-BR revisadas, docs em `mapoteca/client/README.md`. | 2 |
| **Total estimado** | | **31 DX** |

### C.5 — Integração com componentes existentes no `client/` raiz

Aproveitar, copiando e adaptando (não importando — são projetos separados):
- `css/design-tokens.css` + `css/base.css` (renomeando tokens se preciso)
- `js/utils/dom.js` (`el()`, `$()`)
- `js/services/api-client.js` — adaptar prefixo para `@mapoteca-` + expiração 1h
- `js/services/cache.js`
- `js/components/charts/bar-chart.js` e `pie-chart.js`
- `js/components/tabs.js` (para abas de detalhe se usado)
- `eslint.config.js`

O que é **exclusivo da mapoteca** (não existe no client acervo):
- `wizard-stepper/`
- `data-table/` com seleção múltipla + exportar CSV (o acervo tem tabelas mais simples)
- `components/form-fields/chip-input.js` (para `palavras_chave`)
- Múltiplos dialogs de edição (clientes, pedidos, materiais, estoque, consumo, plotters)
- `pages/consultar-pedido.js` (rota pública)

### C.6 — Scripts no `package.json` raiz

Adicionar ao `controle_acervo/package.json`:

```json
{
  "scripts": {
    "install-mapoteca": "cd mapoteca/client && npm install",
    "dev-mapoteca": "cd mapoteca/client && npm run dev",
    "build-mapoteca": "cd mapoteca/client && npm run build",
    "install-all": "npm install && cd server && npm install && cd ../client && npm install && cd ../mapoteca/client && npm install"
  }
}
```

(Ajustar `install-all` para incluir a mapoteca. Outros scripts de setup/deploy continuam como estão.)

### C.7 — Checklist de aceitação do Frontend

- [ ] `mapoteca/client/` criado com estrutura completa.
- [ ] `npm run dev-mapoteca` sobe em porta 3001 e faz proxy para :3015.
- [ ] Login funciona e redireciona para dashboard.
- [ ] 13 rotas hash funcionando + 401/403 → redirect com `?from=`.
- [ ] Todas as views CRUD funcionam com os endpoints existentes do backend.
- [ ] Wizard de pedido cria pedido + produtos em sequência.
- [ ] Busca de produto no wizard chama o catálogo do acervo.
- [ ] Dashboard carrega os 4 cards + gráficos + tabela, com auto-refetch 60s.
- [ ] Novos endpoints de dashboard (RF06.10) integrados.
- [ ] Badge "abaixo do mínimo" visível em `tipo_material` quando aplicável.
- [ ] Tema claro/escuro persiste entre recargas.
- [ ] Rota pública `/consultar/:localizador` funciona sem login.
- [ ] `npm run lint` zero warnings.
- [ ] Teste manual cobre: criar pedido, editar, cancelar (com motivo), concluir (com data), consumir material (trigger rejeita com mensagem amigável quando sem estoque).

---

## Ordem de execução recomendada

1. **A.1 → A.7**: aplicar mudanças no ER em ambiente dev; validar constraints criadas.
2. **B.1 → B.8**: atualizar backend; garantir Jest verde e Swagger atualizado.
3. **C.F1 → C.F9**: frontend em ordem sequencial; cada fase verificada manualmente no browser.

A cada marco (fim de cada parte), **rodar** `npm test` (server) + `npm run lint` (client) + teste manual das rotas afetadas. **Não commitar** — usuário revisa.

## Itens para o usuário decidir antes de começar

1. **Estratégia do ER** — opção 1 (reescrever `er/mapoteca.sql`) ou opção 2 (novo `er/mapoteca_v2.sql` apenas com ALTER/INSERT)?
2. **Seeds iniciais de `tipo_material`** — aceitar a lista proposta na Parte A.5 ou customizar nomes/descrições?

### Contexto: resolvidos
- **Porta do dev da mapoteca client**: **3001**.
- **Pasta `sistema_mapoteca/`**: conteúdo removido (diretório-casca remanescente, sem impacto).
- **Endpoint de transferência de material**: **Abordagem B** — endpoint dedicado `POST /api/mapoteca/estoque_material/transferir` com transação e lock `FOR UPDATE`, sem tabela de histórico na v1. Especificação completa em **B.4**.
