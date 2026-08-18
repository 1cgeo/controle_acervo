'use strict'

const dotenv = require('dotenv')
const Joi = require('joi')
const fs = require('fs')
const path = require('path')

const AppError = require('./utils/app_error')
const errorHandler = require('./utils/error_handler')

const configFile =
  process.env.NODE_ENV === 'test' ? 'config_testing.env' : 'config.env'

const configPath = path.join(__dirname, '..', configFile)

if (!fs.existsSync(configPath)) {
  errorHandler.critical(
    new AppError(
      'Arquivo de configuração não encontrado. Configure o serviço primeiro.'
    )
  )
}

dotenv.config({
  path: configPath
})

// `MIN_DATABASE_VERSION` é o PISO do banco, e sobe junto com toda migração que
// acrescenta schema, tabela ou coluna que o código passa a ler. Banco abaixo do
// piso não sobe o serviço (`database/database_version.js`). O carimbo do banco
// mora em `public.versao` e é escrito por cada migração.
//
// MIGRAÇÃO QUE SÓ REMOVE NÃO SOBE O PISO. A 1.26.0 apaga uma função e um índice
// que o código nunca leu, então um banco carimbado 1.25.0 roda esta versão sem
// faltar nada. Subir o piso obrigaria toda instalação a migrar para não ganhar
// nada.
//
// A 1.27.0 SOBE O PISO, porque é o caso oposto: ela acrescenta `data_prevista`
// em `acervo.versao`, `rpcmtec.capacitacao` e `mapoteca.pedido`, e o cálculo do
// planejado do PIT passa a LER as três. Num banco 1.26.0 a grade quebraria com
// "coluna data_prevista não existe", que é erro de 500 sem explicação.
//
// A 1.28.0 SOBE O PISO por um motivo diferente: ela não acrescenta coluna, ela
// muda o que `pit.meta_vigente` DEVOLVE. A meta que revisão publicada nenhuma
// declarou deixa de sair da view. Num banco 1.27.0 o serviço rodaria sem erro e
// mostraria linha em branco no PIT do ano, que é pior do que falhar.
//
// A 1.29.0 SÓ REMOVE (`mapoteca.midia_meta_pit`) e não subiria o piso sozinha.
// Ela entra de carona na 1.30.0, que é a maior mudança de schema do PIT: a meta
// vira GRUPO, o item vira `pit.meta_item` e a declaração vira
// `pit.meta_item_revisao`. O piso SOBE porque não há como o código servir os
// dois formatos: num banco 1.29.0 toda consulta do PIT falharia com "relação
// pit.meta_item não existe", e as cinco chaves estrangeiras de trabalho ainda
// apontariam a tabela errada. Aqui o piso é o próprio contrato.
// A 1.31.0 SOBE O PISO, e por REMOÇÃO de coluna. É a exceção à regra do
// parágrafo da 1.26.0: remover só não sobe o piso quando o código nunca leu o
// que saiu, e aqui ele lia. `orcamento.nota_credito.meta_pit_id` sai, e a meta
// da NC passa a ser lida por JOIN através de `orcamento.pdr_item`. Num banco
// 1.30.0 este código gravaria a NC sem a coluna que lá ainda é a única fonte da
// meta, e a grade do PIT somaria crédito por um caminho que lá não existe: a
// tela mostraria zero onde há dinheiro. O contrário também quebra, e mais cedo:
// um servidor 1.30.0 contra um banco 1.31.0 falha no INSERT da NC, porque a
// coluna não está mais lá.
//
// A 1.32.0 SOBE O PISO. O rascunho do envio pelo plugin sai de três tabelas
// espelho (`upload_produto_temp`, `upload_versao_temp`, `upload_arquivo_temp`) e
// passa a viver em `acervo.upload_session.payload`, um JSONB. Este código lê e
// escreve só a coluna nova: num banco 1.31.0 todo `prepare-upload` falharia com
// "coluna payload não existe". O contrário quebra igual, e mais tarde: um
// servidor 1.31.0 contra um banco 1.32.0 gravaria a sessão e procuraria as
// tabelas espelho, que lá não existem mais.
//
// A 1.33.0 SOBE O PISO, e ela só acrescenta duas linhas de domínio
// (`dominio.modulo` ganha 4 Produção e 5 Efetivo). Sobe porque este código passa
// a LER esses códigos: o mapa `MODULO` de `login/verify_perfil.js` traduz
// 'pit' para 4 e 'efetivo' para 5, e as rotas da execução do PIT, do
// Extra-PIT, da capacitação e do efetivo trocaram `verifyAdmin` por
// `verifyPerfil(..., 'pit')` e `verifyPerfil(..., 'efetivo')`.
//
// Num banco 1.32.0 nada quebraria com erro, e é justamente esse o motivo de
// cobrar o piso: sem as linhas 4 e 5, a chave estrangeira
// `dgeo.usuario_perfil.modulo_id` recusa toda concessão nesses módulos, e
// ninguém além do administrador global consegue entrar naquelas telas. O
// sistema subiria, a tela de usuários mostraria três colunas em vez de cinco, e
// o chefe concluiria que a permissão nova não funciona.
// A 1.34.0 SOBE O PISO por REMOÇÃO, como a 1.31.0. `orcamento.configuracao`
// some, e com ela as rotas `GET /` e `PUT /` do módulo. Este código nunca mais
// consulta a tabela, então ele roda inteiro num banco 1.33.0; o que quebra é o
// contrário, e sem barulho: um servidor 1.33.0 contra um banco 1.34.0 abriria a
// tela de Configuração, chamaria o `GET /`, tomaria "relação não existe" e
// mostraria a falha de carga. Pior, o `PUT /` daria o mesmo erro DEPOIS de o
// administrador digitar. Piso cobrado para o par ficar sempre casado.
//
// A 1.35.0 SOBE O PISO, e também por REMOÇÃO. `acervo.lote.data_fim_prevista`
// sai, e este código deixa de lê-la e de escrevê-la: ela some do SELECT de
// `getLotes`, dos dois ColumnSet e da lista do `preserveOmitted`.
//
// Um servidor 1.34.0 contra um banco 1.35.0 quebra em toda listagem de lote,
// com "coluna data_fim_prevista não existe", e a tela de projetos fica sem a
// aba. O contrário não quebra, mas mente: este código nunca mais grava a coluna,
// então num banco 1.34.0 ela congelaria com os valores de hoje, e quem a
// consultasse por fora leria promessa velha como se fosse atual.
//
// A 1.36.0 SOBE O PISO, e é o caso simples: ela ACRESCENTA
// `rpcmtec.subsecao_revisao`, e este código passa a ler e escrever a tabela em
// toda montagem de edição e no fechamento. Num banco 1.35.0 a tela do RPCMTec
// falharia com "relação não existe" logo na abertura.
// A 1.37.0 SOBE O PISO. Ela acrescenta `mapoteca.produto_pedido.meta_pit_id`, e
// as três consultas da impressão passam a ler a coluna em todo cálculo da
// execução do PIT. Num banco 1.36.0 a grade da meta 4 falharia com "coluna não
// existe" na abertura da tela do PIT.
//
// A 1.38.0 SOBE O PISO pelo mesmo motivo, com um detalhe a mais: ela acrescenta
// a mídia Sulfite 75g (code 9), e o code entra no `TIPO_MIDIA` que o Joi usa
// para validar. Num banco 1.37.0 este código ACEITARIA o 9 no corpo e o banco o
// recusaria pela chave estrangeira, ou seja, 500 onde deveria haver cadastro.
//
// A 1.41.0 SOBE O PISO, e as 1.39.0 e 1.40.0 no meio do caminho não subiam
// (só removiam). Ela ACRESCENTA `mapoteca.movimento_material` e
// `mapoteca.tipo_movimento_material`, e este código passa a ler o livro em toda
// tela de material, no painel de consumo e na coluna "Consumo no mês" da 7.2 do
// RPCMTec. Ela também APAGA `mapoteca.consumo_material` e três colunas de
// `tipo_material`, e este código já não as escreve: num banco 1.40.0 as telas
// falhariam com "relação não existe" na abertura, e não numa borda rara.
// A 1.42.0 NAO SUBIU O PISO (poda do pedido: nada nasceu, e o filtro novo le uma
// coluna que existe desde a instalacao).
//
// A 1.43.0 SOBE O PISO, e por REMOCAO, como a 1.31.0 e a 1.35.0. A regra do
// paragrafo da 1.26.0 diz que remover so nao sobe o piso quando o codigo nunca
// leu o que saiu, e AQUI ELE LIA todas: `orcamento.dfd.valor_estimado`,
// `dfd_item.valor_total`, `pdr_item.gnd`, `nota_credito.marcador`,
// `licitacao.nup` e `licitacao.fornecedor` estavam nos SELECT, nos INSERT e nos
// UPDATE de cinco controladores, mais `dfd.grau_prioridade_id` com o JOIN em
// `dominio.grau_prioridade`, que saiu inteira.
//
// Um servidor 1.42.0 contra um banco 1.43.0 quebra na ABERTURA de quatro telas
// (DFD, PDR, Notas de Credito e Licitacoes), com "coluna nao existe", e nao numa
// borda rara. E ele quebra tambem em toda gravacao de NOTA DE EMPENHO, e essa e
// a metade que importa mais: a 1.43.0 poe `NOT NULL` em `nota_empenho.ug` e
// `gestao`, e o servidor 1.42.0 nao escreve nenhuma das duas.
//
// O contrario tambem quebra, e sem barulho, que e pior: este codigo GRAVA `ug` e
// `gestao` desde a 1.43.0, e num banco 1.42.0 (onde as colunas existem, mas
// anulaveis) ele funcionaria -- so que o `NOT NULL` que torna a protecao real
// nao estaria la, e qualquer outra porta de escrita voltaria a produzir NE com
// UG nula, que no Postgres nao colide com nada num indice unico. Piso cobrado
// para o par ficar sempre casado.
//
// A 1.44.0 NÃO SOBE O PISO, e ela é a poda da grade do PIT: `pit.execucao`
// perde `data_conclusao` e `observacao`, o CHECK `execucao_diz_alguma_coisa`
// encolhe de quatro termos para dois, e 19 lançamentos manuais em item de
// origem calculada são apagados (com os 19 eventos `D` gravados na auditoria
// antes do DELETE).
//
// Ela cai na regra do parágrafo da 1.26.0, e não na exceção da 1.31.0: aqui
// nada nasce, e este código PAROU de ler as duas colunas ANTES de elas caírem.
// Elas saíram do Joi, da CTE `celula`, da grade, do `listarDaMeta`, do merge do
// `salvar` e do mapa de auditoria na mesma versão. Um banco 1.43.0, que ainda as
// tenha, serve este servidor inteiro: nenhuma consulta as cita, e as colunas
// sobrando apenas ficam paradas. Subir o piso obrigaria toda instalação a migrar
// para não ganhar nada, que é exatamente o que o parágrafo da 1.26.0 recusa.
//
// A única assimetria num banco 1.43.0 é o CHECK antigo, de quatro termos,
// aceitar uma linha que o novo recusa -- e ninguém tem porta para criar essa
// linha, justamente porque os dois campos saíram do contrato desta versão.
//
// O SENTIDO CONTRÁRIO QUEBRA, e o piso não é o que o resolveria: um servidor
// 1.43.0 contra um banco 1.44.0 falha em toda leitura da grade, porque lá as
// duas colunas ainda estão nos SELECT. `MIN_DATABASE_VERSION` só cobra "o banco
// é novo o bastante para ESTE código", e não o oposto; quem casa o outro lado é
// implantar o servidor junto com a migração, que é como o serviço sobe.
// A 1.46.0 SOBE O PISO, e é o caso simples da regra: ela ACRESCENTA um schema
// inteiro. `equipamento` nasce com seis tabelas de dado (`tipo_equipamento`,
// `equipamento`, `indisponibilidade`, `afastamento`, `manutencao`,
// `transferencia`), cinco de domínio e a função `equipamento.situacao_em(dia)`,
// e este código LÊ as doze em toda tela do módulo novo.
//
// Num banco 1.45.0 nada disso existe: a primeira requisição a `/api/equipamento`
// falharia com "relação equipamento.equipamento não existe", e o painel, a ficha
// do bem e o Relatório DMT quebrariam na abertura, não numa borda rara.
//
// E há a metade que quebra CALADO, que é a que obriga o piso: a 1.46.0 também
// acrescenta a linha 6 em `dominio.modulo`. Sem ela, a chave estrangeira
// `dgeo.usuario_perfil.modulo_id` recusa toda concessão de perfil no módulo, e
// ninguém além do administrador global alcança as telas. O sistema subiria, a
// tela de usuários mostraria cinco colunas em vez de seis, e o chefe concluiria
// que a permissão nova não funciona. É exatamente o que aconteceu na 1.33.0, com
// produção e efetivo, e o piso é o que impede que se repita.
//
// O piso pula da 1.43.0 direto para a 1.46.0: as 1.44.0 e 1.45.0 no meio do
// caminho não subiam (poda da grade do PIT e o livro de movimentos do material).
//
// A 1.49.0 SOBE, e as 1.47.0 e 1.48.0 no meio não subiam. O schema `campo`
// nasce nela, e sem ele não é uma tela que degrada: é `/api/campo` inteira
// respondendo 500 por relação inexistente, e a subseção 2.5 do RPCMTec, que
// passou a ser CALCULADA, deixando de sair. Piso baixo aqui daria um servidor
// que sobe e um relatório que não fecha.
// A 1.50.0 SOBE O PISO, e ela SÓ RENOMEIA. É a exceção mais dura à regra do
// parágrafo da 1.26.0: renomear não acrescenta nem remove nada, e mesmo assim
// não há como este código servir os dois nomes.
//
// Ele lê `pit.pit`, e num banco 1.49.0 toda consulta do PIT falha com "relação
// não existe" -- o plano do ano, a revisão, a execução, o Extra-PIT e o campo.
// E o mapa `MODULO` de `login/verify_perfil.js` traduz 'pit' para 4, contra um
// `dominio.modulo` que ainda diz 'producao': a autorização do módulo 4 recusaria
// todo mundo, sem erro nenhum na tela.
//
// O contrário quebra igual: um servidor 1.49.0 contra um banco 1.50.0 procura
// `pit.exercicio`, que já não existe.
// `VERSION` é a versão do SERVIÇO, e sai em `version` de TODA resposta da API e
// na linha de boot. Ela ficou parada em 1.38.0 enquanto o banco chegou a 1.50.0,
// e a defasagem só apareceu porque alguém foi ler a constante: nada a ligava a
// nada, e por isso ninguém a bumpava.
//
// A REGRA, desde 2026-08-09: ela nunca fica ABAIXO da versão que `er/versao.sql`
// carimba numa instalação nova. Não precisa ser IGUAL -- um release sem migração
// move o serviço e não move o banco --, e é por isso que a regra é `>=` e não
// `===`. Quem a faz cumprir é `__tests__/unit/versao_do_servico.test.js`, e não
// a boa memória de quem commita.
//
// A 3.0.0 É A RENOMEAÇÃO: o Controle do Acervo passa a se chamar SAP
// (Sistema de Apoio à Produção), por decisão do chefe em 2026-08-09, e o SAP
// 2.3.5, que roda em outro repositório, é aposentado. O salto de 1.50.0 para
// 3.0.0 não é uma série nova inventada: ele continua a numeração do sistema que
// está sendo aposentado, para que a versão de cá e a de lá se comparem número a
// número.
//
// O NOME É "SAP", E O 3.0 É ESTA CONSTANTE. O chefe decidiu em 2026-08-09 que a
// versão não entra no rótulo: o menu, o `<title>` e o Swagger dizem "SAP", e
// quem carrega o 3.0.0 é `VERSION` aqui e `public.versao` no banco.
//
// A MIGRAÇÃO `2026-08-09_o_sca_vira_sap_3.sql` NÃO CARIMBA NADA, e não toca
// schema nenhum. Ela carimbava 3.0.0 até 2026-08-09 e PERDEU o
// `UPDATE public.versao`: quem aplicasse só ela ficaria com `public.versao`
// dizendo 3.0.0 e sem um objeto do core, e como `MIN_DATABASE_VERSION` também é
// 3.0.0 o serviço subiria satisfeito contra esse banco. Quem carimba a 3.0.0 é
// `2026-08-09_o_core_de_producao_atravessa.sql`, que é quem CRIA os cinco
// schemas -- o número só sobe quando o banco tem de fato o que o número promete.
// O que sobrou naquele arquivo é uma conferência, e a renomeação é de PRODUTO:
// ela vive neste código e nas telas.
//
// O PISO EM 3.0.0 NÃO É SIMETRIA COM A `VERSION`, e é o caso raro em que a regra
// do parágrafo da 1.26.0 não precisa ser invocada: este código LÊ `producao`,
// `qgis`, `metadado`, `acompanhamento` e `microcontrole`, e um banco em 1.52.0
// não tem nenhum deles. Cobrar menos deixaria o serviço subir para morrer na
// primeira consulta, com "relation producao.etapa does not exist".
// A IDENTIDADE DA INSTALAÇÃO NÃO MOVE ESTES DOIS NÚMEROS, e a ausência é
// deliberada. `dgeo.instituicao` (1.51.0) e a saída do `e_1cgeo` de
// `limites.area_suprimento` (1.52.0) entraram em 2026-08-09, ANTES da renumeração
// para a série 3: as duas são degraus da mesma escada que termina em 3.0.0, e é
// 3.0.0 que `er/versao.sql` carimba na instalação nova. Um banco 3.0.0 já tem a
// tabela de identidade e já não tem o booleano, então o piso continua certo onde
// está.
//
// A 3.1.0 SOBE O PISO. Ela acrescenta `equipamento.equipamento.patrimonio_pendente`,
// e este código passa a LER a coluna em quatro lugares: o `SELECT` do bem (lista e
// ficha), o `INSERT`, o `UPDATE` e a consulta do painel que nomeia os bens com
// patrimônio por conferir. Num banco 3.0.0 a lista de equipamentos inteira falharia
// com "column e.patrimonio_pendente does not exist", que é 500 sem explicação numa
// tela que hoje funciona.
//
// A 3.2.0 SOBE O PISO PELA MESMA RAZÃO. Ela acrescenta
// `orcamento.recebimento_material.data_recebimento`, e o gerador da subseção 4.6
// do RPCMTec passa a LER a coluna para recortar a tabela pelo mês da edição. Num
// banco 3.1.0 o documento inteiro falharia, e não só aquele bloco: `calcular`
// monta os 33 blocos num `Promise.all`, então uma coluna que não existe derruba a
// montagem toda com "column rm.data_recebimento does not exist".
//
// A 3.3.0 NÃO SOBE O PISO, e é a regra do parágrafo da 1.26.0 aplicada a uma
// migração que nem remove: ela só reescreve DADO. A etiqueta do pedido vira
// vocabulário (34 grafias em 50 usos caem para duas), e a rota nova que sugere
// as etiquetas lê `mapoteca.pedido.palavras_chave`, coluna que existe desde a
// instalação. Um banco carimbado 3.2.0 roda este código inteiro sem faltar nada,
// e cobrar a migração obrigaria toda instalação a migrar para não ganhar coluna
// nenhuma. O que ela ganharia é a limpeza do próprio dado, e isso é escolha de
// quem opera o banco, não condição para o serviço subir.
//
// A 3.4.0 TAMBÉM NÃO SOBE O PISO, e é a mesma regra outra vez: ela só funde duas
// linhas de `mapoteca.cliente` que eram a mesma OM cadastrada duas vezes, e move
// o pedido de uma para a outra. Não nasce coluna, não muda o que view nenhuma
// devolve, e este código lê `nome`, `sigla` e `cliente_id` desde a instalação.
// Um banco 3.2.0 roda tudo -- só continua contando 68 OM onde há 67, que é
// defeito do DADO daquela instalação e não do contrato do schema.
//
// A 3.5.0 TAMBÉM NÃO SOBE, e o precedente é exatamente ela: a 1.48.0 acrescentou
// `unique_tipo_material_nome` com a mesma tradução de 23505 no controlador e não
// subiu o piso. Aqui nasce `unique_cliente_nome_sigla`, e o código não QUEBRA num
// banco que não a tem -- ele nunca vê o 23505, e o cadastro repetido continua
// possível lá. Não é o caso da linha 6 de `dominio.modulo` na 1.46.0, que quebrava
// CALADO uma funcionalidade inteira: o que uma instalação sem a migração perde é
// uma garantia sobre o DADO dela, e migrar para ganhá-la é escolha de quem opera
// o banco.
const VERSION = '3.7.0'
const MIN_DATABASE_VERSION = '3.2.0'

