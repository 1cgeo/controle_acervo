# SAP 3.0 - Sistema de Apoio à Produção

Sistema de gerenciamento de dados geoespaciais produzidos pelo Serviço Geográfico do Exército Brasileiro (DSG/1CGEO). Gerencia produtos geográficos versionados (cartas, ortoimagens, modelos digitais de elevação), seus arquivos, volumes de armazenamento, a mapoteca física, o controle orçamentário da divisão e a produção cartográfica.

> **Ele se chamava Controle do Acervo (SCA) até 2026-08-09**, quando passou a ser o SAP 3.0 e a versão do serviço saltou de 1.50.0 para 3.0.0, continuando a numeração do SAP 2.3.5, que roda em outro repositório e será aposentado. A renomeação é de RÓTULO: o schema `acervo`, o módulo `acervo`, o `acervo_cli`, as rotas `/api/acervo/*`, o nome do banco e as chaves `SCA_*` do ambiente não mudaram. Onde o repositório ainda diz "SCA", é o mesmo sistema. O porquê está em [`docs/decisoes.md`](docs/decisoes.md).

São **sete módulos de autorização na mesma plataforma**, com um servidor, um banco e uma interface web. Cinco têm tela própria e prefixo de rota (`acervo`, `mapoteca`, `orcamento`, `equipamento` e `producao`); `pit` e `efetivo` guardam telas de PLATAFORMA (a execução do PIT, o Extra-PIT, a capacitação e o aproveitamento do efetivo). O `pit` chamava-se `producao` até 2026-08-09, quando o nome foi devolvido ao core de produção herdado do SAP 2.3.5.

O módulo `producao` é a maior parte do sistema em número de endpoints: são sete prefixos de rota, os schemas `producao`, `qgis`, `metadado` e `microcontrole` mais as funções de `acompanhamento`, e onze telas. **O `microcontrole` é o único assunto do sistema que vive em DOIS bancos**: o perfil que diz o que monitorar fica aqui, e a telemetria que o plugin do QGIS captura fica num banco separado e OPCIONAL, apontado pelas chaves `MICRO_DB_*`. Sem esse banco o serviço sobe inteiro, e só as rotas que leem a telemetria respondem 503.

A **autenticação é do próprio SAP 3.0**: ele guarda o hash bcrypt em `dgeo.usuario.senha`, valida o login sozinho e cadastra gente pela interface. Não há serviço de autenticação externo, e por isso não há um segundo serviço a subir para alguém conseguir entrar.

> Regras de projeto e padrões que todo código novo segue estão em **[`CLAUDE.md`](CLAUDE.md)**. O **porquê** de cada escolha que parece estranha, e o que custou a alternativa, em **[`docs/decisoes.md`](docs/decisoes.md)**. Para subir o ambiente, veja **[`levantar_servico.md`](levantar_servico.md)**.

## Componentes

| Componente | Diretório | Tecnologia | Descrição |
|---|---|---|---|
| **Server** | `server/` | Node.js / Express 5 | API REST com PostgreSQL/PostGIS |
| **Interface web** | `client/` | Vanilla JS / Vite 6 | SPA única, com os cinco módulos de tela e as páginas de plataforma |
| **Plugin QGIS do Acervo** | `ferramentas_acervo/` | Python / PyQt (Qt6) | Catalogação, carga e diagnóstico |
| **Plugin QGIS da Mapoteca** | `ferramentas_mapoteca/` | Python / PyQt (Qt6) | Pedidos ativos, download de PDF e quantitativo impresso |
| **CLIs de agente** | `acervo_cli/`, `mapoteca_cli/`, `orcamento_cli/`, `equipamento_cli/`, `pit_cli/`, `efetivo_cli/`, `sag_cli/` | Node (dependência zero) | Quatro de módulo, dois de plataforma e o `sag_cli`, que só LÊ o SAG |

Os CLIs são irmãos do client web, não scripts auxiliares: o client serve humanos e o CLI serve agentes, sobre a mesma API, com o contrato lido do Joi vivo em tempo de execução.

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

O terceiro comando não é opcional num clone novo: este repositório é PÚBLICO, e o guard `scripts/check_vazamento.py` (fail-closed, em `.githooks/pre-commit`) é o que barra segredo, IP interno e caminho de máquina antes do commit. Sem `core.hooksPath` apontado, o hook nem roda.

A configuração pergunta os dados do **primeiro administrador** (login, senha, nome, nome de guerra e posto/graduação) e o cria no banco: é com ele que se entra no sistema pela primeira vez. O `create_config.js` também aceita flags de linha de comando (`--db-server`, `--db-port`, `--db-name`, `--db-create`, `--admin-login`, `--admin-senha`, ...); rode-o sem argumento para o modo interativo.

### Execução

```bash
cd server && npm run dev        # Desenvolvimento (HTTP, hot-reload por nodemon)
cd server && npm run dev-https  # Desenvolvimento (HTTPS)
npm start                       # Produção (HTTP, via PM2)
npm run deploy                  # Build da interface + PM2 startOrReload + pm2 save
```

### Testes

```bash
cd server
npm run test:rapido       # segundos: tudo que NÃO toca o banco, em paralelo
npm run test:banco        # minutos: o que precisa de PostgreSQL
npm test                  # os dois
npm run test:coverage     # cobertura
```

