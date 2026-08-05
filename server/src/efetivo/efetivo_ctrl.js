'use strict'

// Aproveitamento do efetivo, por INTERVALO.
//
// Duas tabelas de fato e nenhuma de resumo: `dgeo.efetivo_periodo` diz quando a
// pessoa esteve na Divisão, e `dgeo.impedimento` diz o que a tirou do trabalho
// sem tirá-la da Divisão. Mês, semana e ano são CONSULTA, e não dado.
//
// A CONTA É POR DIA, e a razão é o mês quebrado. Quem chegou em 06 de março
// rendeu 26 dias de 31 naquele mês, e nenhuma agregação mais grossa sabe disso.
// Trinta pessoas por 365 dias são onze mil linhas na consulta mais larga desta
// tela, o que é irrelevante para o Postgres e é o que compra a resposta exata.
//
// DIA CORRIDO, e não dia útil. O numerador e o denominador usam a mesma régua, e
// dia útil exigiria um calendário de feriados só para mudar o denominador.
//
// A DISPONIBILIDADE TEM TRÊS ESTADOS, e confundir os dois últimos é o erro que a
// tela existe para não cometer:
//   NULL  a pessoa não estava na Divisão naquele dia
//   0     estava, e um impedimento consumiu o dia inteiro
//   1..100  estava, com o que sobrou depois dos impedimentos

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

/**
 * A disponibilidade de cada pessoa em cada DIA do recorte.
 *
 * É a base de tudo o que esta tela mostra, e por isso mora numa constante só:
 * o mapa do ano, o resumo do mês e a subseção 6.1 do RPCMTec agregam ESTE
 * resultado de três jeitos diferentes. Três consultas parecidas divergiriam na
 * primeira regra nova.
 *
 * A grade é o produto cartesiano PESSOA x DIA, e não os dias de presença: sem
 * ela, quem esteve ausente o mês inteiro sumiria da lista em vez de aparecer
 * com zero, e a média da Divisão subiria por desaparecimento.
 */
const DISPONIBILIDADE_POR_DIA = `
  WITH dias AS (
    SELECT d::date AS dia
    FROM generate_series($<inicio>::date, $<fim>::date, INTERVAL '1 day') AS d
  ),
  -- Quem teve QUALQUER passagem que cruza o recorte. Alguém cujo período inteiro
  -- é de outro ano não entra na tela deste ano.
  pessoas AS (
    SELECT DISTINCT p.usuario_uuid
    FROM dgeo.efetivo_periodo AS p
    WHERE p.data_inicio <= $<fim>::date
      AND (p.data_fim IS NULL OR p.data_fim >= $<inicio>::date)
  ),
  grade AS (
    SELECT pe.usuario_uuid, d.dia
    FROM pessoas AS pe
    CROSS JOIN dias AS d
  )
  SELECT
    g.usuario_uuid,
    g.dia,
    CASE
      WHEN p.id IS NULL THEN NULL
      -- O truncamento em 100 é o que permite impedimentos sobrepostos: LTSP
      -- integral mais chefia de seção somam 150, e ninguém fica com -50% de
      -- disponibilidade.
      ELSE GREATEST(0, 100 - LEAST(100, COALESCE(im.perda, 0)))
    END AS disponibilidade
  FROM grade AS g
  LEFT JOIN dgeo.efetivo_periodo AS p
    ON p.usuario_uuid = g.usuario_uuid
   AND g.dia >= p.data_inicio
   AND (p.data_fim IS NULL OR g.dia <= p.data_fim)
  LEFT JOIN LATERAL (
    SELECT SUM(i.percentual)::int AS perda
    FROM dgeo.impedimento AS i
    WHERE i.usuario_uuid = g.usuario_uuid
      AND g.dia >= i.data_inicio
      AND (i.data_fim IS NULL OR g.dia <= i.data_fim)
  ) AS im ON TRUE
`

const primeiroDia = ano => `${ano}-01-01`
const ultimoDia = ano => `${ano}-12-31`

const inicioDoMes = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}-01`
const fimDoMes = (ano, mes) => {
  const ultimo = new Date(ano, mes, 0).getDate()
  return `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
}

