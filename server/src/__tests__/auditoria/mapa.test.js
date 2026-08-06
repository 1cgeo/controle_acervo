'use strict'

// VARREDURA DO MAPA DE ENTIDADES.
//
// O mapa e a unica declaracao de o que se audita e como se le. Ele tem duas
// formas de apodrecer, e as duas sao silenciosas:
//
//   1. Declarar uma tabela que nao existe mais (renomeada, removida): a entrada
//      fica la, ninguem a usa, e quem le o mapa acredita que aquilo e auditado.
//   2. Declarar um campo que a tabela nao tem: o rotulo nunca casa, o campo real
//      cai no ramo "nao declarado" e aparece com o nome cru para sempre, sem que
//      nada acuse.
//
// Este arquivo faz as duas coisas cumprirem, lendo os `er/*.sql` de verdade.

const fs = require('fs')
const path = require('path')

const { mapa, entradaDe, tabelasDeclaradas, dominiosCitados } = require('../../auditoria/mapa')

const RAIZ = path.resolve(__dirname, '..', '..', '..', '..')
const ER = path.join(RAIZ, 'er')

/**
 * As tabelas e as colunas de cada uma, lidas dos `er/*.sql`.
 *
 * Analise rasa de proposito: pega o bloco entre `CREATE TABLE x(` e o `);`, e
 * dele o primeiro identificador de cada linha. Nao e um parser de SQL, e nao
 * precisa ser -- o que se quer e "esta coluna existe?", e o falso positivo
 * possivel (pegar o nome de uma constraint como coluna) so tornaria o teste mais
 * permissivo, nunca mais rigoroso.
 */
const lerSchemas = () => {
  const tabelas = new Map()

  for (const arquivo of fs.readdirSync(ER).filter(f => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(ER, arquivo), 'utf8')
    const re = /CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+\.[a-z_]+)\s*\(([\s\S]*?)\n\)\s*;/gi
    let m
    while ((m = re.exec(sql)) !== null) {
      const nome = m[1].toLowerCase()
      const colunas = new Set()
      for (const linha of m[2].split('\n')) {
        const limpa = linha.trim()
        if (!limpa || limpa.startsWith('--')) continue
        const col = limpa.match(/^([a-z_][a-z0-9_]*)\s/)
        if (col) colunas.add(col[1])
      }
      tabelas.set(nome, colunas)
    }
  }

  return tabelas
}

const SCHEMAS = lerSchemas()

