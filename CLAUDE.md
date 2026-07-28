# CLAUDE.md - Controle do Acervo (SCA)

Este arquivo guarda só o que muda uma DECISÃO de quem escreve código aqui. A referência completa
(estrutura do repositório, stack, comandos, tabela de rotas, banco, instalação) vive no `README.md`.

## Git Rules

- **NEVER create commits automatically.** The user will always review changes and commit manually. Do not run `git add`, `git commit`, or `git push` unless the user explicitly asks for it in that specific message.
- **NEVER commit changes** unless the user explicitly asks in that specific message. Always let the user review first.

## Este repositório é PÚBLICO

Nunca escreva em arquivo versionado: endereço de servidor, IP interno, porta acoplada a host,
pasta de rede, caminho de máquina (letra de unidade, UNC) nem segredo com valor. Cite a **CHAVE**
do `server/config.env`, que é gitignored e nunca foi commitado. O catálogo comentado, sem valor
nenhum, está em `.env.example`.

O guard `scripts/check_vazamento.py` faz a regra cumprir no pre-commit (`.githooks/pre-commit`,
fail-closed). Numa máquina nova ele só liga com `git config core.hooksPath .githooks`. Ele checa
só o que vaza, nunca estilo: guard que bloqueia todo commit ensina `--no-verify`.

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
- **`maplibre-gl` é a única dependência de mapa, e entra por `import()` dinâmico.** Decisão do chefe
  em 2026-07-25 (portal do acervo). Ela pesa cerca de 1 MB minificada, contra 290 KB de todo o resto
  da interface: num `import` de topo, quem abre a tela de pedidos baixaria o mapa junto. Por isso
  `components/mapa/base.js` a carrega sob demanda (`carregarMapLibre()`), e ela vira um pedaço
  próprio no build. Esse arquivo é onde moram o estilo de fundo, as fontes e o enquadramento
  inicial, e é dele que saem os dois mapas que existem: a busca do acervo
  (`modules/acervo/pages/busca/mapa.js`, com desenho de área e seleção) e as entregas da mapoteca
  (`modules/mapoteca/pages/dashboard/mapa-entregas.js`, coroplético por quantidade). O CSS dela
  continua estático, que são poucos KB e evita o mapa nascer sem controles. O fundo é OSM (rede
  interna, mas com internet): sem internet os polígonos continuam aparecendo, porque vêm da nossa
  API; o que falta é só a imagem de fundo. Em teste, `@components/mapa/maplibre-stub.js` faz o papel
  da biblioteca, porque o jsdom não tem WebGL.
- **Os filtros do mapa da mapoteca são do SERVIDOR, e a escala entra pelo rótulo.** O cliente não
  existe na feição (ela traz a CONTAGEM de OMs atendidas, não a lista), então filtrar tipo e escala
  na tela e o cliente no servidor faria as três contas seguirem regras diferentes, e o número do
  resumo pararia de fechar com o mapa. A escala vai como `'1:50.000'`, e não como código de domínio,
  porque a escala personalizada tem um código só para todos os denominadores: por código,
  1:30.000 e 1:75.000 virariam uma opção chamada "personalizada".
- **No mapa da mapoteca o rótulo sai de uma fonte de PONTOS, e o preenchimento é ordenado por
  área.** Rotulando o polígono, a mesma carta aparecia duas vezes (chefe, 2026-07-28): o MapLibre
  corta o GeoJSON em ladrilhos e ancora o texto por pedaço, então a folha que cruza a borda de um
  ladrilho ganha um rótulo de cada lado, e a deduplicação entre ladrilhos não pega porque as duas
  âncoras ficam longe. O ponto vem do servidor por `ST_PointOnSurface` (e não `ST_Centroid`, que cai
  fora de uma folha em L). A ordenação existe porque o mapeamento é **aninhado por escala**: a folha
  1:25.000 fica dentro da 1:100.000, que fica dentro da 1:250.000. Sem `fill-sort-key` pela área
  negativa, a folha grande cai por cima da pequena e a engole, inclusive para o clique. O tom de
  azul mais escuro nessas áreas é a soma dos preenchimentos translúcidos empilhados, e não um erro
  de classificação: para ler a quantidade sem empilhamento, filtre por uma escala.
- **Polígono empilhado no mapa da mapoteca é PRODUTO diferente, nunca versão.** A pergunta voltou em
  2026-07-28 ("talvez esteja mostrando versões"), então fica a medição, contra produção: em 2026 são
  325 feições para 325 `produto.id` distintos, e a consulta agrega por `prod.id`; a versão só
  aparece no caminho `produto_pedido -> versao -> produto`, e nunca no resultado. O empilhamento tem
  duas origens legítimas. A primeira é o aninhamento por escala: a 2952-1-SO (1:25.000) está
  100% contida na 2952 (1:100.000) e na 535 (1:250.000), e as três saíram no ano. A segunda são
  Carta Topográfica e Carta Ortoimagem da MESMA folha, que no SCA são produtos distintos com
  contorno idêntico (8 pares em 2026, de 317 geometrias distintas em 325 feições). Por isso o balão
  lista TODOS os produtos sob o ponteiro, e não só o de cima: mostrar um só era o que fazia a tela
  parecer errada, porque a cor ali é a soma dos preenchimentos e não pertence ao produto exibido.
