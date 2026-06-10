'use strict'
/**
 * Carga dos CDGV do lote 2021_SISFRON_Generalizacao_100k
 * (Y:\Produtos_2021\2021_SISFRON_Generalizacao_100k\CDGV\{MI}.zip).
 *
 * Cada CDGV é o Conjunto de Dados Geoespaciais Vetoriais (ET-EDGV 2.1.3) que
 * serve de INSUMO à carta topográfica 1:100.000 correspondente (já carregada).
 *
 * Modelagem (confirmada com o usuário):
 *  - tipo_produto = CDGV (1); subtipo = ET-EDGV 2.1.3 (1); escala 1:100.000 (3).
 *  - O arquivo do CDGV é o próprio .zip (camadas SHP dentro) -> Arquivo Principal.
 *  - CRS do conjunto = EPSG:4674 (lido dos .prj).
 *  - versão "1ª Edição" (tipo_versao_id=2, histórico); mesmo lote da CT.
 *  - Relacionamento: a versão da CT tem o CDGV como Insumo
 *    (versao_relacionamento: versao_id_1=CT, versao_id_2=CDGV, tipo=1).
 *
 * Requer a carga das CTs (carga_2021_sisfron_100k.cjs) já feita.
 * Uso: node carga_2021_sisfron_100k_cdgv.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { titleCasePt } = require('./title_case.cjs')
const { nomeArquivoPadrao } = require('./nome_arquivo.cjs')
const pgp = require('D:/desenvolvimento/controle_acervo/server/node_modules/pg-promise')()

const API = 'http://localhost:3015/api'
const USUARIO = 'claude'
const SENHA = 'claude'

const FONTE = 'Y:/Produtos_2021/2021_SISFRON_Generalizacao_100k/CDGV'
const VOLUME_HOST = '10.25.163.8'
const DADOS = path.join(__dirname, 'sisfron_2021_100k_dados.json')
const MARGINAIS = path.join(__dirname, 'sisfron_2021_100k_marginais.json')

// Domínios
const TIPO_PRODUTO_CDGV = 1
const TIPO_PRODUTO_CT = 2
const TIPO_ESCALA_100K = 3
const SUBTIPO_EDGV_213 = 1
const TIPO_VERSAO_HISTORICO = 2
const TIPO_ARQUIVO_PRINCIPAL = 1
const TIPO_RELACIONAMENTO_INSUMO = 1
const SITUACAO_NAO_CARREGADO_BDGEX = 1
const LOTE_NOME = '2021_SISFRON_Generalizacao_100k'

const db = pgp({ host: 'localhost', port: 5432, database: 'sca', user: 'claude', password: 'claude' })
let token = null

async function api (method, endpoint, body, _retry = true) {
  let res
  try {
    res = await fetch(`${API}/${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (e) {
    if (_retry) return api(method, endpoint, body, false)
    throw e
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    throw new Error(`${method} ${endpoint} -> ${res.status}: ${json.message || JSON.stringify(json)}`)
  }
  return json
}

function sha256 (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function ringParaEwkt (ring) {
  const coords = ring.map(([x, y]) => `${x} ${y}`).join(',')
  return `SRID=4674;POLYGON((${coords}))`
}

// timestamptz + servidor em America/Sao_Paulo: fixar meio-dia local
function diaLocal (yyyymmdd) {
  return `${yyyymmdd}T12:00:00-03:00`
}

async function main () {
  const login = await api('POST', 'login', { usuario: USUARIO, senha: SENHA, cliente: 'sca_qgis' })
  token = login.dados.token
  console.log('Login OK (admin:', login.dados.administrador + ')')

  const dados = JSON.parse(fs.readFileSync(DADOS, 'utf8'))
  const marginais = new Map(
    JSON.parse(fs.readFileSync(MARGINAIS, 'utf8')).map(m => [m.mi, m])
  )
  const mis = Object.keys(dados).sort()

  // --- Volume + associação CDGV ---
  const volumes = (await api('GET', 'volumes/volume_armazenamento')).dados || []
  const volume = volumes.find(v => (v.volume || '').includes(VOLUME_HOST))
  if (!volume) throw new Error(`Volume contendo "${VOLUME_HOST}" não encontrado`)
  console.log(`Volume: id=${volume.id} ${volume.volume}`)

  let assocs = (await api('GET', 'volumes/volume_tipo_produto')).dados || []
  if (!assocs.some(a => Number(a.tipo_produto_id) === TIPO_PRODUTO_CDGV)) {
    await api('POST', 'volumes/volume_tipo_produto', {
      volume_tipo_produto: [{
        tipo_produto_id: TIPO_PRODUTO_CDGV,
        volume_armazenamento_id: Number(volume.id),
        primario: true
      }]
    })
    console.log('Associação volume <- CDGV (primária) criada')
  } else {
    console.log('Associação CDGV -> volume já existia')
  }

  // --- Projeto/lote (já existem) ---
  const projetos = (await api('GET', 'projetos/projeto')).dados || []
  const projeto = projetos.find(p => p.nome === 'SISFRON')
  if (!projeto) throw new Error('Projeto SISFRON não encontrado')
  const lotes = (await api('GET', 'projetos/lote')).dados || []
  const lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.nome === LOTE_NOME)
  if (!lote) throw new Error(`Lote ${LOTE_NOME} não encontrado (carregue as CTs primeiro)`)
  console.log(`Lote: id=${lote.id} ${LOTE_NOME}`)

  // --- Payload CDGV ---
  const produtos = []
  for (const mi of mis) {
    const d = dados[mi]
    const marginal = marginais.get(mi)
    const zip = `${FONTE}/${mi}.zip`
    if (!fs.existsSync(zip)) throw new Error(`CDGV não encontrado: ${zip}`)

    const versaoNome = '1ª Edição'
    const nomeCarta = titleCasePt(d.nome)
    const anoInsumo = marginal.ano_ultimo_insumo || 2017
    const nomeBase = nomeArquivoPadrao({
      mi, tipoProdutoId: TIPO_PRODUTO_CDGV, versao: versaoNome, subtipoProdutoId: SUBTIPO_EDGV_213
    })

    console.log(`  ${mi}: CDGV "${nomeCarta}" -> ${versaoNome} | EDGV 2.1.3 | nome_arquivo=${nomeBase}.zip`)

    produtos.push({
      produto: {
        nome: nomeCarta,
        mi,
        inom: d.inom,
        tipo_escala_id: TIPO_ESCALA_100K,
        denominador_escala_especial: null,
        tipo_produto_id: TIPO_PRODUTO_CDGV,
        descricao: '',
        geom: ringParaEwkt(d.ring)
      },
      versoes: [{
        uuid_versao: null,
        versao: versaoNome,
        nome: nomeCarta,
        tipo_versao_id: TIPO_VERSAO_HISTORICO,
        subtipo_produto_id: SUBTIPO_EDGV_213,
        lote_id: Number(lote.id),
        metadado: {
          fonte: 'informacoes_marginais',
          edgv: '2.1.3',
          insumo_da_carta: `CT ${mi} 1:100.000`,
          datum_horizontal: marginal.datum_horizontal,
          etapas_producao: marginal.etapas_producao
        },
        descricao: '',
        orgao_produtor: '1º CGEO',
        palavras_chave: ['SISFRON', 'CDGV', 'EDGV 2.1.3'],
        data_criacao: diaLocal(`${anoInsumo}-01-01`),
        data_edicao: diaLocal(marginal.data_edicao),
        arquivos: [{
          uuid_arquivo: null,
          nome: `${mi} CDGV 2021`,
          nome_arquivo: nomeBase,
          tipo_arquivo_id: TIPO_ARQUIVO_PRINCIPAL,
          extensao: 'zip',
          tamanho_mb: fs.statSync(zip).size / (1024 * 1024),
          checksum: sha256(zip),
          metadado: {},
          situacao_carregamento_id: SITUACAO_NAO_CARREGADO_BDGEX,
          descricao: 'Conjunto de dados geoespaciais vetoriais (ET-EDGV 2.1.3), camadas SHP em ZIP',
          crs_original: '4674',
          _origem: zip
        }]
      }]
    })
  }

  // checksum -> origem
  const origemPorChecksum = new Map()
  for (const p of produtos) for (const v of p.versoes) for (const a of v.arquivos) {
    origemPorChecksum.set(a.checksum, a._origem); delete a._origem
  }

  // --- prepare ---
  console.log('\nPreparando upload (prepare-upload/product)...')
  const prep = await api('POST', 'arquivo/prepare-upload/product', { produtos })
  const sessionUuid = prep.dados.session_uuid
  console.log(`Sessão: ${sessionUuid}`)

  // --- transferência ---
  let copiados = 0
  for (const p of prep.dados.produtos) for (const v of p.versoes) for (const a of v.arquivos) {
    const origem = origemPorChecksum.get(a.checksum)
    if (!origem) throw new Error(`Sem origem para checksum ${a.checksum}`)
    fs.mkdirSync(path.dirname(a.destination_path), { recursive: true })
    fs.copyFileSync(origem, a.destination_path)
    copiados++
    console.log(`  copiado: ${path.basename(origem)} -> ${a.destination_path}`)
  }
  console.log(`${copiados} arquivos copiados`)

  // --- confirm ---
  console.log('\nConfirmando upload...')
  const conf = await api('POST', 'arquivo/confirm-upload', { session_uuid: sessionUuid })
  console.log(`Confirmação: ${conf.message} | status: ${conf.dados?.status}`)

  // --- Relacionamentos CT <- CDGV (Insumo) ---
  console.log('\nCriando relacionamentos (carta tem CDGV como insumo)...')
  const versoesDb = await db.any(`
    SELECT v.id AS versao_id, p.mi, p.tipo_produto_id
    FROM acervo.versao v JOIN acervo.produto p ON p.id = v.produto_id
    WHERE v.lote_id = $1`, [Number(lote.id)])

  const rels = []
  for (const mi of mis) {
    const ct = versoesDb.find(r => r.mi === mi && Number(r.tipo_produto_id) === TIPO_PRODUTO_CT)
    const cdgv = versoesDb.find(r => r.mi === mi && Number(r.tipo_produto_id) === TIPO_PRODUTO_CDGV)
    if (!ct || !cdgv) throw new Error(`MI ${mi}: não achei versão CT (${ct?.versao_id}) e/ou CDGV (${cdgv?.versao_id})`)
    rels.push({ versao_id_1: Number(ct.versao_id), versao_id_2: Number(cdgv.versao_id), tipo_relacionamento_id: TIPO_RELACIONAMENTO_INSUMO })
    console.log(`  ${mi}: CT v${ct.versao_id} <- CDGV v${cdgv.versao_id} (insumo)`)
  }
  await api('POST', 'produtos/versao_relacionamento', { versao_relacionamento: rels })
  console.log(`${rels.length} relacionamentos criados`)

  // --- views ---
  console.log('\nAtualizando views materializadas...')
  await api('POST', 'acervo/refresh_materialized_views')

  const total = (await api('GET', 'dashboard/produtos_total')).dados
  console.log(`\nTotal de produtos no acervo: ${JSON.stringify(total)}`)
  await pgp.end()
}

main().catch(async e => {
  console.error('\nFALHOU:', e.message)
  let causa = e.cause
  while (causa) { console.error('  causa:', causa.code || '', causa.message || causa); causa = causa.cause }
  await pgp.end()
  process.exit(1)
})