São **dois pacotes**, e quem entra em qual sai de LER O FONTE: teste que faz `require` de `helpers/db` ou de `helpers/app` abre conexão e vai para o pacote de banco. No dia a dia, `test:rapido` é o que se roda; `test:banco` antes de commitar. Os testes usam `config_testing.env`, e o `globalSetup` monta um banco-TEMPLATE aplicando `er/*.sql` na mesma ordem do `create_config.js`, de onde clona um banco por worker do Jest. O porquê do arranjo está em [`docs/decisoes.md`](docs/decisoes.md).

### Variáveis de ambiente

Arquivo `server/config.env`, gerado pelo `npm run config`. O catálogo comentado, sem valor nenhum, está em `.env.example`.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `PORT` | Sim | Porta HTTP do servidor |
| `DB_SERVER`, `DB_PORT`, `DB_NAME` | Sim | Conexão com o PostgreSQL |
| `DB_USER`, `DB_PASSWORD` | Sim | Usuário de escrita do banco |
| `DB_USER_READONLY`, `DB_PASSWORD_READONLY` | Não | Papel somente leitura (URI de camada do QGIS) |
| `MICRO_DB_SERVER`, `MICRO_DB_PORT`, `MICRO_DB_NAME`, `MICRO_DB_USER`, `MICRO_DB_PASSWORD` | Não | O banco SEPARADO da telemetria do microcontrole. **TODAS ou NENHUMA**: o boot cobra as cinco se alguma vier preenchida. Sem elas o serviço sobe inteiro e as rotas que leem a telemetria respondem 503 |
| `PRODUCAO_DB_ADMIN_USER`, `PRODUCAO_DB_ADMIN_PASSWORD`, `PRODUCAO_DB_HOSTS` | Não | A conexão ADMINISTRATIVA dos bancos de edição, que cria e revoga o papel efêmero do operador. **TODAS ou NENHUMA**, e o boot recusa subir com duas das três. `PRODUCAO_DB_HOSTS` é a lista branca de `servidor` ou `servidor:porta`, separada por vírgula: alvo fora dela é recusado NA HORA DE DISCAR, e não só ao cadastrar. Sem as três, as rotas de `/banco_dados` respondem 503 |
| `JWT_SECRET` | Sim | Segredo para assinatura JWT |
| `JWT_EXPIRACAO` | Não | Duração da sessão no formato do jsonwebtoken (default `8h`) |
| `MINIATURA_PDFTOPPM`, `MINIATURA_GDAL_TRANSLATE`, `MINIATURA_GDALINFO` | Não | Caminho dos binários de miniatura (vazio = procurar no PATH) |
| `UPLOAD_WEB_MAX_GB` | Não | Teto do arquivo que o NAVEGADOR envia ao volume (default 2). Acima dele, o caminho é o plugin |
| `VOLUMES_RAIZ` | Não | Onde os shares do acervo estão MONTADOS nesta máquina. Só importa fora do Windows (`utils/caminho_volume.js`) |
| `PUBLIC_PATH` | Não | Prefixo público em que um proxy reverso publica a interface (`/<prefixo>`, vazio = raiz). **Entra no BUILD**, e não só no servidor: o `create_build.js` a repassa como `base` do Vite, e trocá-la pede build novo. No servidor, remove o prefixo da requisição que chega sem proxy na frente |
| `TRUST_PROXY` | Não | Proxies reversos confiáveis, separados por vírgula. Sem ela, atrás de um proxy o `req.ip` é o IP do proxy para todo mundo: o rate limit deixa de ser por cliente e o log perde o rastro |
| `SCA_CLIENT_PORT`, `SCA_API_PORT` | Não | Portas do Vite e do proxy `/api` em desenvolvimento (`client/vite.config.js`) |

### Endpoints da API

Todos sob `/api`. Swagger em `GET /api/api_docs` com o servidor no ar. **Para contar ou listar rotas, leia o `router.stack` que `server/src/routes.js` monta**, e não um `grep` por `router.get(`: rota gerada em laço, como o CRUD dos `perfil_*` da produção, não aparece no fonte.

**Todo endpoint de MÓDULO exige perfil naquele módulo**, por `verifyPerfil(minimo, modulo)`, inclusive os de domínio; são sete linhas em `dominio.modulo`. Rota de PLATAFORMA escolhe entre `verifyLogin` (a própria conta), `verifyAcesso` (perfil em algum módulo), `verifyGerente` (gerente de qualquer módulo, mais `verifyModuloSubsecao()` para escrever subseção do RPCMTec) e `verifyAdmin`. Sem autenticação nenhuma ficam `/api/integracao/*`, a consulta de pedido por localizador (`GET /api/mapoteca/pedido/localizador/:localizador`) e `/logs`. A régua dos três perfis está no [`CLAUDE.md`](CLAUDE.md), e o porquê de cada exceção em [`docs/decisoes.md`](docs/decisoes.md).