- **A informação do mapa da mapoteca sai num painel FIXO, não num balão que segue o ponteiro.** O
  balão do MapLibre é ancorado na coordenada apontada, então perto da borda do quadro ele saía da
  área visível (chefe, 2026-07-28) — e a carta perto da borda é justamente a que se aponta quando se
  está olhando uma região. O painel fica no canto superior direito, a informação troca e a moldura
  fica. Ele nunca esvazia: sem carta sob o ponteiro volta ao texto de convite, porque aparecer e
  sumir a cada movimento do mouse é o que faz um painel piscar. O `max-height` para antes do rodapé
  de propósito, para não cobrir a barra de escala; a legenda está no canto oposto.
- **As opções de filtro do mapa são FACETADAS: cada lista aplica os outros filtros, nunca o
  próprio.** Pedido do chefe em 2026-07-28 ("um filtro deve filtrar o quantitativo do outro"):
  escolher uma OM passa a mostrar quantos produtos daquela OM existem em cada escala. Aplicar também
  o próprio filtro deixaria cada lista com uma opção só, a que já está escolhida, e trocar de escala
  exigiria limpar antes. Elas ficam em endpoint próprio (`/dashboard/entregas_filtros`), e não junto
  das feições, porque o cache é por combinação e a tela pede as duas coisas em paralelo. A contagem
  ao lado da opção é, por construção, o número de produtos que o mapa desenha ao escolhê-la; há
  teste de rota e prova contra produção guardando essa igualdade. Quando o cruzamento zera a escolha
  atual, a tela a MANTÉM na lista com "(0)" em vez de descartá-la: descartar desfaria em silêncio o
  que a pessoa pediu. A exceção é a troca de ano, onde a opção some porque não existe mesmo.
  A **busca do acervo segue a mesma regra** desde 2026-07-28 (`/acervo/busca/facetas`, mesmo pedido
  do chefe), com uma exceção própria: o subtipo que não pertence ao tipo recém-escolhido é
  DESCARTADO, e não mantido com "(0)". Ele não cruzou a zero, ele deixou de fazer sentido, e manter
  deixaria a busca com dois filtros que nunca se cruzam devolvendo zero sem dizer por quê. As três
  contagens saem do MESMO `montarFiltrosBusca` da lista e da camada do mapa, então nenhuma pode
  divergir do resultado; provado contra produção em 2026-07-28 (soma dos tipos = 5.741 = acervo
  inteiro, e cada opção bate exatamente com o total da busca ao escolhê-la).
- **A sugestão de palavra-chave da busca é um popover NOSSO, não `<datalist>`.** O nativo escolhe
  sozinho quantas linhas mostrar, sem CSS que o alcance, e com as vinte etiquetas que a rota devolve
  abria cobrindo boa parte da tela (chefe, 2026-07-28). Junto vieram três coisas que o datalist não
  dava: a contagem de usos como texto de verdade (nele ia no atributo `label`, que só o Firefox
  mostra), setas e Enter iguais em todo navegador, e a lista refeita a cada tecla contra o servidor.
  Enter com o campo digitado aplica o texto como está, de propósito: a sugestão vem limitada a 20 e o
  acervo tem mais etiquetas do que isso. Ver `modules/acervo/pages/busca/palavra-chave.js`.
- **A busca do acervo lista PRODUTOS, e a ficha lista as versões da mais nova para a mais antiga.**
  O cartão anuncia a última edição (`ORDER BY v.data_edicao DESC LIMIT 1`) e a contagem de versões;
  a ficha (`/produto/detalhado/:id`) traz todas, ordenadas no SERVIDOR por `data_edicao DESC NULLS
  LAST, id DESC`, com a primeira marcada como "Mais recente". Ordenar na tela não serviria: quem lê
  essa rota inclui o plugin. `NULLS LAST` porque versão sem data de edição é registro incompleto, e
  não a mais nova.
