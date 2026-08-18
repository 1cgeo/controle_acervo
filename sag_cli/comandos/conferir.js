'use strict'

const argsLib = require('../lib/args')
const http = require('../lib/http')
const contrato = require('../lib/contrato')
const consulta = require('../lib/consulta')
const saida = require('../lib/saida')
const valores = require('../lib/valores')
const sca = require('../lib/sca')
const { resolverSca } = require('../lib/config')
const { documento } = require('../lib/documentos')

// `sag conferir` e a razao de este CLI existir.
//
// Ele poe lado a lado o que o SIAFI registrou (pelo SAG) e o que o SCA guarda,
// e diz onde os dois discordam. Duas medidas independentes do mesmo fato: e o
// unico jeito de saber que o modulo orcamento esta certo, porque conferir o SCA
// com ele mesmo nao prova nada.
//
// ELE NAO ESCREVE. A saida e um relatorio, mais os corpos JSON prontos para o
// orcamento_cli quando se pede --corpo. Quem grava e o orcamento_cli, com os
// guardrails dele. Um caminho de escrita a mais seria uma segunda porta para o
// mesmo banco, com metade da protecao.

const RECURSOS = {
  nc: {
    caminho: '/orcamento/notas_credito',
    rotulo: 'notas de credito',
    // O DOCUMENTO DE ANULACAO NAO E NOTA DE CREDITO NO SCA. O SIAFI devolve
    // credito por uma NC de ND 339000 ou 449000, e o SCA guarda isso no recurso
    // `recolhimento`, uma linha por NC que o documento abate. Sem olhar essa
    // segunda tabela, o conferir reporta cada anulacao como "falta cadastrar"
    // para sempre: eram 27 falsos positivos permanentes em 2026, medidos em
    // 2026-08-18, e eles empurram para o operador um cadastro que ja existe.
    //
    // A chave NAO leva cod_nd. As ND de anulacao nao estao no dominio de ND do
    // SCA, entao o recolhimento grava cod_nd nulo e registra a ND na
    // observacao. Casar por ND aqui nao acharia nenhum.
    recolhimento: {
      caminho: '/orcamento/recolhimentos',
      chave: ['numero', 'ug_emitente'],
      campoValor: 'valor'
    },
    // Campos comparados alem da chave. `converter` traz o valor do SAG para a
    // forma do SCA antes de comparar: 20.710,00 contra 20710 nao e divergencia.
    comparar: [
      { campo: 'valor_nc', sag: 'VALOR_NC', tipo: 'valor' },
      { campo: 'data_emissao', sag: 'DATA_EMISSAO', tipo: 'data' }
    ]
  },
  ne: {
    caminho: '/orcamento/notas_empenho',
    rotulo: 'notas de empenho',
    comparar: [
      {
        campo: 'valor_empenhado',
        sag: 'VALOR_NE',
        tipo: 'valor',
        // O SAG ENTREGA O VALOR JA LIQUIDO DE ANULACAO, e o SCA guarda os dois
        // lados em campos separados. Medido na 2026NE000002 em 2026-08-07: ela
        // tem um item de +1.727,48 e outro de -1.727,48, e `VALOR_NE` sai
        // 0,00. Comparar esse zero com o `valor_empenhado` bruto do SCA acusa
        // divergencia em toda NE que teve anulacao, que sao justamente as que
        // mais precisam de conferencia.
        //
        // A 4.1 do RPCMTec soma exatamente esta diferenca
        // (`valor_empenhado - valor_anulado`), entao e ela que se compara.
        noSca: registro =>
          (valores.numero(registro.valor_empenhado) || 0) -
          (valores.numero(registro.valor_anulado) || 0)
      },
      { campo: 'data_empenho', sag: 'DATA_EMISSAO', tipo: 'data' }
    ]
  }
}

// Identidade de cada documento no SCA, quando o documento nao declara a sua.
const CHAVE_PADRAO = ['numero']

