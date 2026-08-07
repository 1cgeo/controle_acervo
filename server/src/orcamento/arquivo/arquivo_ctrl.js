'use strict'

const path = require('path')

const { db } = require('../../database')
const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')
const { AppError, httpCode } = require('../utils')

const controller = {}

// O multer/busboy entrega file.originalname decodificado como latin1; refaz
// para UTF-8 para nao corromper nomes com acento (ex.: "relatório.pdf"). Para
// nomes ASCII e um no-op.
const decodeNome = nome => Buffer.from(nome, 'latin1').toString('utf8')

// Colunas devolvidas ao client (NUNCA o conteudo BYTEA: a listagem traz so os
// metadados; os bytes saem apenas no download).
const COLUNAS =
  `id, nota_credito_id, dfd_id, pdr_ano, recolhimento_id, nome_original,
   extensao, mimetype, tamanho_bytes, data_cadastramento, usuario_cadastramento_uuid`

const INSERT_SQL = `INSERT INTO orcamento.arquivo
    (nota_credito_id, dfd_id, pdr_ano, recolhimento_id, nome_original,
     extensao, mimetype, tamanho_bytes, conteudo, usuario_cadastramento_uuid)
  VALUES
    ($<notaCreditoId>, $<dfdId>, $<pdrAno>, $<recolhimentoId>, $<nomeOriginal>,
     $<extensao>, $<mimetype>, $<tamanhoBytes>, $<conteudo>, $<usuarioUuid>)`

// Normaliza o vinculo (NC | DFD | PDR-ano | recolhimento) com null nos ausentes.
const normalizarVinculo = vinculo => ({
  notaCreditoId: vinculo.nota_credito_id != null ? vinculo.nota_credito_id : null,
  dfdId: vinculo.dfd_id != null ? vinculo.dfd_id : null,
  pdrAno: vinculo.pdr_ano != null ? vinculo.pdr_ano : null,
  recolhimentoId: vinculo.recolhimento_id != null ? vinculo.recolhimento_id : null
})

// A linha do anexo para a AUDITORIA: os metadados e os tres vinculos, NUNCA o
// `conteudo`.
//
// Aqui nao se usa o `auditoriaCtrl.lerAntes`, e e a unica excecao do modulo. Ele
// faz `SELECT *`, e o `*` desta tabela traz o BYTEA inteiro para a memoria do
// processo so para o `sanitizar` o substituir por `{_omitido, bytes}` na linha
// seguinte. Num PDF de dezenas de MB isso e memoria paga por nada. O mapa de
// auditoria continua declarando `omitir: ['conteudo']` como rede: se um dia
// alguem passar a linha inteira por engano, os bytes nao entram no rastro.
const SELECT_PARA_AUDITORIA = `
  SELECT id, nota_credito_id, dfd_id, pdr_ano, recolhimento_id, nome_original,
         extensao, mimetype, tamanho_bytes,
         data_cadastramento, usuario_cadastramento_uuid,
         data_modificacao, usuario_modificacao_uuid
    FROM orcamento.arquivo`

// Registra a exclusao de um anexo, ja com a linha lida.
const registrarExclusao = async (t, linha, usuarioUuid, contexto) =>
  auditoriaCtrl.registrar(t, {
    tabela: 'orcamento.arquivo',
    registroId: linha.id,
    operacao: 'D',
    antes: linha,
    usuarioUuid,
    contexto
  })

/**
 * O rastro dos anexos que caem por ON DELETE CASCADE.
 *
 * `orcamento.arquivo.nota_credito_id` e `.dfd_id` sao ON DELETE CASCADE, entao
 * apagar a NC ou o DFD apaga o anexo sem DELETE nenhum no controller. Sem esta
 * funcao, o unico registro de que o PDF do SIAFI existiu sumiria em silencio
 * junto com o dono -- e a exclusao e justamente o evento que o rastro existe
 * para guardar. E o mesmo caso da `impressao_item` da mapoteca, que ja e
 * auditada apesar de cair por cascata.
 *
 * Chamada ANTES do DELETE do dono, dentro da mesma transacao.
 *
 * @param {object} t - a transacao do dono
 * @param {'nota_credito_id'|'dfd_id'|'recolhimento_id'} coluna - identificador
 *   interno, nunca entrada do usuario
 * @param {number|string} valor
 */
controller.auditarCascata = async (t, coluna, valor, usuarioUuid, contexto) => {
  const anexos = await t.any(
    `${SELECT_PARA_AUDITORIA} WHERE ${coluna} = $<valor>`,
    { valor }
  )
  for (const anexo of anexos) {
    await registrarExclusao(t, anexo, usuarioUuid, contexto)
  }
}

