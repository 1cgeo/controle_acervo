# Controle do Acervo (SCA)

Sistema de gerenciamento de dados geoespaciais produzidos pelo Serviço Geográfico do Exército Brasileiro (DSG/1CGEO). Gerencia produtos geográficos versionados (cartas, ortoimagens, modelos digitais de elevação), seus arquivos, volumes de armazenamento, a mapoteca física e o controle orçamentário da divisão.

São **seis módulos de autorização na mesma plataforma**, com um servidor, um banco e uma interface web: `acervo`, `mapoteca`, `orcamento` e `equipamento`, que têm tela própria e prefixo de rota, mais `pit` e `efetivo`, que nasceram na 1.33.0 e guardam telas de PLATAFORMA (a execução do PIT, o Extra-PIT, a capacitação e o aproveitamento do efetivo), para haver como dar menos que a flag global nesse trabalho. O `equipamento` nasceu na 1.46.0 e traz para o sistema o material permanente da Divisão, que vivia numa planilha (o Relatório DMT). O `pit` chamava-se `producao` até 2026-08-09, e foi renomeado para devolver o nome ao core de produção do SAP, que vai entrar como módulo próprio.

A **autenticação é do próprio SCA**: ele guarda o hash bcrypt em `dgeo.usuario.senha`, valida o login sozinho e cadastra gente pela interface. Não há serviço de autenticação externo, e por isso não há um segundo serviço a subir para alguém conseguir entrar.

> Regras de projeto e padrões que todo código novo segue estão em **[`CLAUDE.md`](CLAUDE.md)**. O **porquê** de cada escolha que parece estranha, e o que custou a alternativa, em **[`docs/decisoes.md`](docs/decisoes.md)**. Para subir o ambiente, veja **[`levantar_servico.md`](levantar_servico.md)**.

## Componentes

| Componente | Diretório | Tecnologia | Descrição |
|---|---|---|---|
| **Server** | `server/` | Node.js / Express 5 | API REST com PostgreSQL/PostGIS |
| **Interface web** | `client/` | Vanilla JS / Vite 6 | SPA única, com os quatro módulos de tela e as páginas de plataforma |
| **Plugin QGIS do Acervo** | `ferramentas_acervo/` | Python / PyQt (Qt6) | Catalogação, carga e diagnóstico |
| **Plugin QGIS da Mapoteca** | `ferramentas_mapoteca/` | Python / PyQt (Qt6) | Pedidos ativos, download de PDF e quantitativo impresso |
| **CLIs de agente** | `acervo_cli/`, `mapoteca_cli/`, `orcamento_cli/`, `equipamento_cli/`, `pit_cli/`, `efetivo_cli/`, `sag_cli/` | Node (dependência zero) | Quatro de módulo, dois de plataforma e o `sag_cli`, que só LÊ o SAG |

Os CLIs são irmãos do client web, não scripts auxiliares: o client serve humanos e o CLI serve agentes, sobre a mesma API. Eles leem o contrato do Joi vivo em tempo de execução, e por isso nunca ficam desatualizados em silêncio.

---

## Server (API REST)

### Requisitos

- Node.js >= 22.12. O servidor carrega dependência ESM pura por `require()`
  (`utils/serialize_error_loader.js`), que só existe sem flag a partir dessa versão.
- PostgreSQL com extensão PostGIS

### Instalação

```bash
npm run install-all              # dependências do servidor e da interface
npm run config                   # configuração interativa (cria banco e config.env)
git config core.hooksPath .githooks   # liga o pre-commit desta máquina
```

O terceiro comando não é opcional num clone novo: este repositório é PÚBLICO, e o guard
`scripts/check_vazamento.py` (fail-closed, em `.githooks/pre-commit`) é o que barra segredo, IP
interno e caminho de máquina antes do commit. Sem `core.hooksPath` apontado, o hook nem roda.

A configuração pergunta os dados do **primeiro administrador** (login, senha, nome, nome de guerra e posto/graduação) e o cria no banco: é com ele que se entra no sistema pela primeira vez.

O `create_config.js` também aceita flags de linha de comando (`--db-server`, `--db-port`, `--db-name`, `--db-create`, `--admin-login`, `--admin-senha`, ...); rode-o sem argumento para o modo interativo.

### Execução

```bash
cd server && npm run dev        # Desenvolvimento (HTTP, hot-reload por nodemon)
cd server && npm run dev-https  # Desenvolvimento (HTTPS)
npm start                       # Produção (HTTP, via PM2)
npm run deploy                  # Build da interface + PM2 startOrReload + pm2 save
```

### Testes

A suíte do servidor é dividida em **dois pacotes**, para nem toda mudança cobrar os três minutos da suíte inteira:

```bash
cd server
npm run test:rapido       # segundos: tudo que NÃO toca o banco, em paralelo
npm run test:banco        # minutos: o que precisa de PostgreSQL
npm test                  # os dois
npm run test:coverage     # cobertura
```

No dia a dia, `test:rapido` é o que se roda: ele cobre schemas, controllers mockados, utilitários e as rotas do orçamento. `test:banco` antes de commitar.