describe('mapa de entidades: varredura contra os er/', () => {
  it('a leitura dos er/ funcionou', () => {
    // Rede contra o falso verde: se a analise devolver vazio, todos os testes
    // abaixo passariam sem cobrar nada.
    expect(SCHEMAS.size).toBeGreaterThan(40)
    expect(SCHEMAS.has('dgeo.usuario')).toBe(true)
    expect(SCHEMAS.get('mapoteca.pedido').has('localizador_pedido')).toBe(true)
  })

  it('toda tabela declarada EXISTE nos er/, ou se declara PSEUDO', () => {
    // Pseudo-tabela e o alvo de um evento de OPERACAO: as visoes materializadas,
    // a limpeza de downloads e a verificacao de volume mudam estado sem ter uma
    // linha antes e depois. Elas passam, desde que MARCADAS -- e a marca e o que
    // separa a convencao deliberada do nome de tabela digitado errado, que e o
    // que este teste existe para pegar.
    const fantasmas = tabelasDeclaradas().filter(
      t => !SCHEMAS.has(t.toLowerCase()) && !mapa[t].pseudoTabela
    )

    expect(fantasmas).toEqual([])
  })

  it('entrada marcada como pseudo NAO e tabela do banco', () => {
    // O caminho inverso: `pseudoTabela: true` numa tabela que existe e um jeito
    // de escapar da varredura sem precisar, e o proximo leitor acreditaria que
    // aquele evento nao descreve linha nenhuma.
    const marcadasSemPrecisar = tabelasDeclaradas().filter(
      t => mapa[t].pseudoTabela && SCHEMAS.has(t.toLowerCase())
    )

    expect(marcadasSemPrecisar).toEqual([])
  })

  it('todo campo declarado EXISTE na tabela dele, ou se declara SINTETICO', () => {
    const inexistentes = []

    for (const [tabela, entrada] of Object.entries(mapa)) {
      const colunas = SCHEMAS.get(tabela.toLowerCase())
      if (!colunas) continue
      for (const [campo, decl] of Object.entries(entrada.campos || {})) {
        // Campo sintetico e o que o CONTROLLER monta e a tabela nao tem: a lista
        // de itens do DFD e o rateio da NE, que sao reescritos inteiros a cada
        // salvamento e por isso viram uma descricao so. Ele passa, desde que
        // esteja MARCADO -- e a marca e o que separa a convencao deliberada do
        // erro de digitacao num nome de coluna, que e o que este teste pega.
        if (decl.sintetico) continue
        // Campo HISTORICO e a coluna que EXISTIU e uma migracao removeu. O
        // evento ja gravado continua trazendo o campo, porque `auditoria.evento`
        // e append-only; sem a declaracao a ficha antiga exibiria o nome cru.
        // Passa marcado, e o teste logo abaixo cobra que a coluna tenha mesmo
        // sumido.
        if (decl.historico) continue
        if (!colunas.has(campo)) inexistentes.push(`${tabela}.${campo}`)
      }
    }

    expect(inexistentes).toEqual([])
  })

  it('campo marcado como HISTORICO NAO e mais coluna da tabela', () => {
    // O caminho inverso, como o do sintetico: `historico: true` numa coluna que
    // ainda existe e um jeito de calar a varredura sem precisar, e o proximo
    // leitor acreditaria que aquele campo saiu do banco.
    const marcadosSemPrecisar = []

    for (const [tabela, entrada] of Object.entries(mapa)) {
      const colunas = SCHEMAS.get(tabela.toLowerCase())
      if (!colunas) continue
      for (const [campo, decl] of Object.entries(entrada.campos || {})) {
        if (decl.historico && colunas.has(campo)) {
          marcadosSemPrecisar.push(`${tabela}.${campo}`)
        }
      }
    }

    expect(marcadosSemPrecisar).toEqual([])
  })

  it('ha ao menos um campo historico declarado', () => {
    // Rede contra o falso verde: os dois testes acima passariam sem cobrar nada
    // se ninguem usasse a marca. Ela nasceu com
    // `orcamento.nota_credito.meta_pit_id` na 1.31.0; se o ultimo campo
    // historico for removido um dia, este teste avisa para tirar a marca do
    // contrato tambem, em vez de deixa-la apodrecer sem uso.
    const historicos = []
    for (const [tabela, entrada] of Object.entries(mapa)) {
      for (const [campo, decl] of Object.entries(entrada.campos || {})) {
        if (decl.historico) historicos.push(`${tabela}.${campo}`)
      }
    }

    expect(historicos).toContain('orcamento.nota_credito.meta_pit_id')
  })

  it('campo marcado como sintetico NAO e coluna da tabela', () => {
    // O caminho inverso: `sintetico: true` numa coluna que existe e um jeito de
    // escapar da varredura sem precisar, e o proximo leitor acreditaria que
    // aquele campo nao vem do banco.
    const marcadosSemPrecisar = []

    for (const [tabela, entrada] of Object.entries(mapa)) {
      const colunas = SCHEMAS.get(tabela.toLowerCase())
      if (!colunas) continue
      for (const [campo, decl] of Object.entries(entrada.campos || {})) {
        if (decl.sintetico && colunas.has(campo)) {
          marcadosSemPrecisar.push(`${tabela}.${campo}`)
        }
      }
    }

    expect(marcadosSemPrecisar).toEqual([])
  })

  it('toda coluna de `omitir` EXISTE na tabela dela', () => {
    const inexistentes = []

    for (const [tabela, entrada] of Object.entries(mapa)) {
      const colunas = SCHEMAS.get(tabela.toLowerCase())
      if (!colunas) continue
      for (const campo of entrada.omitir || []) {
        if (!colunas.has(campo)) inexistentes.push(`${tabela}.${campo}`)
      }
    }

    // Uma omissao que nao casa com coluna nenhuma e pior do que inutil: ela da a
    // impressao de que o segredo esta protegido.
    expect(inexistentes).toEqual([])
  })

  it('todo dominio citado EXISTE como tabela', () => {
    const fantasmas = dominiosCitados()
      .filter(d => !SCHEMAS.has(d.tabela.toLowerCase()))
      .map(d => d.tabela)

    expect(fantasmas).toEqual([])
  })

  it('todo dominio citado tem as colunas de CHAVE e de ROTULO que o servidor le', () => {
    // A coluna de rotulo nao e sempre `nome`: das 14 tabelas de dominio do ponto
    // de controle, 12 chamam a coluna de `code_name`. Este caso e o que impede
    // uma declaracao errada de chegar em producao -- e o efeito la nao seria um
    // campo sem traducao, seria a tela de rastreabilidade INTEIRA caindo com
    // 42703, porque o `enriquecer` roda sobre a pagina toda e uma tabela
    // quebrada leva junto os eventos dos outros modulos.
    const fora = []

    for (const d of dominiosCitados()) {
      const colunas = SCHEMAS.get(d.tabela.toLowerCase())
      if (!colunas) continue
      if (!colunas.has(d.chave)) fora.push(`${d.tabela}.${d.chave} (chave)`)
      if (!colunas.has(d.rotulo)) fora.push(`${d.tabela}.${d.rotulo} (rotulo)`)
    }

    expect(fora).toEqual([])
  })
})

