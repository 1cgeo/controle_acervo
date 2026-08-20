'use strict'

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// A LINHA E SEMPRE A 1, e o numero nao e magico: ele e o `DEFAULT 1` com
// `CHECK (id = 1)` do DDL, que e o que faz a tabela ter uma linha so. Ele nao
// vem de `utils/domain_constants.js` porque nao e codigo de tabela de dominio --
// nao ha catalogo com um `code` 1 aqui, ha uma linha unica cuja chave e 1.
const LINHA_UNICA = 1

const FK_VIOLATION = '23503'

// A UG inexistente e o UNICO erro de banco que uma requisicao BEM formada
// consegue produzir aqui: o Joi ja garante que `nome` e `sigla` cabem nas
// colunas, e quem decide se o codigo da UG existe e a chave estrangeira.
//
// Sem esta traducao o 23503 sobe como 500 citando
// 'instituicao_ug_code_fkey', que nao ajuda quem acabou de digitar.
const traduzirErro = err => {
  if (err && err.code === FK_VIOLATION) {
    return new AppError(
      'A Unidade Gestora informada não existe no catálogo (dominio.ug)',
      httpCode.BadRequest,
      err
    )
  }
  return err
}

/**
 * A instituição desta instalação.
 *
 * DEVOLVE O NOME DA UG JUNTO, por LEFT JOIN: a tela e o rodapé do relatório
 * mostram "160382 - 1 CGEO - Primeiro Centro de Geoinformação", e sem o nome
 * eles teriam de pedir o catálogo inteiro de UG só para traduzir um código. O
 * LEFT é o que mantém a instalação sem orçamento (UG nula) respondendo 200 em
 * vez de sumir da consulta.
 *
 * `ug_nome`, `data_modificacao` e `usuario_modificacao_uuid` saem AO LADO dos
 * três campos que o PUT aceita, e não dentro deles: os três primeiros são
 * leitura, e é por isso que a rota valida o corpo pelo validador TOLERANTE. Ver
 * o cabeçalho de `instituicao_route.js`.
 */
controller.get = async () => {
  const linha = await db.conn.oneOrNone(
    `SELECT i.id, i.nome, i.sigla, i.ug_code, ug.nome AS ug_nome,
            i.data_modificacao, i.usuario_modificacao_uuid,
            -- Os BYTES nao saem daqui: a ficha e JSON, e a imagem tem rota
            -- propria. O booleano existe para a tela decidir entre mostrar a
            -- previa e oferecer o envio, sem pedir a imagem para descobrir.
            (i.simbolo IS NOT NULL) AS tem_simbolo,
            i.simbolo_nome_original, i.simbolo_data_envio
       FROM dgeo.instituicao AS i
       LEFT JOIN dominio.ug AS ug ON ug.code = i.ug_code
      WHERE i.id = $<id>`,
    { id: LINHA_UNICA }
  )

  // NAO E UM 404 DE ROTINA: a linha e semeada pelo `er/dgeo.sql` e pela
  // migracao, entao a ausencia dela quer dizer que alguem a apagou por `psql`
  // ou que a migracao nao rodou. A mensagem diz as duas coisas, porque quem le
  // este erro esta num servidor e nao numa tela.
  if (!linha) {
    throw new AppError(
      'A instituição desta instalação não está cadastrada. Aplique a migração 2026-08-09_a_instituicao.sql ou insira a linha em dgeo.instituicao',
      httpCode.NotFound
    )
  }

  return linha
}

