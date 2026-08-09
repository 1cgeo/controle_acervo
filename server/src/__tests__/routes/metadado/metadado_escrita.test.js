'use strict'

// A ESCRITA DO METADADO, com o banco fingido e a AUDITORIA DE VERDADE.
//
// O QUE ESTE ARQUIVO PROTEGE E A REGRA MAIS DURA DA CASA: escrita que muda dado
// vive numa transacao, e o evento de auditoria cai na MESMA. A origem no SAP nao
// auditava nada, e as onze tabelas deste schema passaram a auditar de uma vez --
// por um caminho generico, que e onde uma tabela some do rastro sem que nada
// acuse.
//
// A auditoria NAO e mockada: o `auditoriaCtrl` de verdade roda contra a mesma
// transacao fingida, e por isso os casos abaixo tambem provam que a entrada do
// `mapa/metadado.js` resolve -- entidade, agregado e resumo. Uma tabela ausente
// do mapa estoura aqui, e nao em producao no meio de um cadastro.
//
// O que se finge e so o `t` do pg-promise, que devolve a SQL montada em vez de
// falar com o Postgres. Assim a montagem da sentenca (colunas, parametros, cast
// de array, default de coluna) fica sob teste sem banco nenhum.

const chamadas = { one: [], none: [], oneOrNone: [] }

// A transacao fingida. Ela responde pelo CONTEUDO da SQL, e nao pela ordem das
// chamadas: `lerAntes` e o `produto dono da versao` do mapa batem os dois em
// `oneOrNone`, e distinguir por ordem quebraria a cada linha nova.
const fakeT = {
  one: async (sql, params) => {
    chamadas.one.push({ sql, params })
    return { id: 1, ...params }
  },
  none: async (sql, params) => {
    chamadas.none.push({ sql, params })
  },
  oneOrNone: async (sql, params) => {
    chamadas.oneOrNone.push({ sql, params })
    // O salto do mapa de auditoria: a linha guarda `versao_id`, e a ficha e a do
    // PRODUTO daquela versao.
    if (sql.includes('SELECT produto_id FROM acervo.versao')) return { produto_id: 99 }
    // `lerAntes`: a linha inteira antes da mudanca.
    return { id: params.id, nome: 'estado anterior', versao_id: 10, code: params.id }
  },
  batch: async promessas => Promise.all(promessas)
}

const mockDb = {
  conn: {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn(),
    task: async fn => fn(fakeT),
    tx: async fn => fn(fakeT)
  }
}

jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const metadadoCtrl = require('../../../metadado/metadado_ctrl')

const USUARIO = '3f1c2b5e-2f4a-4a3b-8d21-9c7e6a1b2c3d'
const CONTEXTO = { origem: 'web', rota: 'POST /api/metadados/x', loteId: 'lote-de-teste' }

beforeEach(() => {
  chamadas.one = []
  chamadas.none = []
  chamadas.oneOrNone = []
})

// O INSERT em `auditoria.evento` e o que prova que o rastro caiu junto.
const eventos = () => chamadas.none.filter(c => c.sql.includes('INSERT INTO auditoria.evento'))

const escritas = () => chamadas.one.filter(c => !c.sql.includes('auditoria.evento'))

