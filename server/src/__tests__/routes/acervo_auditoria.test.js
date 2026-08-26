'use strict'

// Varredura da rastreabilidade do modulo ACERVO (auditoria.evento).
//
// Este arquivo e a TROCA por nao usar gatilho de banco. A insercao do evento
// mora no backend, porque o gatilho nao conhece o usuario da sessao HTTP (o
// Postgres ve so a conexao do pool). O preco dessa escolha e a rota nova que
// esquece de auditar, e quem cobra o preco e este teste: ele le os SETE routers
// do acervo de verdade e exige que toda rota de escrita esteja coberta ou
// justificada.
//
// Alem da varredura, os casos aqui guardam o que so se prova mexendo:
//
//   1. A GEOMETRIA do produto entra em EWKT e CABE. Sem o `geometrias: ['geom']`
//      no mapa, o `SELECT *` devolveria WKB hexadecimal, e o rastro do unico
//      campo do sistema cujo estado anterior serve para desfazer seria ilegivel.
//   2. O RENOME PADRAO gera N eventos com o MESMO lote_id. Ele abre uma
//      transacao POR ARQUIVO, entao o lote e a unica coisa que junta os N -- sem
//      ele a tela viraria 5.000 linhas iguais.
//   3. A EXCLUSAO EM CASCATA gera um evento por LINHA apagada, e nao um com a
//      contagem: quem pergunta depois quer saber QUAL folha se perdeu.
//   4. A verificacao contra o volume e o CONTRARIO: UM evento de operacao, nunca
//      um por arquivo, porque dois dos UPDATEs dela nao tem lista de ids.

const request = require('supertest')
const fs = require('fs').promises
const os = require('os')
const path = require('path')

const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')
const {
  createProduto, createVersao, createArquivo, createVolume, createProjeto
} = require('../helpers/fixtures')

const produtoRouter = require('../../produto/produto_route')
const arquivoRouter = require('../../arquivo/arquivo_route')
const projetoRouter = require('../../projeto/projeto_route')
const volumeRouter = require('../../volume/volume_route')
const gerenciaRouter = require('../../gerencia/gerencia_route')
const acervoRouter = require('../../acervo/acervo_route')
const pontoControleRouter = require('../../ponto_controle/ponto_controle_route')

let app
let raizVolume

beforeAll(async () => {
  app = await getApp()
  raizVolume = await fs.mkdtemp(path.join(os.tmpdir(), 'sca-auditoria-acervo-'))
})

afterAll(async () => {
  await fs.rm(raizVolume, { recursive: true, force: true })
})

// Volume e banco sao dois estados, e os dois vazam entre casos.
afterEach(async () => {
  await cleanTestData()
  await fs.rm(raizVolume, { recursive: true, force: true })
  await fs.mkdir(raizVolume, { recursive: true })
})

// --- Helpers locais ---------------------------------------------------------

const admin = () => generateAdminToken()

/** Os eventos de uma tabela, do mais antigo para o mais novo. */
const eventos = async (tabela, operacao) =>
  conn.any(
    `SELECT * FROM auditoria.evento
      WHERE tabela = $<tabela> AND ($<operacao> IS NULL OR operacao = $<operacao>)
      ORDER BY id`,
    { tabela, operacao: operacao || null }
  )

const GEOM_FOLHA = 'SRID=4674;POLYGON((-50 -15, -49 -15, -49 -14, -50 -14, -50 -15))'

// --- A varredura ------------------------------------------------------------

