'use strict'

/**
 * Carrega trajetos de viatura (GPX) num campo, pela API que AUDITA.
 *
 * POR QUE PELA API, e nao por SQL: `POST /api/campo/:id/track` grava o track, os
 * pontos e o evento de `auditoria.evento` na MESMA transacao. O carregador do
 * dump do SAP (`carregar_campo_sap.py`) escreve SQL cru porque era uma migracao
 * de historico, com rastro proprio; carga nova nao tem essa licenca.
 *
 * UM TRAJETO POR DIA, e nao por arquivo. `campo.track.dia` e UM dia (coluna
 * DATE), e a view `campo.track_linha` costura TODOS os pontos do track numa
 * linha so, ordenada pelo momento. Um GPX de cinco dias viraria uma linha unica
 * emendando ida e volta entre dias distantes.
 *
 * O DIA E O DE BRASILIA (UTC-3), e nao o do texto do GPX, que e UTC. Um ponto
 * das 02h UTC pertence ao dia ANTERIOR aqui, e partir pelo texto cru jogaria a
 * madrugada de trabalho para o dia seguinte.
 *
 * SECO POR PADRAO. Sem `--gravar` ele NAO toca o servidor: monta o payload real
 * e o valida contra o Joi VIVO do servidor (`campo_schema.track`), que e o mesmo
 * objeto que a rota usa. Dry-run que so imprime a intencao deixa o erro passar.
 *
 * A CREDENCIAL VEM DO AMBIENTE, nunca da linha de comando, onde ficaria no
 * historico do shell e visivel no `ps`:
 *
 *   node scripts/carregar_track_gpx.cjs --campo 45 --pasta "<pasta dos GPX>"
 *
 *   SCA_URL=http://localhost:3015 SCA_USER=<login> SCA_SENHA=<senha> \
 *     node scripts/carregar_track_gpx.cjs --campo 45 --pasta "<pasta>" --limite 1 --gravar
 *
 * `--limite N` e o PILOTO: grava N, rele o destino e para. Rodar de novo sem o
 * limite carrega o resto -- o que ja entrou e reconhecido por (placa, dia) e
 * fica de fora, entao repetir o comando NAO duplica.
 *
 * A pasta chega por ARGUMENTO e nunca e escrita aqui: este repositorio e
 * PUBLICO, e pasta de rede nao entra em arquivo versionado.
 */

const fs = require('fs')
const path = require('path')

const campoSchema = require('../server/src/campo/campo_schema')

// --- Argumentos --------------------------------------------------------------

const args = process.argv.slice(2)
const valorDe = (nome) => {
  const i = args.indexOf(nome)
  return i >= 0 ? args[i + 1] : null
}
const CAMPO_ID = Number(valorDe('--campo'))
const PASTA = valorDe('--pasta')
const GRAVAR = args.includes('--gravar')
// O PILOTO. Lote grande comeca por um, e o numero medido vai a mesa do chefe
// ANTES de escalar: `--limite 1` grava o primeiro trajeto, reLE o destino e para.
const LIMITE = valorDe('--limite') ? Number(valorDe('--limite')) : Infinity
const URL = process.env.SCA_URL || 'http://localhost:3015'

if (!Number.isInteger(CAMPO_ID) || !PASTA) {
  console.error('uso: --campo <id> --pasta <caminho> [--limite N] [--gravar]')
  process.exit(2)
}

// --- Quem estava na viatura --------------------------------------------------
//
// A PLACA E A CHAVE, e nao o nome do militar: a viatura e o que o GPS acompanha,
// e o par chefe/motorista foi confirmado pelo chefe da DGEO em 2026-08-13. O
// posto e o nome de guerra sao COPIADOS do cadastro do campo (`campo_militar` e
// `militares_externos`), e nao digitados de novo: "1º Sgt André" ja existe assim
// em `campo.track` desde a carga do SAP.
const TRIPULACAO = {
  'IXX-5290': { chefe_vtr: '3º Sgt Caio Sabadin', motorista: 'Cb Bueno' },
  'IYM-8743': { chefe_vtr: '1º Sgt André', motorista: 'Cb Freitas' },
  'IYV-8369': { chefe_vtr: '2º Sgt Castro', motorista: 'Cb Areias' }
}