// ---------------------------------------------------------------------------
// A instituição vista por quem EMITE DOCUMENTO
// ---------------------------------------------------------------------------
//
// AQUI, E NÃO EM SEIS ARQUIVOS. Até 2026-08-09 o nome do Centro estava escrito
// no código em dez lugares (o cabeçalho, a capa, o rodapé e o bloco de
// assinatura do PDF do RPCMTec, o nome do arquivo do Anuário, as duas frases da
// 1.1 e a coluna OMDS do RTM), e `rpcmtec_ctrl.areaDoCentro` já tinha aberto um
// `SELECT nome FROM dgeo.instituicao` próprio. Espalhar essa consulta pelos seis
// arquivos que precisam dela repetiria o defeito que a tabela veio consertar:
// seis lugares para acertar quando o campo mudar de nome, e seis mensagens de
// erro diferentes para a mesma falha.
//
// MORA NO MÓDULO DONO DA TABELA, e não em `rpcmtec/` nem em `utils/`. Quem lê
// são os dois: `rpcmtec/` e `mapoteca/`. Pôr o ponto em `rpcmtec/` obrigaria a
// mapoteca a requerer o RPCMTec para saber a sigla da própria casa, e fecharia
// um ciclo de `require` (o `rpcmtec_route.js` já requer `mapoteca/relatorio_ctrl`
// e `mapoteca/anuario_ctrl`). Quem sabe ler `dgeo.instituicao` é quem escreve
// nela.
//
// UMA CONSULTA POR DOCUMENTO, E SEM CACHE DE PROCESSO. A linha muda por
// `PUT /api/instituicao`, e um cache faria o relatório seguinte ao PUT sair com
// o nome velho -- sem erro, sem aviso e sem ninguém entender por quê, até
// alguém reiniciar o serviço por acaso. O que se economizaria é uma leitura de
// UMA linha por chave primária, e ela acontece por GERAÇÃO DE DOCUMENTO (montar
// a edição, desenhar o PDF, exportar o Anuário ou o RTM), e não por requisição
// de tela.

// Sem acento, só [A-Z0-9], e SEM SEPARADOR NENHUM.
//
// A IDEIA É A DE `acervo.slug_nome()` (em `er/acervo.sql`), e a divergência é
// uma só: lá o que sobra entre os pedaços vira '-', aqui vira nada. O nome que a
// DSG já recebe é `Anuario_Estatistico_1CGEO_06_Junho_2026.ods`, com o '1CGEO'
// colado; um '1-CGEO' meteria um SEGUNDO separador dentro de um nome separado
// por '_' e quebraria a sequência de arquivos já enviados.
//
// EM JS, E NÃO CHAMANDO A FUNÇÃO DO BANCO, por três razões nesta ordem: ela
// daria a resposta ERRADA (o separador acima), ela mora no schema `acervo` e
// fala de nome físico de produto, que não é o que o Anuário é, e chamá-la
// custaria uma ida ao banco para normalizar um texto que já está na memória de
// quem acabou de lê-lo.
//
// NFD, E NUNCA NFKD. O que se quer perder é o acento: 'ã' se decompõe em 'a'
// mais o til, e o til cai no filtro. O 'º' ordinal NÃO se decompõe em NFD, e é
// o filtro que o apaga -- em NFKD ele viraria a letra 'o', e '1º CGEO' sairia
// como '1OCGEO'.
// SÃO TRÊS PASSOS E NÃO QUATRO: quem apaga o acento é o MESMO filtro que apaga
// o espaço e o 'º'. Depois do NFD, o 'Ã' é a letra 'A' seguida de um til solto,
// e o til não é [A-Z0-9]. Um `replace` só para diacríticos seria uma faixa de
// Unicode escrita à mão para não fazer nada além do que a linha seguinte já faz.
const slugDaSigla = sigla => String(sigla)
  .normalize('NFD')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '')

// A INSTITUIÇÃO NÃO RESPONDEU, e o documento NÃO SAI.
//
// Ela sempre existe (semente do `er/dgeo.sql` mais o `CHECK (id = 1)`), então
// chegar aqui quer dizer que o banco está em pé de guerra, que alguém apagou a
// linha por `psql` ou que a migração não rodou. Nenhuma dessas tem valor padrão
// honesto: um `|| '1º CGEO'` trancaria de novo a instalação no Centro de quem
// escreveu o código, e um `?? ''` imprimiria "RPCMTec  Julho/2026" num PDF que
// alguém assina. Documento assinado com o nome errado, ou sem nome, é pior do
// que documento que não saiu: o erro alguém conserta, o papel alguém arquiva.
//
// UMA MENSAGEM SÓ para as duas causas, com a original preservada em `err`: quem
// a lê está gerando um relatório, e o que ele precisa saber é que o documento
// parou por causa da instituição e onde ela se configura.
const naoRespondeu = err => new AppError(
  'O documento não pôde ser gerado porque esta instalação não conseguiu ler a que instituição pertence (dgeo.instituicao): o nome e a sigla do Centro entram no cabeçalho, no rodapé, no bloco de assinatura e no nome do arquivo. Confira em PUT /api/instituicao (rota de administrador).',
  httpCode.InternalError,
  err
)