Quem entra em qual pacote é decidido **lendo o fonte**, não por uma lista: teste que faz `require` de `helpers/db` ou de `helpers/app` abre conexão e vai para o pacote de banco. Lista seria cópia, e cópia apodrece.

Os testes usam `config_testing.env`. O `globalSetup` monta um banco-TEMPLATE aplicando `er/*.sql` na mesma ordem do `create_config.js`, e daí clona **um banco por worker** do Jest (`CREATE DATABASE ... TEMPLATE`, que é cópia de arquivo). É o que permite rodar em paralelo: cada teste de banco chama `cleanTestData()`, que faz TRUNCATE nas tabelas inteiras, e com um banco só dois workers apagariam os dados um do outro.

### Variáveis de ambiente

Arquivo `server/config.env`, gerado pelo `npm run config`. O catálogo comentado, sem valor nenhum, está em `.env.example`.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | Sim | Porta HTTP do servidor |
| `DB_SERVER`, `DB_PORT`, `DB_NAME` | Sim | Conexão com o PostgreSQL |
| `DB_USER`, `DB_PASSWORD` | Sim | Usuário de escrita do banco |
| `DB_USER_READONLY`, `DB_PASSWORD_READONLY` | Não | Papel somente leitura (URI de camada do QGIS) |
| `JWT_SECRET` | Sim | Segredo para assinatura JWT |
| `JWT_EXPIRACAO` | Não | Duração da sessão no formato do jsonwebtoken (default `8h`) |
| `MINIATURA_PDFTOPPM`, `MINIATURA_GDAL_TRANSLATE`, `MINIATURA_GDALINFO` | Não | Caminho dos binários de miniatura (vazio = procurar no PATH) |
| `UPLOAD_WEB_MAX_GB` | Não | Teto do arquivo que o NAVEGADOR envia ao volume (default 2). Acima dele, o caminho é o plugin |
| `VOLUMES_RAIZ` | Não | Onde os shares do acervo estão MONTADOS nesta máquina. Só importa fora do Windows (`utils/caminho_volume.js`) |

### Endpoints da API

Todos sob `/api`. Swagger em `GET /api/api_docs` com o servidor no ar.

**Todo endpoint de MÓDULO exige perfil naquele módulo**, por `verifyPerfil(minimo, modulo)`, inclusive os de domínio. São **seis** linhas em `dominio.modulo`: acervo, mapoteca, orçamento, **pit** e **efetivo** desde a 1.33.0, e **equipamento** desde a 1.46.0. O code 4 chamava-se `producao` até 2026-08-09. O `pit` e o `efetivo` nasceram para haver como dar menos que a flag global no trabalho de produção e de pessoal, e guardam rotas que são de PLATAFORMA no endereço (`/api/metas/execucao`, `/api/metas/extra`, `/api/campo/*`, `/api/rpcmtec/capacitacao/*`, `/api/efetivo/*`). Antes deles a única guarda disponível ali era `verifyAdmin`, e por isso 5 das 7 contas que trabalhavam no sistema eram administradoras (medido em 2026-08-06). As outras guardas de plataforma continuam: `verifyAdmin` (usuários, meta e revisão do PIT, criar, fechar e reabrir a edição do RPCMTec, o anexo assinado, views materializadas e limpeza de download), `verifyGerente` (gerente de QUALQUER módulo ou administrador: a LEITURA inteira do RPCMTec, mais o Anuário e o RTM), `verifyGerente` mais `verifyModuloSubsecao()` (escrever UMA subseção do RPCMTec, e só as do módulo em que a pessoa é gerente), `verifyAcesso` (leitura de meta, de revisão e de Extra-PIT: exige perfil em ALGUM módulo, sem exigir um módulo específico) e `verifyLogin` (o próprio cadastro e a própria senha). A diferença entre as duas últimas é a conta recém-criada, que ainda não recebeu perfil nenhum: ela alcança a própria página e nada mais. Sem autenticação nenhuma ficam `/api/integracao/*`, a consulta de pedido por localizador (`GET /api/mapoteca/pedido/localizador/:localizador`) e `/logs`, as três por decisão registrada em `docs/decisoes.md`.