// PONTOS DE MAIS NUM DIA nao sao trajeto. O GPS grava um ou dois pontos logo
// depois da meia-noite, ou traz um ponto velho no arquivo: partido por dia, isso
// vira um "trajeto" de dois pontos que o Joi ACEITA (o piso dele e 2) e que o
// mapa desenha como um risco reto entre duas posicoes distantes.
const MIN_PONTOS_DO_DIA = 10

// --- Leitura do GPX ----------------------------------------------------------

const PONTO = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g
const TEMPO = /<time>([^<]+)<\/time>/
const ELE = /<ele>([-\d.]+)<\/ele>/

// SEM `\b` NA FRENTE DA PLACA: o separador do nome do arquivo e o SUBLINHADO,
// que e caractere de palavra, e entre `_` e `I` nao ha fronteira. Com `\b` os
// catorze arquivos apareciam como "sem placa".
const PLACA = /(?:^|[^A-Za-z0-9])([A-Z]{3})[\s-]?(\d{4})(?![0-9])/

const lerGpx = (texto) => {
  const pontos = []
  let m
  PONTO.lastIndex = 0
  while ((m = PONTO.exec(texto)) !== null) {
    const corpo = m[3] || ''
    const t = TEMPO.exec(corpo)
    const e = ELE.exec(corpo)
    pontos.push({
      longitude: Number(m[2]),
      latitude: Number(m[1]),
      elevacao: e ? Number(e[1]) : null,
      momento: t ? t[1].trim() : null
    })
  }
  return pontos
}

// A placa NORMALIZADA para AAA-0000. A pasta traz uma com espaco e duas com
// traco, e placa e IDENTIFICADOR: duas grafias da mesma viatura viram duas
// viaturas em qualquer agrupamento. `campo.track` ja carrega essa inconsistencia
// de antes (30 linhas com traco, 42 sem), e ela NAO se conserta aqui -- reescrever
// 76 linhas alheias nao e o que esta carga foi mandada fazer.
const placaDo = (nome) => {
  const m = PLACA.exec(nome)
  return m ? `${m[1]}-${m[2]}` : null
}

const diaLocal = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

const chaveDoPonto = p => `${p.momento}|${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`

// --- Montagem ----------------------------------------------------------------

const arquivos = fs.readdirSync(PASTA).filter(n => /\.gpx$/i.test(n)).sort()
const lidos = arquivos.map(nome => ({
  nome,
  placa: placaDo(nome),
  pontos: lerGpx(fs.readFileSync(path.join(PASTA, nome), 'utf8'))
}))

const problemas = []
for (const l of lidos) {
  if (!l.placa) problemas.push(`${l.nome}: sem placa no nome`)
  else if (!TRIPULACAO[l.placa]) problemas.push(`${l.nome}: placa ${l.placa} sem tripulacao declarada`)
  if (!l.pontos.length) problemas.push(`${l.nome}: nenhum trkpt`)
  const semHora = l.pontos.filter(p => !p.momento).length
  if (semHora) problemas.push(`${l.nome}: ${semHora} ponto(s) sem hora, e o dia sai da hora`)
}
if (problemas.length) {
  console.error('PARANDO. O nome do arquivo e a fonte do militar e da placa:')
  for (const p of problemas) console.error('  - ' + p)
  process.exit(1)
}

