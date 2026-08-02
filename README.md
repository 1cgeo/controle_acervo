# Controle do Acervo (SCA)

Sistema de gerenciamento de dados geoespaciais produzidos pelo Serviço Geográfico do Exército Brasileiro (DSG/1CGEO). Gerencia produtos geográficos versionados (cartas, ortoimagens, modelos digitais de elevação), seus arquivos, volumes de armazenamento, a mapoteca física e o controle orçamentário da divisão.

Desde 2026-07-27 o SCA absorveu o antigo SCO (Sistema de Controle Orçamentário). São **três módulos na mesma plataforma**: `acervo`, `mapoteca` e `orcamento`, com um servidor, um banco e uma interface web.

Para sua utilização é necessário o [Serviço de Autenticação](https://github.com/1cgeo/auth_server), que valida a senha e é a fonte dos usuários.

> Regras de projeto, decisões de design deliberadas e padrões que todo código novo segue estão em **[`CLAUDE.md`](CLAUDE.md)**. Para subir o ambiente, veja **[`levantar_servico.md`](levantar_servico.md)**.

## Componentes

| Componente | Diretório | Tecnologia | Descrição |
|---|---|---|---|
| **Server** | `server/` | Node.js / Express 5 | API REST com PostgreSQL/PostGIS |
| **Interface web** | `client/` | Vanilla JS / Vite 6 | SPA única, com os três módulos |
| **Plugin QGIS do Acervo** | `ferramentas_acervo/` | Python / PyQt (Qt6) | Catalogação, carga e diagnóstico |
| **Plugin QGIS da Mapoteca** | `ferramentas_mapoteca/` | Python / PyQt (Qt6) | Pedidos ativos, download de PDF e quantitativo impresso |
| **CLIs de agente** | `acervo_cli/`, `mapoteca_cli/`, `orcamento_cli/` | Node (dependência zero) | Um por módulo |

Os três CLIs são irmãos do client web, não scripts auxiliares: o client serve humanos e o CLI serve agentes, sobre a mesma API. Eles leem o contrato do Joi vivo em tempo de execução, e por isso nunca ficam desatualizados em silêncio.

---

## Server (API REST)

### Requisitos

- Node.js >= 16.15
- PostgreSQL com extensão PostGIS
- [Serviço de Autenticação](https://github.com/1cgeo/auth_server) em execução

### Instalação

```bash
npm run install-all   # dependências do servidor e da interface
npm run config        # configuração interativa (cria banco e config.env)
```

O `create_config.js` também aceita flags de linha de comando (`--db-server`, `--db-port`, `--db-name`, `--auth-server-raw`, `--db-create`, ...); rode-o sem argumento para o modo interativo.

### Execução

```bash
cd server && npm run dev        # Desenvolvimento (HTTP, hot-reload por nodemon)
cd server && npm run dev-https  # Desenvolvimento (HTTPS)
npm start                       # Produção (HTTP, via PM2)
npm run deploy                  # Build da interface + PM2 startOrReload + pm2 save
```

O servidor **não inicia** se o Serviço de Autenticação não estiver operacional.

### Testes

A suíte do servidor é dividida em **dois pacotes**, para nem toda mudança cobrar os três minutos da suíte inteira:

```bash
cd server
npm run test:rapido       # ~3s: tudo que NÃO toca o banco (47 suítes, em paralelo)
npm run test:banco        # ~3min: o que precisa de PostgreSQL (29 suítes)
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
| `AUTH_SERVER` | Sim | URL do serviço de autenticação |
| `USE_PROXY` | Não | Usar proxy do sistema nas chamadas ao auth (default `false`) |
| `MINIATURA_PDFTOPPM`, `MINIATURA_GDAL_TRANSLATE`, `MINIATURA_GDALINFO` | Não | Caminho dos binários de miniatura (vazio = procurar no PATH) |
| `UPLOAD_WEB_MAX_GB` | Não | Teto do arquivo que o NAVEGADOR envia ao volume (default 2). Acima dele, o caminho é o plugin |

### Endpoints da API

Todos sob `/api`. Swagger em `GET /api/api_docs` com o servidor no ar.

Desde 2026-07-25 **todo endpoint exige perfil no seu módulo**, por `verifyPerfil(minimo, modulo)`, inclusive os de domínio, que antes eram anônimos. Endpoints de plataforma (usuários, views materializadas, limpeza de download) exigem `verifyAdmin`. As únicas rotas sem autenticação são `/api/integracao/*` e a consulta de pedido por localizador, as duas por decisão registrada no `CLAUDE.md`.

| Prefixo | Módulo | Descrição |
|---|---|---|
| `/api/login` | plataforma | Autenticação (JWT, expiração 1h). Devolve `perfis` e `modulos` |
| `/api/usuarios` | plataforma | Gerenciamento de usuários e concessão de perfil por módulo (admin) |
| `/api/metas` | plataforma | Metas do PIT: o plano anual da Divisão, que os três módulos consomem. Ler exige só login; escrever exige administrador |
| `/api/rpcmtec` | plataforma | RPCMTec inteiro (DOCX), Anuário Estatístico e RTM/META4 (ODS) e a edição mensal. Admin: cruza os três módulos e traz valor de crédito |
| `/api/acervo` | acervo | Operações do acervo, downloads, visões materializadas |
| `/api/arquivo` | acervo | Upload (do plugin e do navegador), download e catalogação de arquivos |
| `/api/produtos` | acervo | CRUD de produtos e versões, e o quadro da folha do SCN (`/folha`) |
| `/api/projetos` | acervo | Projetos e lotes |
| `/api/volumes` | acervo | Volumes de armazenamento |
| `/api/ponto_controle` | acervo | Pontos de controle geodésico |
| `/api/gerencia` | acervo | Domínios, arquivos excluídos, inconsistências |
| `/api/dashboard` | acervo | Analytics do acervo |
| `/api/mapoteca` | mapoteca | Clientes, pedidos, plotters, materiais, relatórios CSV e impressão |
| `/api/mapoteca/dashboard` | mapoteca | Analytics da mapoteca |
| `/api/orcamento/dominio` | orcamento | ND, PI, UG, tipo de licitação, classificação de NC, tipo de item de DFD, grau de prioridade |
| `/api/orcamento/configuracao` | orcamento | Singleton: UASG, CODOM, ano de referência |
| `/api/orcamento/dfd` | orcamento | DFD e itens (o PCA do ano é o conjunto de DFDs do ano) |
| `/api/orcamento/pdr` | orcamento | Itens do PDR do ano |
| `/api/orcamento/notas_credito` | orcamento | Notas de crédito (NC) |
| `/api/orcamento/notas_empenho` | orcamento | Notas de empenho (NE) |
| `/api/orcamento/liquidacoes` | orcamento | Liquidações de NE |
| `/api/orcamento/recebimentos` | orcamento | Recebimento de material por NE |
| `/api/orcamento/licitacoes` | orcamento | Licitações (GCALC DSG, própria, participante) |
| `/api/orcamento/rpnp` | orcamento | Restos a pagar não processados |
| `/api/orcamento/dashboard` | orcamento | Execução por ND para as abas do painel (números por PDR/Extra-PDR, com linha de total) |
| `/api/orcamento/arquivo` | orcamento | Anexos de NC, DFD e PDR (bytes em `orcamento.arquivo.conteudo`) |
| `/api/integracao` | público | Somente leitura, para o vault da DGEO. Sem autenticação (intranet) |

Desde 2026-08-01 o acervo também se **escreve pela interface web**: produto, versão e relacionamento.
A geometria do produto sai do MI/INOM quando a folha é do SCN, e dos cantos quando não é; a versão
Regular entra pelo assistente de carregamento, que manda metadados e bytes numa requisição só
(`POST /api/arquivo/upload-web/versao`): o servidor grava no volume, mede o checksum e NOMEIA o
arquivo pelo padrão do acervo. O plugin do QGIS continua sendo o caminho da carga em lote e do
arquivo grande. Ver o `CLAUDE.md`.

`/api/mapoteca/dashboard` é montada ANTES de `/api/mapoteca` em `routes.js`, para o Express casar o prefixo mais específico primeiro. Preserve essa ordem ao acrescentar rota.

**Formato padrão de resposta:**

```json
{ "version": "1.7.0", "success": true, "message": "...", "dados": { }, "error": null }
```

### Segurança

Helmet (CSP desabilitado para servir o SPA e o Swagger UI), limite de 3.000 requisições por 60 segundos por IP, proteção contra HTTP Parameter Pollution, CORS habilitado, cache desabilitado, JWT com expiração de 1 hora e o perfil relido do banco a cada requisição.

### Jobs agendados

Um cron de hora em hora limpa tokens de download e sessões de upload expiradas.

Outro, na meia hora, gera as **miniaturas** que faltam (até 20 por passada). A miniatura é a imagem que a ficha do produto mostra: a página inteira do PDF da versão, ou o raster quando não há PDF. Produto só vetorial não tem miniatura.

Dois binários e uma biblioteca, e cada um faz o que só ele faz bem:

| Etapa | Ferramenta | Por quê |
|---|---|---|
| Renderizar PDF | `pdftoppm` (poppler) | os substitutos em npm discordam do preenchimento das cartas, arquivo a arquivo, nos dois sentidos |
| Abrir formato geo | `gdal_translate` + `gdalinfo` | é o único que lê ERDAS `.img` (Ortoimagem, 7,4 GB com pirâmides) e GeoTIFF Float32 (MDS/MDT) |
| Reduzir e codificar | `sharp` (npm) | o `-outsize` do GDAL decima por vizinho mais próximo e serrilha o texto da legenda |

Os dois binários extraem ao **dobro** do alvo e o `sharp` faz a redução final, com reamostragem de verdade. Em Linux é `apt install poppler-utils gdal-bin`; em Windows o GDAL vem dentro do QGIS. Sem os binários, a rota da miniatura responde 404 e o job aborta a passada com um erro no log; nada mais quebra.

**Raster de medida é esticado, não cortado.** MDS e MDT guardam ALTITUDE na banda, não intensidade de pixel. Convertidos direto para 8 bits, toda cota acima de 255 m vira branco e a miniatura sai vazia. O gerador detecta a banda que não é de 8 bits e estica por média ± 2,5 desvios, presa ao intervalo real. O `GDAL_PAM_ENABLED=NO` é forçado: sem ele, pedir estatística grava um `.aux.xml` **ao lado do arquivo lido**, dentro do volume do acervo.

Para carregar o acervo já existente de uma vez, em vez de esperar o cron:

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
├── authentication/       # Integração com o serviço de autenticação
├── login/                # JWT, validate_token, verify_perfil, verify_admin
├── acervo/ arquivo/ produto/ projeto/ volume/ ponto_controle/ dashboard/ gerencia/
├── usuario/              # Usuários e perfis (plataforma)
├── pit/                  # Metas do PIT (plataforma)
├── rpcmtec/              # RPCMTec inteiro e Anuário Estatístico (plataforma)
├── mapoteca/             # CRUD da mapoteca, dashboard, relatórios CSV, impressão
├── limites/              # Limite político-administrativo (referência)
├── integracao/           # Rotas públicas para o vault da DGEO
├── orcamento/            # Módulo orçamento (13 features + utils próprio)
└── utils/                # Utilitários compartilhados
```

Cada feature segue o padrão de 4 arquivos (`index.js`, `*_ctrl.js`, `*_route.js`, `*_schema.js`).

---

## Interface web

Uma SPA só, em `client/`, servida na raiz pelo Express. Trocar de módulo é trocar de rota (`#/acervo/...`, `#/mapoteca/...`, `#/orcamento/...`), sem recarregar e sem novo login. O seletor mostra só os módulos em que a pessoa tem perfil; quem é administrador global vê os três.

```
client/src/js/
├── index.js          # Tema, roteador, layout, rotas de plataforma
├── router.js         # Roteador hash com guardas
├── store/            # auth-store: sessão única, prefixo @sca-*
├── services/         # api-client, cache, plataforma-service, rpcmtec-service
├── utils/            # dom, formatação, tema, toast
├── components/       # layout, data-table, modal, form-fields, charts, mapa, tabs, wizard
├── pages/            # login, usuarios, rpcmtec, 404, não autorizado
└── modules/
    ├── registry.js   # O CONTRATO: como registrar página, pedir dado e declarar perfil
    ├── acervo/       # Dashboard, busca, pontos de controle, cadastro de produto e versão
    ├── mapoteca/     # Clientes, pedidos, materiais, estoque, consumo, plotters, relatórios
    └── orcamento/    # DFD, PDR, metas, NC, NE, licitações, RPNP, configuração
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
| `mapoteca` | cliente, pedido, produto_pedido, impressao_item, plotter, estoque_material |
| `orcamento` | 12 tabelas: configuracao, dfd, dfd_item, licitacao, pdr_item, nota_credito, nota_empenho, nota_empenho_nota_credito, liquidacao, recebimento_material, rpnp, arquivo |
| `pit` | `meta`: as metas do PIT do ano. Dado de referência, fora dos módulos |
| `rpcmtec` | `edicao`: o metadado da edição mensal do relatório. As tabelas do relatório são consultas, nunca gravadas |
| `limites` | Limite político-administrativo e área de suprimento |
| `dominio` | Tabelas de domínio dos três módulos, mais `tipo_perfil` e `modulo` |
| `dgeo` | `usuario` e `usuario_perfil` |
| `public` | Versão do banco e estilos de camada do QGIS |

### Instalação nova

Arquivos em `er/`, nesta ordem: `versao`, `dominio`, `dgeo`, `limites`, `pit`, `acervo`, `ponto_controle`, `acompanhamento`, `mapoteca`, `orcamento`, `rpcmtec`, `permissao` e, opcional, `permissao_readonly`.

A ordem tem razões: `limites` vem antes de `acervo`, que não o referencia mas o consulta, e é o primeiro arquivo com geometria (declara o PostGIS); `pit` vem antes de mapoteca e orçamento, que a referenciam.

`create_config.js` e o `globalSetup` do Jest seguem a mesma ordem. Ao acrescentar arquivo em `er/`, atualize os dois. O `globalSetup` LÊ a ordem do `create_config.js` em vez de copiá-la, porque a cópia apodrece.

A versão do schema é **1.11.0**, casada com `VERSION` e `MIN_DATABASE_VERSION` em `server/src/config.js`.

### Atualização de banco existente

`er/` descreve só a instalação nova. O caminho de atualização vive em `migrations/`, um arquivo por mudança, nomeado por data e aplicado em ordem. As migrações são aditivas e idempotentes.

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

Transferência de arquivo: no **download**, prepara pela API (recebe token e caminho), o `FileTransferThread` copia (cópia direta no Windows, `smbclient` no Linux), 3 tentativas com espera exponencial (2s, 4s, 8s), confere o SHA-256 e confirma pela API. No **upload**, valida a camada tabular no QGIS, calcula SHA-256 e tamanho, prepara pela API (recebe `session_uuid` e destino), copia e confirma.

**`ferramentas_mapoteca/`** é voltado à operação de impressão: a fila de atendimento (`GET /api/mapoteca/pedido/em_aberto`, ordenada por prazo), os itens de cada pedido com o que falta imprimir, o download dos PDFs das cartas (sequencial, com verificação SHA-256, gravando o manifesto `impressao_<localizador>.csv`) e o registro de impressão por item (quem, quando, quantas cópias), com histórico, para que operadores diferentes continuem o trabalho em dias distintos. Ele usa grupo próprio de `QgsSettings`, com as mesmas chaves do plugin do acervo, mais a pasta de destino dos PDFs.

Ele exige o perfil **operador no módulo mapoteca**, e todas as rotas que usa são de `/api/mapoteca` — inclusive a confirmação do download (`POST /api/mapoteca/impressao/confirmar_download`), que existe porque a gêmea do acervo cobra perfil no módulo acervo. Ver a seção do plugin no `CLAUDE.md`.

---

## CLIs de agente

Um por módulo, todos com dependência zero (sem `node_modules` próprio, para rodar num clone recém-baixado) e contrato lido do Joi vivo do servidor.

```bash
node acervo_cli/acervo.js --help
node mapoteca_cli/mapoteca.js --help
node orcamento_cli/orcamento.js --help
node orcamento_cli/orcamento.js schema nc             # contrato formatado, do Joi vivo
```

Os três compartilham o cache de sessão em `~/.sca`: um login serve os três. Nunca copie contrato para dentro de um CLI: acrescente a entrada em `lib/recursos.js` e o contrato aparece sozinho.

```bash
npm run test-cli      # os três (node:test, sem dependência)
```

Eles usam `node:test` e `assert`, e não Jest: dependência zero vale para o teste também.

---

## Scripts

| Script | O que faz |
|---|---|
| `scripts/fumaca.py` | Fumaça pós-deploy: os três módulos de ponta a ponta, só leitura, sai com 1 se algo falha |
| `scripts/check_vazamento.py` | Guard de pre-commit: barra segredo, IP interno e caminho de máquina neste repositório PÚBLICO |
| `scripts/gerar_miniaturas.cjs` | Carga em lote das miniaturas do acervo já existente |

---

## Licença

MIT
