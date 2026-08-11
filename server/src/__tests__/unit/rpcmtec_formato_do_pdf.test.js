'use strict'

// O FORMATO DO PDF do RPCMTec, e por que ele se prova aqui.
//
// O ARQUIVO PRONTO NÃO SE LÊ: o texto sai comprimido, e a suíte só sabe comparar
// tamanho. O que este arquivo mede é a DEFINIÇÃO pdfmake (`montarDefinicao`),
// que é onde as três medidas do chefe (2026-08-11) viram número.
//
// O QUE ELE PEGA, e que nenhum teste pegava: as tabelas do relatório não tinham
// a mesma largura, e todas invadiam a margem direita. A causa é que o pdfmake
// trata `widths` como largura de CONTEÚDO e soma o espaçamento da célula por
// fora -- 6 pt por coluna --, então a tabela CRESCIA com o número de colunas: a
// de 8 terminava em 597 pt de uma página de 612, a de 3 em 583, e a margem
// esquerda de 72 pt parecia sobra ao lado de 15 pt do outro lado. Aqui a conta é
// cobrada tabela a tabela, nas 29 do documento.

const fs = require('fs')
const path = require('path')

const { montarDefinicao, FORMATO } = require('../../rpcmtec/rpcmtec_pdf')
const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

const INSTITUICAO = {
  nome: '1º Centro de Geoinformação',
  sigla: '1º CGEO',
  sigla_slug: '1CGEO'
}

// UMA EDIÇÃO COM AS 29 TABELAS do documento, cada uma com uma linha de dado, e
// as quatro subseções de prosa. Não é encenação de conveniência: as grades são
// as da estrutura, que é o que o desenhador recebe em produção.
const EDICAO = {
  id: 1,
  ano: 2026,
  mes: 7,
  fechada: true,
  assinante_nome: 'Fulano de Tal',
  assinante_posto_extenso: 'Major',
  instituicao: INSTITUICAO,
  secoes: [
    {
      titulo: '1. FINALIDADE',
      subsecoes: estrutura.BLOCOS.map(b => ({
        numero: b.numero,
        titulo: b.titulo,
        texto: b.cabecalhos ? null : 'prosa da subseção',
        cabecalhos: b.cabecalhos,
        grade: b.grade,
        linhas: b.cabecalhos ? [b.cabecalhos.map((_, i) => `celula ${i}`)] : null
      }))
    }
  ]
}

// Todo nó da definição, achatado -- `stack` incluído, que é onde o bloco de
// assinatura passou a viver.
const nosDe = raiz => {
  const achatar = no => {
    if (no == null || typeof no !== 'object') return []
    if (Array.isArray(no)) return no.flatMap(achatar)
    return [
      no,
      ...achatar(no.text),
      ...achatar(no.columns),
      ...achatar(no.stack),
      ...achatar(no.content),
      ...(no.table ? achatar(no.table.body) : [])
    ]
  }

  return achatar(raiz)
}

const definicao = montarDefinicao(EDICAO)
const nos = nosDe(definicao.content)
const tabelas = nos.filter(no => no.table)

describe('a fonte do relatório', () => {
  test('é a Lato, e os dois arquivos estão em assets/', () => {
    expect(definicao.defaultStyle.font).toBe('Lato')
    expect(FORMATO.FONTE).toBe('Lato')

    const assets = path.join(__dirname, '..', '..', 'rpcmtec', 'assets')
    for (const arquivo of ['Lato-Light.ttf', 'Lato-Bold.ttf', 'Lato-OFL.txt']) {
      expect(fs.existsSync(path.join(assets, arquivo))).toBe(true)
    }
  })
})

describe('os dois tamanhos de fonte, e a fronteira entre eles', () => {
  test('a tabela inteira sai em 10, cabeçalho e corpo', () => {
    expect(tabelas.length).toBe(29)

    for (const { table } of tabelas) {
      for (const linha of table.body) {
        for (const celula of linha) {
          expect(celula.fontSize).toBe(10)
        }
      }
    }
  })

  test('o cabeçalho institucional da capa sai em 10', () => {
    const institucionais = [
      'MINISTÉRIO DA DEFESA',
      'EXÉRCITO BRASILEIRO',
      INSTITUICAO.nome.toUpperCase(),
      '(Coms da Carta G do Brasil/1903)',
      'DIVISÃO DE LEVANTAMENTO GENERAL AUGUSTO TASSO FRAGOSO'
    ]

    for (const texto of institucionais) {
      const no = nos.find(n => n.text === texto)
      expect(no).toBeDefined()
      expect(no.fontSize).toBe(10)
    }
  })

  // O RESTO DO DOCUMENTO É 12, e a prova é pelo avesso: nenhum nó de texto com
  // tamanho declarado pode ter um terceiro valor. Uma subseção nova que saísse
  // em 11 passaria pelas duas asserções acima sem reprovar nenhuma.
  test('nenhum texto do relatório sai num tamanho que não seja 10 ou 12', () => {
    const tamanhos = new Set(
      nos.filter(no => no.fontSize != null).map(no => no.fontSize)
    )

    expect([...tamanhos].sort()).toEqual([10, 12])
  })

  test('o título de seção e a prosa saem em 12', () => {
    const titulo = nos.find(no => no.text === '1. FINALIDADE')
    expect(titulo.fontSize).toBe(12)

    const prosa = nos.find(no => typeof no.text === 'string' &&
      no.text.includes('prosa da subseção'))
    expect(prosa.fontSize).toBe(12)
  })
})