/**
 * Tira do objeto as chaves cujo valor e vazio (ausente, '' ou so espaco).
 *
 * Existe para as `MICRO_DB_*`: elas valem TODAS ou NENHUMA, e o `config.env`
 * escrito por `create_config.js` traz as cinco presentes e em branco quando a
 * telemetria nao foi configurada. Sem esta poda, `MICRO_DB_SERVER=''` contaria
 * como "presente" para o `Joi.and` e o boot morreria cobrando as outras quatro
 * de toda instalacao que nao usa telemetria.
 *
 * VALE IGUAL para as tres `PRODUCAO_DB_*`, escritas em branco pelo mesmo
 * instalador quando a instalacao nao tem banco de edicao com controle de
 * permissao.
 */
const vazioEhAusente = obj =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && String(v).trim() !== '')
  )

const configSchema = Joi.object().keys({
  PORT: Joi.number()
    .integer()
    .required(),
  DB_SERVER: Joi.string().required(),
  DB_PORT: Joi.number()
    .integer()
    .required(),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  // Duração da sessão, no formato do jsonwebtoken ('8h', '30m', '1d'). Não há
  // renovação de token: quando ele expira, a próxima requisição volta 401 e o
  // client desloga no meio do trabalho.
  JWT_EXPIRACAO: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('8h'),
  DB_USER_READONLY: Joi.string().allow('').default(''),
  DB_PASSWORD_READONLY: Joi.string().allow('').default(''),
  // --- O banco da TELEMETRIA (microcontrole) ---------------------------------
  //
  // AS CINCO SÃO OPCIONAIS, e é isso que faz o serviço subir sem telemetria. Sem
  // `MICRO_DB_SERVER` a segunda conexão nem é montada (`database/db.js`), as
  // cinco rotas de `/api/microcontrole` que leem o banco PRINCIPAL continuam
  // respondendo e as seis que leem a telemetria respondem 503.
  //
  // MAS ELAS VALEM JUNTAS OU NENHUMA, e o `Joi.and` abaixo é o que cobra. Meia
  // configuração (o servidor sem o banco, ou o usuário sem a senha) produziria
  // um objeto de conexão que só falha na PRIMEIRA requisição do plugin, com um
  // erro do driver, longe de quem digitou. Aqui ela falha no boot, dizendo qual
  // chave falta.
  //
  // A PORTA É NÚMERO E TEM DE ACEITAR VAZIO: `Joi.number()` recusa a string
  // vazia, e `config.env` escrito por `create_config.js` traz as cinco chaves
  // presentes e em branco quando a telemetria não foi configurada. Por isso o
  // `config` abaixo converte '' para `undefined` antes de validar, em vez de
  // `Number('')`, que é 0 e passaria como porta válida.
  MICRO_DB_SERVER: Joi.string(),
  MICRO_DB_PORT: Joi.number().integer(),
  MICRO_DB_NAME: Joi.string(),
  MICRO_DB_USER: Joi.string(),
  MICRO_DB_PASSWORD: Joi.string(),
  // --- Administração dos bancos de EDIÇÃO (login temporário da produção) -----
  //
  // AS TRÊS SÃO OPCIONAIS, pelo mesmo desenho das cinco acima: sem elas o
  // subsistema que cria e revoga o papel efêmero no banco de edição fica
  // DESLIGADO, e não quebrado. O serviço sobe inteiro, as três rotas de
  // `/api/gerencia_producao/banco_dados` respondem 503 e o pacote da atividade
  // sai sem a seção de acesso. Quem lê as chaves é `database/conexao_admin.js`,
  // direto de `process.env`; aqui elas são VALIDADAS, e é só isso.
  //
  // E ELAS VALEM JUNTAS OU NENHUMA, o que aqui não é preciosismo de simetria:
  // `PRODUCAO_DB_HOSTS` é a lista de servidores de banco que esta instalação
  // pode discar, e ela existe porque o endereço do alvo vem do DADO
  // (`producao.dado_producao.configuracao_producao`), digitado por um gerente do
  // módulo. Sem lista, quem digita aquele campo escolhia para qual servidor este
  // serviço manda o par de SUPERUSUÁRIO abaixo, e um PostgreSQL falso do outro
  // lado pede a senha em claro e a recebe.
  //
  // Por isso credencial sem lista mata o BOOT em vez de virar 503 na primeira
  // requisição: uma instalação que já tem as duas primeiras chaves precisa saber
  // AGORA que falta a terceira, e não no dia em que alguém for iniciar uma
  // atividade. `conexao_admin.js` recusa toda discagem enquanto a lista estiver
  // vazia, que é o lado seguro da ausência.
  //
  // O ENDEREÇO NÃO ENTRA EM `PRODUCAO_DB_ADMIN_*`: elas são só o papel e a senha.
  PRODUCAO_DB_ADMIN_USER: Joi.string(),
  PRODUCAO_DB_ADMIN_PASSWORD: Joi.string(),
  // `servidor` ou `servidor:porta`, separados por vírgula. Sem curinga.
  PRODUCAO_DB_HOSTS: Joi.string(),
  // Onde os shares do acervo estão MONTADOS nesta máquina. Só importa fora do
  // Windows: `acervo.volume_armazenamento.volume` guarda caminho UNC, que no
  // Linux não existe. Com VOLUMES_RAIZ=/mnt, o share "acervo_sca" da UNC é lido
  // em /mnt/acervo_sca; VOLUME_<SHARE>_CAMINHO manda sobre a convenção
  // (`utils/caminho_volume.js`). No Linux, sem isso todo download responde 404.
  VOLUMES_RAIZ: Joi.string().allow('').default(''),
  // Teto, em GB, do arquivo que o NAVEGADOR envia por
  // POST /api/arquivo/upload-web/{produto,versao,arquivos}. O byte atravessa o
  // processo do servidor, e uma requisição de horas não é o que o navegador nem
  // o proxy aguentam. Arquivo maior entra pelo plugin, por SMB, sem passar aqui.
  UPLOAD_WEB_MAX_GB: Joi.number().positive().default(2),
  // Prefixo público em que a interface é publicada por um proxy reverso, com
  // barra no começo (o guard de vazamento proíbe escrever o valor aqui: ele é
  // de deploy, e mora no config.env). VAZIO É O ESTADO NORMAL, e publica na
  // raiz. O MESMO valor entra no build (`create_build.js` o repassa como `base`
  // do Vite) e é removido das requisições em `server/app.js`, para o build
  // funcionar atrás do proxy e direto na porta.
  PUBLIC_PATH: Joi.string()
    .allow('')
    .pattern(/^\/\S*$/)
    .default(''),
  // Proxies reversos confiáveis, separados por vírgula (`servidor`, faixa CIDR
  // ou `loopback`). Sem eles, atrás de um proxy o `req.ip` é o IP do PROXY para
  // todo mundo: o rate limit por IP vira um balde único compartilhado e o log
  // registra sempre o mesmo endereço. VAZIO É O ESTADO NORMAL de quem atende
  // direto na porta, e afrouxar isto por engano deixaria qualquer cliente
  // forjar o próprio IP por X-Forwarded-For.
  TRUST_PROXY: Joi.string()
    .allow('')
    .default(''),
  VERSION: Joi.string().required(),
  MIN_DATABASE_VERSION: Joi.string().required()
})
  // TODAS OU NENHUMA. `Joi.and` só cobra quando ALGUMA está presente, que é
  // exatamente o que se quer: nenhuma chave é o estado normal de quem não usa
  // telemetria, e uma sozinha é erro de digitação que precisa aparecer no boot.
  .and(
    'MICRO_DB_SERVER',
    'MICRO_DB_PORT',
    'MICRO_DB_NAME',
    'MICRO_DB_USER',
    'MICRO_DB_PASSWORD'
  )
  // TODAS OU NENHUMA, de novo, e por um motivo mais duro: aqui a chave que falta
  // não degrada uma tela, ela decide para qual servidor este serviço manda um
  // par de superusuário. Credencial sem lista de servidores é o defeito, e ele
  // morre no boot.
  .and(
    'PRODUCAO_DB_ADMIN_USER',
    'PRODUCAO_DB_ADMIN_PASSWORD',
    'PRODUCAO_DB_HOSTS'
  )

