'use strict'

// O NOME DO CENTRO NO DOCUMENTO, e a prova de que ele NÃO é desta casa.
//
// O QUE MUDOU EM 2026-08-09. O nome do 1º CGEO estava escrito no código em dez
// lugares: a capa do PDF, a linha do mês, o bloco de assinatura, o cabeçalho de
// toda página, o nome do arquivo do Anuário, as duas frases da 1.1 e a coluna
// OMDS da aba META4_DETALHADA do RTM. `dgeo.instituicao` existia desde aquele
// mesmo dia e quase ninguém a consumia: outro CGEO que instalasse o SAP emitiria
// relatório com "1º CGEO" no cabeçalho e mandaria à DSG uma planilha com a sigla
// desta casa em todas as linhas.
//
// POR QUE UM ARQUIVO SÓ PARA ISSO, e por que ele é RÁPIDO. O PDF pronto não se
// lê: o texto sai comprimido, e a suíte só sabia comparar tamanho de arquivo.
// Por isso `rpcmtec_pdf` expõe `montarDefinicao`, a definição pdfmake antes de
// virar bytes, e é sobre ela que a capa, o cabeçalho e a assinatura se afirmam
// -- com um segundo Centro, que é o único jeito de saber se o trabalho valeu.
//
// O QUE ELE NÃO PROVA, e é do `routes/rpcmtec.test.js`: que a leitura chega de
// fato em `dgeo.instituicao` e que trocar a linha por `PUT /api/instituicao`
// muda o documento seguinte. Aqui a instituição é encenada.

const {
  montarDefinicao, mesCapitalizado
} = require('../../rpcmtec/rpcmtec_pdf')
const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

// A SEMENTE de `er/dgeo.sql` (o que uma instalação nova traz) e um SEGUNDO
// Centro. Nenhum dos dois é constante do sistema: os dois são dado, e é
// exatamente isso que este arquivo existe para dizer.
const PRIMEIRO = {
  nome: '1º Centro de Geoinformação',
  sigla: '1º CGEO',
  sigla_slug: '1CGEO'
}
const SEGUNDO = {
  nome: '2º Centro de Geoinformação',
  sigla: '2º CGEO',
  sigla_slug: '2CGEO'
}

const edicaoCom = instituicao => ({
  id: 1,
  ano: 2026,
  mes: 7,
  fechada: true,
  assinante_nome: 'Fulano de Tal',
  assinante_posto_extenso: 'Major',
  instituicao,
  secoes: [
    {
      titulo: '1. FINALIDADE',
      subsecoes: [
        {
          numero: '1.1',
          titulo: null,
          texto: estrutura.aplicarInstituicao(
            estrutura.BLOCOS.find(b => b.numero === '1.1').conteudo,
            instituicao
          )
        }
      ]
    }
  ]
})

// Todo texto da definição, achatado: a capa e a assinatura são listas de nós, e
// o que se quer perguntar é "esta frase está no documento?".
const textosDe = definicao => {
  const achatar = no => {
    if (no == null) return []
    if (Array.isArray(no)) return no.flatMap(achatar)
    if (typeof no === 'string') return [no]
    if (typeof no !== 'object') return []
    return [
      ...(typeof no.text === 'string' ? [no.text] : achatar(no.text)),
      ...achatar(no.columns),
      ...achatar(no.content)
    ]
  }

  return achatar(definicao.content)
}

// O cabeçalho de página é uma FUNÇÃO de (página, total): o pdfmake a chama uma
// vez por página. Aqui ela é chamada como o desenhador a chamaria.
const cabecalhoDe = (definicao, pagina = 1, total = 3) =>
  textosDe({ content: definicao.header(pagina, total) })