| Prefixo | Módulo | Descrição |
|---|---|---|
| `/api/login` | plataforma | Autenticação local por bcrypt (JWT). Devolve `perfis`, `modulos` e `instituicao` (o `nome` e a `sigla` de quem opera esta instalação, com que o client desenha), e grava `dgeo.login`. `GET /login/sessao` devolve a mesma foto, sem trocar o token |
| `/api/usuarios` | plataforma | Cadastro de usuários, senha e concessão de perfil por módulo (admin). `/usuarios/perfil` exige só login: é a única rota que a conta sem perfil nenhum alcança |
| `/api/instituicao` | plataforma | A instituição que opera esta instalação (nome, sigla e UG), em `dgeo.instituicao`, de LINHA ÚNICA. `GET` exige só login, como `/usuarios/perfil`: a conta sem perfil nenhum também vê de quem é a instalação. `PUT` é do administrador |
| `/api/acessos` | plataforma | Histórico de acesso: quem entrou hoje, logins por dia, mês, usuário e cliente (admin) |
| `/api/auditoria` | plataforma | Rastreabilidade: a varredura de eventos (`/`), as opções de filtro (`/filtros`) e o histórico de UMA ficha (`/:modulo/:entidade/:id`). NÃO confundir com `/api/acervo/auditoria`, que roda os invariantes do acervo |
| `/api/metas` | plataforma | Metas do PIT (o plano anual da Divisão), a execução mensal delas (`/execucao`), os anos do plano (`/exercicios`), as revisões com anexo (`/revisoes`) e as demandas Extra-PIT (`/extra`) |
| `/api/rpcmtec` | plataforma | A edição mensal do RPCMTec, o documento e o PDF assinado, o Anuário Estatístico e o RTM/META4 (ODS), mais a capacitação ministrada (módulo `pit`, subseção 2.6) e a recebida (módulo `efetivo`, 6.2) |
| `/api/efetivo` | plataforma | Passagem de cada pessoa pela DGEO, impedimentos e o aproveitamento agregado por semana, mês e ano. O PRÓPRIO aproveitamento tem porta separada (`/meu_aproveitamento`, `/meu_periodo`, `/meu_impedimento`), com o dono saindo do token |
| `/api/acervo` | acervo | Operações do acervo, downloads, visões materializadas |
| `/api/arquivo` | acervo | Upload (do plugin e do navegador), download e catalogação de arquivos. A sessão de upload vencida se renova por `POST /renovar-upload` (dono, mais 24 h), e `GET /upload-web/teto` publica o `UPLOAD_WEB_MAX_GB` para o assistente marcar o arquivo grande antes do primeiro byte |
| `/api/produtos` | acervo | CRUD de produtos e versões, e o quadro da folha do SCN (`/folha`) |
| `/api/projetos` | acervo | Projetos e lotes |
| `/api/volumes` | acervo | Volumes de armazenamento |
| `/api/ponto_controle` | acervo | Pontos de controle geodésico |
| `/api/gerencia` | acervo | Domínios, arquivos excluídos, inconsistências. As três leituras são de `consulta`, pela régua; só `verificar_inconsistencias` é de gerente |
| `/api/dashboard` | acervo | Analytics do acervo |
| `/api/limites` | acervo | Contorno de estado ou município (schema `limites`), para a tela destacar o lugar filtrado |
| `/api/mapoteca` | mapoteca | Clientes, pedidos, relatórios CSV e impressão. O material tem o `movimento_material` (o LIVRO) como única porta de escrita, e o `estoque_material` é só leitura |
| `/api/mapoteca/dashboard` | mapoteca | Analytics da mapoteca |
| `/api/orcamento/dominio` | orcamento | ND, PI, UG, tipo de licitação, classificação de NC, tipo de item de DFD, grau de prioridade |
| `/api/orcamento/configuracao/anos` | orcamento | Anos com dado, para o seletor de ano das telas |
| `/api/orcamento/dfd` | orcamento | DFD e itens (o PCA do ano é o conjunto de DFDs do ano) |
| `/api/orcamento/pdr` | orcamento | Itens do PDR do ano |
| `/api/orcamento/notas_credito` | orcamento | Notas de crédito (NC) |
| `/api/orcamento/recolhimentos` | orcamento | Recolhimento de crédito: um DOCUMENTO do SIAFI por linha, apontando a NC que ele abate |
| `/api/orcamento/notas_empenho` | orcamento | Notas de empenho (NE) |
| `/api/orcamento/liquidacoes` | orcamento | Liquidações de NE |
| `/api/orcamento/recebimentos` | orcamento | Recebimento de material por NE |
| `/api/orcamento/licitacoes` | orcamento | Licitações (GCALC DSG, própria, participante) |
| `/api/orcamento/rpnp` | orcamento | Restos a pagar não processados |
| `/api/orcamento/dashboard` | orcamento | Execução por ND para as abas do painel (números por PDR/Extra-PDR, com linha de total) |
| `/api/orcamento/arquivo` | orcamento | Anexos de NC, DFD e PDR (bytes em `orcamento.arquivo.conteudo`) |
| `/api/equipamento` | equipamento | O material permanente da Divisão (Classe VI e IX): o bem, os tipos, a indisponibilidade, o afastamento, a manutenção, a transferência e o painel. A **situação do bem não é campo**: ela vem de `equipamento.situacao_em(dia)`. `/relatorio/dmt_ods` responde binário |
| `/api/campo` | **pit** | A atividade que a Divisão executa FORA dela: reambulação, voo de drone, ponto de controle, modelo 3D e panorâmica 360. É a fonte da subseção 2.5 do RPCMTec. Prefixo próprio, mas **não é módulo**: a guarda cobra `pit`. `/imagem/:imagemId/arquivo` responde binário |
| `/api/producao` | producao | O CADASTRO da produção: os domínios do fluxo, o catálogo que o QGIS baixa do banco (estilo, regra, menu, tema, alias, modelo, workflow, servidor do FME), a linha de produção, a fase, a subfase, a etapa, as camadas, as `perfil_*` de configuração, o bloco, a unidade de trabalho, a atividade, o dado de produção e o insumo. São seis arquivos de rota, e `producao_route.js` é o índice deles |
| `/api/gerencia_producao` | producao | Pausar, reiniciar, voltar e avançar atividade; furar a fila para uma pessoa ou para um grupo; declarar quem está habilitado a receber o quê; responder ao problema apontado e à alteração de fluxo; e manter o que o cliente de produção precisa ter instalado (versão mínima do QGIS, plugins, atalhos, caminho de atualização) |
| `/api/distribuicao` | producao | A fila do operador: pega a próxima atividade, inicia, finaliza, aponta problema, marca finalização incorreta e manda o metadado de edição. É o que o plugin SAP Operador consome |
| `/api/acompanhamento` | producao | **TODAS de leitura** (não há POST, PUT nem DELETE): lotes e subfases, informações, grade, atividade por subfase e por usuário, situação da subfase, painel do ano, PIT da produção, mapa e projetos. A tile vetorial `/linha_producao/:id/:z/:x/:y.pbf` sai por `verifyLoginTile` |
| `/api/metadados` | producao | O CRUD das 16 tabelas de `metadado`, que alimentam a ficha ET-PCDG, mais as que GERAM a saída (o JSON de edição e o XML), por lote ou por versão. **Rota anônima não existe**: o JSON de edição expõe servidor, porta e nome do banco de edição |
| `/api/microcontrole` | **producao** | A medição do trabalho no QGIS, e o único prefixo que fala com DOIS bancos. Parte lê o banco principal (o tipo de monitoramento e o CRUD de `/configuracao/perfil_monitoramento`) e responde sempre; o resto lê a TELEMETRIA (`/tipo_operacao`, `POST /feicao`, `POST /tela`, `/feicao/resumo`, `/tela/cobertura`, `/tela/aproveitamento`) e responde **503** quando o banco dela não está configurado ou não responde. Prefixo próprio, mas **não é módulo**: a guarda cobra `producao` |
| `/api/perigo` | producao | As rotas que apagam, com o nome herdado do SAP: soltar as atividades de um usuário, apagar o log combinado e apagar unidade de trabalho sem atividade, mais o CRUD de propriedades de camada e de insumo. As três que VARREM exigem repetir no corpo o nome da ação ou o uuid da pessoa. A trilha é UM evento por operação, na pseudo-tabela `producao.zona_perigo` |
| `/api/integracao` | público | Somente leitura, para o vault da DGEO. Sem autenticação (intranet). O `POST /acervo/situacao_geral` é POST pelo tamanho da geometria no corpo, e não por mutar estado |

