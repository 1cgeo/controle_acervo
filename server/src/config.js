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
// 'producao' para 4 e 'efetivo' para 5, e as rotas da execução do PIT, do
// Extra-PIT, da capacitação e do efetivo trocaram `verifyAdmin` por
// `verifyPerfil(..., 'producao')` e `verifyPerfil(..., 'efetivo')`.
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
const VERSION = '1.38.0'
const MIN_DATABASE_VERSION = '1.49.0'

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
  VERSION: Joi.string().required(),
  MIN_DATABASE_VERSION: Joi.string().required()
})

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
  // Ausente vale 2, e nao NaN: `Number(undefined)` reprovaria a validacao e
  // mataria o boot de toda instalacao que nunca ouviu falar desta chave.
  UPLOAD_WEB_MAX_GB: process.env.UPLOAD_WEB_MAX_GB
    ? Number(process.env.UPLOAD_WEB_MAX_GB)
    : 2,
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
