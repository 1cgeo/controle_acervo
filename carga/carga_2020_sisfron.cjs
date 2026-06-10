'use strict'
/**
 * Carga do lote 2020_SISFRON_PR_25k (Y:\Produtos_2020\2020_SISFRON_PR_25k) no SCA.
 *
 * Modelado em carga_saica_2017.cjs; regras em regras_carga_produtos.md:
 *  - Ordinal da edição: posição do ano entre as edições pré-ET-RDG (< 2022)
 *    listadas no site de produtos (situacao-geral) -> "Nª Edição"
 *    (validado contra Cont_Edicao da planilha ASC).
 *  - data_criacao = data do último insumo (reambulação > outro campo > imagem).
 *  - data_edicao  = data exata das informações marginais da carta.
 *  - Lote só tem PDF -> PDF = Arquivo Principal (regras, seção 2.3).
 *  - Geometria: moldura da grade do site (cross-validada com DsgTools),
 *    pré-processada em sisfron_2020_geometria.json.
 *
 * Uso: node carga_2020_sisfron.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { titleCasePt } = require('./title_case.cjs')

const API = 'http://localhost:3015/api'
const USUARIO = 'claude'
const SENHA = 'claude'

const FONTE = 'Y:/Produtos_2020/2020_SISFRON_PR_25k'
const VOLUME_HOST = '10.25.163.8' // volume já existente — apenas localizar
const GEOMETRIA = path.join(__dirname, 'sisfron_2020_geometria.json')
const MARGINAIS = path.join(__dirname, 'sisfron_2020_marginais.json')
const PLANILHA_JSON = path.join(__dirname, 'sisfron_2020_planilha_raw.json')

// Domínios (er/dominio.sql)
const TIPO_PRODUTO_CT = 2
const TIPO_ESCALA_25K = 1
const SUBTIPO_T34_700 = 2 // edição 2020 < 2022 -> T34-700
const TIPO_VERSAO_HISTORICO = 2
const TIPO_ARQUIVO_PRINCIPAL = 1 // versão só com PDF -> PDF é o principal
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
    // Socket keep-alive fechado pelo servidor durante pausas longas
    // (ex.: cálculo de checksums) — uma nova tentativa abre conexão nova
    if (_retry) {
      return api(method, endpoint, body, false)
    }
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

// data_criacao/data_edicao são timestamptz; servidor em America/Sao_Paulo.
// "YYYY-MM-DD" vira 00:00 UTC e cai no dia anterior em -03 — fixar meio-dia local.
function diaLocal (yyyymmdd) {
  return `${yyyymmdd}T12:00:00-03:00`
}

async function main () {
  // --- Login ---
  const login = await api('POST', 'login', { usuario: USUARIO, senha: SENHA, cliente: 'sca_qgis' })
  token = login.dados.token
  console.log('Login OK (admin:', login.dados.administrador + ')')

  // --- Fontes pré-processadas ---
  const geometria = JSON.parse(fs.readFileSync(GEOMETRIA, 'utf8'))
  const marginais = new Map(
    JSON.parse(fs.readFileSync(MARGINAIS, 'utf8')).map(m => [m.mi, m])
  )
  const planilhaRaw = JSON.parse(fs.readFileSync(PLANILHA_JSON, 'utf8'))

  const mis = Object.keys(geometria).sort()
  if (mis.length !== 44) throw new Error(`Esperava 44 MIs na geometria, achei ${mis.length}`)

  // --- Volume de armazenamento (já existe — apenas localizar, nunca criar) ---
  const volumes = (await api('GET', 'volumes/volume_armazenamento')).dados || []
  const volume = volumes.find(v => (v.volume || '').includes(VOLUME_HOST))
  if (!volume) throw new Error(`Volume contendo "${VOLUME_HOST}" não encontrado — abortando`)
  console.log(`Volume: id=${volume.id} ${volume.volume}`)

  const assocs = (await api('GET', 'volumes/volume_tipo_produto')).dados || []
  if (!assocs.some(a => a.tipo_produto_id === TIPO_PRODUTO_CT && a.primario)) {
    throw new Error('Associação primária CT -> volume não existe — abortando')
  }
  console.log('Associação primária CT OK')

  // --- Projeto e lote ---
  let projetos = (await api('GET', 'projetos/projeto')).dados || []
  let projeto = projetos.find(p => p.nome === 'SISFRON')
  if (!projeto) {
    await api('POST', 'projetos/projeto', {
      nome: 'SISFRON',
      descricao: 'Sistema Integrado de Monitoramento de Fronteiras',
      data_inicio: '2020-01-01',
      data_fim: '2020-12-31',
      status_execucao_id: STATUS_EXECUCAO_CONCLUIDO
    })
    projetos = (await api('GET', 'projetos/projeto')).dados
    projeto = projetos.find(p => p.nome === 'SISFRON')
    console.log(`Projeto criado: id=${projeto.id} SISFRON`)
  } else {
    console.log(`Projeto já existia: id=${projeto.id}`)
  }

  let lotes = (await api('GET', 'projetos/lote')).dados || []
  let lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.pit === '2020')
  if (!lote) {
    await api('POST', 'projetos/lote', {
      projeto_id: Number(projeto.id),
      pit: '2020',
      nome: '2020_SISFRON_PR_25k',
      descricao: 'Cartas topográficas 1:25.000 do SISFRON no Paraná, edição 2020',
      data_inicio: '2020-01-01',
      data_fim: '2020-12-31',
      status_execucao_id: STATUS_EXECUCAO_CONCLUIDO
    })
    lotes = (await api('GET', 'projetos/lote')).dados
    lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.pit === '2020')
    console.log(`Lote criado: id=${lote.id} 2020_SISFRON_PR_25k`)
  } else {
    console.log(`Lote já existia: id=${lote.id}`)
  }

  // --- Montagem do payload ---
  const produtos = []
  for (const mi of mis) {
    const geo = geometria[mi]
    const marginal = marginais.get(mi)
    if (!marginal) throw new Error(`MI ${mi} sem informações marginais extraídas`)
    if (marginal.mi !== mi) throw new Error(`MI impresso (${marginal.mi}) != MI do arquivo (${mi})`)
    if (!marginal.data_edicao || !/^\d{4}-\d{2}-\d{2}$/.test(marginal.data_edicao)) {
      throw new Error(`MI ${mi} sem data exata de edição nas informações marginais`)
    }

    // Linha da planilha ASC com Ano_Edicao = 2020 (autoritativa p/ nome/órgão/EPSG)
    const linhas = (planilhaRaw[mi] || []).filter(r => r.Ano_Edicao === '2020')
    if (linhas.length !== 1) {
      throw new Error(`MI ${mi}: esperava 1 linha 2020 na planilha T25, achei ${linhas.length}`)
    }
    const plan = linhas[0]
    if (plan.INOM !== geo.inom) {
      throw new Error(`MI ${mi}: INOM planilha (${plan.INOM}) != INOM grade/DsgTools (${geo.inom})`)
    }

    // Ordinal: grade do site (pré-ET-RDG), validado contra Cont_Edicao da planilha
    const ordinal = geo.ordinal_2020
    if (!ordinal) throw new Error(`MI ${mi} sem ordinal 2020 calculado`)
    if (String(ordinal) !== String(plan.Cont_Edicao)) {
      throw new Error(`MI ${mi}: ordinal grade (${ordinal}) != Cont_Edicao planilha (${plan.Cont_Edicao})`)
    }
    const versaoNome = `${ordinal}ª Edição`

    const pdf = `${FONTE}/${mi.toLowerCase().replace(/-/g, '')}.pdf`
    if (!fs.existsSync(pdf)) throw new Error(`Arquivo não encontrado: ${pdf}`)
    const nomeArquivo = path.basename(pdf, '.pdf')

    const anoInsumo = marginal.ano_ultimo_insumo || 2020
    const epsg = /^\d+$/.test(plan.EPSG) ? plan.EPSG : null
    // Títulos em title case pt-BR (regras_carga_produtos.md, seção 2.4)
    const nomeCarta = titleCasePt(plan.Nome)

    console.log(`  ${mi}: "${nomeCarta}" -> ${versaoNome} | edicao=${marginal.data_edicao} | insumo=${anoInsumo} | epsg=${epsg}`)

    produtos.push({
      produto: {
        nome: nomeCarta,
        mi,
        inom: geo.inom,
        tipo_escala_id: TIPO_ESCALA_25K,
        denominador_escala_especial: null,
        tipo_produto_id: TIPO_PRODUTO_CT,
        descricao: '',
        geom: ringParaEwkt(geo.ring)
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
          datum_horizontal: marginal.datum_horizontal,
          datum_vertical: marginal.datum_vertical,
          etapas_producao: marginal.etapas_producao
        },
        descricao: '',
        orgao_produtor: plan.Orgao_Produtor || '1º CGEO',
        palavras_chave: ['SISFRON', 'Paraná'],
        data_criacao: diaLocal(`${anoInsumo}-01-01`),
        data_edicao: diaLocal(marginal.data_edicao),
        arquivos: [
          {
            uuid_arquivo: null,
            nome: `${mi} PDF 2020`,
            nome_arquivo: nomeArquivo,
            tipo_arquivo_id: TIPO_ARQUIVO_PRINCIPAL,
            extensao: 'pdf',
            tamanho_mb: fs.statSync(pdf).size / (1024 * 1024),
            checksum: sha256(pdf),
            metadado: {},
            situacao_carregamento_id: SITUACAO_NAO_CARREGADO_BDGEX,
            descricao: '',
            crs_original: epsg,
            _origem: pdf
          }
        ]
      }]
    })
  }

  // mapa checksum -> arquivo de origem (o prepare devolve o checksum por destino)
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