/**
 * Chave de casamento, na identidade que o SCA usa para AQUELE documento.
 *
 * A NC e (numero, cod_nd, ug_emitente), porque a numeracao do SIAFI e por
 * emitente e uma NC de duas ND entra duas vezes. A NE e so o numero.
 *
 * A chave TEM DE SAIR DO DOCUMENTO, e nao ser fixa: com a chave da NC aplicada
 * a NE, o lado do SAG entraria com cod_nd vazio e o lado do SCA com a ND
 * herdada da NC, e nenhum empenho casaria. O relatorio diria que o SCA esta
 * inteiro vazio, que e o modo de falhar mais convincente que existe.
 */
function chaveDe (registro, chave = CHAVE_PADRAO) {
  return chave
    .map(campo => (campo === 'numero'
      ? valores.documentoCurto(registro[campo]) || ''
      : registro[campo] || ''))
    .join('|')
}

/** Traduz uma linha do SAG para os nomes de campo do SCA. */
function traduzir (linha, mapa) {
  const saidaLinha = {}
  for (const [origem, destino] of Object.entries(mapa)) {
    let valor = linha[origem]
    if (destino === 'numero') valor = valores.documentoCurto(valor)
    if (destino === 'data_emissao' || destino === 'data_empenho') valor = valores.paraIso(valor)
    if (destino === 'valor_nc' || destino === 'valor_empenhado') valor = valores.numero(valor)
    saidaLinha[destino] = valor === '' ? null : valor
  }
  return saidaLinha
}

/**
 * Reduz as linhas do SAG a UM registro por chave do SCA.
 *
 * O SAG lista por ITEM do documento; o SCA guarda por documento e ND. Sem esta
 * reducao, uma NC de dois itens apareceria duas vezes e a segunda sobrescreveria
 * a primeira, perdendo metade do valor sem nada acusar.
 *
 * Os campos de `doc.somar` se acumulam; os demais ficam com o primeiro valor,
 * que e o mesmo em todas as linhas da chave (numero, data, ND, historico).
 * Documento sem `somar` declarado e DEDUPLICADO, nunca somado: somar o total
 * repetido de um empenho o multiplicaria pelo numero de itens.
 */
function agrupar (linhas, doc) {
  const mapa = new Map()
  let agrupadas = 0

  for (const linha of linhas) {
    const traduzida = traduzir(linha, doc.paraSca)
    const chave = chaveDe(traduzida, doc.chave)
    const existente = mapa.get(chave)

    if (!existente) {
      mapa.set(chave, { bruto: linha, traduzida })
      continue
    }

    agrupadas++
    for (const campo of doc.somar || []) {
      const acumulado = valores.numero(existente.traduzida[campo])
      const novo = valores.numero(traduzida[campo])
      if (acumulado === null && novo === null) continue
      existente.traduzida[campo] = (acumulado || 0) + (novo || 0)
    }
  }

  return { mapa, agrupadas }
}

/**
 * Indexa a tabela de recolhimentos do SCA por documento do SIAFI.
 *
 * Um documento de anulacao pode ratear entre VARIAS NCs (a 2026NC401316 abate
 * R$ 0,98 de uma e R$ 0,99 de outra), e ai ele entra uma vez por alvo. Somar
 * por chave antes de comparar e o que permite conferir o documento inteiro
 * contra o valor que o SAG declara. Sem a soma, cada parcela pareceria
 * divergencia de valor.
 */
function indexarRecolhimentos (linhas, chave, campoValor) {
  const mapa = new Map()
  for (const linha of linhas) {
    const k = chaveDe(linha, chave)
    const valor = valores.numero(linha[campoValor]) || 0
    const atual = mapa.get(k)
    if (atual) {
      atual.valor += valor
      atual.linhas++
      continue
    }
    mapa.set(k, { numero: linha.numero, valor, linhas: 1 })
  }
  return mapa
}