/**
 * A instituição para quem vai IMPRIMIR o nome dela.
 *
 * É a mesma leitura de `controller.get()` -- o ponto único continua sendo um --
 * com três coisas a mais, todas por causa do destino:
 *
 *   1. FALHA em vez de devolver campo vazio (ver `naoRespondeu`, acima);
 *   2. cobra `nome` e `sigla` PREENCHIDOS, e não só não-nulos: as colunas são
 *      NOT NULL, e ' ' passa por NOT NULL;
 *   3. devolve `sigla_slug`, a sigla como nome de arquivo a aceita.
 *
 * O 2 COBRA OS DOIS SEMPRE, inclusive para quem só precisa do nome (a subseção
 * 2.7 do RPCMTec). É deliberado: quem pede a instituição para documento está
 * montando um documento que leva os dois, e é melhor parar na primeira leitura
 * do que dez linhas depois, com meia edição calculada.
 *
 * @returns {Promise<Object>} a linha do GET mais `sigla_slug`
 */
controller.paraDocumento = async () => {
  let instituicao
  try {
    instituicao = await controller.get()
  } catch (err) {
    throw naoRespondeu(err)
  }

  const vazio = campo =>
    instituicao[campo] == null || String(instituicao[campo]).trim() === ''

  if (vazio('nome') || vazio('sigla')) throw naoRespondeu()

  const siglaSlug = slugDaSigla(instituicao.sigla)

  // SIGLA SEM LETRA NEM NÚMERO ('---', '...') daria um nome de arquivo com dois
  // separadores encostados, e dois meses diferentes sairiam com nomes que só
  // diferem no número: prefere-se parar aqui.
  if (siglaSlug === '') {
    throw new AppError(
      `A sigla desta instituição ("${instituicao.sigla}") não tem letra nem número, e por isso não serve de nome de arquivo. Corrija em PUT /api/instituicao (rota de administrador).`,
      httpCode.InternalError
    )
  }

  return { ...instituicao, sigla_slug: siglaSlug }
}

// EXPORTADO para o teste do slug, e não porque alguém de fora o chame: quem quer
// o slug pede `paraDocumento`, que já o traz pronto ao lado da sigla que o
// gerou.
controller.slugDaSigla = slugDaSigla

/**
 * Altera a instituição. Só ALTERA: não há criação nem exclusão.
 *
 * A escrita inteira vive em `db.conn.tx()`, com `auditoriaCtrl.registrar` na
 * MESMA transação. Aqui isso pesa mais do que em outras telas: trocar o nome
 * muda a que Centro o sistema inteiro se diz pertencer, e a subseção 2.7 do
 * RPCMTec passa a procurar outra área de suprimento. É o tipo de mudança cuja
 * pergunta seguinte é "quem trocou, e quando".
 */
