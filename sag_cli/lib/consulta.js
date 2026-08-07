'use strict'

const { semTags } = require('./contrato')

// A consulta do SAG e um DataTables com carga no servidor. O client web chama
//   /php/chamadas/<pagina>.php?metodo=tela&fase=<load|change>&<formulario>
// e recebe { data: [[celula, ...], ...], iTotalDisplayRecords: N }.
//
// As celulas voltam na ORDEM em que as colunas foram pedidas em coluna[], e sem
// nome: o cabecalho e conhecimento de quem perguntou. E por isso que este
// modulo devolve objetos, e nao a matriz crua.

const PAGINA_PADRAO = 500

/**
 * `fase` reproduz o que o JS da tela faz: 'load' quando ha UG favorecida
 * escolhida, 'change' quando nao ha. O comentario no fonte do SAG explica o
 * porque (o WHERE de UG fica grande demais sem recorte), e nos so obedecemos.
 */
function faseDa (formulario) {
  const ug = formulario['UG_FAV[]']
  return Array.isArray(ug) ? (ug.length ? 'load' : 'change') : (ug ? 'load' : 'change')
}

/**
 * Monta os parametros de uma pagina de consulta.
 * `campos` sao as colunas pedidas, na ordem em que voltarao.
 */
function parametros (campos, formulario, inicio, tamanho) {
  return Object.assign({}, formulario, {
    metodo: 'tela',
    fase: faseDa(formulario),
    sEcho: '1',
    sSearch: '',
    iDisplayStart: String(inicio),
    iDisplayLength: String(tamanho),
    'coluna[]': campos
  })
}

function paraQuery (params) {
  const partes = []
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === null) continue
    for (const v of (Array.isArray(valor) ? valor : [valor])) {
      partes.push(encodeURIComponent(chave) + '=' + encodeURIComponent(String(v)))
    }
  }
  return partes.join('&')
}

/**
 * Executa a consulta inteira, paginando ate o total que o proprio SAG informa.
 *
 * NUNCA CORTA EM SILENCIO. Quando `limite` trunca o resultado, o corte volta em
 * `truncado` para o chamador avisar. Resultado cortado sem aviso e o defeito
 * classico deste tipo de integracao: some registro e a soma continua parecendo
 * plausivel.
 *
 * @returns {{linhas: Array<Object>, total: number, truncado: number}}
 */
async function executar (sessao, doc, campos, formulario, opcoes = {}) {
  const limite = opcoes.limite || Infinity
  const tamanho = Math.min(opcoes.pagina || PAGINA_PADRAO, limite)
  const linhas = []
  let total = null
  let inicio = 0

  while (true) {
    const params = parametros(campos, formulario, inicio, tamanho)
    const { texto } = await sessao.requisitar(
      'GET', `/php/chamadas/${doc.pagina}.php?${paraQuery(params)}`
    )

    let payload
    try {
      payload = JSON.parse(texto)
    } catch (e) {
      // A tela devolve HTML quando a sessao caiu ou o parametro nao serve. O
      // JSON.parse falharia com "Unexpected token <", que nao ensina nada.
      throw new Error(
        'O SAG respondeu algo que nao e JSON. Costuma ser sessao expirada ' +
        '(rode `sag login`) ou filtro que a tela nao aceita. ' +
        `Inicio da resposta: ${semTags(texto).slice(0, 160)}`
      )
    }

    const dados = payload.data || payload.aaData || []
    if (total === null) {
      total = Number(
        payload.iTotalDisplayRecords ?? payload.iTotalRecords ?? dados.length
      )
    }

    for (const linha of dados) {
      linhas.push(montar(campos, linha))
    }

    inicio += dados.length
    if (!dados.length || linhas.length >= Math.min(total, limite)) break
  }

  const truncado = Number.isFinite(limite) && total > linhas.length ? total - linhas.length : 0
  return { linhas, total, truncado }
}

/** Casa a matriz de celulas com os nomes das colunas pedidas. */
function montar (campos, celulas) {
  const registro = {}
  campos.forEach((campo, i) => {
    registro[campo] = semTags(celulas[i] === undefined || celulas[i] === null ? '' : celulas[i])
  })
  return registro
}

module.exports = { executar, parametros, paraQuery, faseDa, montar, PAGINA_PADRAO }