// ARQUIVO CONTIDO EM OUTRO SAI FORA. Medido ponto a ponto (mesmo instante e
// mesma posicao), e nao pelo nome: o GPS exporta o log acumulado, e um arquivo
// pode repetir inteiro um anterior. Duas linhas identicas no mapa nao se
// distinguem, e a segunda so engorda a contagem.
const conjuntos = new Map(lidos.map(l => [l.nome, new Set(l.pontos.map(chaveDoPonto))]))
const descartados = new Set()
for (const [a, A] of conjuntos) {
  for (const [b, B] of conjuntos) {
    if (a === b || descartados.has(a) || descartados.has(b)) continue
    if (A.size >= B.size) continue
    let comuns = 0
    for (const k of A) if (B.has(k)) comuns++
    if (comuns === A.size) {
      descartados.add(a)
      console.log(`descartado: ${a} (${A.size} pontos) esta INTEIRO dentro de ${b}`)
    }
  }
}

// A CHAVE E (PLACA, DIA), e nao o arquivo. O DDL diz a frase: "um track e UM DIA
// de UMA viatura". A pasta separa ida e volta em arquivos diferentes
// (IDAGUAIRA/VOLTAGUAIRA no dia 30, ida_chapeco/volta_poa no dia 05), e carregar
// um track por arquivo poria DUAS linhas da mesma viatura no mesmo dia. Nao ha
// UNIQUE no banco que barre isso, e e justamente por isso que a juncao e feita
// aqui: o modelo depende de quem escreve.
//
// Nada se perde na juncao: `campo.track` nao tem coluna para o nome do arquivo
// nem descricao, entao a distincao ida/volta nao teria onde morar.
const porViaturaDia = new Map()
for (const l of lidos) {
  if (descartados.has(l.nome)) continue
  for (const p of l.pontos) {
    const d = diaLocal(p.momento)
    const chave = `${l.placa}|${d}`
    if (!porViaturaDia.has(chave)) {
      porViaturaDia.set(chave, {
        dia: d,
        placa_vtr: l.placa,
        ...TRIPULACAO[l.placa],
        arquivos: new Set(),
        pontos: []
      })
    }
    const t = porViaturaDia.get(chave)
    t.arquivos.add(l.nome)
    t.pontos.push(p)
  }
}

const trajetos = []
const fragmentos = []
for (const t of [...porViaturaDia.values()].sort((a, b) =>
  (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.placa_vtr.localeCompare(b.placa_vtr)))) {
  // A ORDEM E A DO TEMPO, e nao a do arquivo: a view costura os pontos pelo
  // `momento`, e ida e volta juntas fora de ordem desenhariam ziguezague.
  t.pontos.sort((x, y) => new Date(x.momento) - new Date(y.momento))
  t.arquivo = [...t.arquivos].join(' + ')
  ;(t.pontos.length < MIN_PONTOS_DO_DIA ? fragmentos : trajetos).push(t)
}

console.log('')
console.log(`fragmentos descartados (menos de ${MIN_PONTOS_DO_DIA} pontos no dia): ${fragmentos.length}`)
for (const f of fragmentos) console.log(`   ${f.arquivo}  ${f.dia}  ${f.pontos.length} pontos`)

// --- O dry-run DE VERDADE: o Joi vivo do servidor -----------------------------

console.log('')
console.log('=== VALIDACAO CONTRA O Joi DO SERVIDOR (campo_schema.track) ===')
let recusados = 0
for (const t of trajetos) {
  const corpo = {
    chefe_vtr: t.chefe_vtr,
    motorista: t.motorista,
    placa_vtr: t.placa_vtr,
    dia: t.dia,
    pontos: t.pontos
  }
  const { error } = campoSchema.track.validate(corpo)
  if (error) {
    recusados++
    console.log(`  RECUSADO  ${t.arquivo} ${t.dia}: ${error.message}`)
  }
}
console.log(recusados
  ? `  ${recusados} de ${trajetos.length} recusados`
  : `  os ${trajetos.length} passam`)

console.log('')
console.log('=== O QUE VAI ENTRAR ===')
for (const t of trajetos) {
  console.log(`  ${t.dia}  ${t.placa_vtr}  ${String(t.pontos.length).padStart(5)} pts  ` +
    `${t.chefe_vtr} / ${t.motorista}   [${t.arquivo}]`)
}
console.log(`  ${trajetos.length} trajetos, ` +
  `${trajetos.reduce((s, t) => s + t.pontos.length, 0)} pontos, no campo ${CAMPO_ID}`)