describe('Toda inserção grava o evento na MESMA transação', () => {
  it('a criação de crédito QPT insere a linha e o evento', async () => {
    const criados = await metadadoCtrl.criarCreditosQpt(
      [{ nome: 'Equipe de 2026', qpt: '<Layout/>' }], USUARIO, CONTEXTO
    )

    expect(criados).toEqual([{ id: 1 }])
    expect(escritas()).toHaveLength(1)
    expect(escritas()[0].sql).toContain('INSERT INTO metadado.creditos_qpt (nome, qpt)')

    const [evento] = eventos()
    expect(evento.params.operacao).toBe('I')
    expect(evento.params.tabela).toBe('metadado.creditos_qpt')
    expect(evento.params.usuarioUuid).toBe(USUARIO)
    expect(evento.params.modulo).toBe('producao')
    expect(evento.params.entidade).toBe('creditos_qpt')
  })

  it('cada linha do corpo gera a sua própria linha e o seu próprio evento', async () => {
    await metadadoCtrl.criarCreditosQpt(
      [
        { nome: 'Equipe A', qpt: '<A/>' },
        { nome: 'Equipe B', qpt: '<B/>' }
      ],
      USUARIO, CONTEXTO
    )

    // A ORIGEM GRAVAVA O LOTE INTEIRO NUMA SENTENCA SO, com o helper de insert em
    // massa do pg-promise. Uma sentenca so nao tem como dizer QUAL linha nasceu,
    // e o rastro sairia com um evento sem registro.
    expect(escritas()).toHaveLength(2)
    expect(eventos()).toHaveLength(2)
  })
})

describe('O nível da declaração decide a ficha em que o evento cai', () => {
  // O XOR do schema e do banco tem consequencia no RASTRO: a declaracao de nivel
  // VERSAO aparece na ficha do PRODUTO daquela folha, ao lado dos eventos de
  // `acervo.versao`; a de nivel LOTE aparece na ficha do LOTE.
  it('a declaração por versão cai na ficha do produto', async () => {
    await metadadoCtrl.criarSensorCartaOrtoimagem(
      [{
        versao_id: 10, tipo: 'Óptico', plataforma: 'Sentinel-2', nome: 'MSI',
        resolucao: '10 m', bandas: 'RGB', nivel_produto: 'L2A'
      }],
      USUARIO, CONTEXTO
    )

    const [evento] = eventos()
    expect(evento.params.entidade).toBe('produto')
    expect(evento.params.entidadeId).toBe('99')
  })

  it('a declaração por lote cai na ficha do lote', async () => {
    await metadadoCtrl.criarSensorCartaOrtoimagem(
      [{
        lote_id: 7, tipo: 'Óptico', plataforma: 'Sentinel-2', nome: 'MSI',
        resolucao: '10 m', bandas: 'RGB', nivel_produto: 'L2A'
      }],
      USUARIO, CONTEXTO
    )

    const [evento] = eventos()
    expect(evento.params.entidade).toBe('lote')
    expect(evento.params.entidadeId).toBe('7')
  })
})

describe('A montagem da sentença', () => {
  it('o opcional ausente entra como null, e não some da lista de colunas', async () => {
    await metadadoCtrl.criarSensorCartaOrtoimagem(
      [{
        lote_id: 7, tipo: 'Óptico', plataforma: 'Sentinel-2', nome: 'MSI',
        resolucao: '10 m', bandas: 'RGB', nivel_produto: 'L2A'
      }],
      USUARIO, CONTEXTO
    )

    // Sem isto o pg-promise derruba com "Property doesn't exist", que chega como
    // 500 onde nao houve erro nenhum: o corpo mandou o lote, e nao a versao.
    expect(escritas()[0].params.versao_id).toBeNull()
  })

  // `dpi` e `INTEGER NOT NULL DEFAULT 300`, e o INSERT deste modulo lista TODAS
  // as colunas: o default do banco so valeria para a coluna AUSENTE da lista.
  it('o DPI omitido vira 300, e não null', async () => {
    await metadadoCtrl.criarInformacoesEdicao(
      [{
        lote_id: 7,
        pec_planimetrico: 'PEC-PCD A',
        pec_altimetrico: 'PEC-PCD A',
        origem_dados_altimetricos: 'Copernicus',
        territorio_internacional: false,
        acesso_restrito: false,
        carta_militar: false,
        data_criacao: '2019-2021',
        epsg_mde: '4674',
        caminho_mde: '/dados/mde.tif',
        dados_terceiro: [],
        quadro_fases: { fases: [] }
      }],
      USUARIO, CONTEXTO
    )

    expect(escritas()[0].params.dpi).toBe(300)
  })

  // A LISTA VAZIA E O CASO NORMAL (a maioria das folhas nao usa dado de
  // terceiro), e sem o cast o Postgres recusa `array[]` com "cannot determine
  // type of empty array". O erro apareceria justamente no caminho comum.
  it('as colunas de array levam cast explícito', async () => {
    await metadadoCtrl.criarClassesComplementaresOrto(
      [{ nome: 'Padrão DSG', classes: ['llp_nome_local_p'] }], USUARIO, CONTEXTO
    )

    expect(escritas()[0].sql).toContain('::text[]')
  })

  it('o quadro de fases entra como JSON, e não como texto de objeto', async () => {
    await metadadoCtrl.criarInformacoesEdicao(
      [{
        versao_id: 10,
        pec_planimetrico: 'PEC-PCD A',
        pec_altimetrico: 'PEC-PCD A',
        origem_dados_altimetricos: 'Copernicus',
        territorio_internacional: false,
        acesso_restrito: false,
        carta_militar: false,
        data_criacao: '2019',
        epsg_mde: '4674',
        caminho_mde: '/dados/mde.tif',
        dados_terceiro: [],
        quadro_fases: { fases: [{ fase: 'Edição' }] }
      }],
      USUARIO, CONTEXTO
    )

    expect(escritas()[0].sql).toContain('$<quadro_fases:json>')
  })
})