**A ordem de declaração em `routes.js` importa, e se preserva:** `/api/mapoteca/dashboard` vem antes de `/api/mapoteca`, para o Express casar o prefixo mais específico primeiro, e `/api/gerencia_producao` vem depois de `/api/gerencia`.

O acervo também se **escreve pela interface web**: produto, versão e relacionamento, com a versão Regular entrando pelo assistente de carregamento, que manda metadados e bytes numa requisição só (`POST /api/arquivo/upload-web/versao`). O plugin do QGIS continua sendo o caminho da carga em lote e do arquivo grande. Ver [`docs/decisoes.md`](docs/decisoes.md).

#### Dois nomes do core não são os do SAP, e quem procurar vai tropeçar

**`/api/gerencia` é do ACERVO, e o da produção é `/api/gerencia_producao`**, porque aquele endereço já existia aqui. **`/api/projeto` do SAP virou `/api/producao`**: das 159 rotas de lá, as 13 que falavam de projeto, lote e produto não atravessaram (este sistema já as responde por `/api/projetos` e `/api/produtos`), e o que sobrou é o cadastro da produção. O `GET /tipo_produto` de lá é `GET /api/gerencia/dominio/subtipo_produto` daqui. O cabeçalho de `server/src/routes.js` repete isso ao lado das declarações.

#### O que NÃO existe, e o motivo

Três coisas do SAP 2.3.5 não têm rota aqui, e a ausência é decidida. Detalhe em [`docs/decisoes.md`](docs/decisoes.md).

- **As rotas de permissão de banco** (`PUT /atividades/permissoes` e as duas de `/banco_dados/*` que
  ESCREVEM; a `GET /banco_dados`, que só lista, atravessou): elas exigiriam uma segunda conexão
  ADMINISTRATIVA ao banco de EDIÇÃO. Pelo mesmo motivo o pacote da atividade não traz `login_info`.
- **`GET /projeto_qgis`**, que lê um template `.qgs` (`sap_config_template.qgs`) e interpola nele o
  endereço e a senha do banco. O template não está neste repositório, e trazê-lo é decisão à parte:
  ele é um projeto do QGIS inteiro, com as camadas da produção desenhadas.
- **`DELETE /perigo/produtos_sem_unidade_trabalho` e `DELETE /perigo/lote_sem_produto`**, removidas em
  2026-08-09: aqui o produto e o lote são `acervo.versao` e `acervo.lote`, e o critério selecionaria
  o acervo INTEIRO. `/ut_sem_atividade` fica, e desde 2026-09-05 aceita `lote_id` no corpo para
  limpar SÓ um lote; sem ele a varredura continua global e a resposta conta o que apagou por lote.

**Formato padrão de resposta:**