// --- Leitura -----------------------------------------------------------------

/**
 * O mapa do ano: uma linha por pessoa, uma célula por SEMANA.
 *
 * A semana é o bloco de sete dias contado a partir de 1º de janeiro, e não a
 * semana ISO. A ISO empresta dias do ano vizinho, e a primeira e a última coluna
 * do mapa passariam a misturar dois anos: numa tela cujo recorte é o ANO, isso
 * se lê como erro de conta.
 *
 * A célula é a MÉDIA da disponibilidade nos dias da semana, com dia fora da
 * Divisão contando ZERO no numerador mas SIM no denominador da semana. É o que
 * faz a semana de chegada aparecer parcial, que é a verdade.
 *
 * `dias` E `dias_na_dgeo` SAIEM JUNTOS, e a tela mostra os dois: 5 de 7 dias a
 * 100% dão a mesma célula que 7 de 7 dias a 71%, e só o denominador separa
 * "chegou na quarta" de "esteve e não rendeu".
 *
 * O QUE ESTA CONSULTA NÃO DEVOLVE: `u.nome`, `u.login` e o nome por extenso do
 * posto. A tela desenha `posto_abrev` e `nome_guerra`, e mais nada. Dado de
 * pessoal que trafega sem uso é vazamento à espera de um log. Quem escreve o
 * nome por extenso é a 6.1 do RPCMTec, por `resumoMensal`.
 */
controller.mapaAnual = async ano => {
  return db.conn.any(
    `WITH base AS (${DISPONIBILIDADE_POR_DIA})
     SELECT
       b.usuario_uuid,
       u.nome_guerra, u.ativo,
       pg.nome_abrev AS posto_abrev,
       u.tipo_posto_grad_id,
       (EXTRACT(DOY FROM b.dia)::int - 1) / 7 + 1 AS semana,
       COUNT(*)::int AS dias,
       COUNT(b.disponibilidade)::int AS dias_na_dgeo,
       ROUND(COALESCE(SUM(b.disponibilidade), 0)::numeric / COUNT(*), 1) AS disponibilidade
     FROM base AS b
     INNER JOIN dgeo.usuario AS u ON u.uuid = b.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     GROUP BY b.usuario_uuid, u.nome_guerra, u.ativo,
              pg.nome_abrev, u.tipo_posto_grad_id, semana
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra, semana`,
    { inicio: primeiroDia(ano), fim: ultimoDia(ano) }
  )
}

/**
 * O aproveitamento de cada pessoa no ANO, que é o número do fechamento anual
 * ("2º Sgt Barreto, 17%").
 *
 * O denominador é o ano INTEIRO, e não os dias de presença: é isso que faz quem
 * chegou em março aparecer com 17% em vez de 100%. Quem só quer a média de quem
 * estava tem `dias_na_dgeo` ao lado para fazer a outra conta, e é essa a conta
 * que a tela usa para ponderar a média da Divisão.
 *
 * Sem `u.nome`, `u.login` e o posto por extenso, pelo mesmo motivo do
 * `mapaAnual`: a tela não os desenha.
 */
