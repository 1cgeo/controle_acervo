# CLAUDE.md - SAP (Sistema de Apoio à Produção)

Só o que muda o que você digita. Estrutura, stack, comandos, rotas e banco: `README.md`. Como subir
o ambiente: `levantar_servico.md`. O **porquê** de cada escolha que parece defeito, e o que custou a
alternativa: `docs/decisoes.md`, que é também onde uma decisão nova se registra.

## O nome

O sistema se chamava **Controle do Acervo (SCA)** até 2026-08-09, quando o chefe decidiu que ele
passa a ser o **SAP**, **Sistema de Apoio à Produção**, e que o SAP 2.3.5 (outro repositório) será
aposentado com todo o conteúdo dele vindo para cá.

**O nome é "SAP", sem número.** O **3.0** é a VERSÃO do serviço, não parte do nome: ele vive em
`VERSION` (`server/src/config.js`) e em `public.versao`, e em lugar nenhum do rótulo. A versão
CONTINUA a numeração do sistema aposentado em vez de abrir série nova, justamente para que a de cá
e a de lá se comparem número a número.

- **O que mudou é RÓTULO:** `README.md`, `levantar_servico.md`, este arquivo, o `<title>` e o
  cabeçalho do client, a mensagem de `GET /api`, o erro do login, o Swagger, o `description` dos
  `package.json` e os READMEs dos sete CLIs.
- **O que NÃO mudou, e é deliberado:** o schema `acervo`, o módulo `acervo` de `dominio.modulo`
  (code 1, `nome_abrev` = `acervo`), o `acervo_cli` e as rotas `/api/acervo/*`. **O acervo é uma
  PARTE do SAP, e não o todo.** Também não mudaram o nome do banco, as chaves `SCA_*` de
  ambiente, o cache de sessão dos CLIs em `~/.sca`, o processo PM2 `controle-acervo`, o `name` dos
  `package.json`, o diretório do repositório nem os remotes de git: são IDENTIFICADORES.
- **`sca_web` e `sca_qgis` continuam aceitos no login**, ao lado de `sap_web`, `sap_fp` (SAP
  Operador) e `sap_fg` (SAP Gerente). Recusá-los derrubaria no deploy todo cliente que já está no
  ar, e `dgeo.login.cliente` guarda os nomes antigos no histórico inteiro.
- **Comentário de código e migração antiga que dizem "SCA" NÃO se reescrevem.** Migração é registro
  histórico, pela mesma razão que a trilha de `auditoria.evento` é append-only.
- **"SAP" sozinho quer dizer ESTE sistema, e o aposentado SEMPRE leva o número.** Ao escrever sobre
  o sistema de lá, diga **"SAP 2.3.5"**, com a versão, toda vez. Onde os dois aparecem no mesmo
  parágrafo, o desempate é o NÚMERO DE VERSÃO nos dois lados: **3.0.0** é o que roda aqui, **2.3.5**
  é o que está sendo aposentado. Ao LER, cuidado com a prosa da travessia (`er/producao.sql`,
  `er/metadado.sql`, `er/qgis.sql`, `er/acompanhamento_producao.sql`, os testes de
  `__tests__/routes/producao/`): lá "SAP" sozinho quer dizer o **2.3.5**, e essas linhas ficam como
  estão.

## Não se negocia

- **NUNCA crie commit.** Quem revisa e commita é o usuário. Só rode `git add`, `git commit` ou
  `git push` se ele pedir naquela mensagem.
- **O repositório é PÚBLICO.** Em arquivo versionado, nunca escreva endereço de servidor, IP interno,
  porta acoplada a host, pasta de rede, caminho de máquina (letra de unidade, UNC) nem segredo com
  valor. Cite a **CHAVE** do `server/config.env`, que é gitignored; o catálogo sem valor nenhum está
  em `.env.example`. O guard `scripts/check_vazamento.py` cobra no pre-commit, e numa máquina que não
  rodou `git config core.hooksPath .githooks` ele nem liga.
- **Senha nunca em claro, e nunca de volta por rota.** O único lugar que gera e confere o hash bcrypt
  de `dgeo.usuario.senha` é `login/senha.js`.
- **`er/` é instalação NOVA.** Atualizar banco existente é arquivo em `migrations/`, ensaiado por
  `migrations/ensaiar_migracao.cjs`.
- **Não invente campo** que não está no DDL nem no schema Joi. Marque como pendência.
- **Não introduza** ORM, TypeScript no servidor, framework de front, Docker ou biblioteca de UI, e
  não ressuscite a SPA React da mapoteca nem os clients por módulo (`acervo_client`,
  `mapoteca_client`), apagados de propósito: a interface é UMA. Mudar isso é decisão, e decisão se
  registra em `docs/decisoes.md`.
- **Decisão de desenho não se conserta sozinha.** Se algo em `docs/decisoes.md` parece defeito, fale
  com o chefe antes de mexer.

## Autorização

