# Controle do Acervo (SCA)

Sistema de gerenciamento de dados geoespaciais produzidos pelo Serviço Geográfico do Exército Brasileiro (DSG/1CGEO). Gerencia produtos geográficos versionados (cartas, ortoimagens, modelos digitais de elevação), seus arquivos, volumes de armazenamento, a mapoteca física e o controle orçamentário da divisão.

Desde 2026-07-27 o SCA absorveu o antigo SCO (Sistema de Controle Orçamentário). São **três módulos na mesma plataforma**: `acervo`, `mapoteca` e `orcamento`, com um servidor, um banco e uma interface web.

Para sua utilização é necessário o [Serviço de Autenticação](https://github.com/1cgeo/auth_server), que valida a senha e é a fonte dos usuários.

> Regras de projeto, decisões de design deliberadas e padrões que todo código novo segue estão em **[`CLAUDE.md`](CLAUDE.md)**. Este arquivo é a referência: estrutura, stack, comandos, rotas, banco e instalação.

## Componentes

| Componente | Diretório | Tecnologia | Descrição |
|---|---|---|---|
| **Server** | `server/` | Node.js / Express 5 | API REST com PostgreSQL/PostGIS |
| **Interface web** | `client/` | Vanilla JS / Vite 6 | SPA única, com os três módulos |
| **Plugin QGIS do Acervo** | `ferramentas_acervo/` | Python / PyQt (Qt6) | Catalogação, carga e diagnóstico |
| **Plugin QGIS da Mapoteca** | `ferramentas_mapoteca/` | Python / PyQt (Qt6) | Pedidos ativos, download de PDF e quantitativo impresso |
| **CLI do Acervo** | `acervo_cli/` | Node (dependência zero) | Interface de agente do módulo acervo |
| **CLI da Mapoteca** | `mapoteca_cli/` | Node (dependência zero) | Interface de agente do módulo mapoteca |
| **CLI do Orçamento** | `orcamento_cli/` | Node (dependência zero) | Interface de agente do módulo orçamento |

Os três CLIs são irmãos do client web, não scripts auxiliares: o client serve humanos e o CLI serve agentes, sobre a mesma API. Eles leem o contrato do Joi vivo em tempo de execução, e por isso nunca ficam desatualizados em silêncio.

---

## Server (API REST)

### Requisitos

- Node.js >= 16.15
- PostgreSQL com extensão PostGIS
- [Serviço de Autenticação](https://github.com/1cgeo/auth_server) em execução

### Instalação

```bash
# Instalar dependências do servidor e da interface
npm run install-all

# Configuração interativa (cria banco de dados e config.env)
npm run config

# Ou via flags de linha de comando
node create_config.js --db-server localhost --db-port 5432 --db-user postgres --db-password <senha> --db-name sca --port 3015 --db-create --auth-server-raw https://<auth_server_url> --auth-user <admin> --auth-password <senha>
```

### Execução

> Para subir o ambiente completo (Auth Server, servidor, interface), com ordem de inicialização, smoke tests e troubleshooting, veja **[`levantar_servico.md`](levantar_servico.md)**. O servidor **não inicia** se o Serviço de Autenticação não estiver operacional.

```bash
cd server && npm run dev        # Desenvolvimento (HTTP, hot-reload por nodemon)
cd server && npm run dev-https  # Desenvolvimento (HTTPS)
npm start                       # Produção (HTTP, via PM2)
npm run deploy                  # Build da interface + PM2 startOrReload + pm2 save
```

### Testes

```bash
cd server
npm test                  # Suite completa
npm run test:unit         # Unitários
npm run test:integration  # Integração (exige PostgreSQL)
npm run test:routes       # Rotas
npm run test:coverage     # Cobertura
```

Os testes usam `config_testing.env`. O `globalSetup` (`server/src/__tests__/setup.js`) cria o banco de teste aplicando `er/*.sql` na mesma ordem do `create_config.js`.

### Variáveis de ambiente

Arquivo `server/config.env`, gerado pelo `npm run config`.

| Variável | Tipo | Obrigatória | Descrição |
|---|---|---|---|
| `PORT` | inteiro | Sim | Porta HTTP do servidor |
| `DB_SERVER` | string | Sim | Host do PostgreSQL |
| `DB_PORT` | inteiro | Sim | Porta do PostgreSQL |
| `DB_NAME` | string | Sim | Nome do banco de dados |
| `DB_USER` | string | Sim | Usuário de escrita do banco |
| `DB_PASSWORD` | string | Sim | Senha do usuário de escrita |
| `DB_USER_READONLY` | string | Não | Usuário somente leitura (URI de camada do QGIS) |
| `DB_PASSWORD_READONLY` | string | Não | Senha do usuário somente leitura |
| `JWT_SECRET` | string | Sim | Segredo para assinatura JWT |
| `AUTH_SERVER` | URI | Sim | URL do serviço de autenticação |
| `USE_PROXY` | boolean | Não | Usar proxy do sistema nas chamadas ao auth (default `false`) |

### Endpoints da API

Todos sob `/api`. Swagger em `GET /api/api_docs` com o servidor no ar.

Desde 2026-07-25 **todo endpoint exige perfil no seu módulo**, por `verifyPerfil(minimo, modulo)`, inclusive os de domínio, que antes eram anônimos. Endpoints de plataforma (usuários, views materializadas, limpeza de download) exigem `verifyAdmin`. As únicas rotas sem autenticação são `/api/integracao/*` e a consulta de pedido por localizador, as duas por decisão registrada no `CLAUDE.md`.

| Prefixo | Módulo | Descrição |
|---|---|---|
| `/api/login` | plataforma | Autenticação (JWT, expiração 1h). Devolve `perfis` e `modulos` |
| `/api/usuarios` | plataforma | Gerenciamento de usuários e concessão de perfil por módulo (admin) |
| `/api/acervo` | acervo | Operações do acervo, downloads, visões materializadas |
| `/api/arquivo` | acervo | Upload e download de arquivos |
| `/api/produtos` | acervo | CRUD de produtos e versões |
| `/api/projetos` | acervo | Projetos e lotes |
| `/api/volumes` | acervo | Volumes de armazenamento |
| `/api/gerencia` | acervo | Domínios, arquivos excluídos, inconsistências |
| `/api/dashboard` | acervo | Analytics do acervo |
| `/api/relatorio` | acervo | RPCMTec, seção do acervo |
| `/api/metas` | plataforma | Metas do PIT: o plano anual da Divisão, que os três módulos consomem. Ler exige só login; escrever exige administrador |
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
| `/api/orcamento/relatorio` | orcamento | RPCMTec seção 3 (execução do PDR), tabelas 3.1 a 3.7 |
| `/api/orcamento/arquivo` | orcamento | Anexos de NC, DFD e PDR (bytes em `orcamento.arquivo.conteudo`) |
| `/api/integracao` | público | Somente leitura, para o vault da DGEO. Sem autenticação (intranet) |

`/api/mapoteca/dashboard` é montada ANTES de `/api/mapoteca` em `routes.js`, para o Express casar o prefixo mais específico primeiro. Preserve essa ordem ao acrescentar rota.

**Formato padrão de resposta:**

```json
{
  "version": "1.7.0",
  "success": true,
  "message": "Mensagem descritiva",
  "dados": { },
  "error": null
}
```

### Segurança

- Helmet (CSP desabilitado para servir o SPA e o Swagger UI)
- Limite de 200 requisições por 60 segundos por IP
- Proteção contra HTTP Parameter Pollution (HPP)
- CORS habilitado, cache desabilitado
- JWT com expiração de 1 hora, e o perfil relido do banco a cada requisição

### Jobs agendados

Um cron de hora em hora limpa tokens de download e sessões de upload expiradas.

Outro, na meia hora, gera as **miniaturas** que faltam (até 20 por passada). A
miniatura é a imagem que a ficha do produto mostra: a página inteira do PDF da
versão, ou o TIF quando não há PDF. Ela sai por `pdftoppm` (poppler) e
`gdal_translate`, cujos caminhos vêm de `MINIATURA_PDFTOPPM`,
`MINIATURA_GDAL_TRANSLATE` e `MINIATURA_GDALINFO` (vazio = procurar no PATH, que
é o caso normal em Linux). Sem os binários, a rota da miniatura responde 404 e o
job aborta a passada com um erro no log; nada mais quebra.

Para carregar o acervo já existente de uma vez, em vez de esperar o cron:

```bash
node scripts/gerar_miniaturas.cjs --limite 50 --embaralhar --dry-run   # ensaio real
node scripts/gerar_miniaturas.cjs --concorrencia 4                     # a carga
```

O `--dry-run` lê o volume e renderiza de verdade, e para só antes de gravar.
Falha vira linha de erro em `acervo.miniatura_versao`, para a carga seguinte não
repetir o arquivo quebrado; `--refazer-erros` insiste neles.

### Estrutura do servidor

```
server/src/
├── index.js              # Entry point (verifica versão do Node.js)
├── main.js               # Boot: DB -> auth -> cron -> start
├── config.js             # Configuração com validação Joi (VERSION, MIN_DATABASE_VERSION)
├── routes.js             # Agregador de rotas
├── server/               # App Express, Swagger
├── database/             # Conexão pg-promise, checagem de versão, refresh de views
├── authentication/       # Integração com o serviço de autenticação
├── login/                # JWT, validate_token, verify_perfil, verify_admin
├── acervo/               # Endpoints do acervo
├── arquivo/              # Upload e download de arquivos
├── produto/              # CRUD de produtos
├── projeto/              # Projetos e lotes
├── volume/               # Volumes de armazenamento
├── usuario/              # Usuários e perfis (plataforma)
├── gerencia/             # Domínios e operações de manutenção
├── dashboard/            # Dashboard do acervo
├── relatorio/            # RPCMTec, seção do acervo
├── mapoteca/             # CRUD da mapoteca, dashboard, relatórios CSV, impressão
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
├── services/         # api-client, cache, plataforma-service (login e usuários)
├── utils/            # dom, formatação, tema, toast
├── components/       # layout, data-table, modal, form-fields, charts, tabs, export-bar, wizard
├── pages/            # login, usuarios, 404, não autorizado
└── modules/
    ├── registry.js   # O CONTRATO: como registrar página, pedir dado e declarar perfil
    ├── acervo/       # Dashboard com 4 abas
    ├── mapoteca/     # Clientes, pedidos, materiais, estoque, consumo, plotters, relatórios
    └── orcamento/    # DFD, PDR, metas, NC, NE, licitações, RPNP, relatório, configuração
```

Para acrescentar página, leia `client/src/js/modules/registry.js`: um manifesto por módulo declara menu, rotas e perfil mínimo, e o roteador não precisa ser tocado.

```bash
npm run dev-client    # Vite na porta 3003, com proxy /api para 3015
npm run build         # Builda client/ e copia para server/src/build/
npm run test-client   # vitest + jsdom
```

Convenções: BEM no CSS, tokens de design em `design-tokens.css`, tema claro e escuro por `[data-theme]`, gráficos com Chart.js em chunk separado. Em teste, o `chart.js` é substituído pelo dublê em `components/charts/chart-stub.js`, porque o jsdom não implementa canvas.

---

## Banco de dados

### Schemas

| Schema | Conteúdo |
|---|---|
| `acervo` | projeto, lote, produto, versao, arquivo, download, sessões de upload |
| `mapoteca` | cliente, pedido, produto_pedido, impressao_item, plotter, estoque_material |
| `orcamento` | 13 tabelas: configuracao, dfd, dfd_item, licitacao, pdr_item, nota_credito, nota_empenho, nota_empenho_nota_credito, liquidacao, recebimento_material, rpnp, relatorio_rpcmtec, arquivo |
| `pit` | `meta`: as metas do PIT do ano. Dado de referência, fora dos módulos (saiu de `orcamento` em 2026-07-31) |
| `dominio` | Tabelas de domínio dos três módulos, mais `tipo_perfil` e `modulo` |
| `dgeo` | `usuario` e `usuario_perfil` |
| `public` | Versão do banco e estilos de camada do QGIS |

### Instalação nova

Arquivos em `er/`, nesta ordem:

1. `versao.sql`: versão do banco
2. `dominio.sql`: domínios dos três módulos
3. `dgeo.sql`: usuários e perfis
4. `acervo.sql`: schema principal
5. `acompanhamento.sql`: visões materializadas
6. `pit.sql`: metas do PIT (antes de mapoteca e orçamento, que a referenciam)
7. `mapoteca.sql`: mapoteca
8. `orcamento.sql`: orçamento
9. `permissao.sql`: permissões
10. `permissao_readonly.sql`: opcional, para o papel somente leitura do QGIS

`create_config.js` e o `globalSetup` do Jest seguem a mesma ordem. Ao acrescentar arquivo em `er/`, atualize os dois.

A versão do schema é **1.10.0**, casada com `VERSION` e `MIN_DATABASE_VERSION` em `server/src/config.js`. O servidor recusa subir com banco abaixo do mínimo, e aceita banco à frente.

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

## Plugin QGIS

### Requisitos

- QGIS >= 4.0 (Qt6)
- Servidor SCA em execução

### Instalação

Copie a pasta `ferramentas_acervo/` para o diretório de plugins do QGIS:

| SO | Diretório |
|---|---|
| Windows | `%APPDATA%\QGIS\QGIS4\profiles\default\python\plugins\` |
| Linux | `~/.local/share/QGIS/QGIS4/profiles/default/python/plugins/` |
| macOS | `~/Library/Application Support/QGIS/QGIS4/profiles/default/python/plugins/` |

### Desenvolvimento

Scripts de setup criam symlinks para desenvolvimento live:

```bash
ferramentas_acervo/.dev/setup_dev_windows.bat   # Windows (como administrador)
ferramentas_acervo/.dev/setup_dev_linux.sh      # Linux
ferramentas_acervo/.dev/setup_dev_macos.sh      # macOS
```

### Autenticação

1. O diálogo de login pede URL do servidor, usuário e senha
2. O plugin envia `POST /api/login` e recebe um JWT
3. Em 401, tenta re-autenticar em silêncio com as credenciais salvas
4. "Lembrar-me" persiste as credenciais no `QgsSettings`

### Funcionalidades

| Categoria | Funcionalidades |
|---|---|
| Funções Gerais | Carregar camadas de produtos, informações do produto, download, situação geral, busca, relacionamentos entre versões, configurações |
| Funções de Administrador | Adicionar produto, adicionar produto com versão histórica, carregar produtos |
| Administração Avançada | Volumes, relacionamento volume e tipo de produto, projetos, lotes, usuários |
| Operações em Lote | Arquivos, produtos completos (prepare, transfer, confirm), versões, criação de produtos, versões históricas, relacionamentos |
| Diagnóstico e Manutenção | Inconsistências, limpeza de downloads, visões materializadas, arquivos com problema, arquivos e downloads excluídos, sessões de upload |

### Transferência de arquivos

**Download:** prepara pela API (recebe token e caminho), `FileTransferThread` copia (cópia direta no Windows, `smbclient` no Linux), 3 tentativas com espera exponencial (2s, 4s, 8s), confere o SHA-256 e confirma pela API.

**Upload:** valida a camada tabular no QGIS, calcula SHA-256 e tamanho, prepara pela API (recebe `session_uuid` e destino), copia e confirma.

### Estrutura do plugin

```
ferramentas_acervo/
├── __init__.py           # classFactory(), entry point do QGIS
├── main.py               # Classe principal
├── config.py             # Nome e versão
├── metadata.txt          # Manifesto do QGIS
├── core/
│   ├── api_client.py     # Cliente HTTP (requests + JWT, re-login em 401)
│   ├── settings.py       # Wrapper de QgsSettings
│   ├── file_transfer.py  # Thread de transferência
│   ├── authSMB.py        # Diálogo de credencial SMB (Linux)
│   └── getFileBySMB.py   # Cópia via SMB (Linux)
└── gui/
    ├── panel.py          # PANEL_MAPPING, registro das funcionalidades
    ├── dockable_panel.py # Painel principal
    ├── login_dialog.py   # Login
    └── [uma pasta por funcionalidade]/   # .py + .ui
```

---

## Plugin QGIS da Mapoteca

Plugin separado (`ferramentas_mapoteca/`, QGIS >= 4.0/Qt6, mesma instalação), voltado à operação de impressão:

1. **Login** no mesmo servidor, com re-login automático em 401
2. **Pedidos ativos**, com status de impressão por pedido
3. **Download dos PDFs** das cartas de um pedido, sequencial e com verificação SHA-256, gravando o manifesto `quantitativos_impressao.csv` com o que falta imprimir de cada arquivo
4. **Registro de impressão** por item (quem, quando, quantas cópias), com histórico, para que operadores diferentes continuem o trabalho em dias distintos

Ele usa grupo próprio de `QgsSettings` (`"Mapoteca - Controle do Acervo"`), com as mesmas chaves do plugin do acervo.

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

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Regras do projeto, decisões deliberadas, modelo de autorização, padrões de código |
| [`levantar_servico.md`](levantar_servico.md) | Subir o ambiente, portas, smoke tests, troubleshooting |
| `docs/api_documentation.md` | Documentação dos endpoints |
| `docs/tutorial_configuracao_inicial.md` | Configuração inicial passo a passo |
| `docs/tutorial_client_dashboard.md` | Uso do dashboard web |
| `docs/fluxos_usuario_plugin.md` | Fluxos de usuário do plugin |
| `docs/regras_carga_produtos.md` | Regras de carga de produtos |

---

## Licença

MIT