| Prefixo | Módulo | Descrição |
|---|---|---|
| `/api/login` | plataforma | Autenticação local por bcrypt (JWT, `JWT_EXPIRACAO`, default 8h). Devolve `perfis` e `modulos`, e grava `dgeo.login` |
| `/api/usuarios` | plataforma | Cadastro de usuários, senha e concessão de perfil por módulo (admin). `/usuarios/perfil` é o próprio cadastro e a própria senha, e exige só login: é a única rota que a conta sem perfil nenhum alcança |
| `/api/acessos` | plataforma | Histórico de acesso: quem entrou hoje, logins por dia, mês, usuário e cliente (admin) |
| `/api/auditoria` | plataforma | Rastreabilidade: a varredura de eventos (`/`), as opções de filtro (`/filtros`) e o histórico de UMA ficha (`/:modulo/:entidade/:id`). A guarda é por CAMINHO: quem vê o registro vê o histórico dele (consulta naquele módulo), e `plataforma` é a exceção de administrador. NÃO confundir com `/api/acervo/auditoria`, que roda os invariantes do acervo |
| `/api/metas` | plataforma | Metas do PIT (o plano anual da Divisão), a execução mensal delas (`/execucao`), os anos do plano (`/exercicios`), as revisões com anexo (`/revisoes`) e as demandas Extra-PIT (`/extra`). Ler a meta, a revisão e o Extra-PIT exige perfil em ALGUM módulo (`verifyAcesso`); ler a GRADE de execução exige **consulta em pit** desde 2026-08-08, e era gerente de qualquer módulo; LANÇAR a execução e cadastrar Extra-PIT exige **operador em pit**; alterar a META e a REVISÃO exige administrador, porque mudar o PIT é ato da DSG |
| `/api/rpcmtec` | plataforma | A edição mensal do RPCMTec, o documento e o PDF assinado, o Anuário Estatístico e o RTM/META4 (ODS). A guarda tem TRÊS níveis desde 2026-08-08: LER é `verifyGerente` (administrador ou gerente de qualquer módulo), ESCREVER uma subseção é `verifyGerente` mais `verifyModuloSubsecao()` (só as subseções do módulo em que a pessoa é gerente, pelo mapa de `rpcmtec_estrutura.js`), e criar, fechar, reabrir ou mexer no anexo assinado é `verifyAdmin`. A **capacitação** é a exceção, e são DUAS rotas: `/capacitacao/ministrada` (operador em **pit**, subseção 2.6) e `/capacitacao/recebida` (operador em **efetivo**, 6.2). O `tipo_id` não vai no corpo: quem o fixa é a rota |
| `/api/efetivo` | plataforma | Passagem de cada pessoa pela DGEO, impedimentos e o aproveitamento agregado por semana, mês e ano. Módulo **efetivo**, inclusive na leitura: **consulta** lê a tela inteira, **gerente** escreve o dado dos outros (2026-08-08). O PRÓPRIO aproveitamento tem porta separada (`/meu_aproveitamento`, `/meu_periodo` e `/meu_impedimento`), sob `verifyAcesso`: o dono sai do token, e o `:id` alheio responde 404. `/meu_aproveitamento?ano=` é a grade do ano de UMA pessoa, pelas mesmas consultas do mapa da Divisão |
| `/api/acervo` | acervo | Operações do acervo, downloads, visões materializadas |
| `/api/arquivo` | acervo | Upload (do plugin e do navegador), download e catalogação de arquivos |
| `/api/produtos` | acervo | CRUD de produtos e versões, e o quadro da folha do SCN (`/folha`) |
| `/api/projetos` | acervo | Projetos e lotes |
| `/api/volumes` | acervo | Volumes de armazenamento |
| `/api/ponto_controle` | acervo | Pontos de controle geodésico |
| `/api/gerencia` | acervo | Domínios, arquivos excluídos, inconsistências |
| `/api/dashboard` | acervo | Analytics do acervo |
| `/api/limites` | acervo | Contorno de estado ou município (schema `limites`), para a tela destacar o lugar filtrado. Rota própria porque é dado de REFERÊNCIA, e cobra consulta no **acervo**, o mesmo das duas telas que a usam |
| `/api/mapoteca` | mapoteca | Clientes, pedidos, plotters, relatórios CSV e impressão. O material tem o `movimento_material` (o LIVRO) como única porta de escrita, e o `estoque_material` é só leitura: ler é de **consulta**, lançar é de **operador** |
| `/api/mapoteca/dashboard` | mapoteca | Analytics da mapoteca |
| `/api/orcamento/dominio` | orcamento | ND, PI, UG, tipo de licitação, classificação de NC, tipo de item de DFD, grau de prioridade |
| `/api/orcamento/configuracao/anos` | orcamento | Anos com dado, para o seletor de ano das telas |
| `/api/orcamento/dfd` | orcamento | DFD e itens (o PCA do ano é o conjunto de DFDs do ano) |
| `/api/orcamento/pdr` | orcamento | Itens do PDR do ano |
| `/api/orcamento/notas_credito` | orcamento | Notas de crédito (NC) |
| `/api/orcamento/recolhimentos` | orcamento | Recolhimento de crédito: um DOCUMENTO do SIAFI por linha, apontando a NC que ele abate. Rota própria, e não sub-rota da NC, porque o fechamento do ano pergunta pelo ANO inteiro. Até a 1.39.0 isto era a coluna `nota_credito.valor_recolhido` |
| `/api/orcamento/notas_empenho` | orcamento | Notas de empenho (NE) |
| `/api/orcamento/liquidacoes` | orcamento | Liquidações de NE |
| `/api/orcamento/recebimentos` | orcamento | Recebimento de material por NE |
| `/api/orcamento/licitacoes` | orcamento | Licitações (GCALC DSG, própria, participante) |
| `/api/orcamento/rpnp` | orcamento | Restos a pagar não processados |
| `/api/orcamento/dashboard` | orcamento | Execução por ND para as abas do painel (números por PDR/Extra-PDR, com linha de total) |
| `/api/orcamento/arquivo` | orcamento | Anexos de NC, DFD e PDR (bytes em `orcamento.arquivo.conteudo`) |
| `/api/equipamento` | equipamento | O material permanente da Divisão (Classe VI e IX): o bem, os tipos, a indisponibilidade, o afastamento, a manutenção, a transferência e o painel. A **situação do bem não é campo**: ela vem de `equipamento.situacao_em(dia)` e sai resolvida na leitura. Ler é de **consulta**, lançar evento é de **operador**, e cadastrar bem ou transferência é de **gerente**. `/relatorio/dmt_ods` responde binário, e é a única rota do módulo que não sai por `sendJsonAndLog` |
| `/api/campo` | **pit** | A atividade que a Divisão executa FORA dela: reambulação, voo de drone, ponto de controle, modelo 3D e panorâmica 360. É a fonte da subseção 2.5 do RPCMTec, que era DIGITADA da tela do SAP até 2026-08-08. Prefixo próprio, mas **não é módulo**: `dominio.modulo` continua com seis linhas, e a guarda cobra `pit` -- campo é o trabalho que o PIT promete. Ler a lista, o mapa, as fotos e os trajetos é de **consulta**; cadastrar, corrigir, subir foto e importar trajeto é de **operador**; **apagar o campo é de gerente**, porque o CASCADE leva as fotos e os trajetos junto. `/imagem/:imagemId/arquivo` responde binário, e é a única rota que não sai por `sendJsonAndLog` |
| `/api/integracao` | público | Somente leitura, para o vault da DGEO. Sem autenticação (intranet). O `POST /acervo/situacao_geral` é POST pelo tamanho da geometria no corpo, e não por mutar estado |

