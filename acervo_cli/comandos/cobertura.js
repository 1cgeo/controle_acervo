'use strict'

// `acervo cobertura` - a pergunta numero um do roteamento de demanda:
// "ja temos essa carta?".
//
//   acervo cobertura --mi 2965-2,2965-4 --escala 50k
//   acervo cobertura --escala 250k --anos 10 --so-faltantes
//   acervo cobertura --inom SF-23-Y-C --json
//
// Por que e um verbo e nao so um GET: a rota devolve uma FeatureCollection por
// escala, com os anos de edicao de carta topografica e de ortoimagem em arrays
// de string. Responder "esta atendida?" a partir disso custa, hoje, carregar o
// GeoJSON inteiro na janela e raciocinar folha a folha. Aqui a saida ja e uma
// linha por folha, com o ano mais recente e o veredito.
//
// Nao ha regra de negocio nova aqui: o veredito e recorte de apresentacao sobre
// o que o servidor mandou (tem edicao? qual a mais recente? passou do corte de
// anos que o usuario pediu?). A regra de quantos anos valem como recente e do
// chefe, e por isso e uma FLAG, nao uma constante escondida no codigo.
//
// E publica: nao gasta login nem token.

const fs = require('fs')
const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')

const ESCALAS = ['25k', '50k', '100k', '250k']

// Tipos que tem area. Ponto e linha dariam intersecao zero e NENHUMA folha
// passaria o limiar, o que pareceria "acervo vazio" em vez de "voce mandou a
// geometria errada". Recusar aqui e mais barato que depurar um zero mentiroso.
const TIPOS_COM_AREA = new Set(['Polygon', 'MultiPolygon'])

/**
 * Extrai as geometrias de area de um GeoJSON (Feature, FeatureCollection,
 * GeometryCollection ou geometria solta). So GeoJSON: ler GPKG ou shapefile
 * exigiria dependencia, e este CLI nao tem nenhuma de proposito. A conversao
 * e uma linha de ogr2ogr, e a mensagem de erro diz qual.
 */
function geometriasDe (raiz) {
  const achadas = []
  const visitar = (no) => {
    if (!no || typeof no !== 'object') return
    if (no.type === 'FeatureCollection') return (no.features || []).forEach(visitar)
    if (no.type === 'Feature') return visitar(no.geometry)
    if (no.type === 'GeometryCollection') return (no.geometries || []).forEach(visitar)
    if (TIPOS_COM_AREA.has(no.type)) achadas.push({ type: no.type, coordinates: no.coordinates })
  }
  visitar(raiz)
  return achadas
}

function lerArea (caminho) {
  let bruto
  try {
    bruto = fs.readFileSync(caminho, 'utf8')
  } catch (err) {
    throw new Error(
      `Nao consegui ler "${caminho}": ${err.message}. ` +
      'O --area aceita GeoJSON. Para GPKG ou shapefile, converta antes: ' +
      'ogr2ogr -f GeoJSON area.geojson area.gpkg'
    )
  }

  let json
  try {
    json = JSON.parse(bruto)
  } catch (err) {
    throw new Error(
      `"${caminho}" nao e JSON valido (${err.message}). O --area aceita GeoJSON; ` +
      'converta GPKG ou shapefile com: ogr2ogr -f GeoJSON area.geojson area.gpkg'
    )
  }

  const geoms = geometriasDe(json)
  if (!geoms.length) {
    throw new Error(
      `"${caminho}" nao tem nenhuma geometria de AREA (Polygon ou MultiPolygon). ` +
      'Ponto e linha nao servem de area de interesse: a intersecao seria zero e ' +
      'nenhuma folha entraria, o que pareceria acervo vazio.'
    )
  }
  return geoms
}

/** Mesma normalizacao do servidor, para o --mi casar apesar de espaco e caixa. */
function norm (s) {
  return s == null ? '' : String(s).trim().toUpperCase().replace(/\s+/g, '')
}

function maisRecente (anos) {
  if (!Array.isArray(anos) || !anos.length) return null
  return anos.map(Number).filter(Number.isFinite).sort((a, b) => b - a)[0] || null
}

