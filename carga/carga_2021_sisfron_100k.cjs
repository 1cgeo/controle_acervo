'use strict'
/**
 * Carga do lote 2021_SISFRON_Generalizacao_100k
 * (Y:\Produtos_2021\2021_SISFRON_Generalizacao_100k\CT) no SCA.
 *
 * 3 cartas topográficas 1:100.000 (generalização SISFRON): 2753, 2779, 2799.
 * Regras em regras_carga_produtos.md:
 *  - T34-700 (2021, exceto Uraricoera) -> versão "Nª Edição", tipo_versao_id=2.
 *  - Ordinal: posição da edição 2021 entre as edições pré-ET-RDG (< 2022) do
 *    site de produtos. 2753/2779 -> 2ª; 2799 -> 4ª (1957,1972,1974,2021).
 *  - TIF (SIRGAS 2000 geográfico = EPSG:4674) -> Arquivo Principal.
 *  - PDF (impressão, UTM SIRGAS 2000) -> Formato Alternativo (zona 22->31982, 21->31981).
 *  - data_criacao = último insumo (imageamento 2017); data_edicao = 2021-12-07 (marginais).
 *  - Geometria: moldura da grade 100k do site.
 *  - nome_arquivo padronizado: CT_{MI}_ed{ordinal} (carga/nome_arquivo.cjs).
 *
 * Uso: node carga_2021_sisfron_100k.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { titleCasePt } = require('./title_case.cjs')
const { nomeArquivoPadrao } = require('./nome_arquivo.cjs')

const API = 'http://localhost:3015/api'
const USUARIO = 'claude'
const SENHA = 'claude'

const FONTE = 'Y:/Produtos_2021/2021_SISFRON_Generalizacao_100k/CT'
const VOLUME_HOST = '10.25.163.8'
const DADOS = path.join(__dirname, 'sisfron_2021_100k_dados.json')
const MARGINAIS = path.join(__dirname, 'sisfron_2021_100k_marginais.json')

// Domínios (er/dominio.sql)
const TIPO_PRODUTO_CT = 2
const TIPO_ESCALA_100K = 3
const SUBTIPO_T34_700 = 2
const TIPO_VERSAO_HISTORICO = 2
const TIPO_ARQUIVO_PRINCIPAL = 1
const TIPO_ARQUIVO_ALTERNATIVO = 2
const SITUACAO_NAO_CARREGADO_BDGEX = 1
const STATUS_EXECUCAO_CONCLUIDO = 3

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

function tamanhoMb (file) {
  return fs.statSync(file).size / (1024 * 1024)
}

// data_criacao/data_edicao são timestamptz; o servidor roda em America/Sao_Paulo.
// Enviar só "YYYY-MM-DD" vira 00:00 UTC e, em -03, cai no dia anterior (e erra o
// ano em EXTRACT(YEAR ...)). Fixar meio-dia local mantém o dia/ano corretos.
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
  if (mis.length !== 3) throw new Error(`Esperava 3 MIs, achei ${mis.length}`)

  // --- Volume (já existe — apenas localizar) ---
  const volumes = (await api('GET', 'volumes/volume_armazenamento')).dados || []
  const volume = volumes.find(v => (v.volume || '').includes(VOLUME_HOST))
  if (!volume) throw new Error(`Volume contendo "${VOLUME_HOST}" não encontrado`)
  console.log(`Volume: id=${volume.id} ${volume.volume}`)

  const assocs = (await api('GET', 'volumes/volume_tipo_produto')).dados || []
  if (!assocs.some(a => a.tipo_produto_id === TIPO_PRODUTO_CT && a.primario)) {
    throw new Error('Associação primária CT -> volume não existe')
  }
  console.log('Associação primária CT OK')

  // --- Projeto SISFRON (já existe) ---
  const projetos = (await api('GET', 'projetos/projeto')).dados || []
  const projeto = projetos.find(p => p.nome === 'SISFRON')
  if (!projeto) throw new Error('Projeto SISFRON não encontrado (carregue 2020 primeiro)')
  console.log(`Projeto: id=${projeto.id} SISFRON`)

  // --- Lote 2021_SISFRON_Generalizacao_100k ---
  let lotes = (await api('GET', 'projetos/lote')).dados || []
  let lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.nome === '2021_SISFRON_Generalizacao_100k')
  if (!lote) {
    await api('POST', 'projetos/lote', {
      projeto_id: Number(projeto.id),
      pit: '2021',
      nome: '2021_SISFRON_Generalizacao_100k',
      descricao: 'Cartas topográficas 1:100.000 do SISFRON (generalização), edição 2021',
      data_inicio: '2021-01-01',
      data_fim: '2021-12-31',
      status_execucao_id: STATUS_EXECUCAO_CONCLUIDO
    })
    lotes = (await api('GET', 'projetos/lote')).dados
    lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.nome === '2021_SISFRON_Generalizacao_100k')
    console.log(`Lote criado: id=${lote.id} 2021_SISFRON_Generalizacao_100k`)
  } else {
    console.log(`Lote já existia: id=${lote.id}`)
  }

  // --- Montagem do payload ---
  const produtos = []
  for (const mi of mis) {
    const d = dados[mi]
    const marginal = marginais.get(mi)
    if (!marginal) throw new Error(`MI ${mi} sem informações marginais`)
    if (marginal.mi !== mi) throw new Error(`MI impresso (${marginal.mi}) != MI do arquivo (${mi})`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(marginal.data_edicao || '')) {
      throw new Error(`MI ${mi} sem data exata de edição`)
    }
    if (!d.nome) throw new Error(`MI ${mi} sem nome de carta extraído`)

    const tif = `${FONTE}/${mi}.tif`
    const pdf = `${FONTE}/${mi}.pdf`
    if (!fs.existsSync(tif)) throw new Error(`TIF não encontrado: ${tif}`)
    if (!fs.existsSync(pdf)) throw new Error(`PDF não encontrado: ${pdf}`)

    const versaoNome = `${d.ordinal}ª Edição`
    const nomeCarta = titleCasePt(d.nome)
    const anoInsumo = marginal.ano_ultimo_insumo || 2017
    const nomeBase = nomeArquivoPadrao({
      mi, tipoProdutoId: TIPO_PRODUTO_CT, versao: versaoNome, subtipoProdutoId: SUBTIPO_T34_700
    })

    console.log(`  ${mi}: "${nomeCarta}" -> ${versaoNome} | edicao=${marginal.data_edicao} | insumo=${anoInsumo} | TIF=4674 PDF=${d.epsg_pdf} | nome_arquivo=${nomeBase}`)

    produtos.push({
      produto: {
        nome: nomeCarta,
        mi,
        inom: d.inom,
        tipo_escala_id: TIPO_ESCALA_100K,
        denominador_escala_especial: null,
        tipo_produto_id: TIPO_PRODUTO_CT,
        descricao: '',
        geom: ringParaEwkt(d.ring)
      },
      versoes: [{
        uuid_versao: null,
        versao: versaoNome,
        nome: nomeCarta,
        tipo_versao_id: TIPO_VERSAO_HISTORICO,
        subtipo_produto_id: SUBTIPO_T34_700,
        lote_id: Number(lote.id),
        metadado: {
          fonte: 'informacoes_marginais',
          generalizacao: '1:100.000 a partir de dados SISFRON',
          datum_horizontal: marginal.datum_horizontal,
          datum_vertical: marginal.datum_vertical,
          etapas_producao: marginal.etapas_producao,
          edicoes_site: d.edicoes
        },
        descricao: '',
        orgao_produtor: '1º CGEO',
        palavras_chave: ['SISFRON', 'Paraná', 'generalização'],
        data_criacao: diaLocal(`${anoInsumo}-01-01`),
        data_edicao: diaLocal(marginal.data_edicao),
        arquivos: [
          {
            uuid_arquivo: null,
            nome: `${mi} TIF 2021`,
            nome_arquivo: nomeBase,
            tipo_arquivo_id: TIPO_ARQUIVO_PRINCIPAL,
            extensao: 'tif',
            tamanho_mb: tamanhoMb(tif),
            checksum: sha256(tif),
            metadado: {},
            situacao_carregamento_id: SITUACAO_NAO_CARREGADO_BDGEX,
            descricao: '',
            crs_original: '4674',
            _origem: tif
          },
          {
            uuid_arquivo: null,
            nome: `${mi} PDF 2021`,
            nome_arquivo: nomeBase,
            tipo_arquivo_id: TIPO_ARQUIVO_ALTERNATIVO,
            extensao: 'pdf',
            tamanho_mb: tamanhoMb(pdf),
            checksum: sha256(pdf),
            metadado: {},
            situacao_carregamento_id: SITUACAO_NAO_CARREGADO_BDGEX,
            descricao: '',
            crs_original: d.epsg_pdf,
            _origem: pdf
          }
        ]
      }]
    })
  }

  // mapa checksum -> origem
  const origemPorChecksum = new Map()
  for (const p of produtos) {
    for (const v of p.versoes) {
      for (const a of v.arquivos) {
        origemPorChecksum.set(a.checksum, a._origem)
        delete a._origem
      }
    }
  }

  // --- Fase 1: prepare ---
  console.log('\nPreparando upload (prepare-upload/product)...')
  const prep = await api('POST', 'arquivo/prepare-upload/product', { produtos })
  const sessionUuid = prep.dados.session_uuid
  console.log(`Sessão: ${sessionUuid}`)

  // --- Fase 2: transferência ---
  let copiados = 0
  for (const p of prep.dados.produtos) {
    for (const v of p.versoes) {
      for (const a of v.arquivos) {
        const origem = origemPorChecksum.get(a.checksum)
        if (!origem) throw new Error(`Sem origem para checksum ${a.checksum}`)
        fs.mkdirSync(path.dirname(a.destination_path), { recursive: true })
        fs.copyFileSync(origem, a.destination_path)
        copiados++
        console.log(`  copiado: ${path.basename(origem)} -> ${a.destination_path}`)
      }
    }
  }
  console.log(`${copiados} arquivos copiados`)

  // --- Fase 3: confirm ---
  console.log('\nConfirmando upload (valida checksums no servidor)...')
  const conf = await api('POST', 'arquivo/confirm-upload', { session_uuid: sessionUuid })
  console.log(`Confirmação: ${conf.message} | status: ${conf.dados?.status}`)

  // --- Views materializadas ---
  console.log('\nAtualizando views materializadas...')
  await api('POST', 'acervo/refresh_materialized_views')
  console.log('Views materializadas atualizadas')

  // --- Validação ---
  const total = (await api('GET', 'dashboard/produtos_total')).dados
  console.log(`\nTotal de produtos no acervo: ${JSON.stringify(total)}`)
}

main().catch(e => {
  console.error('\nFALHOU:', e.message)
  let causa = e.cause
  while (causa) {
    console.error('  causa:', causa.code || '', causa.message || causa)
    causa = causa.cause
  }
  process.exit(1)
})
