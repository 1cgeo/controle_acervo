'use strict'

// A meta do PIT, separada entre IDENTIDADE e DECLARAÇÃO (2026-08-04).
//
// A DSG revisa o PIT durante a execução, e o próprio R0 de 2026 avisa: "o EM/DSG
// realizará a revisão do PIT nos meses de ABR e AGO 26". Alterar o PIT é
// cancelar, alterar e adicionar meta (chefe, 2026-08-04). Só isso, e as três são
// atos DELA.
//
//   pit.meta          o que o SCA decide (unidade, origem) e o que revisão
//                     nenhuma muda (ano, número, item). Id ESTÁVEL, e é nele que
//                     os seis vínculos de outros schemas se penduram.
//   pit.meta_revisao  o que a DSG declara. Uma linha por revisão que mudou algo.
//
// A LEITURA sai de `pit.meta_vigente`, que devolve os mesmos nomes de coluna de
// sempre com a promessa em vigor. Quem lia `pit.meta` trocou uma palavra.
//
// A ESCRITA DA DECLARAÇÃO EXIGE REVISÃO ABERTA. É o que faz o histórico ficar
// completo POR CONSTRUÇÃO: não dá para mudar o que o PIT promete sem dizer qual
// documento autorizou. Corrigir erro de digitação é outro ato, com rota própria.

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