if (recusados) {
  console.error('')
  console.error('PARANDO: o Joi recusou pelo menos um. Nada foi gravado.')
  process.exit(1)
}

if (!GRAVAR) {
  console.log('')
  console.log('SECO. Nada foi gravado. Repita com --gravar para escrever.')
  process.exit(0)
}

// --- A escrita ---------------------------------------------------------------

// DOIS CAMINHOS PARA O TOKEN, e nenhum deles poe senha na linha de comando.
//
// `--sessao <arquivo>` reaproveita a sessao que os CLIs desta casa ja cacheiam
// em `~/.sca`. E o caminho preferido quando ela existe: ninguem digita senha, e
// a escrita fica atribuida a mesma conta que abriu aquela sessao. O token PODE
// estar vencido -- o `verifyPerfil` do servidor decide, nao este arquivo.
//
// Sem ela, `SCA_USER`/`SCA_SENHA` no AMBIENTE, nunca em argumento, onde ficariam
// no historico do shell e visiveis no `ps`.
const SESSAO = valorDe('--sessao')
const { SCA_USER, SCA_SENHA } = process.env
if (!SESSAO && (!SCA_USER || !SCA_SENHA)) {
  console.error('Informe --sessao <arquivo de ~/.sca>, ou SCA_USER e SCA_SENHA no ambiente.')
  console.error('A senha nunca vai na linha de comando.')
  process.exit(2)
}

const tokenDaSessao = () => {
  const os = require('os')
  const caminho = path.join(os.homedir(), '.sca', SESSAO)
  if (!fs.existsSync(caminho)) {
    console.error(`sessao nao encontrada: ${SESSAO}`)
    process.exit(1)
  }
  const dados = JSON.parse(fs.readFileSync(caminho, 'utf8'))
  const t = dados.token || dados.access_token
  if (!t) {
    console.error(`a sessao ${SESSAO} nao tem token`)
    process.exit(1)
  }
  return t
}

const chamar = async (rota, metodo, corpo, token) => {
  const r = await fetch(URL + rota, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  })
  let json = null
  try { json = await r.json() } catch { /* corpo nao-JSON */ }
  return { status: r.status, json }
}

