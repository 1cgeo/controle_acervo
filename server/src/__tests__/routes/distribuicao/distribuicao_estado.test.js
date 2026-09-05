'use strict'

// DUAS COSTURAS DA FILA DO OPERADOR, PELO SQL QUE ELAS MANDAM AO BANCO.
//
// 1. O `/inicia` TRAVA A LINHA DA PESSOA ANTES DE PERGUNTAR se ela já tem
//    atividade em andamento. A pergunta é um SELECT, e sem trava dois `/inicia`
//    simultâneos da MESMA pessoa (o duplo clique do plugin, ou um reenvio da
//    rede) leem "nenhuma" ao mesmo tempo e iniciam atividades DIFERENTES -- o
//    índice único de `producao.atividade` é por (etapa, unidade de trabalho) e
//    não impede isso. A pessoa fica com duas em execução, `/verifica` só devolve
//    uma, e a outra prende a unidade de trabalho até um gerente pausá-la.
//
// 2. O recado para a PRÓXIMA atividade não pode cair numa tentativa DESCARTADA.
//    Uma etapa acumula muitas linhas de code 5 ('Não finalizada') -- o índice
//    único parcial só cobre 1 a 4 --, e sem o filtro o `LIMIT 1` sobre linhas de
//    mesma `eprox.ordem` escolhia qualquer uma: o texto que o operador escreveu
//    ia para uma linha morta, e quem abrisse a folha a seguir não via recado
//    nenhum.
//
// Banco dublado: nada aqui abre conexão, e por isso os casos rodam no pacote
// `rapido`.

const { db } = require('../../../database')

const permissoes = require('../../../database/permissoes_producao')

const ctrl = require('../../../distribuicao/distribuicao_ctrl')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONTEXTO = {
  origem: 'qgis',
  rota: 'POST /api/distribuicao/inicia',
  loteId: UUID
}

// A linha canônica responde por qualquer SELECT do dublê, e por isso carrega as
// colunas que a auditoria procura para resolver o agregado (`lote_id`).
const LINHA = {
  id: 7,
  lote_id: 5,
  etapa_id: 11,
  unidade_trabalho_id: 13,
  usuario_uuid: UUID,
  tipo_situacao_atividade_id: 1,
  observacao: null
}

const fabricarBanco = () => {
  const consultas = []

  const registrar = (query, values) => {
    consultas.push(db.pgp.as.format(query, values))
  }

  const conn = {
    any: async (query, values) => {
      registrar(query, values)
      // Nada a apagar: nem furo de fila a consumir, nem correção a bloquear.
      if (/^\s*DELETE/i.test(String(query))) return []
      return [{ ...LINHA }]
    },
    one: async (query, values) => {
      registrar(query, values)
      return { ...LINHA }
    },
    oneOrNone: async (query, values) => {
      registrar(query, values)
      const texto = db.pgp.as.format(query, values)
      // A pessoa NÃO tem atividade em andamento, senão `inicia` para antes.
      if (/FROM producao\.atividade\s+WHERE usuario_uuid/i.test(texto)) return null
      if (/SELECT aprox\.id/i.test(texto)) return { id: 99 }
      return { ...LINHA }
    },
    none: async (query, values) => {
      registrar(query, values)
      return null
    },
    result: async (query, values) => {
      registrar(query, values)
      return { rowCount: 1 }
    }
  }

  conn.tx = async cb => cb(conn)
  conn.task = async cb => cb(conn)

  return { consultas, conn }
}

let originalConn
let originalPacote
let originalRevogar

beforeEach(() => {
  originalConn = db.conn
  originalPacote = ctrl.getDadosAtividade
  originalRevogar = permissoes.revogarAcesso

  // O pacote da atividade e a revogação no banco de EDIÇÃO são outro assunto e
  // outro arquivo: aqui o que se mede é o SQL do banco principal.
  ctrl.getDadosAtividade = async atividadeId => ({ atividade: { id: atividadeId } })
  permissoes.revogarAcesso = async () => null
})

