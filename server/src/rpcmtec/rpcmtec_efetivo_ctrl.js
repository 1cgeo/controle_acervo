'use strict'

// Aproveitamento do efetivo: a subseção 6.1 do RPCMTec ("Militar | Atividades").
//
// POR QUE É TABELA, e não uma consulta a `dgeo.usuario`. Ela guarda o posto DA
// ÉPOCA e o efetivo DAQUELE mês. Lendo o cadastro de hoje, a edição de março se
// reescreveria sozinha na primeira promoção de julho, e quem transferisse
// sumiria de todos os meses em que esteve. Uma edição assinada não muda depois
// de assinada, e é essa a propriedade que a tabela compra.
//
// O PREENCHIMENTO É O PROBLEMA REAL desta subseção: são dezenas de linhas por
// mês, e quase todas iguais às do mês anterior. Por isso as duas partidas
// rápidas, que vieram do SAP junto com a tabela:
//
//   iniciarDoEfetivo  cria uma linha por pessoa ATIVA hoje, com o posto atual e
//                     sem atividade. É a partida do primeiro mês.
//   copiarMesAnterior repete o mês anterior, posto e atividade. É a partida de
//                     todo mês seguinte, porque o encargo de cada um muda pouco.
//
// AS DUAS NUNCA SOBRESCREVEM. Quem já tem linha no mês fica como está: elas são
// para COMEÇAR o mês, e reexecutá-las depois de alguém ter editado apagaria o
// trabalho de quem editou. O retorno diz quantas linhas entraram, senão não há
// como distinguir "copiou 31" de "não copiou nada porque já estava lá".

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

// O mês ANTERIOR a (ano, mes). Janeiro volta para dezembro do ano passado, e é
// o caso que importa: é justamente em janeiro que alguém copia o mês anterior.
const mesAnterior = (ano, mes) =>
  mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 }

/**
 * O retrato de um mês, já com o nome de quem é cada linha.
 *
 * O posto sai da PRÓPRIA linha (`tipo_posto_grad_id`), e não de `dgeo.usuario`:
 * é o congelamento que a tabela existe para guardar. O nome sai do cadastro,
 * porque nome não é o que se congela aqui, e é assim que a pessoa é procurada.
 */
controller.listar = async (ano, mes) => {
  return db.conn.any(
    `SELECT a.id, a.ano, a.mes, a.usuario_uuid, a.tipo_posto_grad_id,
            p.nome_abrev AS posto_abrev, p.nome AS posto,
            u.nome, u.nome_guerra, u.login, u.ativo,
            a.atividades,
            a.data_cadastramento, a.usuario_cadastramento_uuid,
            a.data_modificacao, a.usuario_modificacao_uuid
     FROM rpcmtec.aproveitamento_mes AS a
     INNER JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS p ON p.code = a.tipo_posto_grad_id
     WHERE a.ano = $<ano> AND a.mes = $<mes>
     ORDER BY a.tipo_posto_grad_id DESC, u.nome_guerra`,
    { ano, mes }
  )
}

/** Os (ano, mês) que já têm retrato, para a tela não oferecer mês vazio. */
controller.mesesPreenchidos = async ano => {
  return db.conn.any(
    `SELECT ano, mes, COUNT(*)::int AS linhas
     FROM rpcmtec.aproveitamento_mes
     WHERE $<ano>::smallint IS NULL OR ano = $<ano>::smallint
     GROUP BY ano, mes
     ORDER BY ano DESC, mes DESC`,
    { ano: ano === undefined ? null : ano }
  )
}

