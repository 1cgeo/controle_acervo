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
 *
 * O MÊS INTEIRO E O MÊS DECORRIDO SAEM JUNTOS, e os dois têm leitor:
 *
 *   `aproveitamento`            denominador = mês inteiro. É o número da 6.1, e
 *                               não muda depois que o mês fecha.
 *   `aproveitamento_decorrido`  denominador = os dias até HOJE. É o número do
 *                               dashboard.
 *
 * A razão de existirem os dois é que a passagem em aberto (`data_fim` NULA)
 * cobre o mês inteiro, inclusive o que não aconteceu: em 07 de agosto a conta do
 * mês inteiro já dava 31 de 31 dias a 100%, e a tela publicava uma PROJEÇÃO com
 * cara de medida. A 6.1 nunca sofreu com isso porque só se gera com o mês
 * fechado, e aí as duas contas coincidem.
 *
 * Num mês inteiramente no futuro nada decorreu, e `aproveitamento_decorrido` sai
 * NULO, e não zero: "não deu para medir" e "mediu zero" são coisas diferentes, e
 * escrevê-las igual é o que faria a tela afirmar que ninguém rendeu nada.
 *
 * `dias_perdidos` É A MESMA CONTA VISTA AO CONTRÁRIO, em dias-militar: dos dias
 * em que a pessoa esteve aqui, quantos o impedimento consumiu. É o número que
 * responde "quanto custou", que o percentual médio não responde.
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
         ROUND(COALESCE(SUM(b.disponibilidade), 0)::numeric / COUNT(*), 1) AS aproveitamento,
         COUNT(*) FILTER (WHERE b.dia <= CURRENT_DATE)::int AS dias_decorridos,
         COUNT(b.disponibilidade) FILTER (WHERE b.dia <= CURRENT_DATE)::int
           AS dias_na_dgeo_decorridos,
         -- NULLIF, e nao COALESCE: mes inteiramente no futuro devolve NULO.
         ROUND(
           COALESCE(SUM(b.disponibilidade) FILTER (WHERE b.dia <= CURRENT_DATE), 0)::numeric
           / NULLIF(COUNT(*) FILTER (WHERE b.dia <= CURRENT_DATE), 0), 1
         ) AS aproveitamento_decorrido,
         -- Dias de presenca menos dias de disponibilidade integral. Casa
         -- exatamente com a soma dos \`dias_perdidos\` dos impedimentos abaixo.
         ROUND(
           COUNT(b.disponibilidade) FILTER (WHERE b.dia <= CURRENT_DATE)
           - COALESCE(SUM(b.disponibilidade) FILTER (WHERE b.dia <= CURRENT_DATE), 0) / 100.0,
           2
         ) AS dias_perdidos
       FROM base AS b
       GROUP BY b.usuario_uuid
     ),
     -- Os dias que a pessoa ESTEVE aqui e que ja aconteceram. E a janela em que
     -- faz sentido dizer que um impedimento consumiu alguma coisa.
     presenca AS (
       SELECT b.usuario_uuid, b.dia
       FROM base AS b
       WHERE b.disponibilidade IS NOT NULL AND b.dia <= CURRENT_DATE
     ),
     -- RATEIO PROPORCIONAL no dia em que os impedimentos somam mais de 100%.
     -- A leitura trunca a perda em 100% (ninguem fica com -50% de
     -- disponibilidade), e sem o rateio a soma das causas passaria do total: LTSP
     -- integral mais chefia de secao dariam 1,5 dia perdido num dia de 1.
     --
     -- \`bruta\` nunca e zero: \`percentual\` e CHECK (1..100) no DDL.
     imped_dia AS (
       SELECT p.usuario_uuid, p.dia, i.id,
              i.percentual::numeric AS percentual,
              SUM(i.percentual) OVER (PARTITION BY p.usuario_uuid, p.dia)::numeric AS bruta
       FROM presenca AS p
       INNER JOIN dgeo.impedimento AS i
         ON i.usuario_uuid = p.usuario_uuid
        AND p.dia >= i.data_inicio
        AND (i.data_fim IS NULL OR p.dia <= i.data_fim)
     ),
     perda_por_impedimento AS (
       SELECT usuario_uuid, id,
              SUM(percentual * LEAST(100::numeric, bruta) / bruta / 100) AS dias_perdidos
       FROM imped_dia
       GROUP BY usuario_uuid, id
     )
     SELECT
       r.usuario_uuid,
       u.nome, u.nome_guerra, u.login, u.ativo,
       pg.nome_abrev AS posto_abrev, pg.nome AS posto,
       r.dias_do_mes, r.dias_na_dgeo, r.aproveitamento,
       r.dias_decorridos, r.dias_na_dgeo_decorridos, r.aproveitamento_decorrido,
       r.dias_perdidos,
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
                'data_fim', i.data_fim::text,
                -- ZERO, e nao nulo, quando o impedimento cruza o mes mas ainda
                -- nao consumiu dia nenhum: ele existe e nao custou nada.
                'dias_perdidos', ROUND(COALESCE(pi.dias_perdidos, 0), 2)
              ) ORDER BY i.data_inicio) AS lista
       FROM dgeo.impedimento AS i
       LEFT JOIN perda_por_impedimento AS pi
         ON pi.usuario_uuid = i.usuario_uuid AND pi.id = i.id
       WHERE i.usuario_uuid = r.usuario_uuid
         AND i.data_inicio <= $<fim>::date
         AND (i.data_fim IS NULL OR i.data_fim >= $<inicio>::date)
     ) AS imp ON TRUE
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { inicio, fim }
  )
}

/**
 * Quem PODE ENTRAR no SCA e não consta na Divisão no mês.
 *
 * Ou a passagem não foi lançada, e a pessoa fica fora do mapa fazendo o número
 * da Divisão cair por ausência, ou ela saiu e o acesso ficou aberto, que é risco
 * de acesso. Nos dois casos há trabalho a fazer, e é por isso que esta é a única
 * divergência que a tela nomeia.
 *
 * O CONTRÁRIO NÃO É DIVERGÊNCIA, e não entra aqui: `dgeo.usuario.ativo` é flag
 * de LOGIN, a maioria do efetivo não usa o SCA, e listar "está na Divisão e não
 * tem conta" encheria a tela com quase a Divisão inteira.
 *
 * NASCEU DENTRO DO MÓDULO EFETIVO de propósito. A conta era feita no cliente a
 * partir de `GET /usuarios`, que é `verifyAdmin` e devolve login, flag de
 * administrador e o perfil em cada módulo de todo mundo: para contar três nomes,
 * a tela pedia o cadastro inteiro e trancava o próprio dashboard do efetivo atrás
 * do administrador global. Aqui sai `posto_abrev` e `nome_guerra`, que é o que a
 * tela desenha, e mais nada.
 */
controller.divergenciasDoMes = async (ano, mes) => {
  return db.conn.any(
    `SELECT u.uuid AS usuario_uuid, u.nome_guerra, pg.nome_abrev AS posto_abrev
     FROM dgeo.usuario AS u
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     WHERE u.ativo IS TRUE
       AND NOT EXISTS (
         SELECT 1 FROM dgeo.efetivo_periodo AS p
         WHERE p.usuario_uuid = u.uuid
           AND p.data_inicio <= $<fim>::date
           AND (p.data_fim IS NULL OR p.data_fim >= $<inicio>::date)
       )
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { inicio: inicioDoMes(ano, mes), fim: fimDoMes(ano, mes) }
  )
}

