'use strict'
/**
 * Carga do piloto Saicã 2017 (Y:\Produtos_2017\2017_SAICA_25K) no SCA.
 *
 * Regras em regras_carga_produtos.md:
 *  - Ordinal da edição: posição do ano entre as edições pré-ET-RDG (< 2022)
 *    listadas no site de produtos (situacao-geral) -> "Nª Edição".
 *  - data_criacao = data do último insumo (reambulação > outro campo > imagem).
 *  - data_edicao  = data exata das informações marginais da carta.
 *  - TIF (EPSG:4674) = Arquivo Principal; PDF = Formato Alternativo.
 *
 * Uso: node carga_saica_2017.js
 */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { titleCasePt } = require('./title_case.cjs')

const API = 'http://localhost:3015/api'
const USUARIO = 'claude'
const SENHA = 'claude'

const FONTE = 'Y:/Produtos_2017/2017_SAICA_25K'
const VOLUME_PATH = 'W:/sca_acervo'
const GRADE = 'D:/desenvolvimento/produtos/data/situacao-geral-ct-25k.geojson'
const MARGINAIS = path.join(__dirname, 'saica_2017_marginais.json')

const CORTE_ET_RDG = 2022 // edições a partir deste ano são ET-RDG (N-DSG)

// Nomes e EPSG original da edição 2017, conforme planilha ASC (grafia com acentos)
const PLANILHA = {
  '2962-4-NE': { nome: 'CERRO DA GLÓRIA', epsg: '31981' },
  '2962-4-SE': { nome: 'ARROIO SAICÃ', epsg: '31981' },
  '2963-3-NO': { nome: 'CERRO PELADO', epsg: '31981' },
  '2963-3-SO': { nome: 'SÃO SIMÃO', epsg: '31981' },
  '2979-2-NE': { nome: 'CAPELA DO SAICÃ', epsg: '31981' },
  '2979-2-SE': { nome: 'CORTE', epsg: '31981' },
  '2980-1-NO': { nome: 'RIO SANTA MARIA', epsg: '31981' },
  '2980-1-SO': { nome: 'ROSÁRIO DO SUL-N', epsg: '31981' }
}

// Domínios (er/dominio.sql)
const TIPO_PRODUTO_CT = 2
const TIPO_ESCALA_25K = 1
const SUBTIPO_T34_700 = 2
const TIPO_VERSAO_HISTORICO = 2
const TIPO_ARQUIVO_PRINCIPAL = 1
const TIPO_ARQUIVO_FORMATO_ALTERNATIVO = 2
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

function ordinalEdicao (edicoesTopo, ano) {
  const anos = [...new Set(edicoesTopo.filter(a => /^\d{4}$/.test(a)).map(Number))]
    .filter(a => a < CORTE_ET_RDG)
    .sort((a, b) => a - b)
  const pos = anos.indexOf(ano)
  if (pos === -1) {
    throw new Error(`Ano ${ano} não consta nas edições pré-ET-RDG: ${anos.join(', ')}`)
  }
  return `${pos + 1}ª Edição`
}