const config = {
  PORT: process.env.PORT,
  DB_SERVER: process.env.DB_SERVER,
  DB_PORT: process.env.DB_PORT,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_USER_READONLY: process.env.DB_USER_READONLY || '',
  DB_PASSWORD_READONLY: process.env.DB_PASSWORD_READONLY || '',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRACAO: process.env.JWT_EXPIRACAO || '8h',
  VOLUMES_RAIZ: process.env.VOLUMES_RAIZ || '',
  PUBLIC_PATH: process.env.PUBLIC_PATH || '',
  TRUST_PROXY: process.env.TRUST_PROXY || '',
  // Ausente vale 2, e nao NaN: `Number(undefined)` reprovaria a validacao e
  // mataria o boot de toda instalacao que nunca ouviu falar desta chave.
  UPLOAD_WEB_MAX_GB: process.env.UPLOAD_WEB_MAX_GB
    ? Number(process.env.UPLOAD_WEB_MAX_GB)
    : 2,
  // Chave VAZIA vira AUSENTE, e não string vazia: `create_config.js` escreve as
  // cinco em branco quando a telemetria não foi configurada, e uma `''` presente
  // faria o `Joi.and` cobrar as outras quatro. Ausente é o estado que diz "não
  // há telemetria nesta instalação".
  ...vazioEhAusente({
    MICRO_DB_SERVER: process.env.MICRO_DB_SERVER,
    MICRO_DB_PORT: process.env.MICRO_DB_PORT,
    MICRO_DB_NAME: process.env.MICRO_DB_NAME,
    MICRO_DB_USER: process.env.MICRO_DB_USER,
    MICRO_DB_PASSWORD: process.env.MICRO_DB_PASSWORD
  }),
  // Pela mesma regra e pelo mesmo motivo das cinco acima: `create_config.js`
  // escreve as três em branco quando o subsistema não foi configurado, e uma
  // `''` presente faria o `Joi.and` cobrar as outras duas de toda instalação que
  // não usa banco de edição com controle de permissão.
  ...vazioEhAusente({
    PRODUCAO_DB_ADMIN_USER: process.env.PRODUCAO_DB_ADMIN_USER,
    PRODUCAO_DB_ADMIN_PASSWORD: process.env.PRODUCAO_DB_ADMIN_PASSWORD,
    PRODUCAO_DB_HOSTS: process.env.PRODUCAO_DB_HOSTS
  }),
  VERSION,
  MIN_DATABASE_VERSION
}

const { error } = configSchema.validate(config, {
  abortEarly: false
})
if (error) {
  const { details } = error
  const message = details.map(i => i.message).join(',')

  errorHandler.critical(
    new AppError(
      'Arquivo de configuração inválido. Configure novamente o serviço.',
      null,
      message
    )
  )
}

module.exports = config