```json
{ "version": "3.0.0", "success": true, "message": "...", "dados": { }, "error": null }
```

O `version` é o `VERSION` de `server/src/config.js`, e não a versão do banco.

### Segurança

Helmet (CSP desabilitado para servir o SPA e o Swagger UI), limite de 3.000 requisições por 60 segundos por IP (desligado sob `NODE_ENV=test`), CORS habilitado, cache desabilitado, JWT com a expiração de `JWT_EXPIRACAO` (default 8h) e o perfil relido do banco a cada requisição.

**O token vai no cabeçalho `Authorization`, com UMA exceção confinada:** `verifyLoginTile`, a guarda da tile vetorial de acompanhamento (`GET /api/acompanhamento/linha_producao/:id/:z/:x/:y.pbf`), aceita `?token=`, porque o QGIS e o MapLibre montam a URL da tile sem cabeçalho. `server/src/__tests__/routes/login_tile_exclusivo.test.js` varre os `*_route.js` para provar que nenhuma outra rota a usa.

**SEM `hpp`** (proteção contra poluição de parâmetro), e a ausência é deliberada: sob Express 5 ele não faz nada, e se voltasse a funcionar quebraria a busca do acervo, cujos filtros de domínio aceitam o mesmo código repetido na URL de propósito. **Não o recoloque numa próxima auditoria de segurança.** As duas razões estão no cabeçalho de `server/src/server/app.js`, e a prova em `server/src/__tests__/unit/server/hpp_removido.test.js`.

### Tarefas de manutenção

**Não há cron, e não se deve reintroduzir um** (ver [`docs/decisoes.md`](docs/decisoes.md)). O que um agendamento faria acontece por outro caminho.

**Expiração de download.** O token vencido é recusado no momento do uso (`confirmDownload`), tenha alguém limpado ou não. A regra é essa, e não a passada de uma limpeza. A arrumação do que já venceu é `POST /api/acervo/cleanup-expired-downloads` (administrador), que fecha downloads e sessões de upload vencidos e devolve a contagem dos dois.

**Miniaturas.** A geração dispara sozinha **depois** do upload, fora da transação e sem segurar a resposta. A miniatura é a imagem que a ficha do produto mostra: a página inteira do PDF da versão, ou o raster quando não há PDF. Produto só vetorial não tem miniatura. Para o que entra por outros caminhos (carga direta no banco, arquivo trocado no volume), há a varredura manual, com teto de 20 por passada: `GET /api/acervo/miniaturas/pendentes` diz quantas versões esperam, e `POST /api/acervo/miniaturas/varrer` (administrador) paga um lote.

São dois binários e uma biblioteca, e cada um faz o que só ele faz bem: `pdftoppm` (poppler) renderiza PDF, `gdal_translate` mais `gdalinfo` abrem o formato geo, e o `sharp` reduz e codifica. Em Linux é `apt install poppler-utils gdal-bin`; em Windows o GDAL vem dentro do QGIS. Sem os binários a varredura aborta a passada com um erro no log e a rota da miniatura responde 404; nada mais quebra. **O cabeçalho de `server/src/utils/miniatura.js` explica por que cada ferramenta está ali, por que raster de medida (MDS, MDT) é esticado e não cortado, e por que `GDAL_PAM_ENABLED=NO` é forçado.**

Para carregar o acervo já existente de uma vez, em vez de varrer de 20 em 20:

```bash
node scripts/gerar_miniaturas.cjs --limite 50 --embaralhar --dry-run   # ensaio real
node scripts/gerar_miniaturas.cjs --concorrencia 4                     # a carga
```

O `--dry-run` lê o volume e renderiza de verdade, e para só antes de gravar. Falha vira linha de erro em `acervo.miniatura_versao`, para a carga seguinte não repetir o arquivo quebrado; `--refazer-erros` insiste neles. Para refazer o que deu certo, apague as linhas alvo: a miniatura é dado derivado.

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
│
│                         # O core de produção, do SAP 2.3.5 (módulo `producao`):
├── producao/             # O cadastro do fluxo, em 6 arquivos de rota
├── gerencia_producao/    # Distribuir, pausar, habilitar, e o cliente do QGIS
├── distribuicao/         # A fila do operador, que o plugin SAP Operador consome
├── acompanhamento_producao/  # Só leitura: como está indo, mais a tile vetorial
├── metadado/             # As 16 tabelas da ficha ET-PCDG e a geração do XML
├── microcontrole/        # A telemetria do QGIS, em dois bancos
├── perigo/               # A zona de perigo: as rotas que apagam
│
└── utils/                # Utilitários compartilhados
```

Cada feature segue o padrão de 4 arquivos (`index.js`, `*_ctrl.js`, `*_route.js`, `*_schema.js`). O `producao/` é a exceção, e por tamanho: ele se divide em cinco fatias (`dominio_qgis`, `fluxo`, `perfil`, `trabalho`, `insumo`), com `producao_route.js` servindo de índice. A **pasta pode divergir do módulo**, como em `campo/`, que cobra `pit`: `acompanhamento_producao/`, `metadado/`, `microcontrole/` e `perigo/` são todos do módulo `producao`.

---

## Interface web

Uma SPA só, em `client/`, servida na raiz pelo Express. Trocar de módulo é trocar de rota (`#/acervo/...`, `#/mapoteca/...`, `#/orcamento/...`, `#/equipamento/...`, `#/producao/...`), sem recarregar e sem novo login. O seletor mostra só os módulos em que a pessoa tem perfil; quem é administrador global vê todos. As telas do PIT e do efetivo são páginas de PLATAFORMA, fora dos manifestos de módulo (`#/metas`, `#/execucao_pit`, `#/revisoes_pit`, `#/extra_pit`, `#/campo`, `#/aproveitamento`, `#/rpcmtec`, `#/capacitacao_ministrada`, `#/capacitacao_recebida`, `#/rastreabilidade`, `#/usuarios`, `#/acessos`, `#/perfil`).