async function executar (args, cfg) {
  const alvo = String(args._[1] || '').toLowerCase()
  const recurso = RECURSOS[alvo]
  if (!recurso) {
    throw new Error(
      `sag conferir aceita: ${Object.keys(RECURSOS).join(', ')}. ` +
      'Os demais documentos ainda nao tem par no SCA.'
    )
  }

  const doc = documento(alvo)
  const ano = argsLib.numero(args.flags, 'ano', null)
  if (!ano) throw new Error('Informe --ano (ex.: --ano 2026): a comparacao e por exercicio.')

  const formato = args.flags.json ? 'json' : (args.flags.formato || 'tabela')
  const avisos = []

  // ---- lado SAG ----
  const sessao = await http.sessaoValida(cfg)
  const { texto: html } = await sessao.requisitar('GET', `/php/${doc.pagina}.php`)
  const lido = contrato.ler(html)

  const campos = doc.padrao
  contrato.conferirColunas(lido, campos)

  const formulario = { DATAINI: `01/01/${ano}`, DATAFIM: `31/12/${ano}` }
  const ugFav = args.flags['ug-fav']
  if (ugFav && ugFav !== true) formulario['UG_FAV[]'] = argsLib.lista(ugFav)

  const acao = args.flags.acao
  if (acao && acao !== true) {
    formulario['ACAO[]'] = argsLib.lista(acao)
  } else {
    avisos.push(
      'Sem --acao, o lado SAG traz TODO o credito da UG, e o SCA guarda so o da ' +
      'DGEO. O grupo "so no SAG" vai vir grande por construcao, e nao por defeito. ' +
      'Use --acao 20XE para recortar o credito da Divisao.'
    )
  }

  const doSag = await consulta.executar(sessao, doc, campos, formulario, {})
  if (doSag.truncado) {
    throw new Error(
      `A consulta ao SAG voltou truncada (${doSag.truncado} de ${doSag.total} ` +
      'registros de fora). Comparar assim acusaria falta que nao existe.'
    )
  }

  // ---- lado SCA ----
  const cfgSca = resolverSca(args.flags)
  const doSca = await sca.listar(cfgSca, recurso.caminho, { ano })

  // Segunda tabela do lado do SCA, quando o recurso tem uma (ver RECURSOS.nc).
  const mapaRecolh = recurso.recolhimento
    ? indexarRecolhimentos(
      await sca.listar(cfgSca, recurso.recolhimento.caminho, { ano }),
      recurso.recolhimento.chave,
      recurso.recolhimento.campoValor
    )
    : new Map()

  // ---- comparacao ----
  const { mapa: mapaSag, agrupadas } = agrupar(doSag.linhas, doc)
  if (agrupadas) {
    avisos.push(
      `${agrupadas} linha${agrupadas === 1 ? '' : 's'} do SAG ${agrupadas === 1 ? 'era' : 'eram'} ` +
      `item de um documento ja listado, e ${agrupadas === 1 ? 'foi somada' : 'foram somadas'} ` +
      'na chave correspondente. O SAG lista por item; o SCA, por documento e ND.'
    )
  }

  // DUPLICATA NO SCA NAO SE DESCARTA, e este bloco existe porque a versao
  // anterior a descartava. Um `Map` guarda o ultimo registro de cada chave, e
  // 2026NE000005 tem DOIS no SCA (R$ 20.710,00 e R$ 8.799,82): a comparacao
  // pegava um deles por ordem de listagem e reportava divergencia de valor
  // contra o SAG, quando o problema e que existem duas linhas para o mesmo
  // empenho. O relatorio acusava o defeito errado, com toda a aparencia de
  // estar certo.
  //
  // A NE nao tem indice unico de numero no SCA (a NC tem,
  // uniq_nota_credito_num_nd_ug), entao isto e detectavel so aqui.
  const mapaSca = new Map()
  const duplicadosSca = []
  for (const registro of doSca) {
    const chave = chaveDe(registro, doc.chave)
    const anterior = mapaSca.get(chave)
    if (anterior) {
      duplicadosSca.push({
        numero: registro.numero,
        ids: `${anterior.id} e ${registro.id}`,
        valores: [anterior, registro]
          .map(r => r.valor_nc ?? r.valor_empenhado)
          .join(' / ')
      })
      continue
    }
    mapaSca.set(chave, registro)
  }

  const soNoSag = []
  const soNoSca = []
  const divergentes = []
  // Documentos que EXISTEM no SCA, so que na segunda tabela.
  const comoRecolhimento = []
  const recolhDivergentes = []
  const casadosComoRecolh = new Set()
  const chavesSagCurta = new Set()

  for (const [chave, { bruto, traduzida }] of mapaSag) {
    if (recurso.recolhimento) {
      chavesSagCurta.add(chaveDe(traduzida, recurso.recolhimento.chave))
    }
    const noSca = mapaSca.get(chave)
    if (!noSca) {
      // ANTES de acusar falta, procure na segunda tabela. Acusar cadastro que
      // ja existe custa o trabalho de alguem, e desgasta a confianca no
      // relatorio inteiro.
      const noRecolh = recurso.recolhimento
        ? mapaRecolh.get(chaveDe(traduzida, recurso.recolhimento.chave))
        : null
      if (noRecolh) {
        casadosComoRecolh.add(chave)
        const linha = {
          numero: traduzida.numero,
          nd: traduzida.cod_nd,
          alvos: noRecolh.linhas,
          no_sag: String(traduzida.valor_nc),
          no_sca: String(noRecolh.valor)
        }
        if (valores.mesmoValor(traduzida.valor_nc, noRecolh.valor)) {
          comoRecolhimento.push(linha)
        } else {
          recolhDivergentes.push(linha)
        }
        continue
      }
      soNoSag.push({
        numero: traduzida.numero,
        nd: traduzida.cod_nd,
        ug_emitente: traduzida.ug_emitente,
        data: traduzida.data_emissao || traduzida.data_empenho,
        valor: traduzida.valor_nc ?? traduzida.valor_empenhado,
        acao: bruto.DESTINO_ACAO || bruto.ACAO || '',
        historico: saida.encurtar(String(bruto.OBS || ''), 70)
      })
      continue
    }
    for (const regra of recurso.comparar) {
      const doLado = traduzida[regra.campo]
      // `noSca` deixa a regra derivar o valor do lado do SCA quando os dois
      // sistemas nao guardam a mesma grandeza no mesmo campo.
      const doOutro = regra.noSca ? regra.noSca(noSca) : noSca[regra.campo]
      const igual = regra.tipo === 'valor'
        ? valores.mesmoValor(doLado, doOutro)
        : valores.paraIso(doLado) === valores.paraIso(doOutro)
      // Campo ausente dos DOIS lados nao e divergencia.
      if (igual || (doLado == null && doOutro == null)) continue
      divergentes.push({
        numero: traduzida.numero,
        nd: traduzida.cod_nd,
        campo: regra.campo,
        no_sag: doLado === null ? '-' : String(doLado),
        no_sca: doOutro === null || doOutro === undefined ? '-' : String(doOutro)
      })
    }
  }

  for (const [chave, registro] of mapaSca) {
    if (mapaSag.has(chave)) continue
    soNoSca.push({
      id: registro.id,
      numero: registro.numero,
      nd: registro.cod_nd,
      ug_emitente: registro.ug_emitente || '-',
      valor: registro.valor_nc ?? registro.valor_empenhado
    })
  }

  const recolhSoNoSca = []
  for (const [chave, registro] of mapaRecolh) {
    if (chavesSagCurta.has(chave)) continue
    recolhSoNoSca.push({
      numero: registro.numero,
      alvos: registro.linhas,
      valor: registro.valor
    })
  }

  const resumo = {
    exercicio: ano,
    no_sag: mapaSag.size,
    no_sca: mapaSca.size,
    so_no_sag: soNoSag.length,
    so_no_sca: soNoSca.length,
    divergentes: divergentes.length,
    duplicados_no_sca: duplicadosSca.length,
    recolhimentos_no_sca: mapaRecolh.size,
    como_recolhimento: comoRecolhimento.length,
    recolhimentos_divergentes: recolhDivergentes.length,
    recolhimentos_so_no_sca: recolhSoNoSca.length
  }

  if (formato === 'json') {
    return {
      texto: JSON.stringify(
        {
          resumo,
          soNoSag,
          soNoSca,
          divergentes,
          duplicadosSca,
          comoRecolhimento,
          recolhDivergentes,
          recolhSoNoSca
        },
        null,
        2
      ),
      avisos
    }
  }

  const partes = []
  partes.push(`Conferencia de ${recurso.rotulo}, exercicio ${ano}`)
  partes.push(`  SAG ${resumo.no_sag}   SCA ${resumo.no_sca}` +
    (recurso.recolhimento ? ` (mais ${resumo.recolhimentos_no_sca} recolhimentos)` : ''))
  partes.push('')

  const bloco = (titulo, linhas) => {
    partes.push(`${titulo} (${linhas.length})`)
    partes.push(linhas.length
      ? saida.lista(linhas, { formato: 'tabela', largura: 70 }).texto
      : '  (nenhum)')
    partes.push('')
  }

  const soDiferencas = args.flags['so-diferencas'] === true
  // Duplicata vem PRIMEIRO: enquanto ela existir, as divergencias de valor
  // daquele numero nao sao confiaveis, porque a comparacao escolheu um dos dois.
  if (duplicadosSca.length) {
    bloco('NUMERO REPETIDO NO SCA (conferir isto antes das divergencias)',
      duplicadosSca.map(d => ({ numero: d.numero, ids: d.ids, valores: d.valores })))
  }
  // O valor do documento de anulacao tem de fechar com a soma dos alvos que ele
  // abate. Quando nao fecha, ou falta um alvo ou uma parcela esta errada, e isso
  // e defeito de dado, nao cadastro faltando.
  if (recolhDivergentes.length) {
    bloco('RECOLHIMENTO COM VALOR DIVERGENTE DO DOCUMENTO', recolhDivergentes)
  }
  bloco('FALTA CADASTRAR NO SCA', soNoSag)
  bloco('DIVERGEM EM VALOR OU DATA', divergentes)
  if (!soDiferencas) {
    if (comoRecolhimento.length) {
      bloco('JA CADASTRADO COMO RECOLHIMENTO (nao e pendencia)', comoRecolhimento)
    }
    bloco('SO NO SCA (sem par no SAG)', soNoSca)
    // Este grupo e o reverso do anterior e sofre do MESMO recorte: com --acao,
    // todo recolhimento das outras acoes cai aqui por construcao. Ele fica
    // junto do "so no SCA" e fora do --so-diferencas de proposito, para nao
    // aparecer como alarme no topo do relatorio.
    if (recolhSoNoSca.length) {
      bloco('RECOLHIMENTO SO NO SCA (mesmo recorte do grupo acima)', recolhSoNoSca)
    }
  } else if (comoRecolhimento.length) {
    partes.push(
      `${comoRecolhimento.length} documento(s) de anulacao casaram com recolhimento ` +
      'no SCA e ficaram fora de "falta cadastrar".'
    )
    partes.push('')
  }

  if (args.flags.corpo === true && soNoSag.length) {
    partes.push('CORPOS PARA O orcamento_cli (confira antes de gravar):')
    for (const [, { traduzida }] of mapaSag) {
      const chaveDoc = chaveDe(traduzida, doc.chave)
      if (mapaSca.has(chaveDoc)) continue
      // Anulacao ja cadastrada como recolhimento nao vira corpo de NC: gravar
      // esse corpo criaria uma nota de credito que o SIAFI nunca emitiu.
      if (casadosComoRecolh.has(chaveDoc)) continue
      partes.push('  ' + JSON.stringify({ ...traduzida, ano }))
    }
    partes.push('')
    partes.push('  Grave com: orcamento nc criar --data \'{...}\' --dry-run')
  }

  return { texto: partes.join('\n'), avisos }
}

module.exports = {
  executar,
  precisaServidor: true,
  chaveDe,
  traduzir,
  agrupar,
  indexarRecolhimentos,
  RECURSOS
}