```
dgeo.usuario.administrador BOOLEAN   -- administrador de TUDO, global e unico
dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
dominio.tipo_perfil   -- 1 consulta, 2 operador, 3 gerente (hierarquicos)
dominio.modulo        -- 1 acervo, 2 mapoteca, 3 orcamento, 4 pit, 5 efetivo, 6 equipamento,
                      -- 7 producao (o core herdado do SAP 2.3.5, com rota e tela desde a 3.0.0)
```

> **Armadilha que já custou caro:** o default de `verifyPerfil(minimo, modulo)` é `'acervo'`. Rota de
> outro módulo que esquece o segundo argumento passa a cobrar perfil no ACERVO, sem erro visível.
> `server/src/__tests__/routes/modulo_em_toda_rota.test.js` varre `orcamento`, `mapoteca`,
> `equipamento`, `campo` (que cobra `pit`), `producao` e `microcontrole` (que também cobra
> `producao`), e os quatro outros módulos do core têm varredura própria ao lado deles
> (`routes/producao/perfil.test.js`, `routes/gerencia_producao/perfil.test.js`,
> `routes/metadado/modulo_na_rota.test.js` e as de `distribuicao`, `acompanhamento_producao` e
> `perigo`). **Em `efetivo` e no resto de `pit`, ninguém cobra por você.**

- **`dominio.modulo.nome` é RÓTULO, e trocar é inocente. `nome_abrev` é IDENTIFICADOR:** o
  `verifyPerfil`, o mapa `MODULO`, o prefixo de rota e a chave dos `perfis` o comparam por igualdade
  de string, e trocá-lo derruba a autorização sem erro de sintaxe e sem teste vermelho. O rótulo do
  MENU já não é uma terceira coisa: o code 4 se chamava `producao` até 2026-08-09, e virou `pit`
  para devolver o nome ao core de produção herdado do SAP 2.3.5, que entrou como Produção (code 7)
  na 3.0.0. A **pasta** ainda pode divergir do módulo (`server/src/campo/` cobra `pit`, e
  `server/src/microcontrole/` cobra `producao`).
- **A régua, de 2026-08-08:** `consulta` LÊ as telas do módulo, `operador` LANÇA, `gerente` responde
  pela área e vê tudo dela. Rota nova escolhe o piso por essa frase, e não por costume. As duas
  exceções são deliberadas: a lista NÃO hierárquica (`perfis: ['consulta','gerente']`, lida por
  `ehDeAlgumPerfil` e nunca por `temPerfil`, para a tela que o operador não vê) e
  `#/acervo/administracao`, do ADMINISTRADOR, a única tela que o gerente da área não alcança.
- **`producao` INVERTE a régua acima, e o módulo INTEIRO é não hierárquico** (chefe, 2026-08-09):
  `consulta` VÊ TUDO e não modifica nada, `operador` vê DUAS telas (o Dashboard e a própria
  atividade), `gerente` vê tudo e mexe em tudo. **O visualizador não é um operador rebaixado**: ele é
  quem acompanha a produção de cima, e o operador é quem executa. Por isso as onze rotas do
  manifesto declaram `perfis` (LISTA) e **nenhuma** declara `perfil` (mínimo): com o mínimo, o
  operador voltaria a ver tudo por ser um nível acima, sem erro nenhum. O servidor NÃO cobra esse
  recorte, porque `verifyPerfil` só compara nível; ele é do client, e o que o servidor barra é a
  ESCRITA. Quem faz cumprir é `client/src/js/modules/producao/index.test.js`.
- **`verifyPerfil` lê o BANCO a cada requisição**, e não o token: rebaixar perfil vale na hora.
  `administrador` é global e curto-circuita qualquer módulo, e não existe administrador de módulo.
  Quem não tem linha para um módulo não o acessa, e conceder é ato explícito.
- **Ter conta não é ter acesso.** Sem perfil em módulo nenhum, a pessoa alcança só a própria página
  (`#/perfil`, `/usuarios/perfil` e a própria senha), e lê ali que o acesso se pede ao ADMINISTRADOR.
  Rota de PLATAFORMA escolhe a guarda entre `verifyLogin` (a própria conta), `verifyAcesso` (perfil
  em ALGUM módulo), `verifyGerente` (gerente de qualquer módulo, mais `verifyModuloSubsecao()` para
  ESCREVER subseção do RPCMTec) e `verifyAdmin` (usuários, meta e revisão do PIT, fechar o RPCMTec,
  views materializadas, limpeza de download).

- **`pit.pit` é o ANO, e o `macrocontrole.pit` do SAP 2.3.5 é a META.** A tabela se chamava
  `pit.exercicio` até 2026-08-09. **O homônimo NÃO se materializou:** o core atravessou na 3.0.0 e o
  `macrocontrole.pit` de lá ficou, porque o que ele diz já mora aqui (`pit.meta`, mais o vínculo por
  `acervo.versao.meta_pit_id`, que aponta `pit.meta_item`). Não existe, e não deve nascer, uma
  segunda tabela `pit` neste banco.
- **A entidade de auditoria de `pit.pit` continua `exercicio`**, e não acompanhou o nome da tabela:
  `auditoria.evento.entidade` é texto gravado no evento, e a trilha é append-only.

## Ao escrever código