/**
 * O CADASTRO MÍNIMO de militar para a tela do efetivo.
 *
 * POR QUE ELA EXISTE. A tela `#/aproveitamento` montava o seletor de militar e a
 * conta de divergência a partir de `GET /api/usuarios`, que é `verifyAdmin`.
 * Como as chamadas saem no mesmo `Promise.all` das rotas de `/efetivo`, o
 * gerente do efetivo recebia 403 numa delas e a tela inteira morria dizendo que
 * é preciso ser administrador. O dado que faltava era o nome de seis colunas, e
 * o preço cobrado era a flag global.
 *
 * O RECORTE DE CAMPO É O QUE PERMITE BAIXAR A GUARDA, e não o contrário. Daqui
 * saem `uuid`, `nome`, `nome_guerra`, `tipo_posto_grad_id`, `tipo_posto_grad` e
 * `ativo`, que é o que a tela desenha. NÃO saem `login`, `administrador`,
 * `senha_definida` nem os perfis por módulo: esses são cadastro de PLATAFORMA,
 * dizem quem manda no sistema, e continuam só em `GET /api/usuarios`, sob
 * `verifyAdmin`. Acrescentar qualquer um deles aqui é reabrir o buraco que esta
 * rota fecha.
 *
 * `ativo` VEM JUNTO porque é flag de LOGIN, e é ela que a tela usa para separar
 * "conta que pode entrar e não consta na Divisão" (a divergência) de conta
 * desligada. Sem ela a lista de divergência teria de ser recalculada no cliente.
 *
 * A ORDEM é a HIERARQUIA (posto decrescente, depois nome de guerra), a mesma de
 * `mapaAnual`, `resumoAnual` e `resumoMensal`. Alfabética pelo nome misturaria
 * coronel e soldado, e o seletor desta tela fica ao lado do mapa: duas ordens
 * diferentes na mesma tela leem-se como lista errada.
 */
controller.listarMilitares = async () => {
  return db.conn.any(
    `SELECT u.uuid, u.nome, u.nome_guerra, u.tipo_posto_grad_id,
            pg.nome_abrev AS tipo_posto_grad, u.ativo
     FROM dgeo.usuario AS u
     INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
     ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`
  )
}

