'use strict'

// Teste unitario do controller de Meta do PIT (banco mockado).
// Cobre: listar (com e sem filtro de ano), criar (NAO valida exercicio: vai
// direto ao INSERT na tx), atualizar (404 se nao existe) e deletar (409 quando
// ha consumidor vinculado; 404 se inexistente).
//
// O controller saiu de src/orcamento/meta/ para src/pit/: o PIT
// virou dado de plataforma. O terceiro consumidor, mapoteca.pedido, entrou na
// mesma data, e por isso o COUNT do deletar soma tres tabelas.

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

  test('criar insere a IDENTIDADE e declara a meta na revisao aberta', async () => {
    comRevisaoAberta()
    mockDb.conn.one.mockResolvedValueOnce({ id: 9 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 9 })

    const r = await ctrl.criar(
      { ano: 2026, numero_meta: 1, item: '1.1', descricao: 'Meta 1' },
      'uuid-1'
    )

    expect(r).toEqual({ id: 9 })
    expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
    // A identidade: sem descricao, sem quantidade, sem prazo.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta'),
      expect.objectContaining({ ano: 2026, numero_meta: 1, usuarioUuid: 'uuid-1' })
    )
    // A declaracao, na revisao que a autoriza.
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pit.meta_revisao'),
      expect.objectContaining({ revisaoId: 7, descricao: 'Meta 1' })
    )
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
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, origem_id: 1 }) // meta existe
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 }) // UPDATE RETURNING id

    const r = await ctrl.atualizar(
      5, { ano: 2026, numero_meta: 2, item: '2.1', unidade_id: 1 }, 'uuid'
    )

    expect(r).toEqual({ id: 5 })
    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pit.meta'),
      expect.objectContaining({ id: 5, numero_meta: 2 })
    )

    // CONTROLE NEGATIVO. Ate aqui esta mesma chamada lia `pit.meta_vigente`,
    // comparava a declaracao e escrevia em `pit.meta_revisao` quando algo
    // divergia. Com o comportamento antigo estas duas asercoes reprovam.
    const sqls = mockDb.conn.one.mock.calls
      .concat(mockDb.conn.oneOrNone.mock.calls)
      .map(([sql]) => String(sql))
    expect(sqls.some(s => s.includes('pit.meta_revisao'))).toBe(false)
    expect(sqls.some(s => s.includes('pit.meta_vigente'))).toBe(false)
  })

  // OMITIR `origem_id` E "NAO MEXER". A regra anterior zerava para Manual, e o
  // formulario da tela nao tem campo de origem: salvar uma correcao de item
  // desligava, em silencio, a meta que contava sozinha.
  test('atualizar sem origem_id guarda a origem que ja estava', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, origem_id: 3 })
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
    mockDb.conn.one.mockResolvedValueOnce({ id: 5 })

    await ctrl.atualizar(
      5, { ano: 2026, numero_meta: 2, item: '2.1', unidade_id: 1 }, 'uuid'
    )

    expect(mockDb.conn.one).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pit.meta'),
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
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026 }) // a meta
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
      mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 5, revisao_id: 7 })

      const r = await ctrl.declararNaRevisao(7, 5, declaracao, 'uuid')

      expect(r).toEqual({ id: 3, meta_id: 5, revisao_id: 7 })
      expect(mockDb.conn.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pit.meta_revisao'),
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
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026 }) // a meta
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
      // A linha que JA existia na revisao: e o `dados_antes` do evento.
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 3, meta_id: 5, revisao_id: 7, quantidade_prevista: 53
      })
      mockDb.conn.one.mockResolvedValueOnce({
        id: 3, meta_id: 5, revisao_id: 7, quantidade_prevista: 35
      })

      const r = await ctrl.declararNaRevisao(
        7, 5,
        { ...declaracao, quantidade_prevista: 35, motivo: 'O R0 assinado diz 35' },
        'uuid'
      )

      expect(r).toEqual({ id: 3, meta_id: 5, revisao_id: 7 })

      const evento = eventosDeAuditoria(mockDb)
        .find(e => e.tabela === 'pit.meta_revisao')
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
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 5, ano: 2026 })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
      mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 5, revisao_id: 7 })

      await ctrl.declararNaRevisao(7, 5, declaracao, 'uuid')

      const sqls = mockDb.conn.one.mock.calls.map(([sql]) => String(sql))
      expect(sqls.some(s => s.includes('UPDATE pit.meta'))).toBe(false)
    })

    test('com numero_meta no corpo, a identidade muda na mesma transacao', async () => {
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 7, ano: 2026, codigo: 'R1', data_vigencia: null
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({
        id: 5, ano: 2026, numero_meta: 4, item: '4.1', unidade_id: 1, origem_id: 1
      })
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 })
      mockDb.conn.one.mockResolvedValueOnce({ id: 5, numero_meta: 4, item: '4.3' })
      mockDb.conn.one.mockResolvedValueOnce({ id: 3, meta_id: 5, revisao_id: 7 })

      await ctrl.declararNaRevisao(
        7, 5, { ...declaracao, numero_meta: 4, item: '4.3' }, 'uuid'
      )

      expect(mockDb.conn.one).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE pit.meta'),
        expect.objectContaining({ metaId: 5, numero_meta: 4, item: '4.3' })
      )
      // E a declaracao sai junto, na mesma tx: uma so chamada de tx.
      expect(mockDb.conn.tx).toHaveBeenCalledTimes(1)
      expect(mockDb.conn.one).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pit.meta_revisao'),
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
  // A ordem das leituras: a meta (lerAntes), o exercicio, as declaracoes, os
  // dependentes e os lancamentos.
  const metaApagavel = ({ declaracoes = [{ revisao_id: 7, codigo: 'R0' }] } = {}) => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, ano: 2026 }) // a meta
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ situacao_id: 2 }) // exercicio
    mockDb.conn.any.mockResolvedValueOnce(declaracoes)
  }

  test('deletar bloqueia com 409 quando ha pdr_item/nota_credito vinculados', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 2 }) // COUNT dependentes > 0
    await expect(ctrl.deletar(1, 7)).rejects.toMatchObject({
      statusCode: httpCode.Conflict
    })
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  test('deletar remove quando nao ha vinculados (n:0)', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 }) // sem dependentes
    mockDb.conn.none.mockResolvedValueOnce(undefined)
    await ctrl.deletar(1, 7)
    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM pit.meta'),
      { id: 1 }
    )
  })

  // CONTROLE NEGATIVO da regra nova: com DUAS declaracoes a meta ja entrou na
  // historia do plano. Antes desta regra o DELETE passava aqui.
  test('deletar recusa a meta que DUAS revisoes declaram, e manda cancelar', async () => {
    metaApagavel({
      declaracoes: [
        { revisao_id: 7, codigo: 'R0' },
        { revisao_id: 8, codigo: 'R1' }
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
    metaApagavel({ declaracoes: [{ revisao_id: 7, codigo: 'R0' }] })

    await expect(ctrl.deletar(1, 9)).rejects.toThrow(/R0/)
    expect(mockDb.conn.none).not.toHaveBeenCalled()
  })

  // O CLI nao manda a revisao, e continua barrado pela primeira metade: com uma
  // declaracao so, apagar e o ato certo.
  test('deletar sem revisao passa quando ha uma declaracao so', async () => {
    metaApagavel()
    mockDb.conn.one.mockResolvedValueOnce({ n: 0 })
    mockDb.conn.none.mockResolvedValueOnce(undefined)

    await ctrl.deletar(1, undefined)

    expect(mockDb.conn.none).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM pit.meta'),
      { id: 1 }
    )
  })

  test('deletar recusa o exercicio ENCERRADO', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, ano: 2025 })
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
    expect(String(sql)).toContain('FROM pit.exercicio')
    expect(String(sql)).toContain('UNION')
  })
})