O acervo também se **escreve pela interface web**: produto, versão e relacionamento. A geometria do
produto sai do MI/INOM quando a folha é do SCN, e dos cantos quando não é; a versão Regular entra
pelo assistente de carregamento, que manda metadados e bytes numa requisição só
(`POST /api/arquivo/upload-web/versao`): o servidor grava no volume, mede o checksum e NOMEIA o
arquivo pelo padrão do acervo. O plugin do QGIS continua sendo o caminho da carga em lote e do
arquivo grande. Ver `docs/decisoes.md`.

`/api/mapoteca/dashboard` é montada ANTES de `/api/mapoteca` em `routes.js`, para o Express casar o prefixo mais específico primeiro. Preserve essa ordem ao acrescentar rota.

**Formato padrão de resposta:**

```json
{ "version": "1.38.0", "success": true, "message": "...", "dados": { }, "error": null }
```

### Segurança

Helmet (CSP desabilitado para servir o SPA e o Swagger UI), limite de 3.000 requisições por 60 segundos por IP (desligado sob `NODE_ENV=test`), CORS habilitado, cache desabilitado, JWT com a expiração de `JWT_EXPIRACAO` (default 8h) e o perfil relido do banco a cada requisição.

**SEM `hpp`** (proteção contra poluição de parâmetro), e a ausência é deliberada: sob Express 5 ele não faz nada, porque `req.query` virou getter sem cache e o objeto que ele reescreve morre ali; e se voltasse a funcionar quebraria a busca do acervo, cujos filtros de domínio aceitam o mesmo código repetido na URL de propósito. A proteção de verdade é o schema de query no Joi de toda rota. Prova em `server/src/__tests__/unit/server/hpp_removido.test.js`; ver o cabeçalho de `server/src/server/app.js`.

### Tarefas de manutenção

**Não há cron, e não se deve reintroduzir um.** Duas instâncias do app contra o mesmo banco rodariam os mesmos jobs em dobro, e o de miniatura ESCREVE. O que um agendamento faria acontece por outro caminho, descrito abaixo.

**Expiração de download.** O token vencido é recusado no momento do uso (`confirmDownload`), tenha alguém limpado ou não. A regra é essa, e não a passada de uma limpeza.

**Limpeza do que expirou.** `POST /api/acervo/cleanup-expired-downloads` (administrador) fecha downloads e sessões de upload vencidos, e devolve a contagem dos dois. É arrumação, e não a regra de expiração.

**Miniaturas.** A geração dispara sozinha **depois** do upload, fora da transação e sem segurar a resposta: renderizar custa segundos e roda processo externo. A miniatura é a imagem que a ficha do produto mostra: a página inteira do PDF da versão, ou o raster quando não há PDF. Produto só vetorial não tem miniatura.

Para o que entra por outros caminhos (carga direta no banco, arquivo trocado no volume), há a varredura manual, com teto de 20 por passada:

- `GET /api/acervo/miniaturas/pendentes` diz quantas versões esperam;
- `POST /api/acervo/miniaturas/varrer` (administrador) paga um lote.

Dois binários e uma biblioteca, e cada um faz o que só ele faz bem:

| Etapa | Ferramenta | Por quê |
|---|---|---|
| Renderizar PDF | `pdftoppm` (poppler) | os substitutos em npm discordam do preenchimento das cartas, arquivo a arquivo, nos dois sentidos |
| Abrir formato geo | `gdal_translate` + `gdalinfo` | é o único que lê ERDAS `.img` (Ortoimagem, 7,4 GB com pirâmides) e GeoTIFF Float32 (MDS/MDT) |
| Reduzir e codificar | `sharp` (npm) | o `-outsize` do GDAL decima por vizinho mais próximo e serrilha o texto da legenda |

Os dois binários extraem ao **dobro** do alvo e o `sharp` faz a redução final, com reamostragem de verdade. Em Linux é `apt install poppler-utils gdal-bin`; em Windows o GDAL vem dentro do QGIS. Sem os binários a varredura aborta a passada com um erro no log, nenhuma miniatura nova é gravada e a rota da miniatura responde 404 por não haver o que servir; nada mais quebra.

**Raster de medida é esticado, não cortado.** MDS e MDT guardam ALTITUDE na banda, não intensidade de pixel. Convertidos direto para 8 bits, toda cota acima de 255 m vira branco e a miniatura sai vazia. O gerador detecta a banda que não é de 8 bits e estica por média ± 2,5 desvios, presa ao intervalo real. O `GDAL_PAM_ENABLED=NO` é forçado: sem ele, pedir estatística grava um `.aux.xml` **ao lado do arquivo lido**, dentro do volume do acervo.

Para carregar o acervo já existente de uma vez, em vez de varrer de 20 em 20:

```bash
node scripts/gerar_miniaturas.cjs --limite 50 --embaralhar --dry-run   # ensaio real
node scripts/gerar_miniaturas.cjs --concorrencia 4                     # a carga
```

O `--dry-run` lê o volume e renderiza de verdade, e para só antes de gravar. Falha vira linha de erro em `acervo.miniatura_versao`, para a carga seguinte não repetir o arquivo quebrado; `--refazer-erros` insiste neles. Para refazer o que deu certo, apague as linhas alvo: a miniatura é dado derivado, e a carga seguinte a reconstrói.

### Estrutura do servidor

```
server/src/
├── index.js / main.js / config.js / routes.js
├── server/               # App Express, Swagger
├── database/             # Conexão pg-promise, checagem de versão, refresh de views
├── login/                # Autenticação local (bcrypt), JWT, verify_perfil, verify_admin
├── acervo/ arquivo/ produto/ projeto/ volume/ ponto_controle/ dashboard/ gerencia/
├── usuario/              # Usuários, senha e perfis (plataforma)
├── acessos/              # Histórico de login (plataforma)
├── auditoria/            # Rastreabilidade: varredura e histórico de ficha (plataforma)
├── pit/                  # Metas do PIT, execução mensal, revisões e Extra-PIT (plataforma)
├── efetivo/              # Passagem pela DGEO, impedimentos e aproveitamento (plataforma)
├── rpcmtec/              # RPCMTec inteiro, Anuário, RTM e capacitação (plataforma)
├── mapoteca/             # CRUD da mapoteca, dashboard, relatórios CSV, impressão
├── equipamento/          # Material permanente da Divisão e o Relatório DMT
├── campo/                # Atividade de campo (prefixo próprio, guarda do módulo pit)
├── limites/              # Limite político-administrativo (referência)
├── integracao/           # Rotas públicas para o vault da DGEO
├── orcamento/            # Módulo orçamento (9 features + utils próprio, 13 routers)
└── utils/                # Utilitários compartilhados
```

Cada feature segue o padrão de 4 arquivos (`index.js`, `*_ctrl.js`, `*_route.js`, `*_schema.js`).

---

## Interface web

Uma SPA só, em `client/`, servida na raiz pelo Express. Trocar de módulo é trocar de rota (`#/acervo/...`, `#/mapoteca/...`, `#/orcamento/...`, `#/equipamento/...`), sem recarregar e sem novo login. O seletor mostra só os módulos em que a pessoa tem perfil; quem é administrador global vê todos. As telas do PIT e do efetivo são páginas de PLATAFORMA, fora dos manifestos de módulo (`#/metas`, `#/execucao_pit`, `#/revisoes_pit`, `#/extra_pit`, `#/campo`, `#/aproveitamento`, `#/rpcmtec`, `#/capacitacao_ministrada`, `#/capacitacao_recebida`, `#/rastreabilidade`, `#/usuarios`, `#/acessos`, `#/perfil`).