// Quem AINDA não está no mês, para a tela oferecer só isso ao acrescentar uma
// linha. Sem isto, escolher alguém já lançado só daria o 409 da UNIQUE.
controller.faltantes = async (ano, mes) => {
  return db.conn.any(
    `SELECT u.uuid AS usuario_uuid, u.nome, u.nome_guerra, u.login,
            u.tipo_posto_grad_id, p.nome_abrev AS posto_abrev
     FROM dgeo.usuario AS u
     INNER JOIN dominio.tipo_posto_grad AS p ON p.code = u.tipo_posto_grad_id
     WHERE u.ativo
       AND NOT EXISTS (
         SELECT 1 FROM rpcmtec.aproveitamento_mes AS a
         WHERE a.ano = $<ano> AND a.mes = $<mes> AND a.usuario_uuid = u.uuid
       )
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { ano, mes }
  )
}

/**
 * Audita as linhas criadas em massa, uma a uma.
 *
 * O evento é por LINHA, e não um só pelo conjunto, porque é a linha que se
 * confere e se corrige depois. O que impede a tela de virar trinta linhas
 * iguais é o `lote_id`, e ele NÃO é gerado aqui: `montarContexto` já emite um
 * por REQUISIÇÃO, e as duas partidas rápidas são uma requisição cada. Gerar
 * outro seria um segundo mecanismo fazendo o mesmo trabalho, e o dia em que os
 * dois divergissem a tela agruparia errado.
 */
const auditarLote = async (t, linhas, usuarioUuid, contexto) => {
  for (const linha of linhas) {
    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.aproveitamento_mes',
      registroId: linha.id,
      operacao: 'I',
      depois: linha,
      usuarioUuid,
      contexto
    })
  }
}

controller.iniciarDoEfetivo = async (ano, mes, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criadas = await t.any(
      `INSERT INTO rpcmtec.aproveitamento_mes
         (ano, mes, usuario_uuid, tipo_posto_grad_id, usuario_cadastramento_uuid)
       SELECT $<ano>, $<mes>, u.uuid, u.tipo_posto_grad_id, $<usuarioUuid>
       FROM dgeo.usuario AS u
       WHERE u.ativo
       ON CONFLICT (ano, mes, usuario_uuid) DO NOTHING
       RETURNING *`,
      { ano, mes, usuarioUuid }
    )

    await auditarLote(t, criadas, usuarioUuid, contexto)

    return { inseridos: criadas.length }
  })
}

controller.copiarMesAnterior = async (ano, mes, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const anterior = mesAnterior(ano, mes)

    const { linhas } = await t.one(
      `SELECT COUNT(*)::int AS linhas FROM rpcmtec.aproveitamento_mes
       WHERE ano = $<ano> AND mes = $<mes>`,
      anterior
    )
    if (linhas === 0) {
      throw new AppError(
        `Não há efetivo lançado em ${String(anterior.mes).padStart(2, '0')}/${anterior.ano} para copiar. Use "Iniciar a partir do efetivo atual".`,
        httpCode.BadRequest
      )
    }

    const criadas = await t.any(
      `INSERT INTO rpcmtec.aproveitamento_mes
         (ano, mes, usuario_uuid, tipo_posto_grad_id, atividades, usuario_cadastramento_uuid)
       SELECT $<ano>, $<mes>, a.usuario_uuid, a.tipo_posto_grad_id, a.atividades, $<usuarioUuid>
       FROM rpcmtec.aproveitamento_mes AS a
       WHERE a.ano = $<anoAnterior> AND a.mes = $<mesAnterior>
       ON CONFLICT (ano, mes, usuario_uuid) DO NOTHING
       RETURNING *`,
      {
        ano,
        mes,
        anoAnterior: anterior.ano,
        mesAnterior: anterior.mes,
        usuarioUuid
      }
    )

    await auditarLote(t, criadas, usuarioUuid, contexto)

    return { inseridos: criadas.length, copiadoDe: anterior }
  })
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // O posto pode vir do chamador (corrigindo o cadastro na hora) ou sair do
    // cadastro atual da pessoa. Sair do cadastro é o caso comum, e exigi-lo do
    // cliente faria a tela ter de conhecer a tabela de postos para acrescentar
    // uma linha.
    const pessoa = await t.oneOrNone(
      'SELECT uuid, tipo_posto_grad_id FROM dgeo.usuario WHERE uuid = $<usuario_uuid>',
      { usuario_uuid: dados.usuario_uuid }
    )
    if (!pessoa) {
      throw new AppError('Usuário não encontrado', httpCode.NotFound)
    }

    const criada = await t.one(
      `INSERT INTO rpcmtec.aproveitamento_mes
         (ano, mes, usuario_uuid, tipo_posto_grad_id, atividades, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<mes>, $<usuarioAlvo>, $<postoId>, $<atividades>, $<usuarioUuid>)
       RETURNING *`,
      {
        ano: dados.ano,
        mes: dados.mes,
        usuarioAlvo: dados.usuario_uuid,
        postoId: dados.tipo_posto_grad_id || pessoa.tipo_posto_grad_id,
        atividades: dados.atividades === undefined ? null : dados.atividades,
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.aproveitamento_mes',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

// Só o posto e as atividades se editam. Trocar a PESSOA ou o MÊS de uma linha
// existente seria reescrever de quem é o retrato, e o caminho certo é excluir e
// lançar de novo.
controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.aproveitamento_mes', id, 'Linha de aproveitamento do efetivo'
    )

    const depois = await t.one(
      `UPDATE rpcmtec.aproveitamento_mes
       SET tipo_posto_grad_id = $<postoId>, atividades = $<atividades>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        postoId: dados.tipo_posto_grad_id || antes.tipo_posto_grad_id,
        atividades: dados.atividades === undefined ? null : dados.atividades,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.aproveitamento_mes',
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

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.aproveitamento_mes', id, 'Linha de aproveitamento do efetivo'
    )

    await t.none('DELETE FROM rpcmtec.aproveitamento_mes WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.aproveitamento_mes',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