### As onze telas da produção

Uma por tela do SAP 2.3.5, e a contagem é decisão do chefe de 2026-08-09: houve a proposta de fundir as de acompanhamento e ela foi recusada, porque quem trabalha no SAP procura pelo nome que conhece. A ordem do menu é a do TRABALHO, e não a alfabética.

| Tela | Rota | Quem vê |
|---|---|---|
| Painel | `#/producao` | todos |
| Minha atividade | `#/producao/atividade` | operador e gerente |
| Grade | `#/producao/grade` | consulta e gerente |
| Acompanhamento do lote | `#/producao/lote` | consulta e gerente |
| Atividade por subfase | `#/producao/atividade_subfase` | consulta e gerente |
| Atividades por usuário | `#/producao/atividade_usuario` | consulta e gerente |
| Situação da subfase | `#/producao/situacao_subfase` | consulta e gerente |
| Atividades | `#/producao/atividades` | consulta e gerente |
| PIT da produção | `#/producao/pit` | consulta e gerente |
| Mapas | `#/producao/mapas` | consulta e gerente |
| Microcontrole | `#/producao/microcontrole` | consulta e gerente |

**O módulo `producao` é o único NÃO hierárquico**: `consulta` vê tudo e não escreve nada, `operador` vê duas telas (o Painel e a própria atividade) e `gerente` vê tudo. Por isso as onze rotas do manifesto declaram `perfis` (LISTA) e nenhuma declara `perfil` (mínimo). "Minha atividade" é a única que ESCREVE, e espelha o que o plugin SAP Operador faz no QGIS. Perfil de rota no client é **só ergonomia**: quem barra escrita é o servidor. O porquê está em [`docs/decisoes.md`](docs/decisoes.md).

**Sete telas do SAP 2.3.5 NÃO viraram tela nova, porque já existem aqui**, e não se duplicam: Campos e Gerência de Campos são as duas abas de `#/campo`; Capacitações são `#/capacitacao_ministrada` e `#/capacitacao_recebida`; Extra-PIT é `#/extra_pit`; Efetivo é `#/aproveitamento`; PIT (a parte que não é produção) é `#/metas` mais `#/execucao_pit`; e RPCMTec é `#/rpcmtec`.

```
client/src/js/
├── index.js          # Tema, roteador, layout, rotas de plataforma
├── router.js         # Roteador hash com guardas
├── store/            # auth-store: sessão única, prefixo @sca-*
├── services/         # api-client, cache, plataforma-service, rpcmtec-service,
│                     # campo-service, rastreabilidade-service, producao-service,
│                     # producao-service, microcontrole-service
├── utils/            # dom, formatação, tema, toast, localizador, reconciliar
├── components/       # layout, data-table, modal, form-fields, charts, mapa, tabs,
│                     # wizard, paginação, histórico, filtros, export-bar
├── pages/            # login, usuarios, acessos, perfil, rpcmtec, capacitacao,
│                     # metas, execucao-pit, revisoes-pit, extra-pit, campo,
│                     # aproveitamento, rastreabilidade, 404, não autorizado
└── modules/
    ├── registry.js   # O CONTRATO: como registrar página, pedir dado e declarar perfil
    ├── acervo/       # Dashboard, busca, pontos de controle, cadastro de produto e versão
    ├── mapoteca/     # Clientes, pedidos, material e o livro de movimentos, relatórios
    ├── orcamento/    # DFD, PDR, metas, NC, NE, licitações, RPNP, configuração
    ├── equipamento/  # Bens, tipos, indisponibilidade, afastamento, manutenção, transferência
    └── producao/     # As onze telas do core: painel, minha atividade, acompanhamento,
                      # PIT da produção, mapas e microcontrole
```

Para acrescentar página, leia `client/src/js/modules/registry.js`: um manifesto por módulo declara menu, rotas e perfil mínimo, e o roteador não precisa ser tocado.

