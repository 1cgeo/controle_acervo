'use strict'

// A IMPORTACAO do CSV do github_dashboard na 5.1, batendo no banco de verdade.
//
// POR QUE ESTE ARQUIVO EXISTE, tendo os dois de `unit/`. Aqueles rodam com o
// banco mockado, e nele `conn.tx` executa o callback com o proprio `conn`: eles
// nao provam nem a IDA E VOLTA pelo JSONB nem a ATOMICIDADE. Sao justamente as
// duas coisas que o Resumo depende:
//
//   1. o Resumo preservado tem de estar NO BANCO depois, e nao so no retorno da
//      rota. `rpcmtec.subsecao.linhas` e JSONB, e o acento do texto escrito a
//      mao passa por ele;
//   2. o 409 da remocao tem de deixar a tabela EXATAMENTE como estava. Um 409
//      lancado depois do UPSERT dentro da transacao so nao destroi nada porque
//      a transacao volta atras.
//
// O CICLO COMPLETO esta no ultimo caso: importa, escreve o Resumo pela rota
// normal, reimporta com os commits mudados e le o banco. E o uso real da 5.1,
// mes a mes.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

const criarEdicao = async () => {
  const res = await request(app)
    .post('/api/rpcmtec')
    .set('Authorization', admin())
    .send({ ano: 2026, mes: 7, assinante_uuid: ADMIN_UUID })
  expect(res.status).toBe(201)
  return res.body.dados.id
}

const importar = (id, csv, confirmarRemocao = false) =>
  request(app)
    .post(`/api/rpcmtec/${id}/subsecao/5.1/importar`)
    .set('Authorization', admin())
    .send({ csv, confirmar_remocao: confirmarRemocao })

const gravarLinhas = (id, linhas) =>
  request(app)
    .put(`/api/rpcmtec/${id}/subsecao/5.1`)
    .set('Authorization', admin())
    .send({ linhas })

/** As linhas COMO ESTAO NO BANCO, e nao como a rota as devolveu. */
const linhasNoBanco = async id => {
  const linha = await conn.oneOrNone(
    `SELECT linhas FROM rpcmtec.subsecao
     WHERE edicao_id = $<id> AND numero = '5.1'`,
    { id }
  )
  return linha ? linha.linhas : null
}

// O formato exato de `dashboard_cli/lib/saida.js` (csvConsolidado) e do botao
// "Dados Consolidados" da tela.
const csvDe = linhas => [
  'Repositório,Número de commits,Efetivo',
  ...linhas
].join('\n')

const AGOSTO = csvDe([
  'controle_acervo,42,Cap Fulano;Maj Beltrano',
  'DsgTools,17,Ten Sicrano'
])

