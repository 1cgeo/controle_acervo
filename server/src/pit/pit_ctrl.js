'use strict'

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

// As metas do ano alimentam o RPCMTec e sao apontadas pelo PDR, pela NC e pelo
// pedido de impressao: mudar uma meta muda o que os tres modulos contam.
const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `id, ano, numero_meta, item, descricao,
  quantidade_prevista, unidade, demandante, prazo::text AS prazo,
  situacao_id,
  (SELECT nome FROM dominio.situacao_meta WHERE code = pit.meta.situacao_id) AS situacao,
  origem_id,
  (SELECT nome FROM dominio.origem_meta WHERE code = pit.meta.origem_id) AS origem,
  data_cadastramento, usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

// O que o PIT promete no item, e o que a 2.1 do RPCMTec cobra. Os quatro são
// opcionais no schema, e `undefined` vira nulo aqui: a meta indivisa e o
// cabeçalho de meta subdividida não prometem quantidade, e o PIT de 2025 foi
// cadastrado sem nenhum deles.
const promessa = dados => ({
  quantidade_prevista: dados.quantidade_prevista === undefined ? null : dados.quantidade_prevista,
  unidade: dados.unidade === undefined ? null : dados.unidade,
  demandante: dados.demandante === undefined ? null : dados.demandante,
  prazo: dados.prazo === undefined ? null : dados.prazo,
  // Omitir vale NULO, como os quatro acima: o formulário manda a meta inteira, e
  // um campo ausente aqui é campo que ninguém preencheu, não campo a preservar.
  situacao_id: dados.situacao_id === undefined ? null : dados.situacao_id,
  // Omitir vale MANUAL, e não nulo: a coluna é NOT NULL no banco, e Manual é o
  // que toda meta é enquanto ninguém a vira de propósito.
  origem_id: dados.origem_id === undefined ? 1 : dados.origem_id
})

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas}
       FROM pit.meta
       WHERE ano = $<ano>
       ORDER BY numero_meta, item`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas}
     FROM pit.meta
     ORDER BY ano DESC, numero_meta, item`
  )
}

// Os anos que TEM meta cadastrada. A tela de metas e de plataforma e nao tem o
// seletor de ano da navbar do orcamento, entao monta o proprio filtro a partir
// desta lista, em vez de adivinhar um intervalo.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM pit.meta ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas}
     FROM pit.meta
     WHERE id = $<id>`,
    { id }
  )
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // RETURNING *, e nao `RETURNING id`: a linha gravada e o `dados_depois`, e o
    // que se audita e o que o banco GRAVOU.
    const criada = await t.one(
      `INSERT INTO pit.meta
         (ano, numero_meta, item, descricao,
          quantidade_prevista, unidade, demandante, prazo, situacao_id, origem_id,
          usuario_cadastramento_uuid)
       VALUES ($<ano>, $<numero_meta>, $<item>, $<descricao>,
               $<quantidade_prevista>, $<unidade>, $<demandante>, $<prazo>,
               $<situacao_id>, $<origem_id>,
               $<usuarioUuid>)
       RETURNING *`,
      {
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        descricao: dados.descricao,
        ...promessa(dados),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    // A rota continua devolvendo so o id, como antes: o RETURNING * e do rastro.
    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Substitui o `SELECT id`, que existia so para o 404: a linha inteira sai
    // pela mesma ida ao banco e vira o `dados_antes`.
    const antes = await auditoriaCtrl.lerAntes(t, 'pit.meta', id, 'Meta do PIT')

    const depois = await t.one(
      `UPDATE pit.meta
       SET ano = $<ano>, numero_meta = $<numero_meta>, item = $<item>,
           descricao = $<descricao>,
           quantidade_prevista = $<quantidade_prevista>, unidade = $<unidade>,
           demandante = $<demandante>, prazo = $<prazo>,
           situacao_id = $<situacao_id>, origem_id = $<origem_id>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        descricao: dados.descricao,
        ...promessa(dados),
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: depois.id }
  })
}

// Ganhou TRANSACAO, e nao so por causa do rastro: eram tres comandos em tres
// conexoes diferentes (o `SELECT id`, a contagem de dependentes e o DELETE), e
// entre a contagem e o DELETE cabia o cadastro de um pedido apontando esta meta.
controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'pit.meta', id, 'Meta do PIT')

    // Bloqueia a exclusao quando algum consumidor aponta para esta meta. Os tres
    // vivem em schemas diferentes, e a lista cresce quando um modulo novo passar a
    // amarrar trabalho ao PIT. Sem isto o erro chegaria como 500 do banco (FK).
    const dependentes = await t.one(
      `SELECT
         (SELECT COUNT(*) FROM orcamento.pdr_item WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM orcamento.nota_credito WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM mapoteca.pedido WHERE meta_pit_id = $<id>) AS n`,
      { id }
    )
    if (parseInt(dependentes.n, 10) > 0) {
      throw new AppError(
        'Meta do PIT possui registros vinculados e não pode ser excluída',
        httpCode.Conflict
      )
    }

    // Lançamento de execução é caso à parte, e por isso tem mensagem própria.
    // A chave estrangeira é ON DELETE CASCADE -- e é isso que torna a guarda
    // necessária, não dispensável: sem ela, apagar a meta levaria junto os doze
    // meses lançados, em silêncio e SEM evento de auditoria para eles, porque
    // quem apaga é o banco. O remédio aqui é do alcance de quem chamou (apagar
    // os lançamentos), ao contrário do PDR e do pedido de impressão.
    const { lancamentos } = await t.one(
      'SELECT COUNT(*)::int AS lancamentos FROM pit.execucao WHERE meta_id = $<id>',
      { id }
    )
    if (lancamentos > 0) {
      throw new AppError(
        `Meta do PIT possui ${lancamentos} lançamento(s) de execução. Exclua os lançamentos antes de excluir a meta.`,
        httpCode.Conflict
      )
    }

    await t.none('DELETE FROM pit.meta WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