// As metas do ano alimentam o RPCMTec e sao apontadas pelo PDR, pela NC e pelo
// pedido de impressao: mudar uma meta muda o que os tres modulos contam.
const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `id, ano, numero_meta, item, descricao,
  quantidade_prevista, unidade_id, unidade, demandante, prazo::text AS prazo,
  cancelada, revisao_id, revisao,
  origem_id,
  (SELECT nome FROM dominio.origem_meta WHERE code = pit.meta_vigente.origem_id) AS origem,
  data_cadastramento, usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

// A unidade que cada origem SABE contar. É o que impede virar automática uma
// meta cuja unidade não é a que o cálculo produz: a origem Produção conta versão
// do acervo, e uma versão é uma FOLHA.
const UNIDADE_EXIGIDA = {
  2: { unidade: 3, nome: 'Capacitação' },
  3: { unidade: 1, nome: 'Folha' },
  4: { unidade: 1, nome: 'Folha' }
}

const conferirCoerencia = (origemId, unidadeId) => {
  const exigida = UNIDADE_EXIGIDA[origemId]
  if (!exigida) return
  if (unidadeId === exigida.unidade) return
  throw new AppError(
    `A meta calcula pela origem escolhida, e essa origem conta em ` +
    `${exigida.nome}. Ajuste a unidade da meta ou volte a origem para Manual.`,
    httpCode.BadRequest
  )
}

// A revisão em que a alteração vai cair. Nula não serve: sem ela a mudança não
// teria documento que a autorize, e o histórico nasceria com buraco.
const revisaoAberta = async (t, ano) => {
  const aberta = await t.oneOrNone(
    `SELECT id, codigo FROM pit.revisao
     WHERE ano = $<ano> AND data_vigencia IS NULL`,
    { ano }
  )
  if (aberta) return aberta

  throw new AppError(
    `Para alterar o que o PIT de ${ano} promete é preciso abrir a revisão que ` +
    'autoriza a mudança. Cadastre a revisão (o R1, o R2), faça as alterações ' +
    'dentro dela e publique. Para consertar um erro de digitação, use a ' +
    'correção de transcrição.',
    httpCode.BadRequest
  )
}

// Recusa mexer em ano fechado. O exercício encerrado é um ato do chefe, e é o
// que impede alguém corrigir 2025 em 2027.
const conferirExercicio = async (t, ano) => {
  const e = await t.oneOrNone(
    'SELECT situacao_id FROM pit.exercicio WHERE ano = $<ano>', { ano }
  )
  if (!e) {
    throw new AppError(
      `O exercício de ${ano} não existe. Crie o ano antes de cadastrar meta.`,
      httpCode.BadRequest
    )
  }
  if (e.situacao_id === 3) {
    throw new AppError(
      `O exercício de ${ano} está encerrado e não aceita alteração.`,
      httpCode.BadRequest
    )
  }
}

// O que a DSG declara, e que vai para a linha da revisão. `undefined` vira nulo:
// a linha de cabeçalho não promete quantidade, e o PIT de 2025 foi cadastrado
// sem nenhum deles.
const declaracao = dados => ({
  descricao: dados.descricao,
  quantidade_prevista: dados.quantidade_prevista === undefined ? null : dados.quantidade_prevista,
  demandante: dados.demandante === undefined ? null : dados.demandante,
  prazo: dados.prazo === undefined ? null : dados.prazo,
  cancelada: dados.cancelada === undefined ? false : dados.cancelada
})

// Grava a declaração NA revisão aberta. Upsert porque o gerente pode voltar à
// mesma meta duas vezes antes de publicar, e a revisão guarda o estado final
// dela, não cada tentativa (o rastro de cada tentativa é a auditoria).
const gravarDeclaracao = async (t, { metaId, revisaoId, dados, usuarioUuid, contexto }) => {
  const linha = await t.one(
    `INSERT INTO pit.meta_revisao
       (meta_id, revisao_id, descricao, quantidade_prevista, prazo, demandante,
        cancelada, usuario_cadastramento_uuid)
     VALUES ($<metaId>, $<revisaoId>, $<descricao>, $<quantidade_prevista>,
             $<prazo>, $<demandante>, $<cancelada>, $<usuarioUuid>)
     ON CONFLICT (meta_id, revisao_id) DO UPDATE
       SET descricao = EXCLUDED.descricao,
           quantidade_prevista = EXCLUDED.quantidade_prevista,
           prazo = EXCLUDED.prazo,
           demandante = EXCLUDED.demandante,
           cancelada = EXCLUDED.cancelada,
           data_modificacao = now(),
           usuario_modificacao_uuid = EXCLUDED.usuario_cadastramento_uuid
     RETURNING *`,
    { metaId, revisaoId, ...declaracao(dados), usuarioUuid }
  )

  await auditoriaCtrl.registrar(t, {
    tabela: 'pit.meta_revisao',
    registroId: linha.id,
    operacao: 'I',
    depois: linha,
    usuarioUuid,
    contexto
  })

  return linha
}

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas}
       FROM pit.meta_vigente
       WHERE ano = $<ano>
       ORDER BY numero_meta, item`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas}
     FROM pit.meta_vigente
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
     FROM pit.meta_vigente
     WHERE id = $<id>`,
    { id }
  )
}

// O HISTÓRICO da meta: em que revisão ela mudou, e para quanto. É a resposta
// direta da tabela esparsa, sem diff nem cálculo.
controller.historico = async id => {
  return db.conn.any(
    `SELECT mr.revisao_id, r.codigo AS revisao, r.data_vigencia::text AS data_vigencia,
            r.assinante, mr.descricao, mr.quantidade_prevista,
            mr.prazo::text AS prazo, mr.demandante, mr.cancelada,
            mr.data_cadastramento, mr.usuario_cadastramento_uuid
     FROM pit.meta_revisao mr
     INNER JOIN pit.revisao r ON r.id = mr.revisao_id
     WHERE mr.meta_id = $<id>
     ORDER BY r.data_vigencia NULLS LAST, r.id`,
    { id }
  )
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // A coerência entre origem e unidade só olha o CORPO, então vem antes de
    // qualquer ida ao banco: corpo incoerente não merece consulta nenhuma.
    conferirCoerencia(
      dados.origem_id === undefined ? 1 : dados.origem_id,
      dados.unidade_id
    )
    await conferirExercicio(t, dados.ano)
    // Adicionar meta é ato da DSG, como alterar e cancelar: também exige
    // revisão aberta.
    const revisao = await revisaoAberta(t, dados.ano)

    // RETURNING *, e nao `RETURNING id`: a linha gravada e o `dados_depois`, e o
    // que se audita e o que o banco GRAVOU.
    const criada = await t.one(
      `INSERT INTO pit.meta
         (ano, numero_meta, item, unidade_id, origem_id, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<numero_meta>, $<item>, $<unidade_id>, $<origem_id>, $<usuarioUuid>)
       RETURNING *`,
      {
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        unidade_id: dados.unidade_id === undefined ? null : dados.unidade_id,
        origem_id: dados.origem_id === undefined ? 1 : dados.origem_id,
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

    await gravarDeclaracao(t, {
      metaId: criada.id, revisaoId: revisao.id, dados, usuarioUuid, contexto
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

    conferirCoerencia(
      dados.origem_id === undefined ? 1 : dados.origem_id,
      dados.unidade_id
    )
    await conferirExercicio(t, dados.ano)

    // A IDENTIDADE muda sem revisão: unidade e origem são classificação NOSSA, e
    // a DSG nunca as menciona.
    const depois = await t.one(
      `UPDATE pit.meta
       SET ano = $<ano>, numero_meta = $<numero_meta>, item = $<item>,
           unidade_id = $<unidade_id>, origem_id = $<origem_id>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        ano: dados.ano,
        numero_meta: dados.numero_meta,
        item: dados.item,
        unidade_id: dados.unidade_id === undefined ? null : dados.unidade_id,
        origem_id: dados.origem_id === undefined ? 1 : dados.origem_id,
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

    // A DECLARAÇÃO só muda dentro de uma revisão, e só se de fato mudou: uma
    // edição que só troca a origem não deve criar linha de revisão nenhuma.
    const vigente = await t.oneOrNone(
      `SELECT descricao, quantidade_prevista, prazo::text AS prazo, demandante, cancelada
       FROM pit.meta_vigente WHERE id = $<id>`,
      { id }
    )
    const nova = declaracao(dados)
    const mudou = !vigente || ['descricao', 'quantidade_prevista', 'prazo', 'demandante', 'cancelada']
      .some(k => String(vigente[k] === undefined ? null : vigente[k]) !== String(nova[k]))

    if (mudou) {
      const revisao = await revisaoAberta(t, dados.ano)
      await gravarDeclaracao(t, {
        metaId: id, revisaoId: revisao.id, dados, usuarioUuid, contexto
      })
    }

    return { id: depois.id }
  })
}