describe('toda tabela tem a MESMA largura, e ela cabe entre as margens', () => {
  // A conta que faltava: o que se declara mais o que o pdfmake soma por fora --
  // o espaçamento das duas bordas de cada célula E o traço das linhas
  // verticais, que são uma a mais que as colunas.
  const larguraReal = ({ table }) =>
    table.widths.reduce((soma, w) => soma + w, 0) +
    2 * FORMATO.ESPACO_CELULA * table.widths.length +
    FORMATO.LARGURA_BORDA * (table.widths.length + 1)

  test('as 29 fecham em 468 pt, a área útil da página', () => {
    for (const tabela of tabelas) {
      expect(larguraReal(tabela)).toBeCloseTo(FORMATO.LARGURA_TABELA, 6)
    }
  })

  test('a largura não depende do número de colunas, que vai de 2 a 8', () => {
    const porColunas = new Map()
    for (const tabela of tabelas) {
      porColunas.set(tabela.table.widths.length, larguraReal(tabela))
    }

    // Se o desconto do espaçamento sumir, esta é a asserção que reprova: as
    // larguras passam a diferir de 12 pt por coluna a mais.
    expect([...porColunas.values()].every(
      l => Math.abs(l - FORMATO.LARGURA_TABELA) < 1e-6
    )).toBe(true)
    expect(Math.min(...porColunas.keys())).toBe(2)
    expect(Math.max(...porColunas.keys())).toBe(8)
  })

  // A PROPORÇÃO DO MODELO SOBREVIVE ao desconto: o que se reparte encolheu, e a
  // razão entre as colunas é a mesma.
  test('a proporção entre as colunas continua a da grade medida', () => {
    const dois = estrutura.BLOCOS.find(b => b.numero === '2.1')
    const tabela = tabelas.find(t => t.table.widths.length === dois.grade.length)
    const totalGrade = dois.grade.reduce((s, c) => s + c, 0)
    const totalLargura = tabela.table.widths.reduce((s, c) => s + c, 0)

    dois.grade.forEach((coluna, i) => {
      expect(tabela.table.widths[i] / totalLargura)
        .toBeCloseTo(coluna / totalGrade, 6)
    })
  })

  test('as margens laterais são iguais, e a tabela encosta nas duas', () => {
    const [esquerda, , direita] = definicao.pageMargins
    expect(esquerda).toBe(direita)
    // 612 pt de Letter menos as duas margens.
    expect(612 - esquerda - direita).toBe(FORMATO.LARGURA_TABELA)
  })
})

// O QUE A EDIÇÃO DE JULHO/2026 MOSTROU: 'Porto Alegre - RS, na data da
// assinatura.' no pé da página 23 e o nome do assinante no alto da 24, com o
// cabeçalho de página no meio.
describe('o bloco de assinatura não se parte entre duas folhas', () => {
  const assinatura = definicao.content[definicao.content.length - 1]

  test('é um nó só, e indivisível', () => {
    expect(assinatura.unbreakable).toBe(true)
    expect(Array.isArray(assinatura.stack)).toBe(true)
  })

  // O VÃO DA CANETA. Eram 24 pt até 2026-08-11, e a rubrica passava por cima do
  // nome impresso.
  test('sobra 1 polegada em branco entre o local e o nome, para a assinatura', () => {
    const local = assinatura.stack.find(no =>
      typeof no.text === 'string' && no.text.startsWith('Porto Alegre'))

    expect(local.margin[3]).toBe(72)
  })

  test('o local, o nome, a função e o Centro estão DENTRO dele', () => {
    const textos = assinatura.stack.map(no => no.text)

    expect(textos).toContain('Porto Alegre – RS, na data da assinatura.')
    expect(textos).toContain('FULANO DE TAL - Major')
    expect(textos).toContain('Chefe da Divisão de Geoinformação')
    expect(textos).toContain(INSTITUICAO.nome)
  })

  // Sem assinante o bloco não imprime nome nenhum, e continua indivisível: o
  // local e a data também não se separam do que vem antes.
  test('sem assinante, o que sobra continua num nó só', () => {
    const sem = montarDefinicao({ ...EDICAO, assinante_nome: null })
    const bloco = sem.content[sem.content.length - 1]

    expect(bloco.unbreakable).toBe(true)
    expect(bloco.stack.map(no => no.text))
      .toContain('Porto Alegre – RS, na data da assinatura.')
    expect(bloco.stack.some(no => /FULANO/.test(no.text || ''))).toBe(false)
  })
})