controller.listarPorVinculo = async vinculo => {
  const { notaCreditoId, dfdId, pdrAno, recolhimentoId } = normalizarVinculo(vinculo)
  // Exatamente um dos quatro e nao-nulo (garantido pelo schema); o branch ativo
  // filtra pela coluna correspondente.
  return db.conn.any(
    `SELECT ${COLUNAS}
       FROM orcamento.arquivo
      WHERE ($<notaCreditoId>::bigint IS NOT NULL AND nota_credito_id = $<notaCreditoId>)
         OR ($<dfdId>::bigint IS NOT NULL AND dfd_id = $<dfdId>)
         OR ($<pdrAno>::smallint IS NOT NULL AND pdr_ano = $<pdrAno>)
         OR ($<recolhimentoId>::bigint IS NOT NULL AND recolhimento_id = $<recolhimentoId>)
      ORDER BY data_cadastramento, id`,
    { notaCreditoId, dfdId, pdrAno, recolhimentoId }
  )
}

// Cria o registro do anexo gravando os bytes (file.buffer) no banco. Para
// NC/DFD (single) substitui o anexo anterior em transacao (apaga a linha antiga
// e insere a nova). Devolve a lista atualizada do vinculo.
controller.criar = async (file, vinculo, usuarioUuid, contexto) => {
  const { notaCreditoId, dfdId, pdrAno, recolhimentoId } = normalizarVinculo(vinculo)

  // Valida o dono (NC/DFD/recolhimento). PDR e nivel ano: nao ha linha pai para
  // checar.
  if (notaCreditoId != null) {
    const nc = await db.conn.oneOrNone(
      'SELECT 1 FROM orcamento.nota_credito WHERE id = $1',
      [notaCreditoId]
    )
    if (!nc) {
      throw new AppError('Nota de credito nao encontrada', httpCode.NotFound)
    }
  } else if (dfdId != null) {
    const dfd = await db.conn.oneOrNone(
      'SELECT 1 FROM orcamento.dfd WHERE id = $1',
      [dfdId]
    )
    if (!dfd) {
      throw new AppError('DFD nao encontrado', httpCode.NotFound)
    }
  } else if (recolhimentoId != null) {
    const recolhimento = await db.conn.oneOrNone(
      'SELECT 1 FROM orcamento.nota_credito_recolhimento WHERE id = $1',
      [recolhimentoId]
    )
    if (!recolhimento) {
      throw new AppError('Recolhimento nao encontrado', httpCode.NotFound)
    }
  }

  const nomeOriginal = decodeNome(file.originalname)
  const meta = {
    notaCreditoId,
    dfdId,
    pdrAno,
    recolhimentoId,
    nomeOriginal,
    extensao: path.extname(nomeOriginal).replace('.', '').toLowerCase(),
    mimetype: file.mimetype || null,
    tamanhoBytes: file.buffer != null ? file.buffer.length : (file.size != null ? file.size : null),
    conteudo: file.buffer,
    usuarioUuid
  }

  const single = notaCreditoId != null || dfdId != null

  await db.conn.tx(async t => {
    if (single) {
      // coluna e um identificador interno controlado (nunca entrada do usuario).
      const coluna = notaCreditoId != null ? 'nota_credito_id' : 'dfd_id'
      const valorDono = notaCreditoId != null ? notaCreditoId : dfdId

      // "Reenviar substitui" e uma SUBSTITUICAO, e o rastro tem de dizer as duas
      // metades: o anexo que saiu (com o nome que ele tinha) e o que entrou. Sem
      // o evento de exclusao, trocar o PDF do SIAFI apareceria como uma inclusao
      // sozinha, e o arquivo anterior nunca teria existido.
      const anteriores = await t.any(
        `${SELECT_PARA_AUDITORIA} WHERE ${coluna} = $<valorDono>`,
        { valorDono }
      )
      await t.none(`DELETE FROM orcamento.arquivo WHERE ${coluna} = $<valorDono>`, {
        valorDono
      })
      for (const anterior of anteriores) {
        await registrarExclusao(t, anterior, usuarioUuid, contexto)
      }
    }

    // `RETURNING` so das colunas de metadado, pela mesma razao do
    // SELECT_PARA_AUDITORIA: `RETURNING *` devolveria o BYTEA recem-gravado.
    const criado = await t.one(
      `${INSERT_SQL}
       RETURNING id, nota_credito_id, dfd_id, pdr_ano, recolhimento_id, nome_original,
                 extensao, mimetype, tamanho_bytes,
                 data_cadastramento, usuario_cadastramento_uuid,
                 data_modificacao, usuario_modificacao_uuid`,
      meta
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'orcamento.arquivo',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })
  })

  return controller.listarPorVinculo(vinculo)
}

// Metadados + bytes de um anexo, para download. Valida existencia no banco.
controller.getParaDownload = async id => {
  const arquivo = await db.conn.oneOrNone(
    `SELECT id, nome_original, mimetype, conteudo
       FROM orcamento.arquivo WHERE id = $1`,
    [id]
  )
  if (!arquivo) {
    throw new AppError('Arquivo nao encontrado', httpCode.NotFound)
  }

  return arquivo
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await t.oneOrNone(
      `${SELECT_PARA_AUDITORIA} WHERE id = $<id>`,
      { id }
    )
    if (!antes) {
      throw new AppError('Arquivo nao encontrado', httpCode.NotFound)
    }

    await t.none('DELETE FROM orcamento.arquivo WHERE id = $<id>', { id })

    await registrarExclusao(t, antes, usuarioUuid, contexto)
  })
}

module.exports = controller
