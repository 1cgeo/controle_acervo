'use strict'

// A REGRA DO DIFF, isolada.
//
// Ela e o que decide o conteudo de `campos_alterados`, que por sua vez e o que a
// tela mostra como "o que mudou". Ate 2026-08-02 ela so era exercitada de lado,
// por testes de rota da mapoteca: um caso de rota prova a contagem e nao a
// regra, e a regra e o que envelhece em silencio quando alguem acrescenta uma
// coluna de carimbo com nome novo.

const { diffCampos, normalizar, CAMPOS_DE_ESCRITURACAO } = require('../../auditoria/diff')

describe('diffCampos', () => {
  it('lista so o campo que mudou de verdade', () => {
    const antes = { id: 1, nome: 'Antigo', quantidade: 10 }
    const depois = { id: 1, nome: 'Novo', quantidade: 10 }

    expect(diffCampos(antes, depois)).toEqual(['nome'])
  })

  it('na insercao lista os campos que nasceram preenchidos, e nao os nulos', () => {
    const depois = { id: 1, nome: 'Novo', observacao: null }

    // `observacao` fica de fora: nascer nula nao e mudanca. Sem isto, todo
    // evento de criacao traria a lista de colunas da tabela.
    expect(diffCampos(null, depois)).toEqual(['id', 'nome'])
  })

  it('na exclusao lista os campos que se perderam', () => {
    const antes = { id: 1, nome: 'Sumiu' }

    expect(diffCampos(antes, null)).toEqual(['id', 'nome'])
  })

  it('NAO acusa mudanca quando o driver muda o tipo do valor', () => {
    // BIGINT volta como string e SMALLINT como numero. Comparar por === cru
    // acusaria mudanca onde nao houve, e o historico do pedido passaria a listar
    // campos que ninguem tocou.
    expect(diffCampos({ id: '10' }, { id: 10 })).toEqual([])
  })

  it('trata undefined e null como o MESMO estado', () => {
    // A linha do banco traz null; um objeto montado no JS pode trazer undefined.
    // Distinguir os dois faria a mesma ausencia contar como mudanca.
    expect(diffCampos({ a: null }, { a: undefined })).toEqual([])
  })

  it('compara data por instante, e nao por identidade de objeto', () => {
    const d1 = new Date('2026-08-02T10:00:00Z')
    const d2 = new Date('2026-08-02T10:00:00Z')

    expect(diffCampos({ quando: d1 }, { quando: d2 })).toEqual([])
    expect(diffCampos({ quando: d1 }, { quando: new Date('2026-08-03T10:00:00Z') }))
      .toEqual(['quando'])
  })

  it('compara array e objeto pelo conteudo', () => {
    expect(diffCampos({ p: ['a', 'b'] }, { p: ['a', 'b'] })).toEqual([])
    expect(diffCampos({ p: ['a'] }, { p: ['a', 'b'] })).toEqual(['p'])
  })

  it('DEIXA DE FORA as colunas de escrituracao, nos dois padroes de nome', () => {
    // Sao o carimbo de quem mexeu e de quando, e mudam em TODO update. Se
    // entrassem, toda linha do historico traria as duas e o campo que a pessoa
    // realmente mudou se perderia no meio.
    const antes = {
      observacao: 'x',
      usuario_atualizacao_id: 1,
      data_atualizacao: '2026-08-01',
      usuario_modificacao_uuid: 'aaa',
      data_modificacao: '2026-08-01'
    }
    const depois = {
      observacao: 'y',
      usuario_atualizacao_id: 2,
      data_atualizacao: '2026-08-02',
      usuario_modificacao_uuid: 'bbb',
      data_modificacao: '2026-08-02'
    }

    expect(diffCampos(antes, depois)).toEqual(['observacao'])
  })

  it('deixa de fora tambem as colunas de CRIACAO, que so aparecem na insercao', () => {
    const depois = {
      nome: 'Novo',
      data_criacao: '2026-08-02',
      usuario_criacao_id: 1,
      data_cadastramento: '2026-08-02',
      usuario_cadastramento_uuid: 'aaa'
    }

    // Num UPDATE elas nao mudariam e nunca apareceriam. Na INSERCAO o diff lista
    // o que nasceu preenchido, e sem esta regra o carimbo viria na frente do que
    // interessa em todo evento de criacao.
    expect(diffCampos(null, depois)).toEqual(['nome'])
  })

  it('devolve a lista ORDENADA, para o historico nao depender da ordem das colunas', () => {
    const antes = { zeta: 1, alfa: 1, meio: 1 }
    const depois = { zeta: 2, alfa: 2, meio: 2 }

    expect(diffCampos(antes, depois)).toEqual(['alfa', 'meio', 'zeta'])
  })

  it('nao quebra com os dois lados vazios', () => {
    expect(diffCampos(null, null)).toEqual([])
    expect(diffCampos({}, {})).toEqual([])
  })
})

describe('normalizar', () => {
  it('nulo e undefined viram o mesmo valor', () => {
    expect(normalizar(null)).toBeNull()
    expect(normalizar(undefined)).toBeNull()
  })

  it('numero e string do mesmo numero viram o mesmo texto', () => {
    expect(normalizar(10)).toBe(normalizar('10'))
  })
})

describe('CAMPOS_DE_ESCRITURACAO', () => {
  // Rede contra a mudanca silenciosa: quem tirar um nome daqui esta fazendo o
  // carimbo voltar a poluir o historico, e tem de ver este teste falhar.
  it('cobre os dois padroes de carimbo do sistema', () => {
    for (const nome of [
      'usuario_atualizacao_id', 'data_atualizacao',
      'usuario_modificacao_uuid', 'data_modificacao',
      'usuario_criacao_id', 'data_criacao',
      'usuario_cadastramento_uuid', 'data_cadastramento'
    ]) {
      expect(CAMPOS_DE_ESCRITURACAO.has(nome)).toBe(true)
    }
  })
})
