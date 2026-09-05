'use strict'

// Teste unitario do controller de Meta do PIT (banco mockado).
// Cobre: listar (com e sem filtro de ano), criar, atualizar (404 se nao existe)
// e deletar (409 quando ha consumidor vinculado; 404 se inexistente).
//
// O QUE O CONTROLLER CHAMA DE "META" E O ITEM (`pit.meta_item`) desde 1.30.0. O
// grupo numerado e `pit.meta`, tem nome proprio e e resolvido por (ano,
// numero_meta): por isso quase toda escrita ganhou UMA leitura a mais, a do
// grupo. As sequencias de duble abaixo refletem essa ordem.
//
// O DEPENDENTE QUE BLOQUEIA O DELETE sao TRES tabelas, e nao cinco: o pedido, a
// versao e a capacitacao apontam o ITEM. A NC e o item do PDR apontam a META, e
// apagar a 1.1 nao os deixa orfaos.

const { createMockDb, eventosDeAuditoria } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../pit/pit_ctrl')
const httpCode = require('../../utils/http_code')

describe('pit_ctrl', () => {
  beforeEach(() => mockDb.reset())

  test('listar com ano passa o filtro', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
    const r = await ctrl.listar(2026)
    expect(r).toHaveLength(2)
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('WHERE ano = $<ano>'),
      { ano: 2026 }
    )
  })

  test('listar sem ano traz todas (sem filtro)', async () => {
    mockDb.conn.any.mockResolvedValueOnce([])
    await ctrl.listar()
    // A chamada sem filtro usa apenas a query (sem objeto de parametros de ano).
    expect(mockDb.conn.any).toHaveBeenCalledWith(
      expect.stringContaining('FROM pit.meta_vigente')
    )
  })

  // O exercício VIGENTE e a revisão ABERTA, que toda escrita de meta consulta
  // antes de gravar. O dublê responde as duas leituras, nessa ordem.
  const comRevisaoAberta = () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    // O duble copia as colunas do SELECT real: `data_vigencia` nula e o que
    // define o RASCUNHO, e sem ela o controller cobraria motivo de correcao.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
    })
  }

  test('criar insere a IDENTIDADE e declara o item na revisao aberta', async () => {
    comRevisaoAberta()
    // O GRUPO ja existe: `resolverMeta` o acha e nao cria nada.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 40, ano: 2026, numero_meta: 1 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 9 })

    const r = await ctrl.criar(
      { ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Carta 1:25.000.', unidade_id: 1 },
      'uuid-1'
    )

    expect(r).toEqual({ id: 9 })
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    // A identidade do ITEM: sem descricao, sem quantidade, sem prazo. O item
    // pendura no grupo achado, e nao guarda `ano` nem `numero_meta`.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta_item'),
      expect.objectContaining({ metaId: 40, item: '1.1', usuarioUuid: 'uuid-1' })
    )
    // A declaracao, na revisao que a autoriza.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta_item_revisao'),
      expect.objectContaining({ revisaoId: 7, descricao: 'Carta 1:25.000.' })
    )
  })

  // O GRUPO NASCE JUNTO quando ainda nao existe, e so entao o `nome` e cobrado.
  // Esta asercao reprova o desenho anterior, em que `pit.meta` guardava `item` e
  // nao tinha nome nenhum.
  test('criar cria o GRUPO quando ele nao existe, com o nome do documento', async () => {
    comRevisaoAberta()
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null) // o grupo nao existe
    mockDb.conn.one.mockResolvedValueOnce({ id: 40 }) // INSERT do grupo
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 }) // INSERT do item
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 9 })

    await ctrl.criar(
      {
        ano: 2026,
        numero_meta: 1,
        nome: 'Produção de Geoinformação',
        item: '1.1',
        descricao: 'Carta 1:25.000.',
        unidade_id: 1
      },
      'uuid-1'
    )

    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta '),
      expect.objectContaining({ ano: 2026, numeroMeta: 1, nome: 'Produção de Geoinformação' })
    )
  })

  // SEM O NOME o grupo inexistente recusa, e nada e gravado. O grupo sem nome
  // era exatamente o que o desenho antigo permitia.
  test('criar recusa o grupo inexistente sem nome, e nao grava nada', async () => {
    comRevisaoAberta()
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(ctrl.criar(
      { ano: 2026, numero_meta: 9, item: '9.1', descricao: 'X', unidade_id: 1 },
      'uuid-1'
    )).rejects.toThrow(/nome/i)

    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  test('criar sem revisao aberta recusa, e nao grava nada', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

    await expect(ctrl.criar(
      { ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' },
      'uuid-1'
    )).rejects.toThrow(/revis/i)

    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  // ATUALIZAR SO MEXE NA IDENTIDADE, e esta e a regra que o desenho novo fixa: o
  // que a DSG promete muda dentro de uma revisao, e nao por aqui.
  test('atualizar mexe so na identidade, e NAO grava declaracao nenhuma', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, origem_id: 1, unidade_id: 1 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 41, numero_meta: 2 }) // o grupo
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 }) // UPDATE RETURNING id

    const r = await ctrl.atualizar(
      5, { ano: 2026, numero_meta: 2, item: '2.1', unidade_id: 1 }, 'uuid'
    )

    expect(r).toEqual({ id: 5 })
    // O ITEM MUDA DE GRUPO pelo `meta_id`, e nao por `ano`/`numero_meta`: as duas
    // colunas saíram de `pit.meta_item` e vivem no grupo.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pit.meta_item'),
      expect.objectContaining({ id: 5, metaId: 41, item: '2.1' })
    )

    // CONTROLE NEGATIVO. Ate aqui esta mesma chamada lia `pit.meta_vigente`,
    // comparava a declaracao e escrevia na tabela de declaracao quando algo
    // divergia. Com o comportamento antigo estas duas asercoes reprovam.
    const sqls = mockDb.conn.one.mock.calls
      .concat(mockDb.conn.oneOrNone.mock.calls)
      .map(([sql]) => String(sql))
    expect(sqls.some(s => s.includes('meta_item_revisao'))).toBe(false)
    expect(sqls.some(s => s.includes('pit.meta_vigente'))).toBe(false)
  })

  // OMITIR `origem_id` E "NAO MEXER". A regra anterior zerava para Manual, e o
  // formulario da tela nao tem campo de origem: salvar uma correcao de item
  // desligava, em silencio, a meta que contava sozinha.
  test('atualizar sem origem_id guarda a origem que ja estava', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, origem_id: 3, unidade_id: 1 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 41 }) // o grupo
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })

    await ctrl.atualizar(
      5, { ano: 2026, numero_meta: 2, item: '2.1', unidade_id: 1 }, 'uuid'
    )

    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pit.meta_item'),
      expect.objectContaining({ origem_id: 3 })
    )
  })

  test('atualizar com meta inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(
      ctrl.atualizar(99, { ano: 2026, numero_meta: 1 }, 'uuid')
    ).rejects.toMatchObject({ statusCode: httpCode.NotFound })
    expect(mockDb.conn.one).not.toHaveBeenCalled()
  })

  // DECLARAR NA REVISAO: a porta unica para mudar o que o PIT promete.
  describe('declararNaRevisao', () => {
    const declaracao = { descricao: 'Carta 1:25.000', quantidade_prevista: 24 }

    test('grava a declaracao na revisao em RASCUNHO', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ // a revisao
        id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
      })
      // O ITEM com o ano do GRUPO, que vem pelo JOIN da consulta.
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 1 })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
      mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 5, revisao_id: 7 })

      const r = await ctrl.declararNaRevisao(7, 5, declaracao, 'uuid')

      expect(r).toEqual({ id: 3, meta_id: 5, revisao_id: 7 })
      expect(mockDb.conn.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pit.meta_item_revisao'),
        expect.objectContaining({
          metaId: 5, revisaoId: 7, descricao: 'Carta 1:25.000', quantidade_prevista: 24
        })
      )
    })

    // A REVISAO PUBLICADA ACEITA A EDICAO, e o MOTIVO e o portao.
    //
    // O texto assinado e o rei, e o que esta no sistema e transcricao dele:
    // editar o R0 publicado conserta a nossa COPIA, e nao o plano. Sem o motivo
    // a porta viraria o caminho facil para reescrever o passado calado.
    test('a revisao PUBLICADA sem motivo recusa, e nao grava nada', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
      })

      await expect(ctrl.declararNaRevisao(7, 5, declaracao, 'uuid'))
        .rejects.toThrow(/motivo/i)

      expect(mockDb.conn.one).not.toHaveBeenCalled()
    })

    // CONTROLE NEGATIVO do teste acima: motivo curto nao vale. O minimo e o
    // mesmo do Joi da correcao de transcricao, cinco caracteres.
    test('a revisao PUBLICADA com motivo curto recusa', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
      })

      await expect(
        ctrl.declararNaRevisao(7, 5, { ...declaracao, motivo: 'oi' }, 'uuid')
      ).rejects.toThrow(/motivo/i)

      expect(mockDb.conn.one).not.toHaveBeenCalled()
    })

    // COM MOTIVO ela GRAVA, e o motivo desce para o rastro. Esta asercao reprova
    // o estado anterior, em que a revisao publicada era recusada sempre.
    test('a revisao PUBLICADA com motivo grava, e o rastro leva o motivo', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R0', data_vigencia: '2026-01-15'
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 1 })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
      // A linha que JA existia na revisao: e o `dados_antes` do evento.
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 3, meta_item_id: 5, revisao_id: 7, quantidade_prevista: 53
      })
      mockDb.conn.one.mockResolvedValueOnce({
        id: 3, meta_item_id: 5, revisao_id: 7, quantidade_prevista: 35
      })

      const r = await ctrl.declararNaRevisao(
        7, 5,
        { ...declaracao, quantidade_prevista: 35, motivo: 'O R0 assinado diz 35' },
        'uuid'
      )

      expect(r).toEqual({ id: 3, meta_id: 5, revisao_id: 7 })

      const evento = eventosDeAuditoria(mockDb)
        .find(e => e.tabela === 'pit.meta_item_revisao')
      expect(evento).toBeDefined()
      expect(evento.motivo).toBe('O R0 assinado diz 35')
      // A linha ja existia, entao o rastro e ALTERACAO e nao insercao.
      expect(evento.operacao).toBe('U')
    })

    // A IDENTIDADE VIAJA JUNTO, na MESMA transacao. Sem `numero_meta` no corpo,
    // `pit.meta` nao se toca: omitir e "nao mexer".
    test('sem numero_meta no corpo, a identidade nao e tocada', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026, numero_meta: 1 })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
      mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 5, revisao_id: 7 })

      await ctrl.declararNaRevisao(7, 5, declaracao, 'uuid')

      const sqls = mockDb.conn.one.mock.calls.map(([sql]) => String(sql))
      expect(sqls.some(s => s.includes('UPDATE pit.meta_item'))).toBe(false)
    })

    test('com numero_meta no corpo, a identidade muda na mesma transacao', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 5, ano: 2026, numero_meta: 4, item: '4.1', unidade_id: 1, origem_id: 1
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 44, numero_meta: 4 }) // o grupo
      mockDb.conn.one.mockResolvedValueOnce({ id: 5, item: '4.3' })
      mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_item_id: 5, revisao_id: 7 })

      await ctrl.declararNaRevisao(
        7, 5, { ...declaracao, numero_meta: 4, item: '4.3' }, 'uuid'
      )

      expect(mockDb.conn.one).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE pit.meta_item'),
        expect.objectContaining({ metaId: 5, grupoId: 44, item: '4.3' })
      )
      // E a declaracao sai junto, na mesma tx: uma so chamada de tx.
      expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
      expect(mockDb.conn.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pit.meta_item_revisao'),
        expect.objectContaining({ metaId: 5, revisaoId: 7 })
      )
    })

    // A revisao de um ano so declara meta DAQUELE ano. Sem a guarda, a UNIQUE
    // (meta_id, revisao_id) aceitaria a meta de 2025 dentro da revisao de 2026.
    test('recusa a meta de outro ano', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2025 })

      await expect(ctrl.declararNaRevisao(7, 5, declaracao, 'uuid'))
        .rejects.toThrow(/2025/)

      expect(mockDb.conn.one).not.toHaveBeenCalled()
    })

    test('404 quando a revisao nao existe', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce(null)

      await expect(ctrl.declararNaRevisao(99, 5, declaracao, 'uuid'))
        .rejects.toMatchObject({ statusCode: httpCode.NotFound })
    })

    test('recusa o exercicio ENCERRADO', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2025, codigo: 'R1', data_vigencia: null
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2025 })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 3 })

      await expect(ctrl.declararNaRevisao(7, 5, declaracao, 'uuid'))
        .rejects.toThrow(/encerrado/i)

      expect(mockDb.conn.one).not.toHaveBeenCalled()
    })
  })

  // APAGAR A META SO VALE NA REVISAO QUE A CRIOU.
  //
  // A primeira criacao pode ter nascido errada, e o documento assinado talvez
  // nem tenha a meta. Da segunda declaracao em diante o plano ja contou com ela,
  // e o que cabe e CANCELAR.
  //
  // A ordem das leituras: o item (lerAntes), o GRUPO (de onde vem o ano), o
  // exercicio, as declaracoes, os dependentes e os lancamentos.
  //
  // A DECLARACAO VEM INTEIRA do banco (`SELECT mr.*`), e o duble a espelha: ela
  // cai por cascata junto com o item e vira evento de auditoria, e o agregado
  // desse evento sai do proprio `meta_item_id` da linha. Um duble com so dois
  // campos deixaria o controlador passar num teste e estourar em producao.
  const DECLARACAO_R0 = {
    id: 90,
    meta_item_id: 1,
    revisao_id: 7,
    codigo: 'R0',
    descricao: 'Carta Topográfica 1:25.000.',
    quantidade_prevista: 24
  }

  const metaApagavel = ({ declaracoes = [DECLARACAO_R0] } = {}) => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, meta_id: 40 }) // o item
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ano: 2026 }) // o grupo
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
    mockDb.conn.any.mockResolvedValueOnce(declaracoes)
  }

  // O DEPENDENTE QUE BLOQUEIA sao o pedido, a versao e a capacitacao, que
  // apontam o ITEM. A NC e o item do PDR SAIRAM da conta em 1.30.0: eles apontam
  // a META (`pit.meta`), e apagar a 1.1 nao os deixa orfaos.
  test('deletar bloqueia com 409 quando ha versao/pedido/capacitacao vinculados', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 2 }) // COUNT dependentes > 0
    await expect(ctrl.deletar(1, 7)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  // CONTROLE NEGATIVO da decisao acima: a contagem NAO pode mais somar as duas
  // tabelas do orcamento. Com a consulta antiga esta asercao reprova.
  test('a contagem de dependentes NAO soma nota_credito nem pdr_item', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })
    mockDb.conn.one.mockResolvedValueOnce({ lancamentos: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    await ctrl.deletar(1, 7)

    const contagem = mockDb.conn.one.mock.calls
      .map(([sql]) => String(sql))
      .find(s => s.includes('AS n'))
    expect(contagem).toBeDefined()
    expect(contagem).toContain('acervo.versao')
    expect(contagem).toContain('mapoteca.pedido')
    expect(contagem).toContain('rpcmtec.capacitacao')
    expect(contagem).not.toContain('nota_credito')
    expect(contagem).not.toContain('pdr_item')
  })

  test('deletar remove quando nao ha vinculados (n:0)', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 }) // sem dependentes
    mockDb.conn.one.mockResolvedValueOnce({ lancamentos: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    await ctrl.deletar(1, 7)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM pit.meta_item'),
      { id: 1 }
    )
  })

  // CONTROLE NEGATIVO da regra nova: com DUAS declaracoes a meta ja entrou na
  // historia do plano. Antes desta regra o DELETE passava aqui.
  // A DECLARACAO QUE CAI POR CASCATA TEM RASTRO PROPRIO.
  //
  // `pit.meta_item_revisao.meta_item_id` e ON DELETE CASCADE: o DELETE do item
  // leva a declaracao sem um DELETE explicito no controlador. Sem este evento, o
  // que a DSG prometeu naquele item (descricao, quantidade, prazo, demandante)
  // sumiria em silencio, e a exclusao e justamente o que o rastro existe para
  // guardar. Mesmo desenho de `arquivoCtrl.auditarCascata` no orcamento.
  test('deletar registra a DECLARACAO que cai por cascata, antes do DELETE', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })
    mockDb.conn.one.mockResolvedValueOnce({ lancamentos: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    await ctrl.deletar(1, 7)

    const eventos = eventosDeAuditoria(mockDb)
    const daDeclaracao = eventos.find(e => e.tabela === 'pit.meta_item_revisao')
    expect(daDeclaracao).toBeDefined()
    expect(daDeclaracao).toMatchObject({
      operacao: 'D',
      entidade: 'meta',
      entidadeId: '1',
      registroId: '90'
    })
    // O QUE SE PERDEU vai no evento, e nao so o id: e o unico registro que
    // sobra do que aquele item prometia.
    expect(JSON.parse(daDeclaracao.dadosAntes)).toMatchObject({
      descricao: 'Carta Topográfica 1:25.000.',
      quantidade_prevista: 24
    })
    // `codigo` NAO ENTRA NO RASTRO. Ele vem do INNER JOIN com `pit.revisao` e
    // nao e coluna de `pit.meta_item_revisao`; `sanitizar` copia toda chave da
    // linha e `diffCampos` lista toda chave nao-nula, entao sem o destructuring
    // o evento passaria a exibir uma coluna que a tabela nao tem -- e o
    // renderizador pediria que alguem a declarasse no mapa.
    expect(JSON.parse(daDeclaracao.dadosAntes)).not.toHaveProperty('codigo')
    expect(daDeclaracao.camposAlterados).not.toContain('codigo')
    // E ele continua servindo ao MOTIVO, que e onde ele diz alguma coisa.
    expect(daDeclaracao.motivo).toContain('R0')
    // ANTES do evento do item: a ordem e a da leitura do historico.
    expect(eventos.findIndex(e => e.tabela === 'pit.meta_item_revisao'))
      .toBeLessThan(eventos.findIndex(e => e.tabela === 'pit.meta_item'))
  })

  test('deletar recusa a meta que DUAS revisoes declaram, e manda cancelar', async () => {
    metaApagavel({
      declaracoes: [
        { ...DECLARACAO_R0, revisao_id: 7, codigo: 'R0' },
        { ...DECLARACAO_R0, id: 91, revisao_id: 8, codigo: 'R1' }
      ]
    })

    await expect(ctrl.deletar(1, 7)).rejects.toMatchObject({
      statusCode: httpCode.Conflict,
      message: expect.stringContaining('CANCELE')
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  // A OUTRA METADE DA REGRA: estando noutra revisao, so resta cancelar.
  test('deletar recusa quando a revisao de onde se apaga nao e a criadora', async () => {
    metaApagavel({ declaracoes: [DECLARACAO_R0] })

    await expect(ctrl.deletar(1, 9)).rejects.toThrow(/R0/)
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  // O CLI nao manda a revisao, e continua barrado pela primeira metade: com uma
  // declaracao so, apagar e o ato certo.
  test('deletar sem revisao passa quando ha uma declaracao so', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })
    mockDb.conn.one.mockResolvedValueOnce({ lancamentos: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    await ctrl.deletar(1, undefined)

    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM pit.meta_item'),
      { id: 1 }
    )
  })

  test('deletar recusa o exercicio ENCERRADO', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, meta_id: 40 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ ano: 2025 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 3 })

    await expect(ctrl.deletar(1, 7)).rejects.toThrow(/encerrado/i)
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('deletar com meta inexistente vira 404', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    await expect(ctrl.deletar(99, 7)).rejects.toMatchObject({
      statusCode: httpCode.NotFound
    })
  })

  // O ANO DO PIT SAI DOS EXERCICIOS, e nao so das metas.
  //
  // CONTROLE NEGATIVO: a consulta era `SELECT DISTINCT ano FROM pit.meta`, e o
  // exercicio de 2027 aberto em 2026 nao tem meta nenhuma. Sem a uniao ele nao
  // aparecia no filtro, e sem o filtro nao havia como chegar nele para cadastrar
  // a primeira meta. Esta asercao reprova aquela consulta.
  test('anos une o exercicio com a meta, para o ano vazio aparecer', async () => {
    mockDb.conn.any.mockResolvedValueOnce([{ ano: 2027 }, { ano: 2026 }])

    const r = await ctrl.anos()

    expect(r).toEqual([2027, 2026])
    const [sql] = mockDb.conn.any.mock.calls[0]
    expect(String(sql)).toContain('FROM pit.pit')
    expect(String(sql)).toContain('UNION')
  })
})