afterEach(() => {
  db.conn = originalConn
  ctrl.getDadosAtividade = originalPacote
  permissoes.revogarAcesso = originalRevogar
})

const rodar = async acao => {
  const fabricado = fabricarBanco()
  db.conn = fabricado.conn
  await acao()
  return fabricado.consultas
}

describe('POST /inicia: a corrida da MESMA pessoa', () => {
  it('trava a linha da pessoa, e a trava vem ANTES da conferência', async () => {
    const consultas = await rodar(() => ctrl.inicia(UUID, CONTEXTO))

    const trava = consultas.findIndex(c =>
      /FROM dgeo\.usuario .* FOR NO KEY UPDATE/is.test(c)
    )
    const conferencia = consultas.findIndex(c =>
      /FROM producao\.atividade\s+WHERE usuario_uuid/i.test(c)
    )

    expect(trava).toBeGreaterThanOrEqual(0)
    expect(conferencia).toBeGreaterThanOrEqual(0)
    // A ordem é a regra inteira: travar depois de perguntar não trava nada.
    expect(trava).toBeLessThan(conferencia)
  })

  it('a trava é a linha DAQUELA pessoa, e não a tabela inteira', async () => {
    const consultas = await rodar(() => ctrl.inicia(UUID, CONTEXTO))

    const trava = consultas.find(c => /FROM dgeo\.usuario/i.test(c))
    expect(trava).toContain(`'${UUID}'`)
    // Nada de trava de tabela nem de trava global: a corrida ENTRE dois
    // operadores continua sendo resolvida pelo WHERE do UPDATE.
    expect(trava).not.toMatch(/LOCK TABLE|pg_advisory/i)
  })

  it('o modo é NO KEY UPDATE, e nunca o FOR UPDATE puro', async () => {
    const consultas = await rodar(() => ctrl.inicia(UUID, CONTEXTO))

    const trava = consultas.find(c => /FROM dgeo\.usuario/i.test(c))
    // `FOR UPDATE` é o único modo que conflita com `FOR KEY SHARE`, que é o que
    // toda transação alheia toma nesta linha ao inserir uma linha que a
    // referencia por chave estrangeira (73 delas só em `er/producao.sql`). Com
    // ele, o `/inicia` de uma pessoa e um `POST /atividade/pausar` de lote
    // inteiro passariam a esperar um pelo outro. `FOR NO KEY UPDATE` conflita
    // consigo mesmo, que é a regra inteira desta trava, e nada além.
    expect(trava).toContain('FOR NO KEY UPDATE')
    expect(trava).not.toMatch(/FOR\s+UPDATE/i)
  })

  it('a corrida entre DOIS operadores continua no WHERE do UPDATE', async () => {
    const consultas = await rodar(() => ctrl.inicia(UUID, CONTEXTO))

    const update = consultas.find(c => /^\s*UPDATE producao\.atividade/i.test(c))
    // 1 é 'Não iniciada' e 3 é 'Pausada': quem chega primeiro atualiza, e o
    // segundo encontra zero linhas.
    expect(update).toContain('tipo_situacao_atividade_id IN (1, 3)')
  })
})

describe('POST /finaliza: o recado para a próxima atividade', () => {
  const finalizar = () =>
    ctrl.finaliza(UUID, 7, undefined, undefined, undefined, 'Confira o topônimo', undefined, CONTEXTO)

  it('não escolhe uma atividade DESCARTADA para receber o recado', async () => {
    const consultas = await rodar(finalizar)

    const busca = consultas.find(c => /SELECT aprox\.id/i.test(c))
    expect(busca).toBeDefined()
    // 5 é 'Não finalizada', a tentativa que não vingou.
    expect(busca).toContain('aprox.tipo_situacao_atividade_id <> 5')
  })

  it('desempata por id, para a escolha não depender do plano do Postgres', async () => {
    const consultas = await rodar(finalizar)

    const busca = consultas.find(c => /SELECT aprox\.id/i.test(c))
    expect(busca).toContain('ORDER BY eprox.ordem, aprox.id')
  })
})