controller.resumoAnual = async ano => {
  return db.conn.any(
    `WITH base AS (${DISPONIBILIDADE_POR_DIA})
     SELECT
       b.usuario_uuid,
       u.nome_guerra, u.ativo,
       pg.nome_abrev AS posto_abrev,
       COUNT(*)::int AS dias_do_ano,
       COUNT(b.disponibilidade)::int AS dias_na_dgeo,
       ROUND(COALESCE(SUM(b.disponibilidade), 0)::numeric / COUNT(*), 1) AS aproveitamento
     FROM base AS b
     INNER JOIN dgeo.usuario AS u ON u.uuid = b.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     GROUP BY b.usuario_uuid, u.nome_guerra, u.ativo,
              pg.nome_abrev, u.tipo_posto_grad_id
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { inicio: primeiroDia(ano), fim: ultimoDia(ano) }
  )
}

/**
 * O efetivo de UM mês, com o aproveitamento e os impedimentos que o explicam.
 *
 * É o que alimenta a subseção 6.1 do RPCMTec. Os impedimentos vêm em lista, e
 * não concatenados: quem monta a frase é o gerador, e quem monta a tela é a
 * tela.
 *
 * ESTA MANTÉM `u.nome` E O POSTO POR EXTENSO, ao contrário das duas de cima. O
 * documento escreve "1º Ten Pedro Martins" por extenso, e cortar as colunas das
 * três de uma vez quebraria a 6.1 sem erro visível.
 */
controller.resumoMensal = async (ano, mes) => {
  const inicio = inicioDoMes(ano, mes)
  const fim = fimDoMes(ano, mes)

  return db.conn.any(
    `WITH base AS (${DISPONIBILIDADE_POR_DIA}),
     resumo AS (
       SELECT
         b.usuario_uuid,
         COUNT(*)::int AS dias_do_mes,
         COUNT(b.disponibilidade)::int AS dias_na_dgeo,
         ROUND(COALESCE(SUM(b.disponibilidade), 0)::numeric / COUNT(*), 1) AS aproveitamento
       FROM base AS b
       GROUP BY b.usuario_uuid
     )
     SELECT
       r.usuario_uuid,
       u.nome, u.nome_guerra, u.login, u.ativo,
       pg.nome_abrev AS posto_abrev, pg.nome AS posto,
       r.dias_do_mes, r.dias_na_dgeo, r.aproveitamento,
       COALESCE(imp.lista, '[]'::json) AS impedimentos
     FROM resumo AS r
     INNER JOIN dgeo.usuario AS u ON u.uuid = r.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'id', i.id,
                'descricao', i.descricao,
                'percentual', i.percentual,
                'data_inicio', i.data_inicio::text,
                'data_fim', i.data_fim::text
              ) ORDER BY i.data_inicio) AS lista
       FROM dgeo.impedimento AS i
       WHERE i.usuario_uuid = r.usuario_uuid
         AND i.data_inicio <= $<fim>::date
         AND (i.data_fim IS NULL OR i.data_fim >= $<inicio>::date)
     ) AS imp ON TRUE
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { inicio, fim }
  )
}

// --- Períodos ----------------------------------------------------------------

controller.listarPeriodos = async ano => {
  const filtro = ano
    ? `WHERE p.data_inicio <= $<fim>::date
         AND (p.data_fim IS NULL OR p.data_fim >= $<inicio>::date)`
    : ''

  return db.conn.any(
    `SELECT p.id, p.usuario_uuid, p.data_inicio::text AS data_inicio,
            p.data_fim::text AS data_fim, p.observacao,
            u.nome, u.nome_guerra, u.login, u.ativo,
            pg.nome_abrev AS posto_abrev,
            p.data_cadastramento, p.usuario_cadastramento_uuid,
            p.data_modificacao, p.usuario_modificacao_uuid
     FROM dgeo.efetivo_periodo AS p
     INNER JOIN dgeo.usuario AS u ON u.uuid = p.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     ${filtro}
     ORDER BY p.data_inicio DESC, u.nome_guerra`,
    ano ? { inicio: primeiroDia(ano), fim: ultimoDia(ano) } : {}
  )
}

// A violação do EXCLUDE chega como 23P01 (exclusion_violation), e o 500 cru dela
// cita o nome da restrição. A frase abaixo diz o que fazer, que é o que a pessoa
// precisa: ela acabou de tentar cadastrar uma passagem por cima de outra.
const traduzirSobreposicao = err => {
  if (err && err.code === '23P01') {
    return new AppError(
      'Este militar já tem uma passagem pela DGEO que cobre parte deste período. Ajuste a data de saída da passagem anterior antes de criar a nova.',
      httpCode.Conflict,
      err
    )
  }
  return err
}

