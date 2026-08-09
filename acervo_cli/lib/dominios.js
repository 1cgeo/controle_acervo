'use strict'

const path = require('path')

// Traduz nome amigavel para o code do dominio: --escala 50k vira
// tipo_escala_id=2, --tipo carta-topografica vira tipo_produto_id=2.
//
// Por que isto existe: o acervo e todo dirigido por id numerico de dominio, e
// trocar 50k (code 2) por 250k (code 4) de cabeca ja custou uma auditoria
// inteira rodada na escala errada. O CLI e a camada certa para nunca mais o
// agente ter que decorar numero.
//
// De onde vem o mapa: do proprio utils/domain_constants.js do server/, lido ao
// vivo. Nao ha catalogo copiado aqui; os apelidos sao DERIVADOS do nome da
// constante (ESCALA_50K -> "50k", CARTA_TOPOGRAFICA -> "carta-topografica").
//
// Limite honesto e declarado: nem toda tabela de dominio esta INTEIRA no
// domain_constants.js. Onde ela nao esta, um nome que nao resolve aqui NAO vira
// erro seco: manda o agente para `acervo dominio <tabela>`, que le a tabela viva
// pela rota publica. Offline resolve o que da; a fonte completa e o servidor.
//
// `subtipo_produto` DEIXOU DE SER SUBCONJUNTO em 2026-08-09: ele tinha 5 dos 30
// codigos e passou a ter os 30, quando o core de producao precisou deles para
// escolher template de metadado. `tipo_produto` continua parcial (5 de 13), e e
// ele que sustenta o aviso agora. Conferir e comparar com `er/dominio.sql`, e
// nao com a memoria: virar `completa: true` sem os codigos todos faria o CLI
// afirmar que nao achou o que existe.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

function constantes () {
  return require(path.join(RAIZ_SERVER, 'utils', 'domain_constants'))
}

// Nome do grupo de constantes que corresponde a cada tabela de dominio, e o
// nome do campo que o carrega nos corpos da API.
const TABELAS = {
  tipo_escala: { grupo: 'TIPO_ESCALA', campo: 'tipo_escala_id', completa: true },
  tipo_produto: { grupo: 'TIPO_PRODUTO', campo: 'tipo_produto_id', completa: false },
  subtipo_produto: { grupo: 'SUBTIPO_PRODUTO', campo: 'subtipo_produto_id', completa: true },
  tipo_arquivo: { grupo: 'TIPO_ARQUIVO', campo: 'tipo_arquivo_id', completa: true },
  tipo_versao: { grupo: 'TIPO_VERSAO', campo: 'tipo_versao_id', completa: true },
  tipo_status_arquivo: { grupo: 'STATUS_ARQUIVO', campo: 'tipo_status_id', completa: true },
  situacao_carregamento: { grupo: 'SITUACAO_CARREGAMENTO', campo: 'situacao_carregamento_id', completa: true },
  tipo_relacionamento: { grupo: 'TIPO_RELACIONAMENTO', campo: 'tipo_relacionamento_id', completa: true }
}

/** ESCALA_25K -> ['escala-25k', '25k']; CARTA_TOPOGRAFICA -> ['carta-topografica']. */
function apelidos (nomeConstante) {
  const base = nomeConstante.toLowerCase().replace(/_/g, '-')
  const saida = [base]
  // Prefixo redundante quando o proprio nome da tabela ja diz do que se trata:
  // em tipo_escala, "escala-50k" e "50k" sao a mesma coisa, e a segunda e a que
  // o chefe escreve.
  const curto = base.replace(/^(escala|carta|tipo)-/, '')
  if (curto !== base) saida.push(curto)
  return saida
}

/** { apelido -> code } de uma tabela. */
function mapaDe (tabela) {
  const meta = TABELAS[tabela]
  if (!meta) return null
  const grupo = constantes()[meta.grupo]
  if (!grupo) return null

  const mapa = new Map()
  for (const [nome, code] of Object.entries(grupo)) {
    for (const apelido of apelidos(nome)) {
      // Primeiro a registrar vence: um apelido curto ambiguo (duas constantes
      // que colapsam no mesmo nome) nao pode sobrescrever em silencio.
      if (!mapa.has(apelido)) mapa.set(apelido, code)
    }
  }
  return mapa
}

/**
 * Resolve um valor para o code do dominio.
 * Numero passa direto (quem ja sabe o code nao e obrigado a usar apelido).
 * @returns {number}
 */
function resolver (tabela, valor) {
  if (valor === undefined || valor === null || valor === true || valor === '') {
    throw new Error(`Valor vazio para o dominio ${tabela}.`)
  }
  const texto = String(valor).trim()
  if (/^\d+$/.test(texto)) return Number(texto)

  const mapa = mapaDe(tabela)
  if (!mapa) {
    throw new Error(
      `Dominio "${tabela}" nao tem apelidos conhecidos; passe o code numerico. ` +
      `Tabela viva: acervo dominio ${tabela}`
    )
  }

  const chave = texto.toLowerCase().replace(/[_\s]+/g, '-')
  if (mapa.has(chave)) return mapa.get(chave)

  const meta = TABELAS[tabela]
  const conhecidos = [...mapa.keys()].sort().join(', ')
  throw new Error(
    `"${texto}" nao e um valor conhecido de ${tabela}.\n` +
    `Apelidos que o CLI resolve offline: ${conhecidos}.\n` +
    (meta.completa
      ? `Ou passe o code numerico. Tabela viva: acervo dominio ${tabela}`
      : `Atencao: o CLI so conhece offline o SUBCONJUNTO de ${tabela} que o servidor usa em query.\n` +
        `A tabela inteira esta no servidor: acervo dominio ${tabela}`)
  )
}

/** Nome do campo de corpo/query que carrega este dominio (tipo_escala -> tipo_escala_id). */
function campoDe (tabela) {
  return TABELAS[tabela] ? TABELAS[tabela].campo : null
}

/** Rotulo legivel a partir do code, para a saida ("2" -> "ESCALA_50K"). */
function rotuloDe (tabela, code) {
  const meta = TABELAS[tabela]
  if (!meta) return null
  const grupo = constantes()[meta.grupo] || {}
  const achado = Object.entries(grupo).find(([, v]) => v === Number(code))
  return achado ? achado[0] : null
}

function listarTabelas () {
  return Object.keys(TABELAS)
}

module.exports = { resolver, campoDe, rotuloDe, mapaDe, listarTabelas, TABELAS }