describe('mapa de entidades: forma das entradas', () => {
  it('a chave e sempre schema.tabela', () => {
    // 'arquivo' sozinho e ambiguo entre acervo, orcamento e ponto_controle.
    for (const chave of tabelasDeclaradas()) {
      expect(chave).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })

  it('`agregado` e `resumo` sao funcoes em toda entrada', () => {
    for (const [chave, entrada] of Object.entries(mapa)) {
      expect(typeof entrada.agregado).toBe('function')
      expect(typeof entrada.resumo).toBe(`function`)
      expect(entrada.entidade).toBeTruthy()
      expect(chave).toBeTruthy()
    }
  })

  it('nenhum campo declara `dominio` e `entidade` ao mesmo tempo', () => {
    // Sao tratamentos OPOSTOS: dominio traduz pelo catalogo, entidade nao traduz
    // de proposito (o nome de hoje pode nao ser o do dia do evento). Declarar os
    // dois deixaria a escolha para a ordem dos `if` do renderizador.
    const ambiguos = []
    for (const [tabela, entrada] of Object.entries(mapa)) {
      for (const [campo, decl] of Object.entries(entrada.campos || {})) {
        if (decl.dominio && decl.entidade) ambiguos.push(`${tabela}.${campo}`)
      }
    }

    expect(ambiguos).toEqual([])
  })

  it('todo campo declarado tem rotulo em portugues', () => {
    const semRotulo = []
    for (const [tabela, entrada] of Object.entries(mapa)) {
      for (const [campo, decl] of Object.entries(entrada.campos || {})) {
        if (!decl.rotulo) semRotulo.push(`${tabela}.${campo}`)
      }
    }

    expect(semRotulo).toEqual([])
  })
})

describe('entradaDe', () => {
  it('tabela nao declarada e ERRO, e a mensagem diz o que fazer', () => {
    // Evento sem agregado nao apareceria em ficha nenhuma, e ninguem
    // descobriria a falta. Por isso falha alto, em vez de gravar modulo vazio.
    expect(() => entradaDe('acervo.tabela_que_nao_existe')).toThrow(/mapa de auditoria/i)
  })

  it('devolve a entrada de uma tabela declarada', () => {
    const entrada = entradaDe('mapoteca.pedido')

    expect(entrada.modulo).toBe('mapoteca')
    expect(entrada.entidade).toBe('pedido')
  })
})

describe('resumo de cada entidade', () => {
  it('nao quebra com uma linha vazia', () => {
    // O resumo roda sobre dado que pode ser antigo, com coluna faltando. Ele nao
    // pode derrubar a leitura do historico: o historico e acessorio, a ficha e o
    // trabalho.
    for (const [chave, entrada] of Object.entries(mapa)) {
      expect(() => {
        try {
          entrada.resumo({})
        } catch (err) {
          throw new Error(`resumo de ${chave} quebrou com linha vazia: ${err.message}`)
        }
      }).not.toThrow()
    }
  })
})
