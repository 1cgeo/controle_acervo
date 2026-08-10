'use strict'

// `GET /api/producao/banco_dados` NAO DEVOLVE O ENDERECO DO BANCO DE EDICAO.
//
// O DEFEITO QUE ISTO PRENDE. `producao.dado_producao.configuracao_producao`
// guarda `servidor:porta/banco` -- medido no dump de producao do SAP 2.3.5 em
// 2026-08-09, e e assim que `er/producao.sql`, `database/conexao_admin.js` e
// `producao/trabalho_schema.js` a leem. Ate 2026-08-09 esta rota devolvia a
// coluna CRUA como `nome`, apoiada num comentario que afirmava o contrario ("aqui
// ela guarda so o nome do banco"). O efeito era o endereco de cada banco de
// edicao da instalacao saindo na resposta E no log, que e o que `er/producao.sql`
// proibe com todas as letras.
//
// O QUE ELE MEDE, e por que nao basta conferir `nome`: a resposta INTEIRA nao
// pode conter os dois separadores do formato. Uma coluna nova que levasse a
// configuracao junto passaria por um `expect(nome).toBe(...)` sem piscar.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const { db } = require('../../../database')

const ctrl = require('../../../producao/trabalho_ctrl')

// O ENDERECO E OSTENSIVAMENTE FALSO. Este repositorio e publico: o que se prova
// aqui e a FORMA que a coluna guarda, e nunca um valor de instalacao nenhuma.
const CONFIGURACAO = 'servidor_de_teste:5432/banco_de_teste'

const linhaDe = configuracao => ({
  id: 1,
  tipo_dado_producao_id: 2,
  tipo_dado_producao: 'PostGIS com controle de permissão',
  configuracao_producao: configuracao,
  lote_status_execucao_id: 1
})

let connOriginal

const dublarBanco = linhas => {
  db.conn = {
    any: async (query, values) => {
      // `as.format` e o mesmo caminho do driver: ele lanca em parametro que
      // falta, e e o que prende um `$<x>` esquecido na consulta.
      db.pgp.as.format(query, values)
      return linhas
    }
  }
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

describe('a lista de bancos de produção', () => {
  it('devolve só o NOME do banco, fatiado do endereço', async () => {
    dublarBanco([linhaDe(CONFIGURACAO)])

    const dados = await ctrl.getBancoDados()

    expect(dados).toEqual([
      {
        id: 1,
        tipo_dado_producao_id: 2,
        tipo_dado_producao: 'PostGIS com controle de permissão',
        nome: 'banco_de_teste',
        lote_status_execucao_id: 1
      }
    ])
  })

  // O SERVIDOR E A PORTA NAO VOLTAM COMO COLUNAS, ao contrario do `split_part` em
  // tres do SAP 2.3.5: `er/producao.sql` proibe o endereco de sair em resposta de
  // API e em log, e este repositorio e publico.
  it('não deixa o endereço sair por campo nenhum', async () => {
    dublarBanco([linhaDe(CONFIGURACAO)])

    const dados = await ctrl.getBancoDados()
    const texto = JSON.stringify(dados)

    expect(texto).not.toContain('servidor_de_teste')
    expect(texto).not.toContain('5432')
    // OS DOIS SEPARADORES DO FORMATO. Sem eles nao ha `servidor:porta/banco` que
    // atravesse, venha por `nome` ou por uma coluna que alguem acrescente depois.
    expect(texto).not.toContain(':5432')
    expect(texto).not.toContain('/')
    expect(dados[0]).not.toHaveProperty('configuracao_producao')
    expect(dados[0]).not.toHaveProperty('servidor')
    expect(dados[0]).not.toHaveProperty('porta')
  })

  // `nome` NULO E A LEITURA CERTA DE "o cadastro deste dado de producao esta
  // incompleto". Devolver o texto cru aqui seria justamente vazar o que nao se
  // sabe ler.
  it.each([
    ['vazia', ''],
    ['sem porta', 'servidor_de_teste/banco_de_teste'],
    ['só o nome do banco', 'banco_de_teste'],
    ['nula', null]
  ])('devolve nome nulo quando a configuração está %s', async (_caso, valor) => {
    dublarBanco([linhaDe(valor)])

    const dados = await ctrl.getBancoDados()

    expect(dados[0].nome).toBeNull()
    expect(JSON.stringify(dados)).not.toContain('servidor_de_teste')
  })

  it('não inventa linha quando não há dado de produção cadastrado', async () => {
    dublarBanco([])

    await expect(ctrl.getBancoDados()).resolves.toEqual([])
  })
})
