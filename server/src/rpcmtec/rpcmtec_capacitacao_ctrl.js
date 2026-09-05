'use strict'

// Capacitação: MINISTRADA alimenta a subseção 2.6 e RECEBIDA a 6.2.
//
// UMA TABELA para as duas, porque a linha é o mesmo fato visto dos dois lados:
// um curso tem nome, instituição, local e período em qualquer dos casos. O que
// muda são três colunas, e é o `tipo_id` que diz quais valem. Duas tabelas com
// dez colunas iguais divergiriam na primeira que fosse acrescentada a uma só.
//
// O TIPO VEM DA ROTA, e não do corpo, desde a 1.33.0. Toda função pública daqui
// recebe `tipoId` e opera SÓ dentro dele: quem pede uma capacitação ministrada
// pelo caminho da recebida recebe 404, e não a linha do outro tipo.
//
// POR QUE ISSO É GUARDA, e não organização. A permissão passou a ser POR TIPO
// (ministrada é do operador do PIT, recebida é do operador de Efetivo), e a
// guarda da rota não enxerga o corpo da requisição. Sem o recorte aqui, o
// operador de Efetivo apagaria uma capacitação MINISTRADA mandando o id dela
// para `DELETE /capacitacao/recebida/:id`: a guarda o aprovaria, porque a rota é
// a dele, e o controlador apagaria a linha do outro tipo. O tipo tem de ser
// cobrado onde o dado está, e não só onde a rota está.
//
// `tipoId` é POSICIONAL E OBRIGATÓRIO de propósito, e vem antes do corpo:
// esquecê-lo faz a chamada quebrar, em vez de gravar a linha no tipo errado em
// silêncio.
//
// O SERVIDOR NÃO RECUSA a coluna que não pertence ao tipo, e isso é deliberado.
// Ele não sabe se a linha está sendo montada aos poucos, e recusar
// `efetivo_capacitado` numa capacitação RECEBIDA transformaria em erro o que é
// só um campo que a tela nem mostra. Quem decide o que aparece é o formulário, e
// quem decide o que SAI é o gerador, que lê a coluna certa para cada subseção.
//
// QUEM DA DIVISÃO PARTICIPOU sai de `rpcmtec.capacitacao_militar`, ligado ao
// cadastro, e vale para os dois tipos: na MINISTRADA são os instrutores e
// monitores, na RECEBIDA são os capacitados. O papel não é coluna: ele vem do
// `tipo_id` da própria capacitação.
//
// A LISTA é regravada INTEIRA a cada salvamento, e por isso o rastro dela é UM
// evento do PAI com a lista descrita em texto dos dois lados. Auditar linha a
// linha faria o histórico dizer "removeu 3, acrescentou 3" toda vez que alguém
// abrisse e salvasse. É o mesmo desenho dos itens do DFD.

const { db } = require('../database')

const {
  AppError, httpCode, domainConstants: { SITUACAO_CAPACITACAO }
} = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

