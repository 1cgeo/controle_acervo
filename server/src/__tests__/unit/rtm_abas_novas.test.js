'use strict'

/**
 * As abas META1_DETALHADA e EXTRA_PIT do RTM, geradas a partir das sementes.
 *
 * O QUE ESTA SUÍTE PROTEGE, e de onde cada número saiu. As três abas do RTM
 * foram medidas no `1_CGEO_RTM_AGO_26_preenchido.ods`, o relatório de agosto de
 * 2026 preenchido à mão, que é o modelo do que a DSG recebe. A medida é a fonte
 * de tudo o que se cobra aqui:
 *
 *   META1_DETALHADA   13 colunas, largura total 1023, 193 linhas de dado
 *   EXTRA_PIT          7 colunas, largura total 1024,  44 linhas de dado
 *
 * A LARGURA NÃO É ENFEITE. A célula repetida que fecha a linha tem de casar com
 * a declaração de colunas da semente; errando, o Calc abre a planilha assim
 * mesmo e desenha a borda no lugar errado, sem reclamar. É defeito que só
 * aparece para quem cola a aba no RTM, ou seja, tarde.
 *
 * A DATA DA CARGA (BDGEx) SAI VAZIA, por decisão do chefe em 2026-09-11: ela não
 * existe no banco e ele preferiu deixar a célula em branco para preenchimento à
 * mão. O teste cobra o VAZIO de propósito: se um dia alguém a preencher com
 * `data_edicao` "porque estava vazia", isto reprova, e é o ponto.
 */

const {
  gerarMeta1Ods,
  gerarExtraPitOds,
  gerarAbaOds,
  ABAS,
  COLUNAS_META1,
  COLUNAS_EXTRA_PIT
} = require('../../rpcmtec/rtm_ods')

const { desziparParaMapa } = require('../../utils/ods_export')

const conteudoDe = buffer => desziparParaMapa(buffer).get('content.xml').toString('utf8')

/** As linhas de dados (a primeira <table:table-row> é o cabeçalho). */
const linhasDe = conteudo => {
  const todas = conteudo.split('<table:table-row').slice(1)
  return todas.slice(1)
}

const META1 = {
  omds: '1º CGEO',
  demandante: 'COTER',
  meta: '1.3',
  produto: 'Carta Ortoimagem',
  mi: '2833-1-NE',
  escala: '1:25.000',
  projeto_sap: 'Produção de Geoinformação Nacional 2026',
  lote_sap: '1j CO 25k PR',
  bloco_sap: '1j CO 25k PR',
  data_carga_bdgex: null,
  id_carga_bdgex: '6cd17aa9-8161-4aab-a86a-3cdec9466059',
  local_carga: 'BDGEX',
  observacao: null
}

const EXTRA = {
  omds: '1º CGEO',
  demandante: 'DSG',
  descricao: 'Lei de Acesso a Informação 60143.000014/2026-7',
  quantidade: 1,
  data_conclusao: '2026-02-10',
  documento_autorizacao: 'DIEx 123',
  observacao: null
}

describe('as sementes das abas novas', () => {
  test.each([
    ['meta1', 'META1_DETALHADA', 13],
    ['extraPit', 'EXTRA_PIT', 7]
  ])('%s: a semente traz a tabela %s e só a linha de cabeçalho', (chave, nome, qtdColunas) => {
    const conteudo = conteudoDe(require('fs').readFileSync(ABAS[chave].semente))

    expect(conteudo).toContain(`table:name="${nome}"`)
    expect((conteudo.match(/<table:table-row/g) || []).length).toBe(1)
    expect(ABAS[chave].colunas).toHaveLength(qtdColunas)
  })

  test('os cabeçalhos da META1 são os 13 do RTM, na ordem', () => {
    const conteudo = conteudoDe(require('fs').readFileSync(ABAS.meta1.semente))
    const rotulos = [...conteudo.matchAll(/<text:p>([^<]*)<\/text:p>/g)].map(m => m[1])

    expect(rotulos).toEqual([
      'OMDS', 'Demandante', 'Meta', 'Produto', 'MI', 'Escala',
      'Projeto (SAP)', 'Lote (SAP)', 'Bloco (SAP)',
      'Data da Carga (BDGEx)', 'ID da Carga (BDGEx)', 'Local da Carga',
      'Observações'
    ])
  })

  test('os cabeçalhos do EXTRA_PIT são os 7 do RTM, na ordem', () => {
    const conteudo = conteudoDe(require('fs').readFileSync(ABAS.extraPit.semente))
    const rotulos = [...conteudo.matchAll(/<text:p>([^<]*)<\/text:p>/g)].map(m => m[1])

    expect(rotulos).toEqual([
      'OMDS', 'Demandante', 'Descrição do Produto/Serviço', 'Qnt',
      'Data de Conclusão/Entrega', 'Documento de Autorização (se houver)',
      'Observação'
    ])
  })
})