describe('o documento leva o nome do Centro que a instalação diz ser o dela', () => {
  test('a capa, a linha do mês, a assinatura e o cabeçalho saem da instituição', () => {
    const definicao = montarDefinicao(edicaoCom(PRIMEIRO))
    const textos = textosDe(definicao)

    // A capa grita o nome; o bloco de assinatura o escreve normal. Os dois vêm
    // do MESMO campo, e a maiúscula é aplicada no desenho.
    expect(textos).toContain('1º CENTRO DE GEOINFORMAÇÃO')
    expect(textos).toContain('1º Centro de Geoinformação')
    expect(textos).toContain('1º CGEO - JULHO/2026')
    expect(cabecalhoDe(definicao)).toContain('RPCMTec 1º CGEO Julho/2026')
  })

  // O CASO QUE DIZ SE O TRABALHO VALEU.
  test('trocado o Centro, os quatro pontos acompanham -- e o nome antigo some', () => {
    const definicao = montarDefinicao(edicaoCom(SEGUNDO))
    const textos = textosDe(definicao)
    const cabecalho = cabecalhoDe(definicao)

    expect(textos).toContain('2º CENTRO DE GEOINFORMAÇÃO')
    expect(textos).toContain('2º Centro de Geoinformação')
    expect(textos).toContain('2º CGEO - JULHO/2026')
    expect(cabecalho).toContain(`RPCMTec 2º CGEO ${mesCapitalizado(7)}/2026`)

    // NÃO BASTA O NOVO APARECER: o que este arquivo existe para pegar é o
    // literal esquecido em algum dos pontos. Um '1º CGEO' sobrando na capa
    // passaria pelas quatro asserções acima sem reprovar nenhuma.
    for (const texto of [...textos, ...cabecalho]) {
      expect(texto).not.toMatch(/1º\s*CGEO/)
      expect(texto).not.toMatch(/1º Centro de Geoinformação/i)
    }
  })

  // A 1.1 é o único texto FIXO que fala em nome de Centro, e ela não podia
  // continuar sendo constante de um módulo de dados carregado no `require`.
  test('as duas frases da finalidade (1.1) trocam nome E sigla', () => {
    const modelo = estrutura.BLOCOS.find(b => b.numero === '1.1').conteudo

    // O que a estrutura guarda é MARCADOR, e não nome: se alguém devolver o
    // literal para cá, é aqui que reprova.
    expect(modelo).toContain('{nome}')
    expect(modelo).toContain('{sigla}')
    expect(modelo).not.toMatch(/CGEO/)

    const texto = estrutura.aplicarInstituicao(modelo, SEGUNDO)

    expect(texto).toContain('Chefe do 2º Centro de Geoinformação (2º CGEO)')
    // A SEGUNDA ocorrência da sigla, no fim da frase: `replace` sem a bandeira
    // `g` trocaria só a primeira, e o documento sairia metade certo.
    expect(texto).toContain('atividades finalísticas do 2º CGEO.')
    expect(texto).not.toMatch(/[{}]/)
  })

  test('marcador nenhum sobrevive à montagem, e texto sem marcador não muda', () => {
    expect(estrutura.aplicarInstituicao('sem marcador', SEGUNDO))
      .toBe('sem marcador')
    expect(estrutura.aplicarInstituicao(null, SEGUNDO)).toBeNull()
  })
})

// SEM VALOR PADRÃO, EM LUGAR NENHUM. É a decisão que separa "o documento não
// saiu" de "o documento saiu com o nome errado", e a segunda é a que ninguém
// percebe: o PDF vai assinado.
describe('sem instituição, o PDF NÃO É DESENHADO', () => {
  test('edição sem instituição dá erro claro, e não "undefined CGEO"', () => {
    const edicao = edicaoCom(PRIMEIRO)
    delete edicao.instituicao

    expect(() => montarDefinicao(edicao)).toThrow(/instituição/i)

    const erro = (() => {
      try {
        montarDefinicao(edicao)
      } catch (e) {
        return e
      }
    })()

    expect(erro.statusCode).toBe(500)
    // A mensagem diz o CONSERTO: a edição tem de vir da montagem, que é quem lê
    // `dgeo.instituicao`.
    expect(erro.message).toContain('rpcmtec_edicao_ctrl.montar')
  })

  test('instituição com sigla vazia também recusa: meia instituição não serve', () => {
    expect(() => montarDefinicao(edicaoCom({ nome: 'Centro X', sigla: '' })))
      .toThrow(/instituição/i)
  })
})
