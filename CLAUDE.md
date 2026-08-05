# CLAUDE.md - Controle do Acervo (SCA)

Instruções de trabalho. Só o que muda o que você digita.

| Quer saber | Leia |
|---|---|
| estrutura, stack, comandos, rotas, banco, instalação | `README.md` |
| como subir o ambiente | `levantar_servico.md` |
| **por que** uma escolha estranha é assim, e o que custou a alternativa | `docs/decisoes.md` |
| o porquê de um trecho específico | o comentário do próprio arquivo |

## Regras que não se negociam

- **NUNCA crie commit sozinho.** Quem revisa e commita é o usuário. Não rode `git add`, `git commit`
  nem `git push` sem que ele peça naquela mensagem.
- **O repositório é PÚBLICO.** Nunca escreva em arquivo versionado: endereço de servidor, IP interno,
  porta acoplada a host, pasta de rede, caminho de máquina (letra de unidade, UNC) nem segredo com
  valor. Cite a **CHAVE** do `server/config.env`, que é gitignored. O catálogo comentado, sem valor
  nenhum, está em `.env.example`. O guard `scripts/check_vazamento.py` cobra no pre-commit
  (`.githooks/pre-commit`, fail-closed); numa máquina nova ele só liga com
  `git config core.hooksPath .githooks`.
- **Senha nunca em claro, e nunca de volta por rota.** O hash bcrypt mora em `dgeo.usuario.senha`, e
  o único lugar que gera e confere é `login/senha.js`.
- **Não escreva em `er/` para atualizar banco existente.** `er/` é instalação nova; atualização é
  `migrations/`, com ensaio por `migrations/ensaiar_migracao.cjs`.
- **Não invente campo** de domínio que não está no DDL nem no schema Joi. Marque como pendência.
- **Não introduza** ORM, TypeScript no servidor, framework de front, Docker ou biblioteca de UI sem
  registrar a decisão e o motivo em `docs/decisoes.md`.
- **Não recrie** a SPA React da mapoteca nem os clients por módulo (`acervo_client` e
  `mapoteca_client`), apagados de propósito. A interface é UMA.
- **Decisão de desenho não se "conserta" sozinho.** Se algo em `docs/decisoes.md` parece defeito,
  fale com o chefe antes.

## O sistema em um parágrafo