async function main () {
  // --- Login ---
  const login = await api('POST', 'login', { usuario: USUARIO, senha: SENHA, cliente: 'sca_qgis' })
  token = login.dados.token
  console.log('Login OK (admin:', login.dados.administrador + ')')

  // --- Fontes ---
  const grade = JSON.parse(fs.readFileSync(GRADE, 'utf8'))
  const porMI = new Map(grade.features.map(f => [f.properties.identificadorMI, f]))
  const marginais = new Map(
    JSON.parse(fs.readFileSync(MARGINAIS, 'utf8')).map(m => [m.mi, m])
  )

  // --- Volume de armazenamento ---
  fs.mkdirSync(VOLUME_PATH, { recursive: true })
  let volumes = (await api('GET', 'volumes/volume_armazenamento')).dados || []
  let volume = volumes.find(v => v.volume === VOLUME_PATH)
  if (!volume) {
    await api('POST', 'volumes/volume_armazenamento', {
      volume_armazenamento: [{ nome: 'Acervo W', volume: VOLUME_PATH, capacidade_gb: 37000 }]
    })
    volumes = (await api('GET', 'volumes/volume_armazenamento')).dados
    volume = volumes.find(v => v.volume === VOLUME_PATH)
    console.log(`Volume criado: id=${volume.id} ${VOLUME_PATH}`)
  } else {
    console.log(`Volume já existia: id=${volume.id}`)
  }

  const assocs = (await api('GET', 'volumes/volume_tipo_produto')).dados || []
  if (!assocs.some(a => a.tipo_produto_id === TIPO_PRODUTO_CT && a.primario)) {
    await api('POST', 'volumes/volume_tipo_produto', {
      volume_tipo_produto: [{
        tipo_produto_id: TIPO_PRODUTO_CT,
        volume_armazenamento_id: volume.id,
        primario: true
      }]
    })
    console.log('Associação primária CT -> Acervo W criada')
  } else {
    console.log('Associação primária CT já existia')
  }

  // --- Projeto e lote ---
  let projetos = (await api('GET', 'projetos/projeto')).dados || []
  let projeto = projetos.find(p => p.nome === 'Saicã')
  if (!projeto) {
    await api('POST', 'projetos/projeto', {
      nome: 'Saicã',
      descricao: 'Atualização cartográfica do CI Barão de São Borja - CIBSB (Saicã)',
      data_inicio: '2017-01-01',
      data_fim: '2017-12-31',
      status_execucao_id: STATUS_EXECUCAO_CONCLUIDO
    })
    projetos = (await api('GET', 'projetos/projeto')).dados
    projeto = projetos.find(p => p.nome === 'Saicã')
    console.log(`Projeto criado: id=${projeto.id} Saicã`)
  } else {
    console.log(`Projeto já existia: id=${projeto.id}`)
  }

  let lotes = (await api('GET', 'projetos/lote')).dados || []
  let lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.pit === '2017')
  if (!lote) {
    await api('POST', 'projetos/lote', {
      projeto_id: Number(projeto.id),
      pit: '2017',
      nome: '2017_SAICA_25K',
      descricao: 'Cartas topográficas 1:25.000 do Saicã, edição 2017',
      data_inicio: '2017-01-01',
      data_fim: '2017-12-31',
      status_execucao_id: STATUS_EXECUCAO_CONCLUIDO
    })
    lotes = (await api('GET', 'projetos/lote')).dados
    lote = lotes.find(l => Number(l.projeto_id) === Number(projeto.id) && l.pit === '2017')
    console.log(`Lote criado: id=${lote.id} 2017_SAICA_25K`)
  } else {
    console.log(`Lote já existia: id=${lote.id}`)
  }

  // --- Montagem do payload ---
  const produtos = []
  for (const mi of Object.keys(PLANILHA)) {
    const celula = porMI.get(mi)
    if (!celula) throw new Error(`MI ${mi} não encontrada na grade do site`)
    const marginal = marginais.get(mi)
    if (!marginal) throw new Error(`MI ${mi} sem informações marginais extraídas`)

    const tif = `${FONTE}/tif/${mi}_4674_2017.tif`
    const pdf = `${FONTE}/pdf/${mi}_2017.pdf`
    for (const f of [tif, pdf]) {
      if (!fs.existsSync(f)) throw new Error(`Arquivo não encontrado: ${f}`)
    }

    const versaoNome = ordinalEdicao(celula.properties.edicoes_topo || [], 2017)
    const anoInsumo = marginal.ano_ultimo_insumo || 2017
    // Títulos em title case pt-BR (regras_carga_produtos.md, seção 2.4)
    const nomeCarta = titleCasePt(PLANILHA[mi].nome)

    console.log(`  ${mi}: "${nomeCarta}" -> ${versaoNome} | edicao=${marginal.data_edicao} | insumo=${anoInsumo}`)

    produtos.push({
      produto: {
        nome: nomeCarta,
        mi,
        inom: celula.properties.identificadorINOM,
        tipo_escala_id: TIPO_ESCALA_25K,
        denominador_escala_especial: null,
        tipo_produto_id: TIPO_PRODUTO_CT,
        descricao: '',
        geom: ringParaEwkt(celula.geometry.coordinates[0])
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
        orgao_produtor: '1º CGEO',
        palavras_chave: ['Saicã', 'CIBSB'],
        data_criacao: `${anoInsumo}-01-01`,
        data_edicao: marginal.data_edicao,
        arquivos: [
          {
            uuid_arquivo: null,
            nome: `${mi} GeoTIFF 2017`,
            nome_arquivo: `${mi}_4674_2017`,
            tipo_arquivo_id: TIPO_ARQUIVO_PRINCIPAL,
            extensao: 'tif',
            tamanho_mb: fs.statSync(tif).size / (1024 * 1024),
            checksum: sha256(tif),
            metadado: {},
            situacao_carregamento_id: SITUACAO_NAO_CARREGADO_BDGEX,
            descricao: '',
            crs_original: '4674',
            _origem: tif
          },
          {
            uuid_arquivo: null,
            nome: `${mi} PDF 2017`,
            nome_arquivo: `${mi}_2017`,
            tipo_arquivo_id: TIPO_ARQUIVO_FORMATO_ALTERNATIVO,
            extensao: 'pdf',
            tamanho_mb: fs.statSync(pdf).size / (1024 * 1024),
            checksum: sha256(pdf),
            metadado: {},
            situacao_carregamento_id: SITUACAO_NAO_CARREGADO_BDGEX,
            descricao: '',
            crs_original: PLANILHA[mi].epsg,
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
  console.log('\nCriando views materializadas...')
  await api('POST', 'acervo/create_materialized_views')
  console.log('Views materializadas criadas')

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
