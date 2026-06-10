'use strict'
/**
 * Nome físico padronizado e globalmente único para os arquivos do acervo.
 *
 * O servidor reconstrói o caminho de download como
 *   <volume>/<nome_arquivo>.<extensao>
 * (ver server/src/acervo/acervo_ctrl.js). Logo, `nome_arquivo` é a CHAVE
 * FÍSICA do arquivo no volume e precisa ser único, ou edições/anos/escalas
 * diferentes com o mesmo nome base se sobrescrevem silenciosamente.
 *
 * Padrão (ver regras_carga_produtos.md, seção 2.3):
 *   {TIPOPROD}_{MI|slug}_{EDICAO}
 *
 * O identificador (MI) já codifica a escala pelo número de componentes:
 *   2753 -> 1:100.000 ; 2753-1 -> 1:50.000 ; 2753-1-NE -> 1:25.000
 * (1:250.000 usa INOM/MIR, de formato distinto). Logo a escala não precisa
 * entrar no nome — tipo de produto + identificador + edição já é único.
 *
 * Exemplos:
 *   CT_2962-4-NE_ed4   (T34-700, 4ª edição, topográfica 1:25.000)
 *   CT_2753_ed1        (SISFRON 100k, 1ª edição)
 *   CT_2753-1_1dsg     (ET-RDG, 1ª edição DSG, 1:50.000)
 *   CO_2962-4-NE_ed1   (ortoimagem do mesmo MI — tipo distinto)
 *
 * O TIF (principal) e o PDF (alternativo) de uma mesma versão compartilham o
 * mesmo nome base e diferem apenas pela extensão — sem colisão, pois a chave
 * física é (nome_arquivo, extensao).
 */

const ESCALA_SLUG = { 1: '25k', 2: '50k', 3: '100k', 4: '250k' }

const TIPO_PROD_SLUG = {
  1: 'CDGV', 2: 'CT', 3: 'CO', 4: 'ORTO', 5: 'MDS', 6: 'MDT',
  7: 'TEM', 8: 'CDGVTEM', 9: 'M3D', 10: 'PC', 11: 'CDGVCO',
  12: 'INSUMO', 13: 'LEVTOPO'
}

function slug (texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
}

/**
 * Slug da edição a partir do texto da versão e do subtipo.
 *  - ET-RDG ("N-DSG")      -> "Ndsg"
 *  - T34-700 ("Nª Edição") -> "edN"
 */
function edicaoSlug (versao, subtipoProdutoId) {
  const v = String(versao || '').trim()

  let m = v.match(/(\d+)\s*-?\s*DSG/i)
  if (m) return `${m[1]}dsg`

  m = v.match(/(\d+)\s*[ªa]?\s*Edi/i)
  if (m) return `ed${m[1]}`

  if (Number(subtipoProdutoId) === 12) return 'dsg'

  const s = slug(v).toLowerCase()
  return s || 'sed'
}

function escalaSlug ({ escalaCode, denominadorEspecial } = {}) {
  if (ESCALA_SLUG[escalaCode]) return ESCALA_SLUG[escalaCode]
  if (denominadorEspecial) return `e${denominadorEspecial}` // escala personalizada (code 5)
  return 'esp'
}

/**
 * Monta o nome físico padronizado (sem extensão): {TIPOPROD}_{MI|slug}_{EDICAO}.
 *
 * @param {object} p
 * @param {string} [p.mi]                 MI da carta (ex.: "2962-4-NE", "2753"); já codifica a escala
 * @param {number} p.tipoProdutoId        code de dominio.tipo_produto
 * @param {string} p.versao               texto da versão (ex.: "4ª Edição", "1-DSG")
 * @param {number} [p.subtipoProdutoId]   code de dominio.subtipo_produto
 * @param {string} [p.produtoNome]        usado como base quando não há MI (especiais)
 */
function nomeArquivoPadrao ({ mi, tipoProdutoId, versao, subtipoProdutoId, produtoNome }) {
  const base = mi ? String(mi).toUpperCase() : slug(produtoNome)
  const tp = TIPO_PROD_SLUG[tipoProdutoId] || `TP${tipoProdutoId}`
  const ed = edicaoSlug(versao, subtipoProdutoId)
  return `${tp}_${base}_${ed}`
}

module.exports = { nomeArquivoPadrao, edicaoSlug, escalaSlug, slug, ESCALA_SLUG, TIPO_PROD_SLUG }