// Chave de rota igual a que o teste monta a partir dos routers de verdade.
const COBERTAS = new Set([
  // produtos/
  'PUT /produto', 'PUT /versao', 'POST /versao/uuid',
  'DELETE /produto', 'DELETE /versao',
  'POST /versao_historica', 'POST /versao_planejada',
  'POST /produto_versao_historica', 'POST /produto_versao_planejada',
  'POST /mover-arquivos', 'POST /renumerar-versoes', 'POST /produtos',
  'POST /versao_relacionamento', 'PUT /versao_relacionamento', 'DELETE /versao_relacionamento',
  // arquivo/
  'PUT /arquivo', 'DELETE /arquivo',
  'POST /upload-web/produto', 'POST /upload-web/versao', 'POST /upload-web/arquivos',
  'POST /catalogar/product', 'POST /confirm-upload',
  'POST /atualizar-checksum', 'POST /renomear-padrao', 'POST /corrigir-nome-fisico',
  // projetos/
  'POST /projeto', 'PUT /projeto', 'DELETE /projeto',
  'POST /lote', 'PUT /lote', 'DELETE /lote',
  // volumes/
  'POST /volume_armazenamento', 'PUT /volume_armazenamento', 'DELETE /volume_armazenamento',
  'POST /volume_tipo_produto', 'PUT /volume_tipo_produto', 'DELETE /volume_tipo_produto',
  // gerencia/ e acervo/, como evento de OPERACAO
  'POST /verificar_inconsistencias',
  'POST /refresh_materialized_views', 'POST /create_materialized_views',
  // Varredura da fila de miniaturas. Nao ha agendamento na aplicacao, entao
  // toda passada tem uma pessoa por tras, e e ela que o rastro guarda. Mesmo
  // formato do refresh das views: evento de OPERACAO, porque nao ha par de
  // linhas para comparar.
  'POST /miniaturas/varrer',
  // Limpeza das sessoes de envio vencidas. Mesmo formato: evento de OPERACAO,
  // com as duas contagens que a funcao do banco mediu. Ela era carona da rota de
  // download ate 06/08/2026, e o numero dela entrava no evento daquela.
  'POST /cleanup-expired-uploads',
  // ponto_controle/
  'POST /confirm-upload (ponto_controle)'
])

// Cada uma com o MOTIVO por escrito, porque lista sem motivo vira gaveta: quem
// acrescentar uma rota aqui tem de dizer por que ela nao audita.
const FORA_DO_ESCOPO = new Map([
  // Sessao de upload do PLUGIN. Reservar destino nao muda o acervo: a linha so
  // entra em produto/versao/arquivo no confirm-upload, e e la que o evento
  // nasce. Registrar a reserva faria a trilha contar duas vezes o que aconteceu
  // uma, e a sessao abandonada (fechada pela limpeza, hoje manual) viraria
  // cadastro no historico.
  ['POST /prepare-upload/files', 'reserva destino; o evento nasce no confirm-upload'],
  ['POST /prepare-upload/version', 'reserva destino; o evento nasce no confirm-upload'],
  ['POST /prepare-upload/product', 'reserva destino; o evento nasce no confirm-upload'],
  ['POST /prepare-upload/replace-files', 'reserva destino; o evento nasce no confirm-upload'],
  ['POST /cancel-upload', 'sessao que nao virou arquivo nao mudou o acervo'],
  ['POST /prepare-upload/missao (ponto_controle)', 'reserva destino; o evento nasce no confirm-upload'],
  ['POST /cancel-upload (ponto_controle)', 'sessao que nao virou ponto nao mudou nada'],
  // Download. E registro de ACESSO a arquivo, nao alteracao de acervo, e
  // `acervo.download` JA E o historico dele -- com usuario, data e desfecho.
  // Duplicar aqui criaria duas versoes da mesma verdade.
  ['POST /prepare-download/arquivos', 'acesso a arquivo; acervo.download ja e o historico'],
  ['POST /prepare-download/produtos', 'acesso a arquivo; acervo.download ja e o historico'],
  ['POST /confirm-download', 'acesso a arquivo; acervo.download ja e o historico'],
  ['POST /cleanup-expired-downloads', 'marca token expirado; nao altera acervo nem arquivo']
])

const METODOS_DE_ESCRITA = ['post', 'put', 'patch', 'delete']

// Os routers do ponto de controle e do acervo tem rotas de caminho igual as de
// outro router ('/confirm-upload', '/cancel-upload'), entao a chave do ponto
// leva o sufixo -- sem ele as duas colidiriam no mesmo Set e uma sumiria da
// varredura sem ninguem notar.
const ROUTERS = [
  { router: produtoRouter, sufixo: '' },
  { router: arquivoRouter, sufixo: '' },
  { router: projetoRouter, sufixo: '' },
  { router: volumeRouter, sufixo: '' },
  { router: gerenciaRouter, sufixo: '' },
  { router: acervoRouter, sufixo: '' },
  { router: pontoControleRouter, sufixo: ' (ponto_controle)' }
]