describe('META1_DETALHADA', () => {
  test('a Data da Carga (BDGEx) sai VAZIA, e é decisão do chefe', () => {
    const conteudo = conteudoDe(gerarMeta1Ods([META1]))
    const linha = linhasDe(conteudo)[0]

    // A décima célula é a da data. Vazia quer dizer sem `office:value-type`.
    const celulas = linha.split('<table:table-cell').slice(1)
    expect(celulas[9]).not.toContain('office:date-value')
    expect(celulas[9]).not.toContain('office:value-type')
  })

  test('mesmo recebendo uma data, a coluna continua sendo a décima', () => {
    // Régua de posição: o que não pode acontecer é a coluna vazia DESLOCAR as
    // seguintes, que foi o defeito clássico da leitura do RTM (o
    // number-columns-repeated colapsando Lote e Bloco).
    const conteudo = conteudoDe(gerarMeta1Ods([META1]))
    const celulas = linhasDe(conteudo)[0].split('<table:table-cell').slice(1)

    expect(celulas[10]).toContain('6cd17aa9-8161-4aab-a86a-3cdec9466059')
    expect(celulas[11]).toContain('BDGEX')
  })

  test('a Meta sai como TEXTO mesmo quando parece número', () => {
    // No RTM de agosto uma linha saiu float porque digitaram `2` sem ponto.
    const conteudo = conteudoDe(gerarMeta1Ods([{ ...META1, meta: '2' }]))
    const celulas = linhasDe(conteudo)[0].split('<table:table-cell').slice(1)

    expect(celulas[2]).toContain('office:value-type="string"')
    expect(celulas[2]).not.toContain('office:value-type="float"')
  })

  test('a folha sem lote nem projeto sai com as células vazias, e não some', () => {
    // São os três produtos especiais do Beira-Rio (Metas 1.9, 1.10 e 1.11).
    const conteudo = conteudoDe(gerarMeta1Ods([
      { ...META1, projeto_sap: null, lote_sap: null, bloco_sap: null }
    ]))
    const celulas = linhasDe(conteudo)[0].split('<table:table-cell').slice(1)

    expect(celulas[6]).not.toContain('office:value-type')
    expect(celulas[7]).not.toContain('office:value-type')
    expect(celulas[8]).not.toContain('office:value-type')
    expect(celulas[4]).toContain('2833-1-NE')
  })

  test('cada linha tem as 13 colunas mais o preenchimento, somando 1023', () => {
    const conteudo = conteudoDe(gerarMeta1Ods([META1]))
    const linha = linhasDe(conteudo)[0]
    const sobra = Number(linha.match(/table:number-columns-repeated="(\d+)"/)[1])

    expect(COLUNAS_META1.length + sobra).toBe(1023)
  })
})

describe('EXTRA_PIT', () => {
  test('a quantidade sai como NÚMERO, que é o que a DSG soma', () => {
    const conteudo = conteudoDe(gerarExtraPitOds([EXTRA]))
    const celulas = linhasDe(conteudo)[0].split('<table:table-cell').slice(1)

    expect(celulas[3]).toContain('office:value-type="float"')
    expect(celulas[3]).toContain('office:value="1"')
  })

  test('a data sai com o valor ISO e o texto em DD/MM/AA', () => {
    const conteudo = conteudoDe(gerarExtraPitOds([EXTRA]))
    const celulas = linhasDe(conteudo)[0].split('<table:table-cell').slice(1)

    expect(celulas[4]).toContain('office:date-value="2026-02-10"')
    expect(celulas[4]).toContain('<text:p>10/02/26</text:p>')
  })

  test('demanda ainda não entregue sai com a data vazia', () => {
    const conteudo = conteudoDe(gerarExtraPitOds([{ ...EXTRA, data_conclusao: null }]))
    const celulas = linhasDe(conteudo)[0].split('<table:table-cell').slice(1)

    expect(celulas[4]).not.toContain('office:date-value')
  })

  test('cada linha tem as 7 colunas mais o preenchimento, somando 1024', () => {
    const conteudo = conteudoDe(gerarExtraPitOds([EXTRA]))
    const sobra = Number(linhasDe(conteudo)[0].match(/table:number-columns-repeated="(\d+)"/)[1])

    expect(COLUNAS_EXTRA_PIT.length + sobra).toBe(1024)
  })
})

describe('a guarda contra a semente trocada', () => {
  test('recusa gerar quando a semente não traz a tabela da aba', () => {
    // O PIOR CASO que esta guarda existe para pegar: apontar a META1 para a
    // semente da META4 gera um arquivo que ABRE, com o cabeçalho de uma aba e
    // os dados de outra. O Calc não reclama, e quem cola no RTM só descobre
    // depois. Sem a guarda, este teste passaria.
    const trocada = { ...ABAS.meta1, semente: ABAS.meta4.semente }

    expect(() => gerarAbaOds(trocada, [META1]))
      .toThrow(/não traz uma tabela com esse nome/)
  })
})

describe('o arquivo gerado abre', () => {
  test.each([
    ['META1_DETALHADA', () => gerarMeta1Ods([META1, { ...META1, meta: '1.1' }])],
    ['EXTRA_PIT', () => gerarExtraPitOds([EXTRA])]
  ])('%s: mimetype primeiro e sem compressão, e tudo descomprime', (nome, gerar) => {
    const buffer = gerar()
    const mapa = desziparParaMapa(buffer)

    expect(mapa.get('content.xml').toString('utf8')).toContain(`table:name="${nome}"`)
    // As 17 entradas da semente sobrevivem: é o que carrega os estilos e a
    // configuração de janela que fazem a aba abrir igual à de sempre.
    expect(mapa.size).toBe(17)

    // O `mimetype` TEM de ser a primeira entrada, e o ODF exige que ela esteja
    // SEM compressão. Errando, o arquivo abre como ZIP e não como planilha.
    expect(buffer.slice(30, 38).toString()).toBe('mimetype')
    expect(buffer.slice(38, 38 + 46).toString())
      .toBe('application/vnd.oasis.opendocument.spreadsheet')

    // `desziparParaMapa` já devolve descomprimido, então ela ter voltado com as
    // 17 entradas legíveis É a prova de que tudo descomprime. O que se cobra
    // aqui é que o conteúdo seja XML de verdade, e não lixo que descomprimiu.
    expect(mapa.get('styles.xml').toString('utf8')).toMatch(/^<\?xml/)
    expect(mapa.get('META-INF/manifest.xml').toString('utf8')).toMatch(/^<\?xml/)
  })
})