- **O ano de referência é contexto de MÓDULO, e mora na navbar.** Vale para o orçamento
  (2026-07-25) e para a mapoteca (2026-07-28), pela fábrica `@store/year-store.js`: chave de
  `localStorage` e evento são namespaced por módulo (`@sca-mapoteca-ano`, `anochange:mapoteca`),
  senão escolher 2025 num módulo mudaria o outro sob os pés de quem troca pela sidebar. O seletor é
  o mesmo componente (`@components/seletor-ano.js`); a diferença é de política: no orçamento o ano
  também decide **onde se cadastra**, e por isso ele oferece "+ Outro ano…"; na mapoteca o ano só
  **filtra o que já aconteceu**, e um ano sem movimento só entregaria telas em branco. Na mapoteca o
  contexto vale para o **dashboard inteiro** (as cinco abas), para a lista de **pedidos**, e para
  consumo, RPCMTec e detalhe do material. Fica de fora só a lista de **clientes**, que é cadastro e
  não movimento. Pedidos esteve fora por algumas horas em 2026-07-28, com o argumento de que é tela
  operacional; o chefe reverteu no mesmo dia. O que a reversão custa, e é deliberado: o pedido de
  dezembro concluído em janeiro só aparece trocando o ano na navbar.
- **No dashboard da mapoteca existem DOIS recortes anuais, e cada aba diz na tela qual é o dela.**
  Resumo Anual e Mapa contam por data de **entrega** efetiva (`FILTRO_ENTREGUE_ANO`); Pedidos e
  Atendimento contam por data do **pedido** (`FILTRO_ANO_PEDIDO`). O pedido de dezembro de 2025
  entregue em janeiro de 2026 cai em anos diferentes nos dois, e os dois estão certos: são perguntas
  distintas ("o que entregamos" e "o que entrou"). Sem a linha de escopo na tela (`.dashboard__escopo`)
  os números de duas abas do mesmo ano pareceriam se contradizer. A aba Materiais é meio a meio, e
  também avisa: o consumo é do ano, mas o **estoque é o saldo de hoje** e ignora o seletor, porque
  "estoque de 2025" não existe; a rota dele é a única do dashboard que não aceita `ano`.
  As janelas deslizantes ("últimos 6 meses", "últimos 12 meses") saíram junto, porque não têm como
  respeitar um ano escolhido: em 2025 elas continuariam terminando hoje. Viraram os doze meses do
  ano, que é a granularidade que o resto do dashboard já usava.
- **Pacote ESM puro entra no servidor por `require()`, e no Jest por dublê mapeado.** O servidor é
  CommonJS, e `serialize-error` (usado por `utils/app_error.js`, ou seja, por quase tudo) é ESM puro
  desde a versão 9. Ele era carregado por `import()` dinâmico, e isso **impedia a suíte inteira do
  servidor de rodar**: dentro do contexto de VM do Jest o `import()` exige
  `NODE_OPTIONS=--experimental-vm-modules`, e com essa flag o Jest 30 no Node 24 quebra antes, em
  `ERR_VM_MODULE_NOT_MODULE`. Sem saída pelos dois lados, todo arquivo de teste morria no primeiro
  `require`. Hoje `utils/serialize_error_loader.js` tenta `require()` primeiro (o Node aceita
  `require()` de ESM sem flag desde a 22.12; o pacote não tem top-level await) e só cai no
  `import()` se der `ERR_REQUIRE_ESM`, para Node mais antigo. No Jest, `moduleNameMapper` aponta
  para um dublê CJS em `__tests__/helpers/`, como já era feito com o `uuid`. **Não devolva a flag
  aos scripts de teste**: ela é a causa, não a cura. Ao acrescentar dependência ESM pura, siga este
  par (require primeiro, dublê mapeado no Jest).
- **O rate limit é desligado sob `NODE_ENV=test`.** São 200 requisições por minuto, e a suíte passa
  disso no meio do arquivo de rotas da mapoteca. O efeito ruim não era falhar, era fazer falhar um
  teste **que não mudou**, só porque um teste novo entrou antes dele no mesmo minuto: a suíte
  passava a depender de ordem e de relógio. O limite protege contra abuso vindo da rede, que não é o
  que a suíte imita.
- **`archiver` fica na 7, e os `overrides` do `server/package.json` são o que zera a auditoria.** NUNCA rode `npm audit fix --force` aqui. Ele sobe o `archiver` para 8, que é **ESM puro e não exporta mais função chamável**: as classes `Archiver`/`ZipArchive` substituíram `archiver('zip', ...)`, e as duas exportações em ZIP quebram no boot. Medido em 2026-07-27. As 7 vulnerabilidades da subárvore vinham todas de `brace-expansion`, então os `overrides` corrigem a raiz sem tocar na API. O `readdir-glob` precisa de override próprio (`minimatch` ^10.2.5) porque o `minimatch` 5 faz `require('brace-expansion')` esperando a função direta, e a versão 5 exporta `{ expand }` nomeado: sem esse segundo override, o `npm audit` diz "0 vulnerabilities" com o `archive.glob()` quebrado. Quem cobre isso é `server/src/__tests__/unit/acervo_zip_ctrl.test.js`, que abre o ZIP e descomprime, em vez de conferir o tipo do retorno.

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
