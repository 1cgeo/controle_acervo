'use strict'

// O contrato de entrada das rotas de /api/acessos, mais as duas varreduras de
// FONTE que guardam o que o porte consertou.
//
// Nao toca o banco: entra no pacote rapido.
//
// CUIDADO AO EDITAR ESTE CABECALHO. O `server/jest.config.js` escolhe o pacote
// de cada arquivo VARRENDO O TEXTO dele atras dos dois helpers que abrem
// conexao. A varredura nao distingue codigo de comentario, entao citar o
// caminho de um deles aqui -- ainda que so para explicar a regra -- joga este
// arquivo no pacote lento, onde ele passaria a cobrar um PostgreSQL que nao
// usa. Aconteceu na primeira versao deste arquivo.

const fs = require('fs')
const path = require('path')

const acessosSchema = require('../../../acessos/acessos_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const RAIZ = path.resolve(__dirname, '..', '..', '..', 'acessos')
const bruto = nome => fs.readFileSync(path.join(RAIZ, nome), 'utf8')

// As varreduras de fonte olham o CODIGO, nunca o comentario.
//
// Sem isto elas se voltam contra a documentacao: o cabecalho de
// `acessos_ctrl.js` cita `$<total:raw>` para explicar o que o porte tirou, e o
// de `acessos_route.js` cita `verifyPerfil` para explicar por que a guarda daqui
// nao e ele. Nas duas primeiras execucoes deste arquivo foi exatamente isso que
// falhou -- o guard acusando a frase que existe para justifica-lo.
//
// Um guard que proibe explicar a regra ensina a apagar a explicacao, que e o
// oposto do que ele quer.
const fonte = nome =>
  bruto(nome)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

describe('Schema das rotas de acessos: o default mora no Joi', () => {
  // O default so vive aqui. Se o controlador voltar a declarar `total = 14`, a
  // resposta passa a depender de a query ter vindo vazia ou nao, e as duas
  // declaracoes divergem no primeiro ajuste.
  it.each([
    ['loginsDiaQuery', 14]
  ])('%s sem query aplica o default total=%i', (nome, esperado) => {
    const valor = aceita(acessosSchema[nome].validate({}))
    expect(valor.total).toBe(esperado)
  })

  it('loginsUsuariosQuery sem query aplica total=30 e max=10', () => {
    const valor = aceita(acessosSchema.loginsUsuariosQuery.validate({}))
    expect(valor).toEqual({ total: 30, max: 10 })
  })

  // A query string SEMPRE chega como texto. Sem a conversao do Joi, o valor
  // seguiria como '7' e o SQL montaria o intervalo com uma string.
  it('converte o texto da query string em numero', () => {
    const valor = aceita(acessosSchema.loginsDiaQuery.validate({ total: '7' }))
    expect(valor.total).toBe(7)
  })
})

describe('Schema das rotas de acessos: total e inteiro positivo com teto', () => {
  it('recusa total = 0: janela de zero dia nao e pergunta', () => {
    recusaPor(acessosSchema.loginsDiaQuery.validate({ total: 0 }), 'total', 'number.min')
  })

  it('recusa total negativo', () => {
    recusaPor(acessosSchema.loginsDiaQuery.validate({ total: -5 }), 'total', 'number.min')
  })

  it('recusa total fracionario', () => {
    recusaPor(
      acessosSchema.loginsDiaQuery.validate({ total: 2.5 }),
      'total',
      'number.integer'
    )
  })

  it('recusa total que nao e numero', () => {
    recusaPor(
      acessosSchema.loginsDiaQuery.validate({ total: 'abc' }),
      'total',
      'number.base'
    )
  })

  // O teto existe porque `total` vira o tamanho do generate_series, ou seja, a
  // quantidade de linhas que a consulta MONTA antes de agrupar.
  it('recusa total acima de 366 dias', () => {
    recusaPor(
      acessosSchema.loginsDiaQuery.validate({ total: 367 }),
      'total',
      'number.max'
    )
    aceita(acessosSchema.loginsDiaQuery.validate({ total: 366 }))
  })
})

describe('Schema das rotas de acessos: max do ranking', () => {
  it('recusa max = 0: ranking vazio nao e pergunta', () => {
    recusaPor(
      acessosSchema.loginsUsuariosQuery.validate({ max: 0 }),
      'max',
      'number.min'
    )
  })

  it('recusa max acima de 100', () => {
    recusaPor(
      acessosSchema.loginsUsuariosQuery.validate({ max: 101 }),
      'max',
      'number.max'
    )
    aceita(acessosSchema.loginsUsuariosQuery.validate({ max: 100 }))
  })
})

describe('O porte tirou a interpolacao crua do SQL', () => {
  // O ORIGINAL (Auth Server, dashboard/dashboard_sql.ts) colava os dois numeros
  // no texto do SQL: `interval '$<total:raw> day'` e `LIMIT $<max:raw>`. O
  // `:raw` do pg-promise desliga o formatador -- o conteudo da variavel entra no
  // SQL como esta, dentro de um literal de intervalo. Funcionava porque o Zod
  // validava antes, e nisso a validacao virava a UNICA coisa entre a query
  // string e o banco.
  //
  // Varredura de texto de proposito: pega tambem a consulta que alguem
  // acrescentar amanha copiando do repositorio de origem.
  it('nenhum parametro do controlador usa :raw', () => {
    const encontrados = [...fonte('acessos_ctrl.js').matchAll(/\$<[^>]*:raw[^>]*>/g)]
      .map(m => m[0])
    expect(encontrados).toEqual([])
  })

  it('o recorte e o teto entram como parametro nomeado do pg-promise', () => {
    const sql = fonte('acessos_ctrl.js')
    expect(sql).toContain('$<total>')
    expect(sql).toContain('LIMIT $<max>')
  })
})

describe('Toda rota de acessos e verifyAdmin', () => {
  // Rota de PLATAFORMA: o historico de quem entrou nao e dado de modulo nenhum,
  // e nao existe "perfil de acessos" porque nao existe modulo de acessos. O
  // risco aqui e o mesmo que o rpcmtec.test.js guarda -- alguem trocar por um
  // verifyPerfil de modulo e entregar a movimentacao de todo mundo a quem so
  // cataloga carta. Le o FONTE para cobrir tambem a rota que ninguem testou.
  const codigo = fonte('acessos_route.js')

  // 'router.get(' seguido, na linha de baixo, do caminho e da guarda.
  const rotas = [...codigo.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)',\s*([A-Za-z]+)/g)]

  it('encontra as quatro rotas declaradas', () => {
    expect(rotas.map(r => r[2]).sort()).toEqual([
      '/logados',
      '/logins/dia',
      '/logins/usuarios',
      '/resumo'
    ])
  })

  it('a primeira coisa depois do caminho e sempre verifyAdmin', () => {
    const semGuarda = rotas.filter(r => r[3] !== 'verifyAdmin').map(r => r[2])
    expect(semGuarda).toEqual([])
  })

  it('o fonte nao chama verifyPerfil nem verifyLogin', () => {
    expect(codigo).not.toMatch(/verifyPerfil|verifyLogin/)
  })
})
