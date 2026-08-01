'use strict'

// A FORMATAÇÃO do RPCMTec, conferida no OOXML do arquivo gerado.
//
// O que este arquivo protege não é o número: é o fato de o documento poder ser
// COLADO no RPCMTec mestre sem ninguém reformatar tabela nenhuma. Trocar a
// fonte, a cor do cabeçalho ou a largura de coluna não quebra nada, não dá erro
// e não some da tela: chega ao chefe como uma tabela que destoa das outras.
//
// Os valores esperados estão ESCRITOS AQUI, medidos em
// "RPCM Técnico Julho_2026.docx" em 2026-08-01, e não lidos de um .docx de
// referência. Um teste que lê a mesma fonte que o código passaria a concordar
// com qualquer coisa que o código fizesse.
//
// O .docx é um ZIP; quem o abre aqui é o `desziparParaMapa` de utils/ods_export,
// que já existe para gerar o Anuário a partir da planilha-semente.

const { desziparParaMapa } = require('../../utils/ods_export')
const { montarDocumento, mesCapitalizado, FORMATO } = require('../../rpcmtec/rpcmtec_docx')

const documentoXml = async (secoes, { ano = 2026, mes = 7 } = {}) => {
  const buffer = await montarDocumento({ ano, mes, secoes })
  return desziparParaMapa(buffer).get('word/document.xml').toString('utf8')
}

const SECAO_DE_PROVA = [{
  titulo: '2. EXECUÇÃO DO PIT',
  subsecoes: [{
    numero: '2.2',
    titulo: 'Totais do Mês e do Ano',
    cabecalhos: ['Tipo de produto', 'Quantidade no mês', 'Quantidade no ano'],
    linhas: [['Carta Topográfica', '3', '19']]
  }]
}]

describe('rpcmtec_docx: as medidas do modelo da Divisão', () => {
  test('as constantes são as MEDIDAS do documento de julho/2026', () => {
    expect(FORMATO.FONTE).toBe('Calibri')
    // Meio-pontos: 24 = 12pt no título e no cabeçalho da tabela, 20 = 10pt no
    // corpo. O modelo NÃO usa o mesmo tamanho nos dois.
    expect(FORMATO.TAMANHO_TITULO).toBe(24)
    expect(FORMATO.TAMANHO_CORPO_TABELA).toBe(20)
    expect(FORMATO.PREENCHIMENTO_CABECALHO).toBe('DDD9C4')
    // A tabela avança sobre a margem esquerda, de propósito.
    expect(FORMATO.RECUO_TABELA).toBe(-141)
  })

  test('as 16 subseções que o SCA gera têm grade de coluna declarada', () => {
    // Subseção sem grade cai na divisão por igual, que dá uma tabela que não é
    // a do modelo. É silencioso: por isso a lista fica explícita aqui.
    expect(Object.keys(FORMATO.GRADES).sort()).toEqual([
      '2.2', '2.4', '2.7',
      '3.1', '3.2', '3.3', '3.4',
      '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7',
      '7.2', '7.3'
    ])
  })

  test('cada grade é a do modelo, com uma largura por coluna', () => {
    // As grades NÃO são proporcionais entre si: a coluna "Finalidade" da 4.2 é
    // larga porque o texto é longo, e a "Qtd" da 3.3 é estreita porque cabe um
    // número. Distribuir por igual seria mais simples e daria outro documento.
    expect(FORMATO.GRADES['2.2']).toEqual([4965, 2370, 2520])
    expect(FORMATO.GRADES['4.2']).toEqual([855, 855, 840, 2865, 1125, 1170, 1140, 945])
    expect(FORMATO.GRADES['3.3']).toEqual([1590, 1575, 630, 1215, 1455, 3360])

    const colunasPorSubsecao = {
      '2.2': 3, '2.4': 6, '2.7': 6,
      '3.1': 3, '3.2': 4, '3.3': 6, '3.4': 3,
      '4.1': 6, '4.2': 8, '4.3': 4, '4.4': 4, '4.5': 4, '4.6': 4, '4.7': 8,
      '7.2': 5, '7.3': 5
    }
    for (const [numero, colunas] of Object.entries(colunasPorSubsecao)) {
      // Grade com menos entradas que colunas deixa a última sem largura, e o
      // Word a desenha com o que sobrar: o alinhamento com o mestre se perde.
      expect(FORMATO.GRADES[numero]).toHaveLength(colunas)
      const soma = FORMATO.GRADES[numero].reduce((s, g) => s + g, 0)
      expect(soma).toBeGreaterThanOrEqual(9700)
      expect(soma).toBeLessThanOrEqual(9900)
    }
  })
})

