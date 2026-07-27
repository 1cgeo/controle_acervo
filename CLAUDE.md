# CLAUDE.md - Controle do Acervo (SCA)

Este arquivo guarda só o que muda uma DECISÃO de quem escreve código aqui. A referência completa
(estrutura do repositório, stack, comandos, tabela de rotas, banco, instalação) vive no `README.md`.

## Git Rules

- **NEVER create commits automatically.** The user will always review changes and commit manually. Do not run `git add`, `git commit`, or `git push` unless the user explicitly asks for it in that specific message.
- **NEVER commit changes** unless the user explicitly asks in that specific message. Always let the user review first.

## O que o sistema é, em um parágrafo

O **SCA** gerencia o acervo geoespacial do 1º CGEO: produtos versionados (cartas, ortoimagens, modelos
de elevação), seus arquivos, os volumes de armazenamento, a mapoteca física e, desde 2026-07-27, o
controle orçamentário. São **três módulos de autorização no mesmo servidor e na mesma interface**:
`acervo`, `mapoteca` e `orcamento`. Depende do [Auth Server](https://github.com/1cgeo/auth_server)
externo, que valida senha e é a fonte dos usuários.

## Decisões de design deliberadas

Parecem defeito e não são. Não "conserte" nenhuma sem falar com o chefe.

- **`/api/integracao/*` não tem autenticação.** São GET públicos e somente leitura, criados para o vault do chefe da DGEO consumir o SCA sem credencial, coerente com a postura de intranet. Expõem só cobertura do acervo, produtos concluídos no mês (por `acervo.versao.data_edicao`, não pela data de cadastro) e o agregado da mapoteca que o RPCMTec exige (sem endereço, contato ou observação de impressão). Ver `server/src/integracao/`.
- **`GET /api/mapoteca/pedido/localizador/:localizador` não tem autenticação.** É o acompanhamento do pedido pelo próprio cliente, que não tem conta. Já foi fechada por engano uma vez, numa classificação automática de rotas.
- **`/logs` não tem autenticação** e **o CORS aceita qualquer origem.** O sistema roda em rede interna.
- **Credencial de banco na URI de camada do QGIS.** O plugin conecta direto no PostgreSQL para carregar camada. Aceitável em rede interna.
- **A mapoteca usa `usuario_id` (INTEGER) e o acervo usa `usuario_uuid` (UUID).** `dgeo.usuario` tem os dois. Tabela nova segue a convenção do acervo (UUID), que é a do orçamento também.
- **O módulo orçamento tem o próprio `schema_validation`.** Em `server/src/orcamento/utils/`. O do SCA descarta chave desconhecida e responde 200; o do orçamento recusa com 400 e sugere a chave parecida. São contratos diferentes de propósito: unificar afrouxaria em silêncio as 67 rotas do orçamento. `orcamento/utils/index.js` reexporta o `utils/` do SCA com essa única substituição.
- **O schema `orcamento` não tem PostGIS nem geometria.** Orçamento não tem dado espacial.
- **A troca de módulo mora na SIDEBAR, não num dropdown na navbar.** Cada módulo é uma seção colapsável, e o cabeçalho dela leva para a home do módulo. O dropdown existiu por algumas horas em 2026-07-27 e foi recusado pelo chefe. Junto veio a regra que o desenho anterior violava: a sidebar é montada uma vez e **nunca se desmonta**, senão entrar numa rota de plataforma (`#/usuarios`) apaga o menu do módulo.
- **O administrador global não é coluna da tabela de usuários.** Ele é propriedade da pessoa, então aparece como marca ao lado do nome. Repetir "Administrador" numa coluna por módulo sugere que existe administrador de módulo, que é justamente o que o modelo não tem.

## Modelo de autorização

Desde 2026-07-25, com o módulo `orcamento` acrescentado em 2026-07-27.

```
dgeo.usuario.administrador BOOLEAN     -- administrador de TUDO, acima de qualquer modulo
dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
dominio.tipo_perfil (code, nome)       -- 1 consulta, 2 operador, 3 gerente (hierarquicos)
dominio.modulo (code, nome, nome_abrev) -- 1 acervo, 2 mapoteca, 3 orcamento
```

- `verifyPerfil(minimo, modulo)` compara `perfil_id >= minimo` e **lê o banco a cada requisição**, não o token. É o que faz desativar usuário ou rebaixar perfil valer na hora.
- `administrador` é **global e único**, curto-circuita qualquer módulo. Não existe administrador por módulo.
- Quem não tem linha para um módulo **não acessa aquele módulo**. Conceder é ato explícito, nunca efeito colateral de migração.
- `dominio.modulo` é tabela, e não CHECK, para que absorver outro sistema seja um `INSERT`.
- `verifyAdmin` fica para rota de plataforma (usuários, views materializadas, limpeza de download).

**Armadilha que já custou caro:** o default do `verifyPerfil` é `'acervo'`. Rota do orçamento ou da
mapoteca que esquecer o segundo argumento passa a cobrar perfil no ACERVO, sem erro visível. O teste
`server/src/__tests__/routes/orcamento/modulo_em_toda_rota.test.js` lê o fonte e faz cumprir.

## Regras de negócio

### Mapoteca, consumo de material
- **Consumo** só pode sair da **Seção** (`tipo_localizacao` code=1). Material tem que ser transferido para a Seção antes de ser consumido, e o trigger recusa consumo sem saldo lá.
- Localizações: 1=Seção, 2=Almoxarifado, 3=Aquisição realizada, 4=Saldo no empenho.

### Orçamento
- **Não existe entidade "exercício", "PCA" nem cabeçalho de "PDR".** Tudo se amarra ao **ano** (coluna `ano SMALLINT`, sem FK). O PCA do ano é o conjunto de DFDs daquele ano; o PDR é o conjunto dos `pdr_item` do ano.
- A **NE empenha contra uma NC obrigatória** e herda dela ND, PI e GND. A **licitação** não tem vínculo com DFD.
- A **NC** tem o par `(ano, numero, cod_nd)` único por UG emitente, e `valor_recolhido` é informativo (não altera `valor_nc`).
- `orcamento.configuracao` é **singleton** (`CHECK (id = 1)`): o backend só faz `UPDATE`, a linha nasce no DDL.

## Padrões que todo código novo segue

### Feature do servidor: 4 arquivos
```
feature/
├── index.js              # re-exporta a rota
├── feature_ctrl.js       # logica e SQL, sem req/res
├── feature_route.js      # rotas, middlewares, asyncHandler
└── feature_schema.js     # Joi
```
Montada em `routes.js`. As do orçamento vivem em `server/src/orcamento/` e entram sob `/api/orcamento/`.

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

### Envelope de resposta
Toda resposta sai por `res.sendJsonAndLog()`: `{ version, success, message, dados, error }`. 500 vira
sempre a mensagem genérica.

### Erros
`AppError(message, statusCode, errorTrace)` mais `asyncHandler` (catch para o `next`) mais o middleware
final. Falha de boot cai em `errorHandler.critical()` e mata o processo.

### Constantes de domínio
`server/src/utils/domain_constants.js` centraliza o valor de código de toda tabela de domínio. Use as
constantes, nunca número mágico em SQL.

### Página nova no client
O contrato está em `client/src/js/modules/registry.js`, e é ele que manda. Um manifesto por módulo
declara menu, rotas e o perfil mínimo de cada uma; o roteador não se toca. Perfil de rota no client é
**só ergonomia**: quem barra escrita é o `verifyPerfil` no servidor.

## Convenções de código

- Servidor: CommonJS, `'use strict'`, SQL parametrizado com parâmetro nomeado do pg-promise (`$<param>`), `db.conn.task()` ou `db.conn.tx()`.
- Client: Vanilla JS com módulos ES, sem framework e sem TypeScript. `el()` de `utils/dom.js` para DOM, BEM no CSS, tokens de design em `design-tokens.css`, tema por `[data-theme]`.
- Plugin: Python 3 com PyQt6, uma pasta por diálogo em `gui/`, chamadas por `self.api_client`.
- CLI: dependência ZERO e contrato lido do **Joi vivo** em tempo de execução. Nunca copie contrato para dentro do CLI.
- **Toda string de interface e mensagem de erro em português do Brasil.** Coluna de banco em `snake_case` sem acento. Variável JS em `camelCase`, Python em `snake_case`.
- Sem em-dash em nada. Acentuação correta em português, nunca dentro de código, URL ou identificador.
- Data absoluta (2026-07-27), nunca "ontem".

## O que não fazer

- Não introduza ORM, TypeScript no servidor, framework de front, Docker ou biblioteca de UI sem registrar a decisão e o motivo.
- Não recrie a SPA React da mapoteca, que foi removida de propósito.
- Não recrie clients separados por módulo: `acervo_client` e `mapoteca_client` foram apagados em 2026-07-27, e a interface é uma só.
- Não armazene senha de usuário: a verificação é sempre delegada ao Auth Server.
- Não invente campo de domínio que não está no DDL nem no schema Joi. Marque como pendência.
- Não escreva em `er/` para atualizar banco existente: `er/` é instalação nova, o caminho de atualização é `migrations/`.

## Onde está o resto

- `README.md`: estrutura do repositório, stack, comandos, configuração, tabela de rotas, banco e instalação.
- `levantar_servico.md`: subir o ambiente (auth, servidor, interface), portas, fumaça e troubleshooting.
- `docs/`: tutoriais de uso, fluxos do plugin e `api_documentation.md`.
- `migrations/`: caminho de atualização do banco, em ordem de data.
- Swagger em `GET /api/api_docs` com o servidor no ar.
