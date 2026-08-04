'use strict'

// O contrato de CONTAGEM das rotas de /api/acessos: elas contam PESSOAS, e o
// que continua contando evento diz isso no nome.
//
// POR QUE ESTE ARQUIVO EXISTE. Medido na producao em 2026-08-04, o painel
// respondia 102 logins em 30 dias, dos quais 98 eram da conta de servico
// `claude`. Nenhum dos numeros do topo dizia quantas PESSOAS entraram, porque as
// tres contagens eram de linha de `dgeo.login`: com JWT de 8 horas e dois
// clientes, a mesma pessoa entra varias vezes por dia. "Logins hoje" respondia a
// pergunta errada com precisao.
//
// O QUE ELE GUARDA, consulta a consulta:
//   1. o topo conta pessoa distinta, e nao linha de login
//   2. o topo conta tambem quem NAO consegue entrar (senha nula)
//   3. "quem entrou hoje" devolve o uuid da pessoa, e uma linha POR PESSOA
//   4. o recorte continua entrando como parametro, e nunca colado no SQL
//
// Nao toca o banco: entra no pacote rapido. O efeito contra o PostgreSQL e do
// arquivo de rota, que semeia login de verdade.
//
// CUIDADO AO EDITAR ESTE CABECALHO. O `server/jest.config.js` escolhe o pacote
// de cada arquivo VARRENDO O TEXTO dele atras dos dois auxiliares que abrem
// conexao. A varredura nao distingue codigo de comentario, entao citar o caminho
// de um deles aqui joga este arquivo no pacote lento, onde ele cobraria um
// PostgreSQL que nao usa.

const mockDb = {
  conn: {
    one: jest.fn(() => Promise.resolve({})),
    any: jest.fn(() => Promise.resolve([]))
  }
}

jest.mock('../../database', () => ({ db: mockDb }))

const ctrl = require('../../acessos/acessos_ctrl')

// O SQL da ultima chamada, sem comentario de linha: as assercoes olham o
// CODIGO. Sem isto elas se voltariam contra a documentacao, que cita de
// proposito o que a consulta deixou de fazer.
const sqlDe = espiao => {
  const [texto] = espiao.mock.calls[espiao.mock.calls.length - 1]
  return String(texto).replace(/^[ \t]*--.*$/gm, '')
}

beforeEach(() => {
  mockDb.conn.one.mockClear()
  mockDb.conn.any.mockClear()
})

describe('resumo: o topo conta PESSOA, e nao evento', () => {
  it('conta pessoa distinta hoje e no periodo', async () => {
    await ctrl.resumo()

    const sql = sqlDe(mockDb.conn.one)
    const distintos = sql.match(/count\(DISTINCT usuario_id\)/g) || []

    // Duas: a de hoje e a da janela de 30 dias. Uma so significaria que uma das
    // duas voltou a contar linha de login.
    expect(distintos).toHaveLength(2)
  })

  it('nomeia o que mede: pessoas_hoje e pessoas_30_dias', async () => {
    await ctrl.resumo()

    const sql = sqlDe(mockDb.conn.one)
    expect(sql).toContain('AS pessoas_hoje')
    expect(sql).toContain('AS pessoas_30_dias')
  })

  it('nao devolve mais logins_hoje nem logins_30_dias', async () => {
    await ctrl.resumo()

    // O nome antigo dizia "login" e a tela o mostrava como se fosse gente. Sair
    // do resultado e o que impede a etiqueta de voltar sem a conta mudar.
    const sql = sqlDe(mockDb.conn.one)
    expect(sql).not.toContain('AS logins_hoje')
    expect(sql).not.toContain('AS logins_30_dias')
  })

  it('conta quem NAO consegue entrar: senha nula', async () => {
    await ctrl.resumo()

    // `dgeo.usuario.senha` e anulavel de proposito desde a fusao de 2026-08-02:
    // quem veio do Auth Server so ganha hash quando o script de copia rodar.
    // Sem esta contagem, quem ficou de fora so aparece ao reclamar.
    const sql = sqlDe(mockDb.conn.one)
    expect(sql).toContain('senha IS NULL')
    expect(sql).toContain('AS contas_sem_senha')
  })

  it('a conta habilitada tem nome de conta, e nao de gente', async () => {
    await ctrl.resumo()

    // `dgeo.usuario.ativo` e conta habilitada, e nao militar na Divisao. Quem
    // responde "quantos militares" e a aba Efetivo, por `dgeo.efetivo_periodo`.
    const sql = sqlDe(mockDb.conn.one)
    expect(sql).toContain('AS contas_ativas')
    expect(sql).not.toContain('AS usuarios_ativos')
  })
})

describe('logados: quem entrou hoje e uma PESSOA, com uuid', () => {
  it('devolve o uuid da pessoa', async () => {
    await ctrl.logados()

    // Sem o uuid a linha nao vira link: a tela de aproveitamento recebe a pessoa
    // por `#/aproveitamento?usuario_uuid=`.
    expect(sqlDe(mockDb.conn.any)).toContain('u.uuid')
  })

  it('troca o ROW_NUMBER sintetico pela identidade real', async () => {
    await ctrl.logados()

    const sql = sqlDe(mockDb.conn.any)
    expect(sql).not.toContain('ROW_NUMBER')
  })

  it('agrupa por pessoa, e nao por par pessoa + cliente', async () => {
    await ctrl.logados()

    // Uma linha por pessoa. O cliente vira COLUNA da linha: quem abriu a
    // interface e o plugin no mesmo dia continua sendo uma pessoa so.
    const sql = sqlDe(mockDb.conn.any)
    expect(sql).toContain('GROUP BY u.uuid')
    expect(sql).not.toContain('GROUP BY usuario_id, cliente')
  })

  it('lista os clientes de cada pessoa numa coluna', async () => {
    await ctrl.logados()

    const sql = sqlDe(mockDb.conn.any)
    expect(sql).toContain('AS clientes')
  })
})

describe('o recorte continua parametrizado', () => {
  it('a janela de 30 dias do resumo entra como parametro nomeado', async () => {
    await ctrl.resumo()

    const sql = sqlDe(mockDb.conn.one)
    // O valor nunca e colado no texto do SQL. A regra da casa e SQL
    // parametrizado, e o porte do Auth Server existiu para tirar o `:raw`.
    expect(sql).not.toMatch(/\$<[^>]*:raw[^>]*>/)
  })
})
