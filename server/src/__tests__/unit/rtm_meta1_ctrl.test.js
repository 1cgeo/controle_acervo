'use strict'

// A aba META1_DETALHADA do RTM, do lado do DADO: o banco mockado, e o que se
// protege aqui é a TRADUÇÃO das linhas para o vocabulário da aba.
//
// O que este arquivo prende são as quatro regras medidas no RTM de agosto de
// 2026 (193 linhas, 13 colunas), e cada uma delas custou uma linha errada no
// documento que sobe para a DSG:
//
//  - a Data da Carga (BDGEx) SAI SEMPRE VAZIA, porque a coluna não existe no
//    banco e derivá-la de `data_cadastramento` daria uma data plausível e
//    falsa (decisão do Chefe da DGEO, 2026-09-11);
//  - a Meta é SEMPRE texto: em agosto uma linha saiu float, porque alguém
//    digitou `2` sem ponto, e o Calc a alinhou à direita;
//  - Lote e Bloco carregam o mesmo valor, em 190 de 190 linhas preenchidas;
//  - a folha SEM lote existe, e são as três do Estádio Beira Rio (metas 1.9,
//    1.10 e 1.11). Um INNER JOIN as apagaria sem nada acusar.

const mockDb = {
  conn: {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn(),
    tx: jest.fn()
  }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

jest.mock('../../instituicao/instituicao_ctrl', () => ({
  paraDocumento: jest.fn().mockResolvedValue({
    nome: '1º Centro de Geoinformação',
    sigla: '1º CGEO',
    sigla_slug: '1_CGEO'
  })
}))

const rtmMeta1Ctrl = require('../../rpcmtec/rtm_meta1_ctrl')
const { COLUNAS_META1 } = require('../../rpcmtec/rtm_ods')

// Os códigos são de dominio.situacao_carregamento (er/dominio.sql:53-59).
const NAO_CARREGADO = 1
const BDGEX_OSTENSIVO = 2
const BDGEX_OPERACOES = 3
const IGW = 4
const GEDW = 5
const EBGEO = 6

// Uma folha da meta 1.1 já carregada no BDGEx, como o banco a devolve.
const LINHA_DO_BANCO = {
  omds: '1º CGEO',
  demandante: 'COTER/DECEX',
  meta: '1.1',
  produto: 'Carta Topográfica',
  mi: '2833-1-NE',
  escala: '1:25.000',
  projeto_sap: 'Produção de Geoinformação Nacional 2026',
  lote_sap: '1d CT 25k Parque Nacional Iguaçu',
  uuid_versao: '6cd17aa9-8161-4aab-a86a-3cdec9466059',
  observacao: null,
  situacoes_carregamento: [BDGEX_OSTENSIVO],
  pronta: true,
  data_edicao: '2026-05-29T00:00:00.000Z',
  data_prevista: '2026-05-01'
}

// A MESMA folha, ainda NÃO PRODUZIDA: é a versão Planejada, que existe como
// registro (com produto, MI, escala e lote) e ainda não tem arquivo nenhum.
// São 48 das 193 linhas da aba de agosto, e 30 das 165 que a produção devolve.
const LINHA_PLANEJADA = {
  ...LINHA_DO_BANCO,
  mi: '2848-1-NE',
  uuid_versao: '25f12d80-fee5-48f7-9318-e04fc973b037',
  situacoes_carregamento: null,
  pronta: false,
  data_edicao: '2026-01-02T00:00:00.000Z',
  data_prevista: '2026-11-30'
}

const comLinhas = (...linhas) => rtmMeta1Ctrl.paraAbaMeta1(linhas)
const uma = (extra = {}) => comLinhas({ ...LINHA_DO_BANCO, ...extra })[0]

describe('rtm_meta1_ctrl: o contrato da aba', () => {
  test('devolve as 13 chaves da aba, e as mesmas que o gerador declara', () => {
    const linha = uma()

    expect(Object.keys(linha)).toEqual([
      'omds', 'demandante', 'meta', 'produto', 'mi', 'escala',
      'projeto_sap', 'lote_sap', 'bloco_sap',
      'data_carga_bdgex', 'id_carga_bdgex', 'local_carga', 'observacao'
    ])
    // A ordem das colunas do .ods é a mesma: chave que o gerador pede e este
    // módulo não devolve sai como célula vazia, sem erro nenhum.
    expect(Object.keys(linha)).toEqual(COLUNAS_META1.map(c => c.key))
  })

  test('lista vazia devolve lista vazia, e não uma linha de nulos', () => {
    expect(rtmMeta1Ctrl.paraAbaMeta1([])).toEqual([])
  })
})

describe('rtm_meta1_ctrl: a Data da Carga (BDGEx)', () => {
  test('sai vazia mesmo na folha carregada', () => {
    expect(uma().data_carga_bdgex).toBeNull()
  })

  test('sai vazia mesmo que o banco traga uma data com esse nome', () => {
    // A GUARDA É CONTRA O FUTURO: no dia em que alguém acrescentar a coluna à
    // consulta sem decidir a regra, a célula continua em branco até a decisão
    // ser tomada. Passar a data adiante em silêncio é o que a decisão de
    // 2026-09-11 recusa.
    const linha = uma({
      data_carga_bdgex: '2026-05-29',
      data_carregamento: '2026-05-29',
      data_cadastramento: '2026-05-29'
    })

    expect(linha.data_carga_bdgex).toBeNull()
  })

  test('sai vazia em TODAS as linhas, e não só na primeira', () => {
    const linhas = comLinhas(
      LINHA_DO_BANCO,
      { ...LINHA_DO_BANCO, meta: '1.2', mi: '2800-1' },
      { ...LINHA_DO_BANCO, meta: '1.3', mi: '2799-1-NE', situacoes_carregamento: null }
    )

    expect(linhas).toHaveLength(3)
    expect(linhas.every(l => l.data_carga_bdgex === null)).toBe(true)
  })
})

describe('rtm_meta1_ctrl: a Meta é sempre texto', () => {
  test('o código com ponto continua o que era', () => {
    expect(uma({ meta: '1.11' }).meta).toBe('1.11')
  })

  test('o número 2 vira a cadeia "2", que é a linha errada de agosto', () => {
    const linha = uma({ meta: 2 })

    expect(linha.meta).toBe('2')
    expect(typeof linha.meta).toBe('string')
  })

  test('o número 1.1 também sai como texto', () => {
    // O PIOR CASO do float não é só o inteiro: 1.1 vindo como número passaria
    // por um `typeof` desatento e chegaria à planilha como número.
    const linha = uma({ meta: 1.1 })

    expect(linha.meta).toBe('1.1')
    expect(typeof linha.meta).toBe('string')
  })

  test('meta ausente sai vazia, e não como a cadeia "null"', () => {
    expect(uma({ meta: null }).meta).toBeNull()
    expect(uma({ meta: '' }).meta).toBeNull()
  })
})

describe('rtm_meta1_ctrl: Lote e Bloco', () => {
  test('carregam o mesmo valor', () => {
    const linha = uma()

    expect(linha.lote_sap).toBe('1d CT 25k Parque Nacional Iguaçu')
    expect(linha.bloco_sap).toBe(linha.lote_sap)
  })

  test('saem na grafia do CADASTRO, sem normalização', () => {
    // DECISÃO DO CHEFE, 2026-09-11: o sistema é a fonte. A base escreve
    // `2026_1d_CT_Parque_Nacional_Iguacu_25k` e a planilha de agosto escreve
    // `1d CT 25k Parque Nacional Iguaçu`. Sai o do cadastro, byte a byte:
    // reescrever para a digitação à mão criaria uma segunda verdade.
    const doCadastro = '2026_1d_CT_Parque_Nacional_Iguacu_25k'
    const linha = uma({ lote_sap: doCadastro })

    expect(linha.lote_sap).toBe(doCadastro)
    expect(linha.bloco_sap).toBe(doCadastro)
    // O sublinhado e a falta de acento são do cadastro e ficam como estão.
    expect(linha.lote_sap).toContain('_')
    expect(linha.lote_sap).not.toContain('Iguaçu')
  })

  test('o PROJETO também sai na grafia do cadastro', () => {
    // Mesma decisão, mesma data. A base diz `Mapeamento de Interesse da Força
    // 2026` e a planilha diz `Produção de Geoinformação Nacional 2026`; quem
    // comparar as duas vai ver nomes diferentes, e não é defeito da consulta.
    const doCadastro = 'Mapeamento de Interesse da Força 2026'

    expect(uma({ projeto_sap: doCadastro }).projeto_sap).toBe(doCadastro)
  })

  test('continuam iguais em todas as linhas, com lotes diferentes', () => {
    const linhas = comLinhas(
      LINHA_DO_BANCO,
      { ...LINHA_DO_BANCO, meta: '1.5', mi: '2799-1', lote_sap: '1v COMBATER' },
      { ...LINHA_DO_BANCO, meta: '1.2', mi: '2853-3', lote_sap: '1g CT 50k União da Vitória' }
    )

    expect(linhas.every(l => l.lote_sap === l.bloco_sap)).toBe(true)
    // E a régua REPROVA o estado que ela existe para pegar: se um dia o bloco
    // passar a sair de outra fonte, este conjunto deixa de ter três iguais.
    expect(new Set(linhas.map(l => l.lote_sap)).size).toBe(3)
  })
})

describe('rtm_meta1_ctrl: a folha sem lote', () => {
  // São as três linhas do Estádio Beira Rio do RTM de agosto (L191, L192 e
  // L193), metas 1.9, 1.10 e 1.11: produto especial, sem lote e sem projeto no
  // SAP. A linha da aba termina cedo, nas seis primeiras colunas.
  const SEM_LOTE = {
    omds: '1º CGEO',
    demandante: 'COTER',
    meta: '1.9',
    produto: 'Carta Topográfica Especial',
    mi: 'Estádio do Beira Rio – Porto Alegre/RS',
    escala: '1:2.000',
    projeto_sap: null,
    lote_sap: null,
    uuid_versao: 'b212c687-ba06-4064-856c-08fee62fe154',
    observacao: 'Foi feito um produto especial com um enquadramento com os 4 MI',
    situacoes_carregamento: null,
    data_edicao: '2026-07-30T00:00:00.000Z'
  }

  test('sai na aba, com lote, bloco e projeto vazios', () => {
    const linhas = rtmMeta1Ctrl.paraAbaMeta1([SEM_LOTE])

    expect(linhas).toHaveLength(1)
    expect(linhas[0].lote_sap).toBeNull()
    expect(linhas[0].bloco_sap).toBeNull()
    expect(linhas[0].projeto_sap).toBeNull()
  })

  test('mantém o que a identifica: meta, produto, MI e escala', () => {
    const [linha] = rtmMeta1Ctrl.paraAbaMeta1([SEM_LOTE])

    expect(linha.meta).toBe('1.9')
    expect(linha.produto).toBe('Carta Topográfica Especial')
    expect(linha.mi).toBe('Estádio do Beira Rio – Porto Alegre/RS')
    expect(linha.escala).toBe('1:2.000')
    expect(linha.observacao).toContain('produto especial')
  })

  test('as três do Beira Rio saem juntas, e não colapsam numa só', () => {
    const linhas = rtmMeta1Ctrl.paraAbaMeta1([
      SEM_LOTE,
      { ...SEM_LOTE, meta: '1.10', produto: 'Carta Ortoimagem Especial' },
      { ...SEM_LOTE, meta: '1.11', produto: 'MGCP' }
    ])

    expect(linhas).toHaveLength(3)
    expect(linhas.map(l => l.meta)).toEqual(['1.9', '1.10', '1.11'])
  })
})

describe('rtm_meta1_ctrl: o Local e o ID da Carga', () => {
  test('BDGEx Ostensivo e Operações são os dois "BDGEX" da aba', () => {
    expect(uma({ situacoes_carregamento: [BDGEX_OSTENSIVO] }).local_carga).toBe('BDGEX')
    expect(uma({ situacoes_carregamento: [BDGEX_OPERACOES] }).local_carga).toBe('BDGEX')
    // Os dois destinos na mesma folha continuam UM rótulo, e não 'BDGEX / BDGEX'.
    expect(uma({ situacoes_carregamento: [BDGEX_OPERACOES, BDGEX_OSTENSIVO] }).local_carga)
      .toBe('BDGEX')
  })

  test('IGW, GEDW e EBGeo saem com o nome do destino, e nunca como BDGEX', () => {
    // O RTM não tem rótulo para os três, e escrever 'BDGEX' num produto que foi
    // para o EBGeo é a linha plausível e falsa que sobe para a DSG.
    expect(uma({ situacoes_carregamento: [IGW] }).local_carga).toBe('IGW')
    expect(uma({ situacoes_carregamento: [GEDW] }).local_carga).toBe('GEDW')
    expect(uma({ situacoes_carregamento: [EBGEO] }).local_carga).toBe('EBGeo')
  })

  test('destinos diferentes na mesma folha saem os dois', () => {
    expect(uma({ situacoes_carregamento: [EBGEO, BDGEX_OSTENSIVO] }).local_carga)
      .toBe('BDGEX / EBGeo')
  })

  test('a folha não carregada sai com as duas colunas de carga vazias', () => {
    for (const vazio of [null, [], undefined]) {
      const linha = uma({ situacoes_carregamento: vazio })
      expect(linha.local_carga).toBeNull()
      expect(linha.id_carga_bdgex).toBeNull()
    }
  })

  test('o código "Não carregado" não vira destino nenhum', () => {
    // A consulta já o exclui, e a tradução não pode inventá-lo se ele chegar.
    const linha = uma({ situacoes_carregamento: [NAO_CARREGADO] })

    expect(linha.local_carga).toBeNull()
    expect(linha.id_carga_bdgex).toBeNull()
  })

  test('NENHUM dos seis códigos do domínio produz "Repositório DSG"', () => {
    // DECISÃO DO CHEFE, 2026-09-11: não nasce código novo em
    // `dominio.situacao_carregamento` para o Repositório DSG. A célula sai em
    // branco e quem monta o RTM escreve o rótulo à mão, como já faz hoje --
    // mesmo tratamento da Data da Carga.
    for (const code of [NAO_CARREGADO, BDGEX_OSTENSIVO, BDGEX_OPERACOES, IGW, GEDW, EBGEO]) {
      // A célula vazia vale, e o `?? ''` é o que deixa o null entrar na régua:
      // com `toMatch` direto, o código 1 derrubava o caso com erro de tipo
      // antes de os outros cinco serem exercitados.
      const local = uma({ situacoes_carregamento: [code] }).local_carga ?? ''
      expect(local).not.toMatch(/Reposit[óo]rio/i)
    }
    // E os seis juntos na mesma folha também não inventam o rótulo.
    const todos = uma({
      situacoes_carregamento: [NAO_CARREGADO, BDGEX_OSTENSIVO, BDGEX_OPERACOES, IGW, GEDW, EBGEO]
    }).local_carga ?? ''
    expect(todos).not.toMatch(/Reposit[óo]rio/i)
  })

  test('os DOIS brancos desta coluna, que a planilha mostra iguais', () => {
    // 1. BRANCO POR FALTA DE CARGA: o banco sabe, e a resposta é "ainda não".
    const semCarga = uma({ situacoes_carregamento: null })
    expect(semCarga.local_carga).toBeNull()
    expect(semCarga.id_carga_bdgex).toBeNull()

    // 2. BRANCO POR FALTA DE CÓDIGO: o destino existe e o domínio não o nomeia.
    // Quando o único código presente não tem tradução, a célula fica com quem
    // preenche -- e a folha NÃO ganha um rótulo inventado nem herda 'BDGEX'.
    const codigoDesconhecido = uma({ situacoes_carregamento: [99] })
    expect(codigoDesconhecido.local_carga).toBeNull()
  })

  test('a folha de CDGV COMBATER sai com o que o CADASTRO diz, e ele diverge da planilha', () => {
    // MEDIDO NA PRODUÇÃO, 2026-09-11: as 8 folhas de CDGV ligadas à meta 1.5
    // têm `situacao_carregamento_id` = 2 (BDGEx Ostensivo), e a planilha de
    // agosto escreve 'Repositório DSG' nas 30 linhas de CDGV COMBATER dela.
    //
    // Este caso PRENDE A DIVERGÊNCIA em vez de escondê-la: sai 'BDGEX', porque
    // é o que o banco afirma. Derivar 'Repositório DSG' do nome do lote seria
    // chute, e sair em branco apagaria uma carga que o cadastro registra.
    const cdgv = uma({
      meta: '1.5',
      produto: 'CDGV',
      lote_sap: '2026_1l_CT_Generalizacao_Iguacu_50k',
      situacoes_carregamento: [BDGEX_OSTENSIVO]
    })

    expect(cdgv.local_carga).toBe('BDGEX')

    // E a folha de CDGV que NÃO tem carga registrada sai em branco, que é o
    // caso 1 acima: quem preenche escreve o Repositório DSG por cima.
    const semRegistro = uma({
      meta: '1.5',
      produto: 'CDGV',
      lote_sap: '2026_1v_CDGV_COMBATER_50k',
      situacoes_carregamento: []
    })

    expect(semRegistro.local_carga).toBeNull()
    expect(semRegistro.id_carga_bdgex).toBeNull()
  })

  test('o ID da Carga é o uuid da versão, e um só por linha', () => {
    const linha = uma()

    expect(linha.id_carga_bdgex).toBe('6cd17aa9-8161-4aab-a86a-3cdec9466059')
    expect(linha.id_carga_bdgex).not.toContain('\n')
  })
})

describe('rtm_meta1_ctrl: a folha ainda não produzida', () => {
  // O CASO NOVO, e o que a primeira versão desta consulta errava: ela filtrava
  // versão Regular e devolvia 135 onde a aba tem 193. A folha planejada É a
  // linha da aba, com as colunas do fim vazias.
  test('aparece na aba, e não é descartada', () => {
    const linhas = rtmMeta1Ctrl.paraAbaMeta1([LINHA_DO_BANCO, LINHA_PLANEJADA])

    expect(linhas).toHaveLength(2)
    expect(linhas.map(l => l.mi)).toEqual(['2833-1-NE', '2848-1-NE'])
  })

  test('traz o que a identifica: meta, produto, MI, escala, projeto, lote e bloco', () => {
    const [linha] = rtmMeta1Ctrl.paraAbaMeta1([LINHA_PLANEJADA])

    expect(linha.meta).toBe('1.1')
    expect(linha.produto).toBe('Carta Topográfica')
    expect(linha.mi).toBe('2848-1-NE')
    expect(linha.escala).toBe('1:25.000')
    expect(linha.projeto_sap).toBe('Produção de Geoinformação Nacional 2026')
    expect(linha.lote_sap).toBe('1d CT 25k Parque Nacional Iguaçu')
    expect(linha.bloco_sap).toBe(linha.lote_sap)
  })

  test('sai com as TRÊS colunas do fim vazias', () => {
    const [linha] = rtmMeta1Ctrl.paraAbaMeta1([LINHA_PLANEJADA])

    expect(linha.data_carga_bdgex).toBeNull()
    expect(linha.id_carga_bdgex).toBeNull()
    expect(linha.local_carga).toBeNull()
  })

  test('o uuid dela NÃO vaza para o ID da Carga', () => {
    // A versão Planejada tem `uuid_versao` desde o cadastro (a coluna é UNIQUE
    // NOT NULL), então quem condicionar a coluna à existência do uuid publica
    // no RTM o identificador de uma folha que o BDGEx não tem.
    const [linha] = rtmMeta1Ctrl.paraAbaMeta1([LINHA_PLANEJADA])

    expect(LINHA_PLANEJADA.uuid_versao).toBeTruthy()
    expect(linha.id_carga_bdgex).toBeNull()
  })

  test('a folha que só ficou pronta DEPOIS do recorte também sai vazia', () => {
    // Mesmo com arquivo carregado: quem decide é o `pronta`, que a consulta
    // calcula com o período. A edição de março não pode afirmar carga de julho.
    const depois = {
      ...LINHA_DO_BANCO,
      pronta: false,
      situacoes_carregamento: [BDGEX_OSTENSIVO],
      data_edicao: '2026-07-15T00:00:00.000Z'
    }
    const [linha] = rtmMeta1Ctrl.paraAbaMeta1([depois])

    expect(linha.local_carga).toBeNull()
    expect(linha.id_carga_bdgex).toBeNull()
  })
})

describe('rtm_meta1_ctrl: a escala', () => {
  test('a do domínio atravessa como está', () => {
    expect(uma({ escala: '1:25.000' }).escala).toBe('1:25.000')
    expect(uma({ escala: '1:250.000' }).escala).toBe('1:250.000')
    expect(uma({ escala: 'Sem escala' }).escala).toBe('Sem escala')
  })

  test('a personalizada ganha o ponto de milhar da aba', () => {
    // O fragmento ESCALA_DISPLAY monta '1:' || denominador, sem separador. Na
    // produção de 2026 há uma folha da Meta 1 assim, e sem o acerto a coluna
    // teria '1:10000' ao lado de '1:25.000'.
    expect(uma({ escala: '1:10000' }).escala).toBe('1:10.000')
    expect(uma({ escala: '1:2000' }).escala).toBe('1:2.000')
    expect(uma({ escala: '1:2410000' }).escala).toBe('1:2.410.000')
  })

  test('escala ausente sai vazia', () => {
    expect(uma({ escala: null }).escala).toBeNull()
  })
})

describe('rtm_meta1_ctrl: a ordem da aba', () => {
  test('o item da meta é numérico, e 1.10 vem depois de 1.9', () => {
    // Ordenado como TEXTO, 1.10 e 1.11 viriam antes de 1.2, que é o oposto da
    // aba de agosto.
    const linhas = comLinhas(
      { ...LINHA_DO_BANCO, meta: '1.11', mi: 'A' },
      { ...LINHA_DO_BANCO, meta: '1.2', mi: 'B' },
      { ...LINHA_DO_BANCO, meta: '1.9', mi: 'C' },
      { ...LINHA_DO_BANCO, meta: '1.10', mi: 'D' }
    )

    expect(linhas.map(l => l.meta)).toEqual(['1.2', '1.9', '1.10', '1.11'])
  })

  test('dentro da meta, a ordem é a do MI', () => {
    const linhas = comLinhas(
      { ...LINHA_DO_BANCO, meta: '1.1', mi: '2848-1-NE' },
      { ...LINHA_DO_BANCO, meta: '1.1', mi: '2833-1-NE' },
      { ...LINHA_DO_BANCO, meta: '1.1', mi: '2834-1-NE' }
    )

    expect(linhas.map(l => l.mi)).toEqual(['2833-1-NE', '2834-1-NE', '2848-1-NE'])
  })

  test('não reordena a lista que recebeu', () => {
    const entrada = [
      { ...LINHA_DO_BANCO, meta: '1.3' },
      { ...LINHA_DO_BANCO, meta: '1.1' }
    ]
    rtmMeta1Ctrl.paraAbaMeta1(entrada)

    expect(entrada.map(l => l.meta)).toEqual(['1.3', '1.1'])
  })
})

describe('rtm_meta1_ctrl: a consulta', () => {
  beforeEach(() => {
    mockDb.conn.any.mockReset()
    mockDb.conn.any.mockResolvedValue([])
  })

  const sqlDaChamada = () => mockDb.conn.any.mock.calls[0][0]
  const paramsDaChamada = () => mockDb.conn.any.mock.calls[0][1]

  // O SQL SEM OS COMENTÁRIOS, para a régua medir o que o Postgres executa e não
  // a prosa ao lado. A consulta explica por escrito que NÃO filtra por
  // `tipo_versao_id`, e uma régua que procurasse o texto cru acusaria a própria
  // explicação.
  const codigoDaChamada = () =>
    sqlDaChamada().split('\n').map(linha => linha.replace(/--.*$/, '')).join('\n')

  test('recorta a Meta 1 do ano, sem item cancelado', async () => {
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026)

    const sql = sqlDaChamada()
    expect(sql).toContain('mv.numero_meta = $<metaProducao>')
    expect(sql).toContain('mv.ano = $<ano>')
    expect(sql).toContain('mv.cancelada IS NOT TRUE')
    // A VIEW, e nunca a tabela pit.meta_item: por ela, demandante viria nulo.
    expect(sql).toContain('pit.meta_vigente')
    expect(sql).not.toContain('JOIN pit.meta_item')

    expect(paramsDaChamada()).toMatchObject({
      ano: 2026,
      mes: null,
      omds: '1º CGEO',
      metaProducao: 1,
      versaoRegular: 1,
      naoCarregado: 1
    })
  })

  test('NÃO filtra a linha por tipo de versão nem por data', async () => {
    // A REGRA QUE A PRIMEIRA VERSÃO ERRAVA. Filtrar `tipo_versao_id = Regular`
    // devolvia 135 linhas onde a aba de agosto tem 193, e a diferença passava
    // por produção que faltou quando era a consulta que recortava errado.
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026, 8)
    const sql = codigoDaChamada()

    // O único lugar em que o tipo de versão aparece é no cálculo de `pronta`,
    // que decide as colunas do fim -- nunca no filtro, que decide as linhas.
    //
    // O CORTE É PELO FIM DO LATERAL DE CARGA, e não por procurar o texto do
    // WHERE: a primeira versão desta régua cortava em 'WHERE mv.numero_meta', e
    // a mutação que acrescentava `tipo_versao_id = Regular AND` antes disso
    // mudava o próprio texto do corte -- o `indexOf` devolvia -1, o `slice(-1)`
    // devolvia um caractere, e a régua passava verde justamente no caso que ela
    // existe para reprovar.
    const filtroDaLinha = sql.slice(sql.lastIndexOf('AS carga ON TRUE'))
    expect(filtroDaLinha).toContain('WHERE')
    expect(filtroDaLinha).not.toContain('tipo_versao_id')
    expect(filtroDaLinha).not.toContain('data_edicao')

    // E o tipo de versão é citado UMA vez no arquivo inteiro da consulta, no
    // `pronta`: duas citações querem dizer que alguém filtrou noutro lugar.
    expect(sql.match(/tipo_versao_id/g)).toHaveLength(1)
    expect(sql.indexOf('tipo_versao_id')).toBeLessThan(sql.indexOf('AS pronta'))
  })

  test('sem mês, o PRONTO é o ano inteiro de data_edicao', async () => {
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026)

    const sql = sqlDaChamada()
    expect(sql).toContain('v.tipo_versao_id = $<versaoRegular>')
    expect(sql).toContain('v.data_edicao >= make_date($<ano>, 1, 1)')
    expect(sql).toContain('v.data_edicao < make_date($<ano> + 1, 1, 1)')
    expect(sql).toContain('AS pronta')
  })

  test('com mês, o PRONTO acumula de janeiro até ele', async () => {
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026, 8)

    const sql = sqlDaChamada()
    // Começa em 1º de janeiro (cumulativo), e não no 1º do mês pedido: o RTM
    // sobe com o acumulado do exercício.
    expect(sql).toContain('v.data_edicao >= make_date($<ano>, 1, 1)')
    expect(sql).toContain("v.data_edicao < (make_date($<ano>, $<mes>, 1) + interval '1 month')")
    expect(paramsDaChamada().mes).toBe(8)
  })

  test('a folha sem lote sobrevive à consulta: os JOIN de lote e projeto são LEFT', async () => {
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026)

    const sql = sqlDaChamada()
    expect(sql).toContain('LEFT JOIN acervo.lote')
    expect(sql).toContain('LEFT JOIN acervo.projeto')
  })

  test('conta como carga só o arquivo que saiu de "Não carregado"', async () => {
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026)

    expect(sqlDaChamada()).toContain('a.situacao_carregamento_id <> $<naoCarregado>')
  })

  test('não pede ao banco data de carga nenhuma', async () => {
    // A coluna não existe (busca em er/ por data_carga|data_carregamento|
    // bdgex_id|id_bdgex|data_publicacao: zero resultados), e a que existe
    // (data_cadastramento do arquivo) é do REGISTRO no SCA, não da carga.
    await rtmMeta1Ctrl.buscarMeta1Detalhada(2026)
    const sql = sqlDaChamada()

    expect(sql).not.toMatch(/data_carga|data_carregamento|data_publicacao/)
    expect(sql).not.toContain('a.data_cadastramento')
  })

  test('o que o banco devolve atravessa a tradução', async () => {
    mockDb.conn.any.mockResolvedValue([LINHA_DO_BANCO])
    const dados = await rtmMeta1Ctrl.buscarMeta1Detalhada(2026, 8)
    const [linha] = rtmMeta1Ctrl.paraAbaMeta1(dados)

    expect(linha.omds).toBe('1º CGEO')
    expect(linha.demandante).toBe('COTER/DECEX')
    expect(linha.local_carga).toBe('BDGEX')
    expect(linha.data_carga_bdgex).toBeNull()
  })
})