```
client/src/js/
├── index.js          # Tema, roteador, layout, rotas de plataforma
├── router.js         # Roteador hash com guardas
├── store/            # auth-store: sessão única, prefixo @sca-*
├── services/         # api-client, cache, plataforma-service, rpcmtec-service,
│                     # campo-service, rastreabilidade-service
├── utils/            # dom, formatação, tema, toast, localizador, reconciliar
├── components/       # layout, data-table, modal, form-fields, charts, mapa, tabs,
│                     # wizard, paginação, histórico, filtros, export-bar
├── pages/            # login, usuarios, acessos, perfil, rpcmtec, capacitacao,
│                     # metas, execucao-pit, revisoes-pit, extra-pit, campo,
│                     # aproveitamento, rastreabilidade, 404, não autorizado
└── modules/
    ├── registry.js   # O CONTRATO: como registrar página, pedir dado e declarar perfil
    ├── acervo/       # Dashboard, busca, pontos de controle, cadastro de produto e versão
    ├── mapoteca/     # Clientes, pedidos, material e o livro de movimentos, plotters, relatórios
    ├── orcamento/    # DFD, PDR, metas, NC, NE, licitações, RPNP, configuração
    └── equipamento/  # Bens, tipos, indisponibilidade, afastamento, manutenção, transferência
```

Para acrescentar página, leia `client/src/js/modules/registry.js`: um manifesto por módulo declara menu, rotas e perfil mínimo, e o roteador não precisa ser tocado.

```bash
npm run dev-client    # Vite na porta 3003, com proxy /api para 3015
npm run build         # Builda client/ e copia para server/src/build/
npm run test-client   # vitest + jsdom
```

Convenções: BEM no CSS, tokens de design em `design-tokens.css`, tema claro e escuro por `[data-theme]`, gráficos com Chart.js em chunk separado. Em teste, `chart.js` e `maplibre-gl` são substituídos por dublês (`chart-stub.js`, `maplibre-stub.js`), porque o jsdom não implementa canvas nem WebGL.

---

## Banco de dados

### Schemas

| Schema | Conteúdo |
|---|---|
| `acervo` | projeto, lote, produto, versao, arquivo, download, miniatura, sessões de upload |
| `ponto_controle` | pontos de controle geodésico e seus arquivos |
| `mapoteca` | cliente, pedido, produto_pedido, impressao_item, anexo_pedido, etiqueta_envio, plotter, manutencao_plotter, tipo_material, `movimento_material` (o LIVRO: Entrada, Transferência e Consumo -- são TRÊS, e o code 4 da Contagem foi extinto na 1.48.0) e `estoque_material` (o saldo, DERIVADO do livro por gatilho e sem porta própria de escrita desde a 1.41.0) |
| `orcamento` | 12 tabelas: dfd, dfd_item, licitacao, pdr_item, nota_credito, nota_empenho, nota_empenho_nota_credito, nota_credito_recolhimento, liquidacao, recebimento_material, rpnp, arquivo. Não há `configuracao`: ela foi podada na 1.34.0 |
| `equipamento` | O material permanente: `equipamento` (o bem), `tipo_equipamento` (CADASTRO, não domínio: tipo novo entra pela tela), `indisponibilidade` e `afastamento` (INTERVALOS, com `EXCLUDE USING gist` como `dgeo.efetivo_periodo`), `manutencao`, `transferencia` e cinco tabelas de domínio. Não há coluna de situação: quem a responde é a função `situacao_em(dia)`, que recebe o dia e não olha para hoje |
| `campo` | A atividade de campo: `campo` (com `geom` MULTIPOLYGON **NOT NULL** e `ano` apontando `pit.pit`), as junções `campo_categoria`, `campo_militar` (para `dgeo.usuario`) e `campo_versao` (para `acervo.versao`, **opcional**), `imagem` (foto e vídeo em `bytea`), `track` e `track_ponto`, mais duas tabelas de domínio (`situacao` e `categoria`). A LINHA do trajeto não se guarda: ela é a view `track_linha`, costurada dos pontos na leitura |
| `pit` | `pit` (o ANO do plano, chamada `exercicio` até 2026-08-09), `meta` e `meta_item` (o que cada uma promete), `revisao`, `meta_item_revisao`, `tipo_anexo_revisao` e `anexo_revisao` (o que mudou, quando, e o documento assinado), `execucao` (o planejado e o realizado de cada mês) e `demanda_extra` (o Extra-PIT), mais a view `meta_vigente` e a função `meta_em(...)`. Dado de referência, fora dos módulos. **`pit.pit` é o ANO; `macrocontrole.pit` do SAP é a META**, e corresponde ao `pit.meta` daqui |
| `rpcmtec` | `edicao` (o metadado da edição mensal), `subsecao` e `subsecao_revisao` (o texto de cada subseção e o que o gerente do módulo alterou nela), `anexo_edicao`, mais `capacitacao` e `capacitacao_militar` (a ENTRADA digitada das subseções 2.6 e 6.2, com quem da Divisão participou ligado ao cadastro). São **33 subseções** no gerador (`rpcmtec_estrutura.js`), e as CALCULADAS continuam saindo de consulta, nunca de linha gravada |
| `auditoria` | `evento`: o rastro de quem mudou o quê, nos módulos e na plataforma. Único schema sem UPDATE e sem DELETE para a aplicação |
| `limites` | `estado`, `municipio` e `area_suprimento` |
| `dominio` | Tabelas de domínio dos módulos, mais `tipo_perfil` e `modulo` (seis linhas) |
| `dgeo` | `usuario`, `usuario_perfil` e `login` (o histórico de acesso, com a coluna `cliente`), mais `efetivo_periodo` e `impedimento` (a passagem de cada pessoa pela DGEO e o que a tirou do trabalho, por intervalo) |
| `public` | Versão do banco e estilos de camada do QGIS |