describe('POST /api/rpcmtec/:id/subsecao/5.1/importar', () => {
  test('a primeira importação chega ao banco com quatro colunas', async () => {
    const id = await criarEdicao()

    const res = await importar(id, AGOSTO)
    expect(res.status).toBe(200)

    expect(await linhasNoBanco(id)).toEqual([
      ['controle_acervo', '42', 'Cap Fulano;Maj Beltrano', ''],
      ['DsgTools', '17', 'Ten Sicrano', '']
    ])
  })

  test('a subseção passa a contar como PREENCHIDA no documento', async () => {
    // Sem isto o fechamento continuaria cobrando a 5.1 depois de importada.
    const id = await criarEdicao()
    await importar(id, AGOSTO)

    const doc = await request(app)
      .get(`/api/rpcmtec/${id}/documento`)
      .set('Authorization', admin())
    const bloco = doc.body.dados.secoes
      .flatMap(s => s.subsecoes)
      .find(s => s.numero === '5.1')

    expect(bloco.preenchida).toBe(true)
    expect(bloco.linhas).toHaveLength(2)
  })

  test('CSV que o importador não entende volta 400 e não grava nada', async () => {
    const id = await criarEdicao()

    const res = await importar(id, 'oi,tudo,bem\n1,2,3')
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('cabeçalho')

    expect(await linhasNoBanco(id)).toBeNull()
  })

  test('a 9.3 não tem esta rota: o caminho fixa a 5.1', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/subsecao/9.3/importar`)
      .set('Authorization', admin())
      .send({ csv: AGOSTO })

    expect(res.status).toBe(404)
  })
})

describe('a reimportação, que é o uso normal da 5.1', () => {
  // O CASO QUE JUSTIFICA A FEATURE INTEIRA, do começo ao fim e contra o banco.
  test('o Resumo escrito sobrevive, e os commits se refazem', async () => {
    const id = await criarEdicao()

    // 1. Importa no começo do mês.
    expect((await importar(id, csvDe([
      'controle_acervo,10,Cap Fulano',
      'DsgTools,4,Ten Sicrano'
    ]))).status).toBe(200)

    // 2. A pessoa escreve o Resumo, pela rota normal de gravação.
    expect((await gravarLinhas(id, [
      ['controle_acervo', '10', 'Cap Fulano', 'Subiu o módulo Efetivo.'],
      ['DsgTools', '4', 'Ten Sicrano', 'Correção do validador de geometria.']
    ])).status).toBe(200)

    // VARIÂNCIA: o estado ANTES da reimportação, para a comparação seguinte não
    // ser satisfeita por uma tabela que nunca mudou.
    const antes = await linhasNoBanco(id)
    expect(antes[0][1]).toBe('10')
    expect(antes[0][3]).toBe('Subiu o módulo Efetivo.')

    // 3. Reimporta no fim do mês, com os commits atualizados e um repo novo.
    const res = await importar(id, csvDe([
      'controle_acervo,42,Cap Fulano;Maj Beltrano',
      'DsgTools,17,Ten Sicrano',
      'ferramentas_edicao,3,Cap Fulano'
    ]))
    expect(res.status).toBe(200)

    // 4. O banco: Resumo preservado, commits e efetivo refeitos, novo em branco.
    expect(await linhasNoBanco(id)).toEqual([
      ['controle_acervo', '42', 'Cap Fulano;Maj Beltrano', 'Subiu o módulo Efetivo.'],
      ['DsgTools', '17', 'Ten Sicrano', 'Correção do validador de geometria.'],
      ['ferramentas_edicao', '3', 'Cap Fulano', '']
    ])
    expect(res.body.dados.resumos_preservados).toBe(2)
    expect(res.body.dados.novos).toEqual(['ferramentas_edicao'])
  })
})

describe('a trava da remoção, contra o banco', () => {
  const comResumo = async () => {
    const id = await criarEdicao()
    await importar(id, csvDe([
      'controle_acervo,10,Cap Fulano',
      'aholo,3,Maj Beltrano'
    ]))
    await gravarLinhas(id, [
      ['controle_acervo', '10', 'Cap Fulano', ''],
      ['aholo', '3', 'Maj Beltrano', 'Tour virtual do museu.']
    ])
    return id
  }

  test('sem confirmação: 409, e a tabela fica EXATAMENTE como estava', async () => {
    // A prova da atomicidade. O 409 é lançado dentro da transação, depois da
    // leitura: sem o rollback, o UPSERT seguinte já teria destruído o Resumo.
    const id = await comResumo()
    const antes = await linhasNoBanco(id)

    const res = await importar(id, csvDe(['controle_acervo,42,Cap Fulano']))

    expect(res.status).toBe(409)
    expect(res.body.message).toContain('aholo')
    expect(await linhasNoBanco(id)).toEqual(antes)
  })

  test('com confirmação: grava, e o rastro guarda o Resumo que se perdeu', async () => {
    const id = await comResumo()

    const res = await importar(id, csvDe(['controle_acervo,42,Cap Fulano']), true)
    expect(res.status).toBe(200)

    expect(await linhasNoBanco(id)).toEqual([
      ['controle_acervo', '42', 'Cap Fulano', '']
    ])

    // O evento é o ÚNICO lugar onde o Resumo da linha removida sobrevive.
    const eventos = await conn.any(
      `SELECT * FROM auditoria.evento
       WHERE tabela = 'rpcmtec.subsecao' ORDER BY id DESC LIMIT 1`
    )
    expect(eventos).toHaveLength(1)
    expect(JSON.stringify(eventos[0].dados_antes)).toContain('Tour virtual do museu.')
  })
})