const colunas = `c.id, c.ano, c.nome, c.tipo_id, t.nome AS tipo,
  c.situacao_id, s.nome AS situacao, c.instituicoes, c.local_realizacao,
  c.data_inicio::text AS data_inicio, c.data_fim::text AS data_fim,
  c.data_prevista::text AS data_prevista,
  c.efetivo_capacitado, c.plano_codigo, c.documento,
  c.meta_pit_id, mp.item AS meta_pit_item, mg.numero_meta AS meta_pit_numero,
  mg.nome AS meta_pit_nome,
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
  -- O ITEM, e nao o grupo: a capacitacao cumpre a 5.1, e o numero da meta vem
  -- do grupo dela.
  LEFT JOIN pit.meta_item AS mp ON mp.id = c.meta_pit_id
  LEFT JOIN pit.meta AS mg ON mg.id = mp.meta_id
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

// `tipoId` é OBRIGATÓRIO e vem da ROTA. Era filtro opcional de `req.query`, e
// aí a mesma rota devolvia ministrada, recebida ou as duas conforme o que o
// cliente pedisse: com a permissão por tipo, isso vira um caminho de leitura da
// área alheia. O `ano` continua opcional, porque ele não é permissão.
controller.listar = async (ano, tipoId) => {
  return db.conn.any(
    `SELECT ${colunas} ${de}
     WHERE ($<ano>::smallint IS NULL OR c.ano = $<ano>::smallint)
       AND c.tipo_id = $<tipoId>
     ORDER BY c.ano DESC, c.data_inicio NULLS LAST, c.nome`,
    { ano: ano === undefined ? null : ano, tipoId }
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
 *
 * A CANCELADA SAI SEMPRE, e a PREVISTA entra. A 2.6
 * descreve o que a Divisão planejou para o mês, então prever e executar contam
 * do mesmo jeito. O que a Divisão cancelou não é atividade nenhuma, e listá-lo
 * num documento assinado afirma trabalho que não houve.
 */
controller.listarDoMes = async (ano, mes, tipoId) => {
  const dois = n => String(n).padStart(2, '0')
  const ultimoDia = new Date(ano, mes, 0).getDate()

  return db.conn.any(
    `SELECT ${colunas} ${de}
     WHERE c.tipo_id = $<tipoId>
       AND c.situacao_id <> $<cancelada>
       AND c.data_inicio IS NOT NULL
       AND c.data_inicio <= $<fimDoMes>::date
       AND COALESCE(c.data_fim, c.data_inicio) >= $<inicioDoMes>::date
     ORDER BY c.data_inicio, c.nome`,
    {
      tipoId,
      // A CANCELADA sai sempre. O código vem de `utils/domain_constants`, que é
      // a mesma fonte que `pit_execucao_ctrl` lê para excluí-la do planejado da
      // meta: dois números iguais escritos em dois lugares divergem no primeiro
      // que alguém corrigir.
      cancelada: SITUACAO_CAPACITACAO.CANCELADA,
      inicioDoMes: `${ano}-${dois(mes)}-01`,
      fimDoMes: `${ano}-${dois(mes)}-${dois(ultimoDia)}`
    }
  )
}

// Recortado pelo TIPO: um id do outro tipo não é "achado e recusado", ele
// simplesmente NÃO EXISTE por este caminho, e a rota responde 404.
controller.getPorId = async (id, tipoId) => {
  return db.conn.oneOrNone(
    `SELECT ${colunas} ${de} WHERE c.id = $<id> AND c.tipo_id = $<tipoId>`,
    { id, tipoId }
  )
}

// OS ANOS DO TIPO, e não os anos da tabela. Ele alimenta o filtro de ano da
// tela, e a lista única oferecia ano vazio: em 2026-08-06 a produção tinha
// MINISTRADA em oito anos (2013, 2018, 2019, 2022, 2023, 2024, 2025 e 2026) e
// RECEBIDA só em 2026. A tela da recebida oferecia os oito, e sete deles
// respondiam "nenhum registro para estes filtros".
controller.anos = async tipoId => {
  const linhas = await db.conn.any(
    `SELECT DISTINCT ano FROM rpcmtec.capacitacao
     WHERE tipo_id = $<tipoId> ORDER BY ano DESC`,
    { tipoId }
  )
  return linhas.map(l => l.ano)
}

const nulo = v => (v === undefined || v === '' ? null : v)

/**
 * O vínculo com o PIT que o UPDATE deve gravar: a meta e o mês prometido.
 *
 * OS DOIS CAMPOS ANDAM JUNTOS, e por isso a mesma regra vale para os dois.
 * `meta_pit_id` diz QUAL meta a capacitação cumpre e `data_prevista` diz em que
 * mês ela promete terminar, que é de onde a grade tira o planejado. Preservar um
 * e apagar o outro deixaria a capacitação ligada à meta sem mês, que conta zero
 * no plano e não acusa nada.
 *
 * A CHAVE AUSENTE PRESERVA, o `null` explícito desliga. São coisas diferentes,
 * e tratá-las igual apagava o vínculo em silêncio: o formulário da tela não tem
 * o campo, então toda edição do nome ou da data zerava o `meta_pit_id`, e a
 * execução da meta 5 do PIT (`pit_execucao_ctrl`) caía sem nada acusar.
 *
 * A DISTINÇÃO MORA AQUI, NO CONTROLLER, e não no schema Joi. O Joi só enxerga o
 * corpo da requisição: ele sabe dizer que a chave é opcional, e nunca "mantenha
 * o que está gravado", porque o valor gravado não passa por ele. O dever do
 * schema é NEGATIVO, e vale cobrá-lo em revisão: `meta_pit_id` não pode ganhar
 * `.default(...)` em `rpcmtec_schema.js`, senão o Joi injeta a chave, ela nunca
 * chega ausente e esta preservação deixa de acontecer. É a mesma regra do
 * `utils/preserve_omitted`, que resolve o problema idêntico do acervo.
 *
 * A linha ANTERIOR já foi lida na mesma transação, para o rastro: preservar
 * daqui custa zero consulta a mais.
 *
 * @param {Object} dados - o corpo já validado
 * @param {Object} antes - a linha como está no banco
 * @param {string} campo - o nome da coluna
 * @returns {*} o valor a gravar
 */
const preservarSeAusente = (dados, antes, campo) =>
  dados[campo] === undefined ? antes[campo] : nulo(dados[campo])

// `tipoId` vem da ROTA, e não de `dados`: o corpo não carrega mais `tipo_id`.
const paraBanco = (dados, tipoId, usuarioUuid) => ({
  ano: dados.ano,
  nome: dados.nome,
  tipoId,
  situacaoId: dados.situacao_id,
  instituicoes: nulo(dados.instituicoes),
  localRealizacao: nulo(dados.local_realizacao),
  dataInicio: nulo(dados.data_inicio),
  dataFim: nulo(dados.data_fim),
  efetivoCapacitado: nulo(dados.efetivo_capacitado),
  planoCodigo: nulo(dados.plano_codigo),
  documento: nulo(dados.documento),
  metaPitId: nulo(dados.meta_pit_id),
  dataPrevista: nulo(dados.data_prevista),
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
// DELETE mais INSERT é o que faz remover alguém funcionar.
//
// UM insert em lote, e não um por militar. O laço anterior gastava uma ida ao
// banco por uuid, dentro da transação: a lista é limitada pelo efetivo da
// Divisão (dezenas), mas cada ida segura a conexão e o custo cresce com o
// efetivo. `db.pgp.helpers.insert` é o mesmo caminho que mapoteca_ctrl e
// acervo_ctrl já usam para lote.
//
// A lista vazia NÃO chega ao insert: o helper lança se receber array vazio, e
// nesse caso o DELETE acima já é a gravação inteira (a pessoa tirou todo mundo).
const gravarMilitares = async (t, capacitacaoId, uuids) => {
  await t.none(
    'DELETE FROM rpcmtec.capacitacao_militar WHERE capacitacao_id = $<capacitacaoId>',
    { capacitacaoId }
  )

  const lista = uuids || []
  if (!lista.length) return

  const cs = new db.pgp.helpers.ColumnSet(
    ['capacitacao_id', 'usuario_uuid'],
    { table: { table: 'capacitacao_militar', schema: 'rpcmtec' } }
  )
  const linhas = lista.map(uuid => ({
    capacitacao_id: capacitacaoId,
    usuario_uuid: uuid
  }))

  await t.none(db.pgp.helpers.insert(linhas, cs))
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

controller.criar = async (dados, tipoId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criada = await t.one(
      `INSERT INTO rpcmtec.capacitacao
         (ano, nome, tipo_id, situacao_id, instituicoes, local_realizacao,
          data_inicio, data_fim, efetivo_capacitado, plano_codigo,
          documento, meta_pit_id, data_prevista, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<nome>, $<tipoId>, $<situacaoId>, $<instituicoes>, $<localRealizacao>,
               $<dataInicio>, $<dataFim>, $<efetivoCapacitado>, $<planoCodigo>,
               $<documento>, $<metaPitId>, $<dataPrevista>, $<usuarioUuid>)
       RETURNING *`,
      paraBanco(dados, tipoId, usuarioUuid)
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

/**
 * A linha existe E é do tipo desta rota?
 *
 * Vale 404, e não 403, de propósito: pela rota da recebida, a capacitação
 * ministrada não é um registro proibido, é um registro que não está lá. Dizer
 * "proibido" confirmaria a existência dela a quem não pode vê-la.
 *
 * @param {Object} antes - a linha lida na mesma transação
 * @param {number} tipoId - o tipo que a ROTA fixou
 */
const exigirDoTipo = (antes, tipoId) => {
  if (Number(antes.tipo_id) !== Number(tipoId)) {
    throw new AppError('Capacitação não encontrada', httpCode.NotFound)
  }
}

controller.atualizar = async (id, tipoId, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.capacitacao', id, 'Capacitação'
    )
    exigirDoTipo(antes, tipoId)
    const militaresAntes = await lerLinhaDosMilitares(t, id)

    const depois = await t.one(
      `UPDATE rpcmtec.capacitacao
       SET ano = $<ano>, nome = $<nome>, tipo_id = $<tipoId>, situacao_id = $<situacaoId>,
           instituicoes = $<instituicoes>, local_realizacao = $<localRealizacao>,
           data_inicio = $<dataInicio>, data_fim = $<dataFim>,
           efetivo_capacitado = $<efetivoCapacitado>,
           plano_codigo = $<planoCodigo>, documento = $<documento>,
           meta_pit_id = $<metaPitId>, data_prevista = $<dataPrevista>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        ...paraBanco(dados, tipoId, usuarioUuid),
        // Os DOIS campos que a ausência preserva em vez de apagar. Ver
        // `preservarSeAusente`: a tela pode não mandar a chave, e o UPDATE
        // escreve a coluna inteira a cada salvamento.
        metaPitId: preservarSeAusente(dados, antes, 'meta_pit_id'),
        dataPrevista: preservarSeAusente(dados, antes, 'data_prevista'),
        id,
        dataModificacao: new Date()
      }
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

    // A CHAVE AUSENTE PRESERVA A LISTA, e a lista vazia a apaga. É a mesma regra
    // dos dois campos do PIT logo acima, e pelo mesmo motivo: `gravarMilitares`
    // é DELETE mais INSERT, então chamá-lo com `undefined` apagaria a lista
    // inteira de quem só quis corrigir o nome da capacitação. Quem manda `[]`
    // está dizendo "tirei todo mundo", e aí o DELETE é o que se pediu.
    if (dados.militares !== undefined) {
      await gravarMilitares(t, id, dados.militares)
    }
    const militaresDepois = await lerLinhaDosMilitares(t, id)
    await registrarMilitares(t, militaresAntes, militaresDepois, usuarioUuid, contexto)

    return { id: depois.id }
  })
}

controller.deletar = async (id, tipoId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.capacitacao', id, 'Capacitação'
    )
    exigirDoTipo(antes, tipoId)
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