### Instalação nova

Arquivos em `er/`, nesta ordem: `versao`, `dominio`, `dgeo`, `auditoria`, `limites`, `pit`, `acervo`, `ponto_controle`, `acompanhamento`, `mapoteca`, `orcamento`, `equipamento`, `campo`, `rpcmtec`, `permissao` e, opcional, `permissao_readonly`.

A ordem tem razões: `limites` vem antes de `acervo`, que não o referencia mas o consulta, e é o primeiro arquivo com geometria (declara o PostGIS); `pit` vem antes de mapoteca e orçamento, que a referenciam, e depois de `dominio`, de onde saiu `situacao_extra_pit`; `equipamento` vem depois de `dgeo`, de onde sai a extensão `btree_gist` que o `EXCLUDE` das tabelas de intervalo exige, e não referencia módulo nenhum; `campo` vem depois de `pit` (o ano aponta `pit.pit`) e de `acervo` (o vínculo opcional aponta `acervo.versao`), e antes de `rpcmtec`, que o lê para calcular a subseção 2.5; `rpcmtec` é o último dos schemas porque referencia `dgeo` e `dominio`.

`create_config.js` e o `globalSetup` do Jest seguem a mesma ordem. Ao acrescentar arquivo em `er/`, atualize os dois. O `globalSetup` LÊ a ordem do `create_config.js` em vez de copiá-la, porque a cópia apodrece.

São DOIS números, e eles não são o mesmo: a versão do schema é carimbada em `public.versao` por `er/versao.sql`, e o piso que o boot exige é `MIN_DATABASE_VERSION`, em `server/src/config.js`. Leia os dois arquivos em vez de confiar num número escrito aqui, que envelhece a cada migração.

Eles divergem de propósito. O piso só sobe quando uma migração ACRESCENTA schema, tabela ou coluna que o código passa a ler; migração que só remove o que ninguém usava deixa o piso onde está, e assim um banco atrás da última versão continua rodando sem faltar nada, e ninguém precisa migrar por obrigação.

### Atualização de banco existente

`er/` descreve só a instalação nova. O caminho de atualização vive em `migrations/`, um arquivo por mudança. As migrações são aditivas e idempotentes.

**A ordem de aplicação é a da VERSÃO que cada arquivo carimba** (`UPDATE public.versao`, no fim do arquivo), e não a do nome. Duas migrações do mesmo dia saem em ordem alfabética que não é a de dependência: `2026-08-02_capacitacao_militar.sql` (1.17.0) precisa da tabela que `2026-08-02_pit_execucao_e_efetivo.sql` (1.15.0) cria. Aplicar por nome também termina com um carimbo abaixo do piso, e aí o serviço recusa subir.

### Modelo principal

```
projeto (1) → (N) lote → (N) versao → (N) arquivo
                              ↓
                          produto (1)
```

- **produto**: geometria PostGIS (POLYGON, EPSG:4674)
- **versao**: edição versionada, metadado em JSONB, formato validado por trigger
- **arquivo**: arquivo físico com checksum, volume e situação de carregamento
- **download e upload**: transferência por token, com expiração automática

O schema `orcamento` não tem geometria, e liga usuário só por `uuid`.

### Visões materializadas

`acervo.mv_produto_<tipo>_<escala>` agregam produto, versão e arquivo. São atualizadas por trigger em `produto`, `versao` e `arquivo` (`FOR EACH STATEMENT` com tabela de transição). Atualização manual por `POST /api/acervo/refresh_materialized_views` e criação por `POST /api/acervo/create_materialized_views`, as duas de administrador.

---

## Plugins QGIS

Dois plugins (QGIS >= 4.0/Qt6), com a mesma instalação: copie a pasta para o diretório de plugins do QGIS.