- Escrita que muda dado vive em `db.conn.tx()`, com **`auditoriaCtrl.registrar(t, {...})` na MESMA
  transação**: falhar ao auditar derruba a escrita, e é deliberado.
- **Dia de calendário é `Joi.date().iso().raw()`**, nunca `Joi.date()`. Sem o `.raw()` a coluna
  guarda o dia anterior em UTC-3; sem o `.iso()`, '01/08/2026' vira 8 de janeiro.
- **Rota literal ANTES de rota com parâmetro:** o Express casa na ordem de declaração, e `/perfil`
  cairia em `/:uuid`.
- Toda resposta sai por `res.sendJsonAndLog()`, e todo erro por `AppError` mais `asyncHandler`.
- Código de tabela de domínio vem de `utils/domain_constants.js`, nunca número mágico no SQL.
- Página nova no client segue o contrato de `client/src/js/modules/registry.js`. Perfil de rota no
  client é **só ergonomia**: quem barra escrita é o `verifyPerfil` no servidor.
- **Uma chamada que falha num `Promise.all` derruba a TELA INTEIRA**, e a mensagem que sobra é a
  dela. Mordeu três vezes em 2026-08-08: `#/aproveitamento` morria dizendo "necessita ser um
  administrador" porque a quarta chamada era `verifyAdmin`, e a lista de DFD morreria com 404 de uma
  rota de domínio apagada. Chamada de outro módulo, de outra guarda ou opcional carrega SOZINHA, com
  o próprio `catch`, e a falha dela fica na seção dela.
- `npm run test:rapido` no dia a dia e `npm run test:banco` antes de commitar, os dois em `server/`.
  Teste de schema prova o MOTIVO da recusa (`recusaPor`, de `__tests__/helpers/joi.js`), nunca só
  que houve recusa. O cliente é vitest, não jest.
- **Caso que fala de mês, prazo ou "hoje" CONGELA o relógio no arquivo inteiro**, nunca dentro de um
  `describe`. `npm run test:relogio` em `client/` roda a suite num dia escolhido (`SONDA_DATA`) e é
  quem acha o caso que só passa porque hoje é hoje: três caíram em 04/09/2026 sem uma linha de código
  ter mudado, um deles com um comentário afirmando um congelamento que não existia.
- **`npm audit fix --force` quebra o boot:** `archiver` fica na 7, e os `overrides` do
  `server/package.json` são o que zera a auditoria.

## Convenções

- Servidor: CommonJS, `'use strict'`, SQL parametrizado por nome do pg-promise (`$<param>`).
- Client: Vanilla JS com módulos ES, sem framework e sem TypeScript, `el()` de `utils/dom.js`, BEM no
  CSS, tokens de `design-tokens.css`, tema por `[data-theme]`.
- CLI: dependência ZERO, e o contrato vem do **Joi vivo** em tempo de execução. Nunca copie contrato
  para dentro de um CLI.
- **Toda string de interface e de erro em português do Brasil.** Coluna de banco em `snake_case` sem
  acento, variável JS em `camelCase`, Python em `snake_case`.
- Sem em-dash em nada, acentuação correta fora de código, e data absoluta (2026-08-08) no lugar de
  "ontem".

## Regras de negócio que o código não impede

- **O saldo de material é DERIVADO do livro** (`mapoteca.movimento_material`: 1 Entrada, 2
  Transferência, 3 Consumo), por gatilho: `estoque_material` não tem porta de escrita, e abrir uma
  faz a soma do livro deixar de bater com o saldo no primeiro uso. É o saldo de HOJE: o "estoque do
  mês anterior" da 7.2 vem da EDIÇÃO FECHADA anterior, nunca de saldo atual mais consumo.
- **NÃO EXISTE movimento de AJUSTE de saldo, e a ausência é a regra.** O code 4 era a Contagem,
  extinta em 2026-08-08: o saldo tem de estar certo pelos três acima, e lançamento errado se conserta
  EDITANDO ou apagando a linha errada, porque o gatilho desfaz o efeito dela. **São TRÊS codes, e o 4
  não existe nem no domínio** desde a 1.48.0. Recusam-no TRÊS: o Joi, o `ELSE FALSE` do CHECK
  `movimento_material_forma` e a chave estrangeira. Quem aparece no erro é o CHECK, porque ele é
  avaliado durante o INSERT e o gatilho da FK só depois. Ressuscitar o tipo é decisão, e decisão se registra em
  `docs/decisoes.md`.
- **No orçamento não existe "exercício", "PCA" nem cabeçalho de "PDR":** tudo se amarra ao **ano**
  (coluna `ano SMALLINT`, sem FK).
- **`campo.ano` é a EXCEÇÃO a isso, e aponta `pit.pit`** (chefe, 2026-08-08), ao contrário de
  `rpcmtec.capacitacao.ano`, que é solto pelo motivo oposto. Campo de ano sem exercício é RECUSADO
  pela FK, e é o comportamento desejado: quem cria os exercícios que faltam é a carga do SAP, e não
  a migração. `campo.geom` é NOT NULL pela mesma decisão, e a carga PARA em vez de inventar polígono.
- **A numeração de `pit.meta` não é estável entre anos:** guarde o `id`, nunca o código.