O **SCA** gerencia o acervo geoespacial do 1º CGEO: produtos versionados (cartas, ortoimagens,
modelos de elevação), seus arquivos, os volumes de armazenamento, a mapoteca física e o controle
orçamentário. São **três módulos de autorização no mesmo servidor e na mesma interface**: `acervo`,
`mapoteca` e `orcamento`. Ele é o **dono da identidade** (guarda o hash da senha e valida o login
sozinho) e absorve do [SAP](https://github.com/1cgeo/sap) o que não depende da produção: execução do
PIT, Extra-PIT, efetivo do mês e capacitação.

## Autorização

```
dgeo.usuario.administrador BOOLEAN      -- administrador de TUDO, acima de qualquer modulo
dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
dominio.tipo_perfil (code, nome)        -- 1 consulta, 2 operador, 3 gerente (hierarquicos)
dominio.modulo (code, nome, nome_abrev) -- 1 acervo, 2 mapoteca, 3 orcamento
```

- `verifyPerfil(minimo, modulo)` compara `perfil_id >= minimo` e **lê o banco a cada requisição**,
  não o token. É o que faz desativar usuário ou rebaixar perfil valer na hora.
- `administrador` é **global e único**, e curto-circuita qualquer módulo. Não existe administrador
  de módulo.
- Quem não tem linha para um módulo **não acessa aquele módulo**. Conceder é ato explícito, nunca
  efeito colateral de migração.
- `verifyAdmin` fica para rota de PLATAFORMA: usuários, PIT, RPCMTec, views materializadas, limpeza
  de download.

> **Armadilha que já custou caro:** o default do `verifyPerfil` é `'acervo'`. Rota do orçamento ou da
> mapoteca que esquecer o segundo argumento passa a cobrar perfil no ACERVO, sem erro visível. O
> teste `server/src/__tests__/routes/orcamento/modulo_em_toda_rota.test.js` lê o fonte e faz cumprir.

## Padrões que todo código novo segue

### Feature do servidor: 4 arquivos

```
feature/
├── index.js              # re-exporta a rota
├── feature_ctrl.js       # logica e SQL, sem req/res
├── feature_route.js      # rotas, middlewares, asyncHandler
└── feature_schema.js     # Joi
```

Montada em `routes.js`. As do orçamento vivem em `server/src/orcamento/` e entram sob
`/api/orcamento/`.

### Rota

```javascript
router.post(
  '/endpoint',
  verifyPerfil('operador', 'orcamento'),  // SEMPRE com o modulo explicito fora do acervo
  schemaValidation({ body: schema }),
  asyncHandler(async (req, res, next) => {
    const result = await ctrl.someMethod(req.body)
    return res.sendJsonAndLog(true, 'Message', httpCode.OK, result)
  })
)
```

Rota literal ANTES de rota com parâmetro: o Express casa na ordem de declaração, e `/perfil` cairia
em `/:uuid`.

### Escrita que muda dado

- Dentro de `db.conn.tx()`, com **`auditoriaCtrl.registrar(t, {...})` na MESMA transação**. Falhar ao
  auditar derruba a escrita, e é deliberado.
- A tabela precisa estar declarada em `server/src/auditoria/mapa/<modulo>.js`. Tabela auditada que
  não está lá é **erro em tempo de execução**, e uma varredura por módulo cobra a rota nova.
- Use `auditoriaCtrl.lerAntes(t, tabela, id, nome)` no lugar do `SELECT id` que só existia para o 404.

### Envelope, erros e constantes

- Toda resposta sai por `res.sendJsonAndLog()`: `{ version, success, message, dados, error }`. 500
  vira sempre a mensagem genérica.
- `AppError(message, statusCode, errorTrace)` mais `asyncHandler` mais o middleware final. Falha de
  boot cai em `errorHandler.critical()` e mata o processo.
- `server/src/utils/domain_constants.js` centraliza o código de toda tabela de domínio. Use as
  constantes, nunca número mágico em SQL.
- **Dia de calendário é `Joi.date().iso().raw()`**, nunca `Joi.date()`. Sem o `.raw()` a coluna
  guarda o dia anterior em UTC-3; sem o `.iso()`, '01/08/2026' vira 8 de janeiro.

### Página nova no client

O contrato está em `client/src/js/modules/registry.js`, e é ele que manda. Um manifesto por módulo
declara menu, rotas e o perfil mínimo de cada uma; o roteador não se toca. Rota de plataforma
(sem módulo) se registra em `client/src/js/index.js` e entra na sidebar por
`components/layout/sidebar.js`. Perfil de rota no client é **só ergonomia**: quem barra escrita é o
`verifyPerfil` no servidor.

### Teste

- `test:rapido` (segundos) é o do dia a dia; `test:banco` (minutos) antes de commitar. Quem entra em
  qual sai de LER O FONTE: `require` de `helpers/db` ou de `helpers/app`.
- Teste de schema prova o MOTIVO da recusa, nunca só que houve recusa. Use
  `recusaPor(resultado, campo, tipo)` de `__tests__/helpers/joi.js`.
- Cliente é vitest (`npm test` em `client/`), não jest.

## Convenções de código

- Servidor: CommonJS, `'use strict'`, SQL parametrizado com parâmetro nomeado do pg-promise
  (`$<param>`), `db.conn.task()` ou `db.conn.tx()`.
- Client: Vanilla JS com módulos ES, sem framework e sem TypeScript. `el()` de `utils/dom.js` para
  DOM, BEM no CSS, tokens em `design-tokens.css`, tema por `[data-theme]`.
- Plugin: Python 3 com PyQt6, uma pasta por diálogo em `gui/`, chamadas por `self.api_client`.
- CLI: dependência ZERO e contrato lido do **Joi vivo** em tempo de execução. Nunca copie contrato
  para dentro do CLI.
- **Toda string de interface e mensagem de erro em português do Brasil.** Coluna de banco em
  `snake_case` sem acento. Variável JS em `camelCase`, Python em `snake_case`.
- Sem em-dash em nada. Acentuação correta em português, nunca dentro de código, URL ou identificador.
- Data absoluta (2026-07-27), nunca "ontem".

## Regras de negócio que o código não deixa óbvio

### Mapoteca, consumo de material

- **Consumo só sai da Seção** (`tipo_localizacao` code=1). Material tem de ser transferido para lá
  antes, e o trigger recusa consumo sem saldo. Localizações: 1 Seção, 2 Almoxarifado, 3 Aquisição
  realizada, 4 Saldo no empenho.
- **`tipo_material.categoria_id` é COLUNA**, e é o que separa as tabelas 7.2 (Papel) e 7.3 (Tintas)
  do RPCMTec. Nunca derive do nome. O default é `3` (Outro).
- **O estoque guarda só o saldo de HOJE**, sem histórico mensal. Por isso "Estoque mês anterior" e
  "Previsão de falta" saem `-`, e NÃO se derivam de estoque atual mais consumo.
- **Escala de item de pedido nunca sai NULA**: o avulso é 'Sem escala', pelo `COALESCE` do fragmento
  `ESCALA_DISPLAY_ITEM`, e não em cada consulta.

### Orçamento

- **Não existe entidade "exercício", "PCA" nem cabeçalho de "PDR".** Tudo se amarra ao **ano**
  (coluna `ano SMALLINT`, sem FK).
- A **NE empenha contra uma NC obrigatória** e herda dela ND, PI e GND. A **licitação** não tem
  vínculo com DFD.
- A **NC** tem o par `(ano, numero, cod_nd)` único por UG emitente, e `valor_recolhido` é informativo.
- `orcamento.configuracao` é **singleton** (`CHECK (id = 1)`): o backend só faz `UPDATE`.

### PIT e RPCMTec

- **`pit.meta` é dado de PLATAFORMA**, consumido pelos três módulos. Ler exige só login; escrever
  exige administrador. A numeração NÃO é estável entre anos: guarde o `id`, nunca o código.
- **Só a meta-FOLHA recebe lançamento.** A meta subdividida tem cabeçalho (`item` nulo) e itens, e
  quem entrega é o item.
- **`pit.execucao` guarda o PLANEJADO e o REALIZADO do mês**, nos dois anuláveis: nulo é "ninguém
  lançou" e zero é "conferi e não houve". A cor da grade compara o ACUMULADO, nunca o mês sozinho,
  senão trabalho adiantado aparece como atraso. Ler é do gerente e do administrador
  (`verifyGerente`); escrever é do administrador.
- **Extra-PIT é a exceção AUTORIZADA**, e `documento_autorizacao` é obrigatório. Não derive de
  `previsto_pit`.
- O RPCMTec gera 18 subseções; 2.2, 2.3, 2.4 e 2.5 leem a produção e ficam no SAP.
- **O aproveitamento do efetivo é INTERVALO** (`dgeo.efetivo_periodo` e `dgeo.impedimento`), e mês,
  semana e ano são CONSULTA. `impedimento.descricao` é texto livre e vale o que TIRA a pessoa do
  trabalho da Divisão, não o que ela faz aqui. Passagem não sobrepõe (o banco cobra por `EXCLUDE`);
  impedimento sobrepõe, e os percentuais somam até 100.

## Armadilhas conhecidas

Uma linha cada. O caso inteiro está em `docs/decisoes.md`.

- **`npm audit fix --force` quebra o boot.** `archiver` fica na 7; os `overrides` do
  `server/package.json` são o que zera a auditoria.
- **Não devolva `NODE_OPTIONS=--experimental-vm-modules` aos scripts de teste.** Ela é a causa, não a
  cura; pacote ESM puro entra por `utils/serialize_error_loader.js` mais dublê no `moduleNameMapper`.
- **O que é mockado não se testa de novo contra o banco**, e o contrário também vale: SQL do
  orçamento só se prova em `integration/orcamento.test.js`.
- **Modal empilhado:** só o do topo responde a Escape e Tab. Use a pilha de `modal-base.js`.
- **`maplibre-gl` entra por `import()` dinâmico**, nunca no topo: ela pesa 1 MB contra 290 KB de todo
  o resto.
- **Filtro de busca é FACETADO:** cada lista aplica os outros filtros, nunca o próprio.
- **A lápide do arquivo excluído mora em `arquivo/arquivo_deletado.js`**, e o vínculo com o download
  casa por `uuid_arquivo`, nunca por ordem.
- **O upload web é UMA requisição**, e quem nomeia, mede o checksum e escolhe a extensão é o
  SERVIDOR. Mandar qualquer um dos quatro é 400.
- **O plugin da mapoteca é cliente do MÓDULO mapoteca**, e nenhuma rota dele é do acervo.