```bash
npm run dev-client    # Vite, com proxy /api (portas em SCA_CLIENT_PORT e SCA_API_PORT)
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
| `mapoteca` | cliente, pedido, produto_pedido, impressao_item, anexo_pedido, etiqueta_envio, tipo_material, `movimento_material` (o LIVRO: Entrada, Transferência e Consumo) e `estoque_material` (o saldo, DERIVADO do livro por gatilho e sem porta própria de escrita) |
| `orcamento` | 12 tabelas: dfd, dfd_item, licitacao, pdr_item, nota_credito, nota_empenho, nota_empenho_nota_credito, nota_credito_recolhimento, liquidacao, recebimento_material, rpnp, arquivo |
| `equipamento` | O material permanente: `equipamento` (o bem), `tipo_equipamento` (CADASTRO, não domínio), `indisponibilidade` e `afastamento` (INTERVALOS, com `EXCLUDE USING gist`), `manutencao`, `transferencia` e cinco tabelas de domínio. Não há coluna de situação: quem a responde é a função `situacao_em(dia)` |
| `campo` | A atividade de campo: `campo` (com `geom` MULTIPOLYGON **NOT NULL** e `ano` apontando `pit.pit`), as junções `campo_categoria`, `campo_militar` e `campo_versao` (**opcional**), `imagem` (foto e vídeo em `bytea`), `track` e `track_ponto`, mais `situacao` e `categoria`. A LINHA do trajeto é a view `track_linha`, costurada dos pontos na leitura |
| `pit` | `pit` (o ANO do plano), `meta` e `meta_item`, `revisao`, `meta_item_revisao`, `tipo_anexo_revisao` e `anexo_revisao`, `execucao` (o planejado e o realizado de cada mês) e `demanda_extra` (o Extra-PIT), mais a view `meta_vigente` e a função `meta_em(...)`. **`pit.pit` é o ANO; `macrocontrole.pit` do SAP é a META**, e corresponde ao `pit.meta` daqui |
| `rpcmtec` | `edicao`, `subsecao` e `subsecao_revisao`, `anexo_edicao`, mais `capacitacao` e `capacitacao_militar` (a ENTRADA digitada das subseções 2.6 e 6.2). São **33 subseções** no gerador (`rpcmtec_estrutura.js`), e as CALCULADAS saem de consulta, nunca de linha gravada |
| `auditoria` | `evento`: o rastro de quem mudou o quê. Único schema sem UPDATE e sem DELETE para a aplicação |
| `limites` | `estado`, `municipio` e `area_suprimento` |
| `dominio` | Tabelas de domínio dos módulos, mais `tipo_perfil` e `modulo` (sete linhas) |
| `dgeo` | `usuario`, `usuario_perfil` e `login` (o histórico de acesso, com a coluna `cliente`), mais `efetivo_periodo`, `impedimento` e `instituicao` (a OM que opera a instalação, LINHA ÚNICA pelo `CHECK (id = 1)`) |
| `producao` | O core herdado do SAP 2.3.5: `linha_producao`, `fase`, `subfase`, `etapa` e as regras que as ordenam (`pre_requisito_subfase`, `restricao_etapa`); `bloco`, `unidade_trabalho`, `atividade`, `insumo`, `relacionamento_ut` e `relacionamento_versao`, mais as cinco `habilitacao*` (que no SAP eram `perfil_producao*`). **O lote é o `acervo.lote`**: não há tabela de lote aqui |
| `qgis` | A configuração que o operador recebe no QGIS: estilo, menu, modelo, regra, tema, alias, atalho, workflow, e a versão mínima de cada plugin. Sai de `dgeo`, que aqui é GENTE |
| `metadado` | As 16 tabelas que alimentam a ficha ET-PCDG e a geração do XML. O que no SAP apontava `produto` aponta `acervo.versao` |
| `microcontrole` | O que se MONITORA do trabalho no QGIS: `tipo_monitoramento` (1 feição, 2 tela) e `perfil_monitoramento`. **A telemetria em si NÃO está aqui**: `tipo_operacao`, `monitoramento_feicao` e `monitoramento_tela` vivem num BANCO SEPARADO, instalado por `er_microcontrole/` e apontado pelas chaves `MICRO_DB_*`. Não existe junção entre os dois bancos, e quem cruza é JavaScript |
| `acompanhamento` | Só FUNÇÕES: as 16 que GERAM, em tempo de execução, uma view materializada por par (lote do acervo, linha de produção) e outra por (lote, subfase). Único schema que a aplicação recebe `CREATE`. Não confundir com `er/acompanhamento.sql`, que apesar do nome cria as views materializadas do ACERVO |
| `public` | Versão do banco e `layer_styles`, os estilos de camada que o QGIS lê DIRETO do banco, sem passar pela API |

### Instalação nova

Arquivos em `er/`, nesta ordem: `versao`, `dominio`, `dgeo`, `auditoria`, `limites`, `pit`, `acervo`, `ponto_controle`, `acompanhamento`, `mapoteca`, `orcamento`, `equipamento`, `campo`, `rpcmtec`, `qgis`, `producao`, `metadado`, `acompanhamento_producao`, `microcontrole`, `permissao` e, opcional, `permissao_readonly`. **A ordem é de dependência, e o motivo de cada posição está comentado ao lado da linha correspondente em `create_config.js`.**

`er_microcontrole/` **não entra nessa lista, e não é esquecimento**: ele instala OUTRO banco, o da telemetria, com `versao.sql` e `permissao.sql` próprios. É opcional, nasce vazio e não tem migração nenhuma. Quem o cria é o mesmo `node create_config.js`, quando se responde que sim à pergunta do microcontrole.

`create_config.js` e o `globalSetup` do Jest seguem a mesma ordem. Ao acrescentar arquivo em `er/`, atualize os dois; o `globalSetup` LÊ a ordem do `create_config.js` em vez de copiá-la.

São DOIS números, e eles não são o mesmo: a versão do schema é carimbada em `public.versao` por `er/versao.sql`, e o piso que o boot exige é `MIN_DATABASE_VERSION`, em `server/src/config.js`. Leia os dois arquivos em vez de confiar num número escrito aqui. Eles divergem de propósito, e o porquê está em [`docs/decisoes.md`](docs/decisoes.md).

### Atualização de banco existente

`er/` descreve só a instalação nova. O caminho de atualização vive em `migrations/`, um arquivo por mudança, ensaiado por `migrations/ensaiar_migracao.cjs`. As migrações são aditivas e idempotentes.

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

**`ferramentas_acervo/`** cobre funções gerais (carregar camadas, informações do produto, download, situação geral, busca, relacionamentos entre versões), funções de administrador (adicionar produto, versão histórica, carregar produtos), administração avançada (volumes, projetos, lotes, usuários), operações em lote e diagnóstico (inconsistências, limpeza de downloads, visões materializadas, arquivos com problema, sessões de upload). Na transferência de arquivo, o **download** prepara pela API (recebe token e caminho), o `FileTransferThread` copia (cópia direta no Windows, `smbclient` no Linux) com até 3 tentativas e espera dobrando (2s e 4s), confere o SHA-256 e confirma pela API; o **upload** valida a camada tabular no QGIS, calcula SHA-256 e tamanho, prepara pela API (recebe `session_uuid` e destino), copia e confirma.

**`ferramentas_mapoteca/`** é voltado à operação de impressão: a fila de atendimento (`GET /api/mapoteca/pedido/em_aberto`, ordenada por prazo), os itens de cada pedido com o que falta imprimir, o download dos PDFs das cartas (sequencial, com verificação SHA-256, gravando o manifesto `impressao_<localizador>.csv`) e o registro de impressão por item (quem, quando, quantas cópias), com histórico. Ele usa grupo próprio de `QgsSettings`, com as mesmas chaves do plugin do acervo, mais a pasta de destino dos PDFs. Exige o perfil **operador no módulo mapoteca**, e todas as rotas que usa são de `/api/mapoteca`, inclusive a confirmação do download (`POST /api/mapoteca/impressao/confirmar_download`). Ver [`docs/decisoes.md`](docs/decisoes.md).

---

## CLIs de agente

São **sete**: quatro de MÓDULO (`acervo_cli`, `mapoteca_cli`, `orcamento_cli`, `equipamento_cli`), dois de PLATAFORMA (o `pit_cli`, do PIT e do RPCMTec, e o `efetivo_cli`, de identidade e efetivo) e o `sag_cli`, que é o único que não fala com o SAP 3.0. Todos com dependência zero (sem `node_modules` próprio, para rodar num clone recém-baixado) e contrato lido do Joi vivo do servidor.

```bash
node acervo_cli/acervo.js --ajuda
node mapoteca_cli/mapoteca.js --ajuda
node orcamento_cli/orcamento.js --ajuda
node equipamento_cli/equipamento.js --ajuda
node efetivo_cli/efetivo.js --ajuda
node pit_cli/pit.js --ajuda
node sag_cli/sag.js --ajuda
node orcamento_cli/orcamento.js schema nc             # contrato formatado, do Joi vivo
npm run test-cli                                      # node:test, sem dependência
```

**O módulo `producao` ainda não tem CLI**, e não é pendência esquecida: quem precisar falar com ele hoje usa a API direto, com o mesmo token. **Não confunda com o `pit_cli`**: ele se chamava `producao_cli` até 2026-08-09, e é do PIT e do RPCMTec, não do core de produção.

Os seis do SAP 3.0 compartilham o cache de sessão em `~/.sca`: um login serve todos. Nunca copie contrato para dentro de um CLI: acrescente a entrada em `lib/recursos.js` e o contrato aparece sozinho. O `sag_cli` é o **irmão de fora**: ele só LÊ o SAG (o espelho do SIAFI), para conferir contra ele o que o módulo orçamento guarda, e não escreve em lado nenhum. Sessão em `~/.sag`, e não em `~/.sca`, porque o cookie é de outro sistema.

Eles usam `node:test` e `assert`, e não Jest: dependência zero vale para o teste também. O script `test-cli` do `package.json` da raiz lista os sete, um `__tests__` por CLI.

---

## Scripts

| Script | O que faz |
|---|---|
| `scripts/fumaca.py` | Fumaça pós-deploy, só leitura, sai com 1 se algo falha. Seis seções: plataforma, acervo, mapoteca, orçamento, RPCMTec e as colisões de nome resolvidas pelo prefixo. Ela ainda NÃO cobre `equipamento`, `campo`, `efetivo` nem os sete prefixos do core de **produção** |
| `scripts/check_vazamento.py` | Guard de pre-commit: barra segredo, IP interno e caminho de máquina neste repositório PÚBLICO |
| `scripts/gerar_miniaturas.cjs` | Carga em lote das miniaturas do acervo já existente |
| `scripts/copiar_usuarios_auth.js` | Copia, uma vez, os hashes de senha do banco do Auth Server para o do SAP 3.0 |
| `scripts/carregar_campo_sap.py` | Gera o SQL de carga do schema `campo` a partir do `controle_campo` do SAP |
| `scripts/carregar_equipamento_dmt.py` | Gera o SQL de carga do módulo `equipamento` a partir do Relatório DMT (.ods) |

Os dois últimos GERAM SQL para um caminho **fora** do repositório, escolhido em `--saida`, e recusam apontar para dentro dele: o repositório é PÚBLICO e a carga traz nome de militar, número de patrimônio e coordenada. O arquivo versionado carrega REGRA, nunca DADO.

O detalhe de cada um está em [`scripts/README.md`](scripts/README.md), e `npm run test-scripts` roda os testes do que funciona sem banco (argumentos, plano, relatório).

---

## Licença

MIT