// CORRIGIR TRANSCRIÇÃO, e não alterar o PIT.
//
// O gerente digitou 53 e o documento diz 35. Isso não é revisão da DSG, é
// conserto de quem transcreveu. Se a única porta fosse "abrir revisão", ele
// inventaria uma revisão que não existe, e o histórico passaria a mentir na
// direção oposta.
//
// Edita a linha da revisão EM VIGOR, exige motivo, e o rastro vai para a
// auditoria com o motivo junto.
controller.corrigirTranscricao = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const vigente = await t.oneOrNone(
      'SELECT revisao_id, ano FROM pit.meta_vigente WHERE id = $<id>', { id }
    )
    if (!vigente || !vigente.revisao_id) {
      throw new AppError(
        'A meta não tem declaração em revisão nenhuma, então não há transcrição a corrigir.',
        httpCode.BadRequest
      )
    }
    await conferirExercicio(t, vigente.ano)

    const antes = await t.one(
      `SELECT * FROM pit.meta_revisao
       WHERE meta_id = $<id> AND revisao_id = $<revisaoId>`,
      { id, revisaoId: vigente.revisao_id }
    )

    const depois = await t.one(
      `UPDATE pit.meta_revisao
       SET descricao = $<descricao>, quantidade_prevista = $<quantidade_prevista>,
           prazo = $<prazo>, demandante = $<demandante>, cancelada = $<cancelada>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE meta_id = $<id> AND revisao_id = $<revisaoId>
       RETURNING *`,
      {
        id, revisaoId: vigente.revisao_id, ...declaracao(dados),
        dataModificacao: new Date(), usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta_revisao',
      registroId: depois.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto,
      motivo: dados.motivo
    })

    return { id: depois.id }
  })
}

// Ganhou TRANSACAO, e nao so por causa do rastro: eram tres comandos em tres
// conexoes diferentes (o `SELECT id`, a contagem de dependentes e o DELETE), e
// entre a contagem e o DELETE cabia o cadastro de um pedido apontando esta meta.
//
// EXCLUIR NÃO É CANCELAR. A meta que a DSG cancelou continua existindo, com
// `cancelada` na revisão que a cancelou; o DELETE fica para o cadastro errado.
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
         (SELECT COUNT(*) FROM mapoteca.pedido WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM acervo.versao WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM rpcmtec.capacitacao WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM mapoteca.midia_meta_pit WHERE meta_pit_id = $<id>) AS n`,
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