async function executar (args, cfg) {
  const flags = args.flags
  const escala = flags.escala && flags.escala !== true ? String(flags.escala) : null
  if (escala && !ESCALAS.includes(escala)) {
    throw new Error(`--escala aceita ${ESCALAS.join(', ')} (recebi "${escala}").`)
  }

  const mi = argsLib.lista(flags.mi)
  const inom = argsLib.lista(flags.inom)
  const anoCorte = argsLib.numero(flags, 'anos', null)
  const hoje = new Date().getFullYear()

  const params = {}
  if (escala) params.escala = escala
  if (mi) params.mi = mi.join(',')
  if (inom) params.inom = inom.join(',')
  if (flags.geom) params.geom = true

  const area = flags.area && flags.area !== true ? String(flags.area) : null
  if (flags.limiar !== undefined && !area) {
    throw new Error('--limiar so faz sentido junto com --area (e a fracao da folha coberta pela area).')
  }

  // Com area, o recorte espacial roda no PostGIS, onde a grade ja esta
  // indexada. Vai por POST porque uma moldura de projeto passa facil do limite
  // de query string, e URL truncada daria resposta errada calada.
  let r
  if (area) {
    const corpo = { intersecta: lerArea(area), limiar: argsLib.numero(flags, 'limiar', 0.01) }
    if (escala) corpo.escala = escala
    if (mi) corpo.mi = mi.join(',')
    if (inom) corpo.inom = inom.join(',')
    if (flags.geom) corpo.geom = true
    r = await http.requisitar(cfg, 'POST', '/integracao/acervo/situacao_geral', { corpo })
  } else {
    r = await http.requisitar(cfg, 'GET', '/integracao/acervo/situacao_geral' + http.query(params))
  }
  const porEscala = r.dados || {}

  if (flags.json) {
    return { texto: JSON.stringify(porEscala, null, 2) }
  }

  const linhas = []
  const avisos = []
  const pedidos = new Set([...(mi || []), ...(inom || [])].map(norm))
  const vistos = new Set()

  for (const [nomeEscala, features] of Object.entries(porEscala)) {
    for (const f of features || []) {
      const p = f.properties || {}
      const topo = maisRecente(p.edicoes_topo)
      const orto = maisRecente(p.edicoes_orto)
      vistos.add(norm(p.identificadorMI))
      vistos.add(norm(p.identificadorINOM))

      const idade = topo ? hoje - topo : null
      let veredito
      if (!topo && !orto) veredito = 'NAO MAPEADO'
      else if (anoCorte !== null && idade !== null && idade > anoCorte) veredito = `DESATUALIZADO (${idade} anos)`
      else if (!topo) veredito = 'SO ORTOIMAGEM'
      else veredito = 'ATENDE'

      if (flags['so-faltantes'] && veredito === 'ATENDE') continue

      linhas.push({
        escala: nomeEscala,
        mi: p.identificadorMI,
        inom: p.identificadorINOM,
        topo_recente: topo,
        edicoes_topo: (p.edicoes_topo || []).length,
        orto_recente: orto,
        veredito
      })
    }
  }

  // Folha pedida que o acervo nem conhece some da resposta do servidor (o filtro
  // e por igualdade). Dizer isso e obrigatorio: "nao veio na lista" e a resposta
  // mais importante da consulta, e a mais facil de perder.
  const ausentes = [...pedidos].filter(id => id && !vistos.has(id))
  if (ausentes.length) {
    avisos.push(
      `Folhas pedidas que NAO existem no acervo (nenhum produto cadastrado nessa ` +
      `celula da grade): ${ausentes.join(', ')}.`
    )
  }

  if (!linhas.length) {
    return {
      texto: flags['so-faltantes']
        ? 'Todas as folhas consultadas atendem ao criterio.'
        : '(nenhuma folha)',
      avisos
    }
  }

  linhas.sort((a, b) => String(a.mi).localeCompare(String(b.mi)))
  const out = saida.lista(linhas, {
    formato: flags.formato || 'tsv',
    campos: argsLib.lista(flags.campos),
    padrao: ['escala', 'mi', 'inom', 'topo_recente', 'edicoes_topo', 'orto_recente', 'veredito']
  })

  const rodape = anoCorte === null
    ? '\nSem regua de recencia. Para marcar o que passou do prazo: --anos 10'
    : `\nRegua: carta com mais de ${anoCorte} anos conta como desatualizada.`

  return { texto: out.texto + rodape, avisos: [...avisos, ...out.avisos] }
}

module.exports = { executar, precisaServidor: true, geometriasDe, lerArea }
