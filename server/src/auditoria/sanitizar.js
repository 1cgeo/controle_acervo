'use strict'

/**
 * O que NUNCA entra no JSON da auditoria, e por que.
 *
 * A exclusao mora AQUI, e nao em cada chamador: quem esquece de excluir uma vez
 * vaza para sempre, e o vazamento so aparece quando alguem abrir a tela de
 * historico -- que e lida por administrador, o que torna o vazamento pior.
 *
 * ORDEM IMPORTA. O diff (`diff.js`) roda sobre a linha CRUA, e a sanitizacao
 * roda depois, sobre a copia que vai para o banco. E o que faz a troca de senha
 * aparecer como `campos_alterados: ['senha']` com os dois valores nulos: saber
 * que a senha mudou, quando e por quem e a informacao toda, e o valor so criaria
 * risco. Sanitizar ANTES apagaria a mudanca do diff, porque nulo comparado a
 * nulo nao acusa nada.
 */

// Teto por VALOR, e nao por linha: o campo grande nao pode empurrar os pequenos
// para fora do registro. 8 kB cobre com folga a folha do SCN (5 vertices) e o
// recorte irregular comum; acima disso o que se guarda e o resumo.
//
// PENDENTE DE CONFIRMACAO DA CHEFIA: acima deste teto, o estado anterior de uma
// folha de recorte irregular deixa de ser recuperavel pelo rastro. Subir o teto
// e uma linha; o que nao se recupera e o que ja foi gravado resumido.
const TETO_VALOR_BYTES = 8 * 1024

/**
 * Numero de vertices de um EWKT, contando as virgulas de coordenada.
 * Aproximado de proposito: serve para a frase da tela ("POLYGON, 1.243
 * vertices"), nao para calculo.
 */
const contarVertices = ewkt => {
  const matches = String(ewkt).match(/,/g)
  return matches ? matches.length + 1 : 1
}

/** O tipo geometrico anunciado no EWKT ('SRID=4674;POLYGON((...' -> 'POLYGON'). */
const tipoGeometrico = ewkt => {
  const m = String(ewkt).match(/([A-Z]+)\s*\(/)
  return m ? m[1] : 'GEOMETRIA'
}

/**
 * Uma copia da linha pronta para virar JSONB.
 *
 * Quatro classes de coluna saem, cada uma por uma razao diferente:
 *
 * 1. SEGREDO (`omitir`). `dgeo.usuario.senha` e o hash bcrypt. Copia-lo criaria
 *    uma SEGUNDA copia do hash, numa tabela que ninguem pensa como guardadora de
 *    credencial. Vira null nos dois lados; o `campos_alterados` ja disse que
 *    mudou.
 * 2. BINARIO (Buffer). `mapoteca.anexo_pedido.conteudo` e `orcamento.arquivo.conteudo`
 *    sao BYTEA. Copiar o anexo para dentro do rastro dobraria o armazenamento do
 *    sistema a cada anexo trocado. Vira `{_omitido, bytes}`, e o diff continua
 *    acusando a mudanca porque `tamanho_bytes` e `nome_original` continuam la.
 * 3. GEOMETRIA GRANDE. Cabe inteira quando cabe -- o estado anterior de uma
 *    folha redesenhada a mao e exatamente o que se quer para desfazer -- e acima
 *    do teto vira resumo.
 * 4. TEXTO ENORME. Mesma logica, sem o resumo geometrico.
 *
 * @param {object} [linha] - a linha crua do banco
 * @param {object} [opcoes]
 * @param {string[]} [opcoes.omitir] - colunas de segredo, do mapa de entidades
 * @returns {object|null}
 */
const sanitizar = (linha, { omitir = [] } = {}) => {
  if (!linha) return null

  const omitirSet = new Set(omitir)
  const saida = {}

  for (const [chave, valor] of Object.entries(linha)) {
    if (omitirSet.has(chave)) {
      // Explicito, e nao ausente: a chave ausente se leria como "esta coluna nao
      // existia", e o que aconteceu foi "existe e nao se guarda".
      saida[chave] = null
      continue
    }

    if (Buffer.isBuffer(valor)) {
      saida[chave] = { _omitido: chave, bytes: valor.length }
      continue
    }

    if (typeof valor === 'string' && Buffer.byteLength(valor, 'utf8') > TETO_VALOR_BYTES) {
      const bytes = Buffer.byteLength(valor, 'utf8')
      // Geometria em EWKT ganha resumo legivel; texto comum so diz o tamanho.
      const pareceGeometria = /^SRID=\d+;[A-Z]/.test(valor)
      saida[chave] = pareceGeometria
        ? {
            _truncado: true,
            bytes,
            resumo: `${tipoGeometrico(valor)}, ${contarVertices(valor)} vertices`
          }
        : { _truncado: true, bytes, resumo: `${valor.slice(0, 200)}...` }
      continue
    }

    saida[chave] = valor
  }

  return saida
}

module.exports = { sanitizar, TETO_VALOR_BYTES }