controller.criarPeriodo = async (dados, usuarioUuid, contexto) => {
  try {
    return await db.conn.tx(async t => {
      const criado = await t.one(
        `INSERT INTO dgeo.efetivo_periodo
           (usuario_uuid, data_inicio, data_fim, observacao, usuario_cadastramento_uuid)
         VALUES ($<usuarioAlvo>, $<dataInicio>, $<dataFim>, $<observacao>, $<usuarioUuid>)
         RETURNING *`,
        {
          usuarioAlvo: dados.usuario_uuid,
          dataInicio: dados.data_inicio,
          dataFim: dados.data_fim === undefined ? null : dados.data_fim,
          observacao: dados.observacao === undefined ? null : dados.observacao,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'dgeo.efetivo_periodo',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      })

      return { id: criado.id }
    })
  } catch (err) {
    throw traduzirSobreposicao(err)
  }
}

controller.atualizarPeriodo = async (id, dados, usuarioUuid, contexto) => {
  try {
    return await db.conn.tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t, 'dgeo.efetivo_periodo', id, 'Passagem pela DGEO'
      )

      // O MILITAR não se troca numa passagem existente: seria reescrever de quem
      // é o período, e o caminho certo é excluir e cadastrar de novo.
      const depois = await t.one(
        `UPDATE dgeo.efetivo_periodo
         SET data_inicio = $<dataInicio>, data_fim = $<dataFim>,
             observacao = $<observacao>,
             data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          dataInicio: dados.data_inicio,
          dataFim: dados.data_fim === undefined ? null : dados.data_fim,
          observacao: dados.observacao === undefined ? null : dados.observacao,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'dgeo.efetivo_periodo',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })

      return { id: depois.id }
    })
  } catch (err) {
    throw traduzirSobreposicao(err)
  }
}

controller.deletarPeriodo = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'dgeo.efetivo_periodo', id, 'Passagem pela DGEO'
    )

    await t.none('DELETE FROM dgeo.efetivo_periodo WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'dgeo.efetivo_periodo',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

// --- Impedimentos ------------------------------------------------------------

controller.listarImpedimentos = async ano => {
  const filtro = ano
    ? `WHERE i.data_inicio <= $<fim>::date
         AND (i.data_fim IS NULL OR i.data_fim >= $<inicio>::date)`
    : ''

  return db.conn.any(
    `SELECT i.id, i.usuario_uuid, i.descricao, i.percentual,
            i.data_inicio::text AS data_inicio, i.data_fim::text AS data_fim,
            u.nome, u.nome_guerra, u.login,
            pg.nome_abrev AS posto_abrev,
            i.data_cadastramento, i.usuario_cadastramento_uuid,
            i.data_modificacao, i.usuario_modificacao_uuid
     FROM dgeo.impedimento AS i
     INNER JOIN dgeo.usuario AS u ON u.uuid = i.usuario_uuid
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     ${filtro}
     ORDER BY i.data_inicio DESC, u.nome_guerra`,
    ano ? { inicio: primeiroDia(ano), fim: ultimoDia(ano) } : {}
  )
}

const impedimentoParaBanco = (dados, usuarioUuid) => ({
  usuarioAlvo: dados.usuario_uuid,
  descricao: dados.descricao,
  percentual: dados.percentual,
  dataInicio: dados.data_inicio,
  dataFim: dados.data_fim === undefined ? null : dados.data_fim,
  usuarioUuid
})

controller.criarImpedimento = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criado = await t.one(
      `INSERT INTO dgeo.impedimento
         (usuario_uuid, descricao, percentual, data_inicio, data_fim, usuario_cadastramento_uuid)
       VALUES ($<usuarioAlvo>, $<descricao>, $<percentual>, $<dataInicio>, $<dataFim>, $<usuarioUuid>)
       RETURNING *`,
      impedimentoParaBanco(dados, usuarioUuid)
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'dgeo.impedimento',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    return { id: criado.id }
  })
}

controller.atualizarImpedimento = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'dgeo.impedimento', id, 'Impedimento'
    )

    const depois = await t.one(
      `UPDATE dgeo.impedimento
       SET descricao = $<descricao>, percentual = $<percentual>,
           data_inicio = $<dataInicio>, data_fim = $<dataFim>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...impedimentoParaBanco(dados, usuarioUuid), id, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'dgeo.impedimento',
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

controller.deletarImpedimento = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'dgeo.impedimento', id, 'Impedimento'
    )

    await t.none('DELETE FROM dgeo.impedimento WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'dgeo.impedimento',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