async function gravar () {
  let token
  if (SESSAO) {
    token = tokenDaSessao()
  } else {
    const login = await chamar('/api/login', 'POST',
      { usuario: SCA_USER, senha: SCA_SENHA, cliente: 'sap_web' })
    token = login.json && login.json.dados && login.json.dados.token
    if (!token) {
      console.error(`login falhou: HTTP ${login.status}`,
        login.json && login.json.message ? login.json.message : '')
      process.exit(1)
    }
  }

  // QUEM VAI ASSINAR A ESCRITA. O rastro de `auditoria.evento` grava esta conta,
  // e ela tem de aparecer ANTES da primeira gravacao: token vencido ou de outra
  // pessoa se descobre aqui, e nao no meio do lote.
  const eu = await chamar('/api/usuarios/perfil', 'GET', null, token)
  if (eu.status !== 200) {
    console.error(`o token nao vale: HTTP ${eu.status}. ` +
      'Abra a sessao de novo, ou use SCA_USER/SCA_SENHA.')
    process.exit(1)
  }
  const quem = eu.json && eu.json.dados ? eu.json.dados : {}
  console.log(`gravando como "${quem.nome_guerra || quem.usuario || '?'}"`)

  // O QUE JA ESTA LA NAO ENTRA DE NOVO. Nao ha UNIQUE em `campo.track`, entao o
  // banco aceitaria a segunda copia caladamente: rodar duas vezes dobraria os
  // trajetos, e o piloto (`--limite 1`) seguido da carga inteira e exatamente o
  // fluxo que produziria isso. A chave e (placa, dia), a mesma do agrupamento.
  const jaLa = await chamar(`/api/campo/${CAMPO_ID}/track`, 'GET', null, token)
  const existentes = new Set(
    ((jaLa.json && jaLa.json.dados) || [])
      .map(t => `${t.placa_vtr}|${String(t.dia).slice(0, 10)}`))

  const pendentes = trajetos.filter(
    t => !existentes.has(`${t.placa_vtr}|${t.dia}`))
  const repetidos = trajetos.length - pendentes.length
  if (repetidos) {
    console.log(`${repetidos} trajeto(s) JA existem no campo ${CAMPO_ID} e ficam de fora`)
  }

  const aGravar = pendentes.slice(0, LIMITE)
  if (aGravar.length < pendentes.length) {
    console.log(`PILOTO: gravando ${aGravar.length} de ${pendentes.length} pendentes`)
  }
  if (!aGravar.length) {
    console.log('nada a gravar.')
    process.exit(0)
  }

  const criados = []
  for (const t of aGravar) {
    const r = await chamar(`/api/campo/${CAMPO_ID}/track`, 'POST', {
      chefe_vtr: t.chefe_vtr,
      motorista: t.motorista,
      placa_vtr: t.placa_vtr,
      dia: t.dia,
      pontos: t.pontos
    }, token)
    if (r.status !== 201 && r.status !== 200) {
      console.error(`FALHOU ${t.arquivo} ${t.dia}: HTTP ${r.status} ` +
        (r.json && r.json.message ? r.json.message : ''))
      console.error(`PARANDO. ${criados.length} trajeto(s) ja entraram e NAO foram desfeitos.`)
      process.exit(1)
    }
    const id = r.json && r.json.dados ? r.json.dados.id : null
    criados.push({ id, dia: t.dia, placa: t.placa_vtr, pontos: t.pontos.length })
    console.log(`  gravado id=${id}  ${t.dia}  ${t.placa_vtr}  ${t.pontos.length} pts`)
  }

  // A PROVA E RELER O DESTINO, e nao o eco do POST. O retorno acima e a
  // ferramenta falando dela mesma; o que conta e o que o servidor DEVOLVE ao ser
  // perguntado de novo, com a linha ja costurada pela view.
  console.log('')
  console.log('=== RELENDO O DESTINO ===')
  const lidosDeVolta = await chamar(`/api/campo/${CAMPO_ID}/track`, 'GET', null, token)
  const lista = (lidosDeVolta.json && lidosDeVolta.json.dados) || []
  console.log(`o servidor devolve ${lista.length} trajeto(s) no campo ${CAMPO_ID}`)

  let divergencias = 0
  for (const c of criados) {
    const achado = lista.find(l => Number(l.id) === Number(c.id))
    if (!achado) {
      console.log(`  AUSENTE id=${c.id}`); divergencias++; continue
    }
    // A CONFERENCIA E CAMPO A CAMPO, e cobre a mesma EXTENSAO da escrita: o dia,
    // a placa e a CONTAGEM de pontos que a view costurou. Contagem menor quer
    // dizer ponto perdido, e um `sem linha` quer dizer que a view nao costurou
    // nada -- os dois passariam por um simples "existe".
    const dia = String(achado.dia).slice(0, 10)
    if (dia !== c.dia) { console.log(`  id=${c.id} dia ${dia} != ${c.dia}`); divergencias++ }
    if (achado.placa_vtr !== c.placa) { console.log(`  id=${c.id} placa divergente`); divergencias++ }
    if (Number(achado.pontos) !== c.pontos) {
      console.log(`  id=${c.id} pontos ${achado.pontos} != ${c.pontos}`); divergencias++
    }
    if (!achado.geometria) { console.log(`  id=${c.id} SEM linha desenhavel`); divergencias++ }
  }
  console.log(divergencias
    ? `  ${divergencias} divergencia(s)`
    : `  os ${criados.length} conferem: dia, placa, contagem de pontos e linha`)
  process.exit(divergencias ? 1 : 0)
}

gravar().catch(err => { console.error('ERRO:', err.message); process.exit(1) })