controller.atualizar = async (dados, usuarioUuid, contexto) => {
  // A cadeia vazia da tela (o campo de UG apagado) e a ausencia do campo querem
  // dizer a mesma coisa, e as duas viram NULL: gravar '' em `ug_code` levaria
  // 23503, porque cadeia vazia nao e codigo de UG nenhum.
  const ugCode = dados.ug_code === undefined || dados.ug_code === ''
    ? null
    : dados.ug_code

  try {
    return await db.conn.tx(async t => {
      // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado anterior
      // para o rastro e lanca o 404 quando a linha nao existe.
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'dgeo.instituicao',
        LINHA_UNICA,
        'Instituição'
      )

      const depois = await t.one(
        `UPDATE dgeo.instituicao SET
           nome = $<nome>, sigla = $<sigla>, ug_code = $<ug_code>,
           data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          nome: dados.nome,
          sigla: dados.sigla,
          ug_code: ugCode,
          usuarioUuid,
          id: LINHA_UNICA
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'dgeo.instituicao',
        registroId: LINHA_UNICA,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    })
  } catch (err) {
    throw traduzirErro(err)
  }
}

// ---------------------------------------------------------------------------
// O SIMBOLO
// ---------------------------------------------------------------------------

// Assinatura dos primeiros bytes de cada formato aceito. A extensao e o
// mimetype vem os DOIS do cliente, e nenhum e prova: quem quiser subir outra
// coisa renomeia o arquivo. Isto le o que o arquivo E.
const ASSINATURAS = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }
]

const tipoReal = buffer => {
  for (const a of ASSINATURAS) {
    if (a.bytes.every((b, i) => buffer[i] === b)) return a.mime
  }
  // WEBP e RIFF....WEBP: a marca esta no byte 8, e nao no comeco.
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/**
 * Metadados do simbolo, SEM os bytes.
 *
 * Existe separada de `getSimboloConteudo` para a rota poder montar a etiqueta de
 * cache e responder 304 sem ler a imagem inteira do banco.
 */
controller.getSimboloMeta = async () => {
  return db.conn.oneOrNone(
    `SELECT simbolo_mimetype AS mimetype, simbolo_nome_original AS nome_original,
            simbolo_data_envio AS data_envio, length(simbolo) AS bytes
       FROM dgeo.instituicao
      WHERE id = $<id> AND simbolo IS NOT NULL`,
    { id: LINHA_UNICA }
  )
}

controller.getSimboloConteudo = async () => {
  const linha = await db.conn.oneOrNone(
    `SELECT simbolo FROM dgeo.instituicao WHERE id = $<id>`,
    { id: LINHA_UNICA }
  )
  return linha ? linha.simbolo : null
}

/**
 * Grava o simbolo. O `buffer` vem do multer, em memoria.
 *
 * NAO registra os BYTES na auditoria, e isso e deliberado: o rastro guardaria
 * uma copia da imagem a cada troca, e `auditoria.evento` viraria deposito de
 * binario. Registra-se a TROCA (nome do arquivo, tipo, tamanho), que e o que
 * responde "quem trocou o brasao e quando".
 */
controller.salvarSimbolo = async (arquivo, usuarioUuid, contexto) => {
  const mime = tipoReal(arquivo.buffer)
  if (!mime) {
    throw new AppError(
      'O arquivo enviado não é uma imagem PNG, JPEG, GIF ou WEBP',
      httpCode.BadRequest
    )
  }

  return db.conn.tx(async t => {
    const antes = await t.oneOrNone(
      `SELECT id, nome, sigla, simbolo_mimetype, simbolo_nome_original,
              simbolo_data_envio, length(simbolo) AS simbolo_bytes
         FROM dgeo.instituicao WHERE id = $<id>`,
      { id: LINHA_UNICA }
    )
    if (!antes) {
      throw new AppError(
        'A instituição desta instalação não está cadastrada',
        httpCode.NotFound
      )
    }

    const depois = await t.one(
      `UPDATE dgeo.instituicao SET
         simbolo = $<simbolo>, simbolo_mimetype = $<mimetype>,
         simbolo_nome_original = $<nomeOriginal>, simbolo_data_envio = now(),
         data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING id, nome, sigla, simbolo_mimetype, simbolo_nome_original,
                 simbolo_data_envio, length(simbolo) AS simbolo_bytes`,
      {
        simbolo: arquivo.buffer,
        mimetype: mime,
        nomeOriginal: arquivo.originalname,
        usuarioUuid,
        id: LINHA_UNICA
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'dgeo.instituicao',
      registroId: LINHA_UNICA,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return depois
  })
}

controller.apagarSimbolo = async (usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await t.oneOrNone(
      `SELECT id, nome, sigla, simbolo_mimetype, simbolo_nome_original,
              simbolo_data_envio, length(simbolo) AS simbolo_bytes
         FROM dgeo.instituicao WHERE id = $<id>`,
      { id: LINHA_UNICA }
    )
    const depois = await t.one(
      `UPDATE dgeo.instituicao SET
         simbolo = NULL, simbolo_mimetype = NULL, simbolo_nome_original = NULL,
         simbolo_data_envio = NULL,
         data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING id, nome, sigla, simbolo_mimetype, simbolo_nome_original,
                 simbolo_data_envio, length(simbolo) AS simbolo_bytes`,
      { usuarioUuid, id: LINHA_UNICA }
    )
    await auditoriaCtrl.registrar(t, {
      tabela: 'dgeo.instituicao',
      registroId: LINHA_UNICA,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
