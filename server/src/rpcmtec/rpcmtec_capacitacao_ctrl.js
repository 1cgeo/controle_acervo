'use strict'

// Capacitação: MINISTRADA alimenta a subseção 2.6 e RECEBIDA a 6.2.
//
// UM cadastro para as duas, porque a linha é o mesmo fato visto dos dois lados:
// um curso tem nome, instituição, local e período em qualquer dos casos. O que
// muda são três colunas, e é o `tipo_id` que diz quais valem. Duas tabelas com
// dez colunas iguais divergiriam na primeira que fosse acrescentada a uma só.
//
// O SERVIDOR NÃO RECUSA a coluna que não pertence ao tipo, e isso é deliberado.
// Ele não sabe se a linha está sendo montada aos poucos, e recusar
// `efetivo_capacitado` numa capacitação RECEBIDA transformaria em erro o que é
// só um campo que a tela nem mostra. Quem decide o que aparece é o formulário, e
// quem decide o que SAI é o gerador, que lê a coluna certa para cada subseção.
//
// QUEM DA DIVISÃO PARTICIPOU sai de `rpcmtec.capacitacao_militar`, ligado ao
// cadastro (chefe, 2026-08-02), e vale para os dois tipos: na MINISTRADA são os
// instrutores e monitores, na RECEBIDA são os capacitados. O papel não é coluna
// -- ele vem do `tipo_id` da própria capacitação.
//
// A LISTA é regravada INTEIRA a cada salvamento, e por isso o rastro dela é UM
// evento do PAI com a lista descrita em texto dos dois lados. Auditar linha a
// linha faria o histórico dizer "removeu 3, acrescentou 3" toda vez que alguém
// abrisse e salvasse. É o mesmo desenho dos itens do DFD.

const { db } = require('../database')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `c.id, c.ano, c.nome, c.tipo_id, t.nome AS tipo,
  c.situacao_id, s.nome AS situacao, c.instituicoes, c.local_realizacao,
  c.data_inicio::text AS data_inicio, c.data_fim::text AS data_fim,
  c.efetivo_capacitado, c.plano_codigo, c.documento,
  c.meta_pit_id, mp.item AS meta_pit_item,
  COALESCE(mil.lista, '[]'::json) AS militares,
  c.data_cadastramento, c.usuario_cadastramento_uuid,
  c.data_modificacao, c.usuario_modificacao_uuid`

// Os militares saem como LISTA de objetos, e não concatenados: quem monta a
// frase do relatório é o gerador, e quem monta a etiqueta da tela é a tela. O
// posto vem do cadastro de HOJE, e não congelado: quem participou continua sendo
// a mesma pessoa depois de promovido.
const de = `FROM rpcmtec.capacitacao AS c
  INNER JOIN dominio.tipo_capacitacao AS t ON t.code = c.tipo_id
  INNER JOIN dominio.situacao_capacitacao AS s ON s.code = c.situacao_id
  LEFT JOIN pit.meta AS mp ON mp.id = c.meta_pit_id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
             'usuario_uuid', u.uuid,
             'nome', u.nome,
             'nome_guerra', u.nome_guerra,
             'posto_abrev', pg.nome_abrev
           ) ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra) AS lista
    FROM rpcmtec.capacitacao_militar AS cm
    INNER JOIN dgeo.usuario AS u ON u.uuid = cm.usuario_uuid
    INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
    WHERE cm.capacitacao_id = c.id
  ) AS mil ON TRUE`

// `tipo_id` é filtro OPCIONAL: a tela lista as duas juntas com uma coluna que as
// separa, e o gerador pede uma de cada vez.
controller.listar = async (ano, tipoId) => {
  return db.conn.any(
    `SELECT ${colunas} ${de}
     WHERE ($<ano>::smallint IS NULL OR c.ano = $<ano>::smallint)
       AND ($<tipoId>::smallint IS NULL OR c.tipo_id = $<tipoId>::smallint)
     ORDER BY c.ano DESC, c.data_inicio NULLS LAST, c.nome`,
    {
      ano: ano === undefined ? null : ano,
      tipoId: tipoId === undefined ? null : tipoId
    }
  )
}

/**
 * As capacitações que ACONTECERAM no mês, que é o recorte das subseções 2.6 e
 * 6.2.
 *
 * "Aconteceu no mês" é o período INTERSECTAR o mês, e não começar nele: um curso
 * de 20 de junho a 10 de julho é atividade dos dois meses, e o relatório de
 * julho que o omitisse estaria errado. Curso ainda sem data não entra, e é a
 * resposta certa: uma capacitação prevista sem período marcado não aconteceu em
 * mês nenhum.
 */
controller.listarDoMes = async (ano, mes, tipoId) => {
  const dois = n => String(n).padStart(2, '0')
  const ultimoDia = new Date(ano, mes, 0).getDate()

  return db.conn.any(
    `SELECT ${colunas} ${de}
     WHERE c.tipo_id = $<tipoId>
       AND c.data_inicio IS NOT NULL
       AND c.data_inicio <= $<fimDoMes>::date
       AND COALESCE(c.data_fim, c.data_inicio) >= $<inicioDoMes>::date
     ORDER BY c.data_inicio, c.nome`,
    {
      tipoId,
      inicioDoMes: `${ano}-${dois(mes)}-01`,
      fimDoMes: `${ano}-${dois(mes)}-${dois(ultimoDia)}`
    }
  )
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(`SELECT ${colunas} ${de} WHERE c.id = $<id>`, { id })
}

controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM rpcmtec.capacitacao ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

const nulo = v => (v === undefined || v === '' ? null : v)

const paraBanco = (dados, usuarioUuid) => ({
  ano: dados.ano,
  nome: dados.nome,
  tipoId: dados.tipo_id,
  situacaoId: dados.situacao_id,
  instituicoes: nulo(dados.instituicoes),
  localRealizacao: nulo(dados.local_realizacao),
  dataInicio: nulo(dados.data_inicio),
  dataFim: nulo(dados.data_fim),
  efetivoCapacitado: nulo(dados.efetivo_capacitado),
  planoCodigo: nulo(dados.plano_codigo),
  documento: nulo(dados.documento),
  metaPitId: nulo(dados.meta_pit_id),
  usuarioUuid
})

// A LINHA SINTÉTICA do rastro: quem está ligado, descrito em texto. O
// `capacitacao_id` vai nela porque é dele que o mapa tira o agregado dono.
const lerLinhaDosMilitares = async (t, capacitacaoId) => {
  const linhas = await t.any(
    `SELECT pg.nome_abrev, u.nome_guerra
     FROM rpcmtec.capacitacao_militar AS cm
     INNER JOIN dgeo.usuario AS u ON u.uuid = cm.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     WHERE cm.capacitacao_id = $<capacitacaoId>
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { capacitacaoId }
  )
  return {
    capacitacao_id: capacitacaoId,
    militares: linhas.map(l => `${l.nome_abrev} ${l.nome_guerra}`.trim())
  }
}

// Regrava a lista inteira. `ON CONFLICT DO NOTHING` não é usado de propósito: o
// DELETE mais INSERT é o que faz remover alguém funcionar, e a lista é pequena.
const gravarMilitares = async (t, capacitacaoId, uuids) => {
  await t.none(
    'DELETE FROM rpcmtec.capacitacao_militar WHERE capacitacao_id = $<capacitacaoId>',
    { capacitacaoId }
  )
  for (const uuid of uuids || []) {
    await t.none(
      `INSERT INTO rpcmtec.capacitacao_militar (capacitacao_id, usuario_uuid)
       VALUES ($<capacitacaoId>, $<uuid>)`,
      { capacitacaoId, uuid }
    )
  }
}

// Só registra quando a lista MUDOU. Salvar o cabeçalho sem mexer nos militares
// não pode produzir uma linha de histórico dizendo que eles mudaram.
const registrarMilitares = async (t, antes, depois, usuarioUuid, contexto) => {
  if (JSON.stringify(antes.militares) === JSON.stringify(depois.militares)) return

  await auditoriaCtrl.registrar(t, {
    tabela: 'rpcmtec.capacitacao_militar',
    operacao: antes.militares.length ? 'U' : 'I',
    antes: antes.militares.length ? antes : undefined,
    depois,
    usuarioUuid,
    contexto
  })
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criada = await t.one(
      `INSERT INTO rpcmtec.capacitacao
         (ano, nome, tipo_id, situacao_id, instituicoes, local_realizacao,
          data_inicio, data_fim, efetivo_capacitado, plano_codigo,
          documento, meta_pit_id, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<nome>, $<tipoId>, $<situacaoId>, $<instituicoes>, $<localRealizacao>,
               $<dataInicio>, $<dataFim>, $<efetivoCapacitado>, $<planoCodigo>,
               $<documento>, $<metaPitId>, $<usuarioUuid>)
       RETURNING *`,
      paraBanco(dados, usuarioUuid)
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.capacitacao',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    await gravarMilitares(t, criada.id, dados.militares)
    const depoisMilitares = await lerLinhaDosMilitares(t, criada.id)
    await registrarMilitares(
      t, { capacitacao_id: criada.id, militares: [] }, depoisMilitares,
      usuarioUuid, contexto
    )

    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.capacitacao', id, 'Capacitação'
    )
    const militaresAntes = await lerLinhaDosMilitares(t, id)

    const depois = await t.one(
      `UPDATE rpcmtec.capacitacao
       SET ano = $<ano>, nome = $<nome>, tipo_id = $<tipoId>, situacao_id = $<situacaoId>,
           instituicoes = $<instituicoes>, local_realizacao = $<localRealizacao>,
           data_inicio = $<dataInicio>, data_fim = $<dataFim>,
           efetivo_capacitado = $<efetivoCapacitado>,
           plano_codigo = $<planoCodigo>, documento = $<documento>,
           meta_pit_id = $<metaPitId>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...paraBanco(dados, usuarioUuid), id, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.capacitacao',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    await gravarMilitares(t, id, dados.militares)
    const militaresDepois = await lerLinhaDosMilitares(t, id)
    await registrarMilitares(t, militaresAntes, militaresDepois, usuarioUuid, contexto)

    return { id: depois.id }
  })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.capacitacao', id, 'Capacitação'
    )
    const militaresAntes = await lerLinhaDosMilitares(t, id)

    // Os vínculos saem por ON DELETE CASCADE, mas o rastro deles é registrado
    // ANTES: quem apaga o banco não escreve evento nenhum, e sem esta linha a
    // lista de quem participou sumiria sem deixar marca.
    if (militaresAntes.militares.length) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'rpcmtec.capacitacao_militar',
        operacao: 'D',
        antes: militaresAntes,
        usuarioUuid,
        contexto
      })
    }

    await t.none('DELETE FROM rpcmtec.capacitacao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.capacitacao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