| SO | Diretório |
|---|---|
| Windows | `%APPDATA%\QGIS\QGIS4\profiles\default\python\plugins\` |
| Linux | `~/.local/share/QGIS/QGIS4/profiles/default/python/plugins/` |
| macOS | `~/Library/Application Support/QGIS/QGIS4/profiles/default/python/plugins/` |

Para desenvolvimento, os scripts em `.dev/` criam os symlinks dos DOIS plugins de uma vez (`setup_dev_windows.bat` como administrador, `setup_dev_linux.sh`, `setup_dev_macos.sh`).

O login pede URL do servidor, usuário e senha, envia `POST /api/login` e guarda o JWT; em 401 tenta re-autenticar em silêncio com as credenciais salvas em `QgsSettings` ("Lembrar-me").

**`ferramentas_acervo/`** cobre funções gerais (carregar camadas, informações do produto, download, situação geral, busca, relacionamentos entre versões), funções de administrador (adicionar produto, versão histórica, carregar produtos), administração avançada (volumes, projetos, lotes, usuários), operações em lote e diagnóstico (inconsistências, limpeza de downloads, visões materializadas, arquivos com problema, sessões de upload).

Transferência de arquivo: no **download**, prepara pela API (recebe token e caminho), o `FileTransferThread` copia (cópia direta no Windows, `smbclient` no Linux), até 3 tentativas com espera dobrando entre elas (2s e 4s), confere o SHA-256 e confirma pela API. No **upload**, valida a camada tabular no QGIS, calcula SHA-256 e tamanho, prepara pela API (recebe `session_uuid` e destino), copia e confirma.

**`ferramentas_mapoteca/`** é voltado à operação de impressão: a fila de atendimento (`GET /api/mapoteca/pedido/em_aberto`, ordenada por prazo), os itens de cada pedido com o que falta imprimir, o download dos PDFs das cartas (sequencial, com verificação SHA-256, gravando o manifesto `impressao_<localizador>.csv`) e o registro de impressão por item (quem, quando, quantas cópias), com histórico, para que operadores diferentes continuem o trabalho em dias distintos. Ele usa grupo próprio de `QgsSettings`, com as mesmas chaves do plugin do acervo, mais a pasta de destino dos PDFs.

Ele exige o perfil **operador no módulo mapoteca**, e todas as rotas que usa são de `/api/mapoteca`, inclusive a confirmação do download (`POST /api/mapoteca/impressao/confirmar_download`), que existe porque a gêmea do acervo cobra perfil no módulo acervo. Ver a seção do plugin em `docs/decisoes.md`.

---

## CLIs de agente

São **sete**: quatro de MÓDULO (`acervo_cli`, `mapoteca_cli`, `orcamento_cli`, `equipamento_cli`), dois de PLATAFORMA (o `pit_cli`, do PIT e do RPCMTec, e o `efetivo_cli`, de identidade e efetivo) e o `sag_cli`, que é o único que não fala com o SCA. Todos com dependência zero (sem `node_modules` próprio, para rodar num clone recém-baixado) e contrato lido do Joi vivo do servidor.

```bash
node acervo_cli/acervo.js --ajuda
node mapoteca_cli/mapoteca.js --ajuda
node orcamento_cli/orcamento.js --ajuda
node equipamento_cli/equipamento.js --ajuda
node efetivo_cli/efetivo.js --ajuda
node pit_cli/pit.js --ajuda
node sag_cli/sag.js --ajuda
node orcamento_cli/orcamento.js schema nc             # contrato formatado, do Joi vivo
```

Os seis do SCA compartilham o cache de sessão em `~/.sca`: um login serve todos. Nunca copie contrato para dentro de um CLI: acrescente a entrada em `lib/recursos.js` e o contrato aparece sozinho.

O `sag_cli` é o **irmão de fora**: ele só LÊ o SAG (o espelho do SIAFI), para conferir contra ele o que o módulo orçamento guarda, e não escreve em lado nenhum. Sessão em `~/.sag`, e não em `~/.sca`, porque o cookie é de outro sistema.

```bash
npm run test-cli      # node:test, sem dependência
```

Eles usam `node:test` e `assert`, e não Jest: dependência zero vale para o teste também. O script `test-cli` do `package.json` da raiz lista **cinco** dos sete; o `equipamento_cli` e o `sag_cli` têm `__tests__` próprio e ainda rodam por `node --test equipamento_cli/__tests__/*.test.js` (e o equivalente do `sag_cli`).

---

## Scripts

| Script | O que faz |
|---|---|
| `scripts/fumaca.py` | Fumaça pós-deploy, só leitura, sai com 1 se algo falha. Seis seções: plataforma, acervo, mapoteca, orçamento, RPCMTec e as colisões de nome resolvidas pelo prefixo. Ela ainda NÃO cobre `equipamento`, `campo` nem `efetivo` |
| `scripts/check_vazamento.py` | Guard de pre-commit: barra segredo, IP interno e caminho de máquina neste repositório PÚBLICO |
| `scripts/gerar_miniaturas.cjs` | Carga em lote das miniaturas do acervo já existente |
| `scripts/copiar_usuarios_auth.js` | Copia, uma vez, os hashes de senha do banco do Auth Server para o do SCA |
| `scripts/carregar_campo_sap.py` | Gera o SQL de carga do schema `campo` a partir do `controle_campo` do SAP |
| `scripts/carregar_equipamento_dmt.py` | Gera o SQL de carga do módulo `equipamento` a partir do Relatório DMT (.ods) |

Os dois últimos GERAM SQL para um caminho **fora** do repositório, escolhido em `--saida`, e recusam apontar para dentro dele: o repositório é PÚBLICO e a carga traz nome de militar, número de patrimônio e coordenada. O arquivo versionado carrega REGRA, nunca DADO.

O detalhe de cada um está em [`scripts/README.md`](scripts/README.md). Os testes
do que roda sem banco (argumentos, plano, relatório):

```bash
npm run test-scripts
```

---

## Licença

MIT