const rotasDeEscrita = () => {
  const chaves = []
  for (const { router, sufixo } of ROUTERS) {
    expect(Array.isArray(router.stack)).toBe(true)
    for (const camada of router.stack) {
      if (!camada.route) continue
      for (const metodo of METODOS_DE_ESCRITA) {
        if (camada.route.methods[metodo]) {
          chaves.push(`${metodo.toUpperCase()} ${camada.route.path}${sufixo}`)
        }
      }
    }
  }
  return chaves
}

describe('Rastreabilidade do acervo - varredura das rotas de escrita', () => {
  it('toda rota de escrita do acervo esta coberta ou justificada', () => {
    const encontradas = rotasDeEscrita()

    // Rede contra o falso verde: se o formato do router mudar e a extracao
    // devolver lista vazia, o teste passaria sem cobrar nada.
    expect(encontradas.length).toBeGreaterThanOrEqual(COBERTAS.size)

    const descobertas = encontradas.filter(
      r => !COBERTAS.has(r) && !FORA_DO_ESCOPO.has(r)
    )

    // Rota nova sem rastro cai AQUI. Para consertar: audite a rota e acrescente
    // a chave em COBERTAS, ou justifique em FORA_DO_ESCOPO.
    expect(descobertas).toEqual([])

    // O caminho inverso: chave em COBERTAS que nao existe mais no router.
    const orfas = [...COBERTAS].filter(r => !encontradas.includes(r))
    expect(orfas).toEqual([])
  })

  it('toda entrada de FORA_DO_ESCOPO carrega o motivo por escrito', () => {
    for (const [rota, motivo] of FORA_DO_ESCOPO) {
      expect(typeof motivo).toBe('string')
      expect(motivo.length).toBeGreaterThan(15)
      expect(rota).toMatch(/^(POST|PUT|PATCH|DELETE) \//)
    }
  })
})

// --- Produto: a geometria, que e o campo mais caro deste modulo --------------

describe('Rastreabilidade do produto', () => {
  it('POST /produtos grava a geometria em EWKT, e ela cabe inteira', async () => {
    const res = await request(app)
      .post('/api/produtos/produtos')
      .set('Authorization', admin())
      .send({
        produtos: [{
          nome: 'Folha de Auditoria',
          mi: '9911-1',
          inom: 'SF-22-Y-D-II-4-NE',
          tipo_escala_id: 1,
          denominador_escala_especial: null,
          tipo_produto_id: 2,
          subtipo_produto_id: null,
          descricao: 'criada para provar o rastro da geometria',
          geom: GEOM_FOLHA
        }]
      })
    expect(res.status).toBe(201)

    const [criacao] = await eventos('acervo.produto', 'I')

    expect(criacao).toBeDefined()
    expect(criacao.modulo).toBe('acervo')
    expect(criacao.entidade).toBe('produto')
    expect(criacao.entidade_id).toBe(criacao.registro_id)
    expect(criacao.usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao.dados_antes).toBeNull()

    // EWKT legivel, e nao o WKB hexadecimal que um `SELECT *` cru devolveria.
    expect(criacao.dados_depois.geom).toMatch(/^SRID=4674;POLYGON\(\(/)
    // A folha do SCN tem 5 vertices e cabe com folga no teto de 8 kB: nada de
    // `_truncado`, que e o que o `sanitizar` poe quando o valor estoura.
    expect(criacao.dados_depois.geom._truncado).toBeUndefined()
    expect(criacao.dados_depois.geom.split(',').length).toBe(5)

    expect(criacao.campos_alterados).toContain('geom')
    expect(criacao.campos_alterados).toContain('mi')
    // O carimbo de escrituracao fica FORA do diff, senao toda linha do
    // historico traria "quem/quando" na frente do que interessa.
    expect(criacao.campos_alterados).not.toContain('data_cadastramento')
    expect(criacao.campos_alterados).not.toContain('usuario_cadastramento_uuid')
  })

  it('PUT /produto registra o diff, com a geometria dos DOIS lados em EWKT', async () => {
    const produto = await createProduto({ mi: '9922-1', descricao: 'antes' })

    const res = await request(app)
      .put('/api/produtos/produto')
      .set('Authorization', admin())
      .send({
        id: Number(produto.id),
        nome: produto.nome,
        mi: produto.mi,
        inom: produto.inom,
        tipo_escala_id: produto.tipo_escala_id,
        denominador_escala_especial: null,
        tipo_produto_id: produto.tipo_produto_id,
        descricao: 'depois'
      })
    expect(res.status).toBe(200)

    const [alteracao] = await eventos('acervo.produto', 'U')

    expect(alteracao.dados_antes.descricao).toBe('antes')
    expect(alteracao.dados_depois.descricao).toBe('depois')
    // Só a descrição mudou: a geometria não foi enviada e tem de sair IGUAL dos
    // dois lados. Se um lado viesse em WKB e o outro em EWKT, o diff acusaria
    // uma mudança de geometria que não houve, em toda edição de produto.
    expect(alteracao.campos_alterados).toEqual(['descricao'])
    expect(alteracao.dados_antes.geom).toMatch(/^SRID=4674;POLYGON\(\(/)
    expect(alteracao.dados_depois.geom).toBe(alteracao.dados_antes.geom)
  })

  it('POST /versao_planejada registra a versao na ficha do PRODUTO', async () => {
    const produto = await createProduto({ mi: '9933-1' })

    const res = await request(app)
      .post('/api/produtos/versao_planejada')
      .set('Authorization', admin())
      .send([{
        uuid_versao: null,
        versao: '1-DSG',
        nome: 'Planejada de teste',
        produto_id: Number(produto.id),
        subtipo_produto_id: 1,
        lote_id: null,
        metadado: {},
        descricao: '',
        orgao_produtor: 'DSG',
        data_criacao: '2026-01-10',
        data_edicao: '2026-02-10'
      }])
    expect(res.status).toBe(201)

    const [criacao] = await eventos('acervo.versao', 'I')

    expect(criacao).toBeDefined()
    // registro_id e da versao; entidade_id e do PRODUTO dono. Sem o RETURNING
    // que entrou nesta fase, o id da versao nem existiria no JavaScript.
    expect(criacao.registro_id).not.toBeNull()
    expect(Number(criacao.entidade_id)).toBe(Number(produto.id))
    expect(criacao.dados_depois.versao).toBe('1-DSG')
  })

  it('o historico sai pela rota de leitura, do mais novo para o mais antigo', async () => {
    const produto = await createProduto({ mi: '9944-1', descricao: 'primeira' })

    const corpo = {
      id: Number(produto.id),
      nome: produto.nome,
      mi: produto.mi,
      inom: produto.inom,
      tipo_escala_id: produto.tipo_escala_id,
      denominador_escala_especial: null,
      tipo_produto_id: produto.tipo_produto_id,
      descricao: 'segunda'
    }
    expect((await request(app).put('/api/produtos/produto').set('Authorization', admin()).send(corpo)).status).toBe(200)
    corpo.descricao = 'terceira'
    expect((await request(app).put('/api/produtos/produto').set('Authorization', admin()).send(corpo)).status).toBe(200)

    const res = await request(app)
      .get(`/api/auditoria/acervo/produto/${produto.id}`)
      .set('Authorization', admin())
    expect(res.status).toBe(200)

    const linhas = res.body.dados
    expect(linhas).toHaveLength(2)
    expect(linhas[0].dados_depois.descricao).toBe('terceira')
    expect(linhas[1].dados_depois.descricao).toBe('segunda')

    // O diff sai PRONTO do servidor: rotulo em portugues e os dois textos.
    const mudanca = linhas[0].mudancas.find(m => m.campo === 'descricao')
    expect(mudanca.rotulo).toBe('Descrição')
    expect(mudanca.antes_texto).toBe('segunda')
    expect(mudanca.depois_texto).toBe('terceira')
    expect(linhas[0].resumo).toContain('9944-1')
  })
})

// --- Exclusao em cascata ----------------------------------------------------

describe('Rastreabilidade da exclusao em cascata', () => {
  it('DELETE /produto grava um evento por LINHA apagada, sob o mesmo lote', async () => {
    const produto = await createProduto({ mi: '9955-1' })
    const versao = await createVersao(produto.id)
    const arquivoA = await createArquivo(versao.id, { nome: 'A', nome_arquivo: 'a_teste' })
    const arquivoB = await createArquivo(versao.id, { nome: 'B', nome_arquivo: 'b_teste' })

    const res = await request(app)
      .delete('/api/produtos/produto')
      .set('Authorization', admin())
      .send({ produto_ids: [Number(produto.id)], motivo_exclusao: 'carga errada' })
    expect(res.status).toBe(200)

    // Sumiram de verdade...
    expect(await conn.oneOrNone('SELECT id FROM acervo.produto WHERE id = $1', [produto.id])).toBeNull()

    // ... e o rastro continua de pe. E o caso que a tabela existe para guardar,
    // e a razao de entidade_id NAO ter chave estrangeira.
    const produtos = await eventos('acervo.produto', 'D')
    const versoes = await eventos('acervo.versao', 'D')
    const arquivos = await eventos('acervo.arquivo', 'D')

    expect(produtos).toHaveLength(1)
    expect(versoes).toHaveLength(1)
    // UM POR ARQUIVO, e nao um evento com "2 arquivos apagados".
    expect(arquivos).toHaveLength(2)

    // Todos na ficha do MESMO produto, inclusive o arquivo -- que esta a dois
    // saltos dele (arquivo -> versao -> produto).
    for (const e of [...produtos, ...versoes, ...arquivos]) {
      expect(Number(e.entidade_id)).toBe(Number(produto.id))
      expect(e.entidade).toBe('produto')
      expect(e.dados_depois).toBeNull()
      expect(e.dados_antes).not.toBeNull()
      // O motivo era cobrado pela rota e so chegava a lapide do ARQUIVO: o
      // produto e a versao o perdiam.
      expect(e.motivo).toBe('carga errada')
      expect(e.usuario_uuid).toBe(ADMIN_UUID)
    }

    // O lote_id e o que junta os quatro eventos numa linha so na tela.
    const lotes = new Set([...produtos, ...versoes, ...arquivos].map(e => e.lote_id))
    expect(lotes.size).toBe(1)
    expect([...lotes][0]).not.toBeNull()

    // A lapide do arquivo e um INSERT...SELECT, DB para DB: o `dados_antes` sai
    // dela e tem de trazer o arquivo INTEIRO, e nao so o id.
    const nomes = arquivos.map(e => e.dados_antes.nome).sort()
    expect(nomes).toEqual(['A', 'B'])
    for (const e of arquivos) {
      expect(e.dados_antes.checksum).toBeTruthy()
      // O status e o que o arquivo TINHA, e nao o EXCLUIDO que a lapide grava.
      expect(Number(e.dados_antes.tipo_status_id)).toBe(1)
    }
    expect(arquivos.map(e => Number(e.registro_id)).sort())
      .toEqual([Number(arquivoA.id), Number(arquivoB.id)].sort())
  })

  it('DELETE /arquivo grava o arquivo apagado na ficha do produto', async () => {
    const produto = await createProduto({ mi: '9966-1' })
    const versao = await createVersao(produto.id)
    const arquivo = await createArquivo(versao.id, { nome_arquivo: 'so_um' })

    const res = await request(app)
      .delete('/api/arquivo/arquivo')
      .set('Authorization', admin())
      .send({ arquivo_ids: [Number(arquivo.id)], motivo_exclusao: 'duplicado' })
    expect(res.status).toBe(200)

    const [exclusao] = await eventos('acervo.arquivo', 'D')
    expect(Number(exclusao.registro_id)).toBe(Number(arquivo.id))
    expect(Number(exclusao.entidade_id)).toBe(Number(produto.id))
    expect(exclusao.motivo).toBe('duplicado')
    expect(exclusao.dados_antes.nome_arquivo).toBe('so_um')
  })
})

// --- Operacao em massa: o lote_id -------------------------------------------

describe('Rastreabilidade do renome padrao', () => {
  it('gera N eventos com o MESMO lote_id, um por arquivo renomeado', async () => {
    const volume = await createVolume({
      nome: 'Volume Renome Auditoria',
      volume: raizVolume,
      layout_origem: false
    })

    // Dois arquivos da MESMA versao, com extensoes diferentes: o nome padrao e
    // um por versao, e quem os separa e a extensao.
    const produto = await createProduto({ mi: '9977-1', tipo_produto_id: 2 })
    const versao = await createVersao(produto.id, { versao: '1-DSG', subtipo_produto_id: 1 })
    const arquivos = []
    for (const ext of ['tif', 'pdf']) {
      const a = await createArquivo(versao.id, {
        volume_armazenamento_id: volume.id,
        nome_arquivo: `fora_do_padrao_${ext}`,
        extensao: ext
      })
      await fs.writeFile(path.join(raizVolume, `fora_do_padrao_${ext}.${ext}`), 'conteudo')
      arquivos.push(a)
    }

    const res = await request(app)
      .post('/api/arquivo/renomear-padrao')
      .set('Authorization', admin())
      .send({
        arquivo_ids: arquivos.map(a => Number(a.id)),
        dry_run: false,
        limite: 100,
        motivo: 'padronizacao do acervo'
      })
    expect(res.status).toBe(200)
    expect(res.body.dados.renomeados).toBe(2)
    expect(res.body.dados.falhas).toBe(0)

    const renomes = await eventos('acervo.arquivo', 'U')
    expect(renomes).toHaveLength(2)

    // UMA TRANSACAO POR ARQUIVO, e mesmo assim UM lote: e ele que faz a tela
    // mostrar "Renomeou 2 arquivos" em vez de duas linhas iguais.
    const lotes = new Set(renomes.map(e => e.lote_id))
    expect(lotes.size).toBe(1)
    expect([...lotes][0]).not.toBeNull()

    for (const e of renomes) {
      expect(e.campos_alterados).toEqual(['nome_arquivo'])
      expect(e.dados_antes.nome_arquivo).toMatch(/^fora_do_padrao_/)
      expect(e.dados_depois.nome_arquivo).not.toMatch(/^fora_do_padrao_/)
      expect(Number(e.entidade_id)).toBe(Number(produto.id))
      expect(e.motivo).toBe('padronizacao do acervo')
      expect(e.usuario_uuid).toBe(ADMIN_UUID)
    }
  })

  it('a SIMULACAO nao grava evento nenhum', async () => {
    const volume = await createVolume({
      nome: 'Volume Simulacao',
      volume: raizVolume,
      layout_origem: false
    })
    const produto = await createProduto({ mi: '9988-1', tipo_produto_id: 2 })
    const versao = await createVersao(produto.id, { versao: '1-DSG', subtipo_produto_id: 1 })
    await createArquivo(versao.id, {
      volume_armazenamento_id: volume.id,
      nome_arquivo: 'so_simulacao',
      extensao: 'tif'
    })

    const res = await request(app)
      .post('/api/arquivo/renomear-padrao')
      .set('Authorization', admin())
      .send({ dry_run: true, limite: 100, motivo: 'so o plano' })
    expect(res.status).toBe(200)

    // Simular nao muda nada, entao nao ha o que registrar. Um evento aqui diria
    // que o arquivo foi renomeado quando o byte nem foi tocado.
    expect(await eventos('acervo.arquivo')).toHaveLength(0)
  })
})

// --- Evento de OPERACAO -----------------------------------------------------

describe('Rastreabilidade das operacoes sem linha antes e depois', () => {
  it('verificar_inconsistencias grava UM evento com as contagens, e nao um por arquivo', async () => {
    const produto = await createProduto({ mi: '9999-1' })
    const versao = await createVersao(produto.id)
    await createArquivo(versao.id, { nome_arquivo: 'sumido_1' })
    await createArquivo(versao.id, { nome_arquivo: 'sumido_2' })

    const res = await request(app)
      .post('/api/gerencia/verificar_inconsistencias')
      .set('Authorization', admin())
    expect(res.status).toBe(200)

    const registros = await eventos('acervo.arquivo')

    // Os dois arquivos apontam para caminho que nao existe e foram marcados,
    // mas o rastro e UM SO: dois dos UPDATEs dela nao tem lista de ids e podem
    // reescrever a tabela inteira, entao a linha por arquivo seria a auditoria
    // crescendo mais rapido que o acervo.
    expect(registros).toHaveLength(1)
    expect(registros[0].operacao).toBe('U')
    expect(registros[0].entidade_id).toBe('operacao')
    expect(registros[0].dados_antes).toBeNull()
    expect(Number(registros[0].dados_depois.arquivos_atualizados)).toBe(2)
    expect(registros[0].dados_depois).toHaveProperty('segundos')
    // A `origem` continua sendo a da REQUISICAO quando ela existe: o
    // `registrarOperacao` so cai em 'sistema' quando nao ha contexto nenhum (o
    // cron, a fila). Aqui alguem apertou o botao, e apagar por onde a pessoa
    // entrou seria perder a informacao mais util do evento.
    expect(registros[0].origem).toBe('desconhecido')
    expect(registros[0].rota).toBe('POST /api/gerencia/verificar_inconsistencias')
    expect(registros[0].usuario_uuid).toBe(ADMIN_UUID)
  })

  it('refresh_materialized_views registra quem mandou rodar', async () => {
    const res = await request(app)
      .post('/api/acervo/refresh_materialized_views')
      .set('Authorization', admin())
    expect(res.status).toBe(200)

    const [operacao] = await eventos('acervo.mv_produto')
    expect(operacao).toBeDefined()
    expect(operacao.entidade).toBe('manutencao')
    expect(operacao.entidade_id).toBe('operacao')
    expect(operacao.usuario_uuid).toBe(ADMIN_UUID)
    expect(operacao.dados_depois.success).toBe(true)
  })
})

// --- Cadastros que nao recebiam o usuario ------------------------------------

describe('Rastreabilidade dos cadastros de projeto e de volume', () => {
  it('as tres rotas de projeto gravam o autor, inclusive a exclusao', async () => {
    const criacao = await request(app)
      .post('/api/projetos/projeto')
      .set('Authorization', admin())
      .send({
        nome: 'Projeto Rastreado',
        descricao: 'nasce para ser apagado',
        data_inicio: '2026-01-05',
        data_fim: null,
        status_execucao_id: 1
      })
    expect(criacao.status).toBe(201)
    const projetoId = Number(criacao.body.dados.id)

    const alteracao = await request(app)
      .put('/api/projetos/projeto')
      .set('Authorization', admin())
      .send({
        id: projetoId,
        nome: 'Projeto Rastreado II',
        descricao: 'nasce para ser apagado',
        data_inicio: '2026-01-05',
        data_fim: null,
        status_execucao_id: 1
      })
    expect(alteracao.status).toBe(200)

    const exclusao = await request(app)
      .delete('/api/projetos/projeto')
      .set('Authorization', admin())
      .send({ projeto_ids: [projetoId] })
    expect(exclusao.status).toBe(200)

    const linhas = await eventos('acervo.projeto')
    expect(linhas.map(l => l.operacao)).toEqual(['I', 'U', 'D'])
    for (const l of linhas) {
      // A EXCLUSAO nao recebia o usuario ate esta fase: quem apagou o projeto
      // simplesmente nao existia em lugar nenhum.
      expect(l.usuario_uuid).toBe(ADMIN_UUID)
      expect(Number(l.entidade_id)).toBe(projetoId)
      expect(l.entidade).toBe('projeto')
    }
    expect(linhas[1].campos_alterados).toEqual(['nome'])
    expect(linhas[2].dados_antes.nome).toBe('Projeto Rastreado II')
  })

  it('o lote aparece na ficha do PROJETO, e nao numa ficha propria', async () => {
    const projeto = await createProjeto({ nome: 'Projeto com Lote' })

    const res = await request(app)
      .post('/api/projetos/lote')
      .set('Authorization', admin())
      .send({
        projeto_id: Number(projeto.id),
        pit: 'PIT-AUDIT',
        nome: 'Lote Rastreado',
        descricao: '',
        data_inicio: '2026-02-01',
        data_fim: null,
        status_execucao_id: 1
      })
    expect(res.status).toBe(201)

    const [criacao] = await eventos('acervo.lote', 'I')
    expect(criacao.entidade).toBe('projeto')
    expect(Number(criacao.entidade_id)).toBe(Number(projeto.id))
    expect(criacao.usuario_uuid).toBe(ADMIN_UUID)
  })

  it('o volume grava o autor nas seis funcoes que nunca o receberam', async () => {
    const criacao = await request(app)
      .post('/api/volumes/volume_armazenamento')
      .set('Authorization', admin())
      .send({
        volume_armazenamento: [
          { nome: 'Volume Rastreado', volume: '/data/rastreado', capacidade_gb: 100 }
        ]
      })
    expect(criacao.status).toBe(201)

    const [nasceu] = await eventos('acervo.volume_armazenamento', 'I')
    expect(nasceu.usuario_uuid).toBe(ADMIN_UUID)
    expect(nasceu.entidade).toBe('volume')
    expect(nasceu.dados_depois.volume).toBe('/data/rastreado')
    const volumeId = Number(nasceu.registro_id)
    expect(Number(nasceu.entidade_id)).toBe(volumeId)

    const alteracao = await request(app)
      .put('/api/volumes/volume_armazenamento')
      .set('Authorization', admin())
      .send({
        volume_armazenamento: [
          { id: volumeId, nome: 'Volume Rastreado', volume: '/data/mudou', capacidade_gb: 100 }
        ]
      })
    expect(alteracao.status).toBe(200)

    const [mudou] = await eventos('acervo.volume_armazenamento', 'U')
    // O CAMINHO do volume e o campo que faz o acervo inteiro daquele volume
    // apontar para outro lugar: e o que se procura no historico.
    expect(mudou.campos_alterados).toEqual(['volume'])
    expect(mudou.dados_antes.volume).toBe('/data/rastreado')
    expect(mudou.dados_depois.volume).toBe('/data/mudou')
    expect(mudou.usuario_uuid).toBe(ADMIN_UUID)

    const exclusao = await request(app)
      .delete('/api/volumes/volume_armazenamento')
      .set('Authorization', admin())
      .send({ volume_armazenamento_ids: [volumeId] })
    expect(exclusao.status).toBe(200)

    const [apagou] = await eventos('acervo.volume_armazenamento', 'D')
    expect(apagou.usuario_uuid).toBe(ADMIN_UUID)
    expect(apagou.dados_antes.volume).toBe('/data/mudou')
  })
})

// --- O contexto da requisicao ------------------------------------------------

describe('Rastreabilidade: o contexto que o guarda monta', () => {
  it('grava a rota por onde a mudanca entrou', async () => {
    const produto = await createProduto({ mi: '9900-1' })

    const res = await request(app)
      .put('/api/produtos/produto')
      .set('Authorization', admin())
      .send({
        id: Number(produto.id),
        nome: produto.nome,
        mi: produto.mi,
        inom: produto.inom,
        tipo_escala_id: produto.tipo_escala_id,
        denominador_escala_especial: null,
        tipo_produto_id: produto.tipo_produto_id,
        descricao: 'com contexto'
      })
    expect(res.status).toBe(200)

    const [evento] = await eventos('acervo.produto', 'U')
    // O PADRAO da rota, e nao a URL com os ids dentro: e o que se procura
    // quando duas rotas escrevem a mesma tabela.
    expect(evento.rota).toBe('PUT /api/produtos/produto')
    // O token da suite e anterior ao `cliente` entrar no payload do JWT, e
    // 'desconhecido' e a resposta honesta: adivinhar por User-Agent daria um
    // valor plausivel e errado.
    expect(evento.origem).toBe('desconhecido')
    expect(evento.lote_id).not.toBeNull()
  })
})
