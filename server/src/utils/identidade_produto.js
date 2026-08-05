'use strict'

const AppError = require('./app_error')
const httpCode = require('./http_code')

/**
 * Espelha o índice `unique_produto_identidade` com erro LEGÍVEL.
 *
 * A identidade do produto é (mi, escala, tipo, subtipo), e quem a garante de
 * verdade é o índice único do banco (er/acervo.sql). Não há duplicata
 * silenciosa: o banco recusa.
 *
 * O problema que esta função resolve é outro. Estourar o índice devolve erro
 * genérico de restrição, sem dizer QUAL produto já ocupa a identidade nem o que
 * fazer em seguida; e num cadastro em lote, o estouro no último item derruba a
 * transação inteira depois de o operador ter preenchido tudo.
 *
 * O `COALESCE(...,0)` e o recorte `mi IS NOT NULL` são os MESMOS do índice, e
 * têm de continuar sendo: carta especial e campo de instrução têm `mi` nulo e
 * moldura própria, e ficam de fora da regra de propósito.
 *
 * @param {Object} t - conexão ou transação do pg-promise
 * @param {Object} produto - { mi, tipo_escala_id, tipo_produto_id, subtipo_produto_id }
 * @throws {AppError} 409 quando a identidade já existe
 */
async function conferirIdentidadeLivre (t, produto) {
  // Sem `mi` não há regra a aplicar: o índice é parcial.
  if (!produto || !produto.mi) return

  const existente = await t.oneOrNone(
    `SELECT id, nome FROM acervo.produto
      WHERE mi = $<mi>
        AND tipo_escala_id = $<tipoEscalaId>
        AND tipo_produto_id = $<tipoProdutoId>
        AND COALESCE(subtipo_produto_id, 0) = COALESCE($<subtipoProdutoId>, 0)`,
    {
      mi: produto.mi,
      tipoEscalaId: produto.tipo_escala_id,
      tipoProdutoId: produto.tipo_produto_id,
      subtipoProdutoId: produto.subtipo_produto_id ?? null
    }
  )

  if (!existente) return

  throw new AppError(
    `Já existe o produto ${existente.id} ("${existente.nome}") com este MI, escala, ` +
    'tipo e subtipo. Para acrescentar uma versão a ele, use o envio de versão.',
    httpCode.Conflict
  )
}

module.exports = { conferirIdentidadeLivre }