// --- O DONO do registro ------------------------------------------------------

/**
 * A linha é da pessoa do TOKEN, ou ela não existe para quem perguntou.
 *
 * POR QUE ISTO EXISTE. As rotas de terceiro (`PUT /efetivo/periodos/:id`)
 * autorizam pelo `:id` sozinho, e podem: quem chega lá já é gerente do Efetivo,
 * e o trabalho dele é justamente mexer no registro dos outros. As rotas do
 * PRÓPRIO (`/efetivo/meu_periodo`) passam por `verifyAcesso`, que só pergunta se
 * a pessoa entrou no sistema: ali o `:id` é a ÚNICA coisa que endereça a linha, e
 * sem esta conferência qualquer pessoa logada editaria a passagem de qualquer
 * outra trocando um número na URL.
 *
 * 404, E NÃO 403, e a diferença não é cosmética: o 403 confirmaria que a linha
 * existe. A mensagem é a MESMA de `auditoriaCtrl.lerAntes`, de propósito -- id
 * inexistente e id alheio têm de se ler iguais do lado de fora, senão a resposta
 * vira um oráculo de "quantas passagens a Divisão tem".
 *
 * `donoUuid` NULO desliga a conferência, e é o caso das rotas de gerente. O
 * default é o desligado porque quem escreve rota do próprio passa o uuid
 * explicitamente; esquecê-lo numa rota de terceiro não muda nada, e esquecê-lo
 * numa rota do próprio é o erro que o teste de guarda cobra.
 */
const exigirDono = (linha, donoUuid, nomeAmigavel) => {
  if (donoUuid && linha.usuario_uuid !== donoUuid) {
    throw new AppError(`${nomeAmigavel} não encontrado(a)`, httpCode.NotFound)
  }
}

// --- Períodos ----------------------------------------------------------------

// O recorte da listagem, montado a partir das condições que de fato vieram. As
// duas listas (a da Divisão e a do próprio) leem a MESMA consulta: separá-las em
// dois SQL faria a ficha de `#/perfil` divergir da tela `#/aproveitamento` na
// primeira coluna nova.
const ondeDe = condicoes => (condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '')

controller.listarPeriodos = async (ano, usuarioUuid = null) => {
  const condicoes = []
  if (ano) {
    condicoes.push(`p.data_inicio <= $<fim>::date
         AND (p.data_fim IS NULL OR p.data_fim >= $<inicio>::date)`)
  }
  if (usuarioUuid) condicoes.push('p.usuario_uuid = $<usuarioUuid>')

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
     ${ondeDe(condicoes)}
     ORDER BY p.data_inicio DESC, u.nome_guerra`,
    {
      inicio: ano ? primeiroDia(ano) : null,
      fim: ano ? ultimoDia(ano) : null,
      usuarioUuid
    }
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

controller.atualizarPeriodo = async (id, dados, usuarioUuid, contexto, donoUuid = null) => {
  try {
    return await db.conn.tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t, 'dgeo.efetivo_periodo', id, 'Passagem pela DGEO'
      )

      // DENTRO da transação, e sobre a linha que o `lerAntes` já trouxe: uma
      // segunda ida ao banco só para conferir o dono leria um estado que pode
      // não ser o que o UPDATE abaixo alcança.
      exigirDono(antes, donoUuid, 'Passagem pela DGEO')

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

controller.deletarPeriodo = async (id, usuarioUuid, contexto, donoUuid = null) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'dgeo.efetivo_periodo', id, 'Passagem pela DGEO'
    )

    exigirDono(antes, donoUuid, 'Passagem pela DGEO')

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

controller.listarImpedimentos = async (ano, usuarioUuid = null) => {
  const condicoes = []
  if (ano) {
    condicoes.push(`i.data_inicio <= $<fim>::date
         AND (i.data_fim IS NULL OR i.data_fim >= $<inicio>::date)`)
  }
  if (usuarioUuid) condicoes.push('i.usuario_uuid = $<usuarioUuid>')

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
     ${ondeDe(condicoes)}
     ORDER BY i.data_inicio DESC, u.nome_guerra`,
    {
      inicio: ano ? primeiroDia(ano) : null,
      fim: ano ? ultimoDia(ano) : null,
      usuarioUuid
    }
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

controller.atualizarImpedimento = async (id, dados, usuarioUuid, contexto, donoUuid = null) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'dgeo.impedimento', id, 'Impedimento'
    )

    exigirDono(antes, donoUuid, 'Impedimento')

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

controller.deletarImpedimento = async (id, usuarioUuid, contexto, donoUuid = null) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'dgeo.impedimento', id, 'Impedimento'
    )

    exigirDono(antes, donoUuid, 'Impedimento')

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
