'use strict'

/**
 * A regra do diff da auditoria.
 *
 * Este arquivo NAO e codigo novo: e o miolo de `mapoteca/auditoria_ctrl.js`
 * (2026-07-30) movido para o modulo comum, sem mudanca de regra nenhuma. Ele
 * subiu porque a auditoria deixou de ser do pedido e passou a valer para os tres
 * modulos; deixar a regra na mapoteca e copia-la para o resto seria a divergencia
 * esperando acontecer, que e a mesma licao da lapide do arquivo (o bloco de 55
 * linhas que vivia copiado em tres controllers e so um tinha teste).
 */

// Colunas de escrituracao, que mudam em TODA atualizacao (o carimbo de quem
// mexeu e de quando). Elas continuam saindo em dados_antes e dados_depois, mas
// ficam FORA de campos_alterados: se entrassem, toda linha do historico traria
// as duas e o campo que a pessoa realmente mudou se perderia no meio.
//
// As tabelas NOVAS carimbam por UUID (usuario_modificacao_uuid/data_modificacao,
// convencao do acervo, do orcamento, do pit e das tabelas novas da mapoteca) e
// as antigas por id (usuario_atualizacao_id/data_atualizacao, mapoteca). Os seis
// nomes entram aqui: e o mesmo carimbo com nomes diferentes, e o motivo de
// exclui-los e o mesmo.
const CAMPOS_DE_ESCRITURACAO = new Set([
  'usuario_atualizacao_id',
  'data_atualizacao',
  'usuario_modificacao_uuid',
  'data_modificacao',
  // As de CRIACAO entram tambem. Elas nao mudam num UPDATE, entao nunca
  // apareceriam no diff de uma alteracao; mas na INSERCAO o diff lista os campos
  // que nasceram preenchidos, e sem isto todo evento de criacao traria
  // "data_cadastramento" e "usuario_cadastramento_uuid" na frente do que
  // interessa.
  'data_cadastramento',
  'usuario_cadastramento_uuid',
  'data_criacao',
  'usuario_criacao_id'
])

/**
 * Normaliza valores vindos do banco para comparacao.
 *
 * Data vira ISO, array e objeto viram JSON, e o resto vira texto. O texto e
 * proposital: o driver devolve BIGINT como string e SMALLINT como numero, entao
 * comparar por === cru acusaria mudanca onde nao houve. Os dois lados saem
 * sempre da MESMA fonte (uma linha do banco), por isso a normalizacao nao
 * esconde diferenca real.
 *
 * @param {*} valor
 * @returns {string|null}
 */
const normalizar = valor => {
  if (valor === null || valor === undefined) {
    return null
  }
  if (valor instanceof Date) {
    return valor.toISOString()
  }
  if (typeof valor === 'object') {
    return JSON.stringify(valor)
  }
  return String(valor)
}

/**
 * Campos que mudaram entre duas versoes da linha.
 *
 * CALCULADO, nunca uma lista digitada a mao: lista escrita a mao envelhece na
 * primeira coluna nova e passa a mentir em silencio.
 *
 * Na insercao (antes nulo) devolve os campos que nasceram preenchidos; na
 * exclusao (depois nulo) devolve os que se perderam. E a mesma conta nos tres
 * casos, sem excecao por operacao.
 *
 * @param {object} [antes]
 * @param {object} [depois]
 * @returns {string[]} ordenados
 */
const diffCampos = (antes, depois) => {
  const chaves = new Set([
    ...Object.keys(antes || {}),
    ...Object.keys(depois || {})
  ])

  return [...chaves]
    .filter(c => !CAMPOS_DE_ESCRITURACAO.has(c))
    .filter(c => normalizar(antes ? antes[c] : null) !== normalizar(depois ? depois[c] : null))
    .sort()
}

module.exports = {
  diffCampos,
  normalizar,
  CAMPOS_DE_ESCRITURACAO
}