describe('A atualização guarda o estado ANTERIOR', () => {
  it('lê a linha antes e manda os dois lados para o rastro', async () => {
    await metadadoCtrl.atualizarCreditosQpt(
      [{ id: 5, nome: 'Equipe nova', qpt: '<Novo/>' }], USUARIO, CONTEXTO
    )

    // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado anterior e
    // lanca o 404 quando o registro nao existe.
    expect(chamadas.oneOrNone.some(c => c.sql.includes('FROM metadado.creditos_qpt'))).toBe(true)

    const [evento] = eventos()
    expect(evento.params.operacao).toBe('U')
    expect(evento.params.dadosAntes).not.toBeNull()
    expect(evento.params.dadosDepois).not.toBeNull()
    // Os campos alterados saem do diff das DUAS linhas lidas do banco, e nao do
    // corpo da requisicao: o que interessa auditar e o que o banco GRAVOU.
    expect(evento.params.camposAlterados).toContain('nome')
  })

  // A organizacao e a UNICA tabela do schema cuja chave nao se chama `id`: ela e
  // dominio semeado, e o `code` dela e o valor que `informacoes_produto` aponta.
  it('a organização é atualizada pelo code, e não por um id', async () => {
    await metadadoCtrl.atualizarOrganizacao(
      [{ code: 1, nome: '1º Centro de Geoinformação', sigla: '1º CGEO' }], USUARIO, CONTEXTO
    )

    const escrita = escritas()[0]
    expect(escrita.sql).toContain('UPDATE metadado.organizacao')
    expect(escrita.sql).toContain('WHERE code = $<code>')
    // O `code` NAO entra na lista de colunas atualizadas: ele identifica a linha.
    expect(escrita.sql).not.toContain('code = $<code>,')

    expect(eventos()[0].params.entidade).toBe('organizacao_metadado')
  })
})

describe('A exclusão também deixa rastro', () => {
  it('lê a linha, apaga e registra a exclusão com o estado anterior', async () => {
    await metadadoCtrl.apagarCreditosQpt([5], USUARIO, CONTEXTO)

    const apagou = chamadas.none.find(c => c.sql.includes('DELETE FROM metadado.creditos_qpt'))
    expect(apagou).toBeDefined()

    const [evento] = eventos()
    expect(evento.params.operacao).toBe('D')
    expect(evento.params.registroId).toBe('5')
    expect(evento.params.dadosAntes).not.toBeNull()
    // Na exclusao nao ha "depois", e e por isso que o `antes` e obrigatorio: sem
    // ele o evento diria que algo sumiu sem dizer o que era.
    expect(evento.params.dadosDepois).toBeNull()
  })
})