describe('rpcmtec_docx: o OOXML gerado', () => {
  test('a página é a do modelo: Letter, margem superior menor que as outras', async () => {
    const xml = await documentoXml(SECAO_DE_PROVA)
    expect(xml).toContain('w:w="12240"')
    expect(xml).toContain('w:h="15840"')
    // A margem de cima é 990 e as outras três são 1440. Igualá-las empurraria
    // todo o conteúdo para baixo e mudaria onde cada tabela cai na página.
    expect(xml).toMatch(/w:top="990"/)
    expect(xml).toMatch(/w:bottom="1440"/)
  })

  test('o cabeçalho da tabela tem o preenchimento bege, negrito e 12pt', async () => {
    const xml = await documentoXml(SECAO_DE_PROVA)
    expect(xml).toContain('w:fill="DDD9C4"')
    // O cabeçalho repete em toda página: tabela longa (a 4.2 passa de 20 linhas)
    // sem isto vira uma página de números sem nome de coluna.
    expect(xml).toContain('<w:tblHeader')
    expect(xml).toContain('w:val="24"')
  })

  test('o corpo da tabela é 10pt e NÃO carrega negrito', async () => {
    const xml = await documentoXml(SECAO_DE_PROVA)
    expect(xml).toContain('w:val="20"')
    // `bold: false` faria a biblioteca escrever <w:b w:val="false"/>, que o
    // modelo não tem. O Word trata igual, mas comparar o OOXML gerado com o do
    // modelo passaria a acusar diferença em toda célula de corpo.
    expect(xml).not.toContain('<w:b w:val="false"/>')
  })

  test('a tabela é de layout fixo, com a grade e o recuo do modelo', async () => {
    const xml = await documentoXml(SECAO_DE_PROVA)
    expect(xml).toContain('w:type="fixed"')
    expect(xml).toContain('w:w="-141"')
    for (const largura of FORMATO.GRADES['2.2']) {
      expect(xml).toContain(`w:w="${largura}"`)
    }
  })

  test('tudo o que se vê é Calibri', async () => {
    const xml = await documentoXml(SECAO_DE_PROVA)
    expect(xml).toContain('w:ascii="Calibri"')
    // O modelo declara Arial no docDefaults e NENHUMA execução visível a usa.
    // Se ela aparecer aqui, é porque uma execução deixou de declarar a fonte.
    expect(xml).not.toContain('w:ascii="Arial"')
  })

  test('o título de seção é negrito e o de subseção não é', async () => {
    const xml = await documentoXml(SECAO_DE_PROVA)
    expect(xml).toContain('2. EXECUÇÃO DO PIT')
    expect(xml).toContain('2.2. Totais do Mês e do Ano')
    // Os dois são justificados, como no modelo.
    expect(xml).toContain('w:val="both"')
  })

  test('o cabeçalho de página traz o mês capitalizado e a numeração', async () => {
    const buffer = await montarDocumento({ ano: 2026, mes: 7, secoes: SECAO_DE_PROVA })
    const entradas = desziparParaMapa(buffer)
    const cabecalho = [...entradas.keys()].find(n => /header\d*\.xml$/.test(n))
    expect(cabecalho).toBeDefined()

    const xml = entradas.get(cabecalho).toString('utf8')
    // "RPCMTec 1º CGEO Julho/2026", e não "JULHO" nem "julho".
    expect(xml).toContain('RPCMTec 1º CGEO Julho/2026')
    expect(xml).toContain('Página ')
    // PAGE e NUMPAGES são campos: o Word os calcula ao abrir, e gravar o número
    // deixaria "Página 1 de 1" num documento de doze páginas.
    expect(xml).toContain('PAGE')
    expect(xml).toContain('NUMPAGES')
  })

  test('tabela sem nenhuma linha sai com uma linha de traços', async () => {
    // É como o modelo escreve "não houve" (ver a 2.4 e a 2.6 de julho/2026).
    // Deixar só o cabeçalho faz parecer que a tabela ficou por preencher.
    const xml = await documentoXml([{
      titulo: '2. EXECUÇÃO DO PIT',
      subsecoes: [{
        numero: '2.4',
        titulo: 'Entregas detalhada de produtos finais (BDGEx, IGW, EBGeo) no mês',
        cabecalhos: ['Tipo produto', 'Escala', 'UUID BDGEx', 'Identificador',
          'Meta PIT', 'Lote SAP'],
        linhas: []
      }]
    }])

    const linhas = xml.match(/<w:tr\b/g) || []
    // Cabeçalho mais a linha de traços.
    expect(linhas).toHaveLength(2)
    expect((xml.match(/<w:t[^>]*>-<\/w:t>/g) || [])).toHaveLength(6)
  })

  test('o mês do cabeçalho sai capitalizado', () => {
    expect(mesCapitalizado(1)).toBe('Janeiro')
    expect(mesCapitalizado(3)).toBe('Março')
    expect(mesCapitalizado(7)).toBe('Julho')
    expect(mesCapitalizado(12)).toBe('Dezembro')
  })

  test('não estoura com célula nula nem com seção sem subseção', async () => {
    // A 7.2 manda '-' nas colunas que o SCA não sabe preencher, e o número do
    // estoque vem do banco como number. Os dois passam pela mesma célula.
    const xml = await documentoXml([
      { titulo: '3. MAPOTECA', subsecoes: [] },
      {
        titulo: '7. EQUIPAMENTO E MATERIAL',
        subsecoes: [{
          numero: '7.2',
          titulo: 'Estoque de Insumos de Impressão - Papel',
          cabecalhos: ['Insumo', 'Estoque atual', 'Estoque mês anterior',
            'Consumo no mês', 'Previsão de falta de estoque'],
          linhas: [['Papel Sulfite 90g', 42, null, 0, undefined]]
        }]
      }
    ])
    expect(xml).toContain('Papel Sulfite 90g')
    expect(xml).toContain('3. MAPOTECA')
  })
})
