'use strict'

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')

const { diffCampos } = require('./diff')
const { sanitizar } = require('./sanitizar')
const { entradaDe } = require('./mapa')

const controller = {}

// --- Leitura do estado, antes e depois --------------------------------------

// Identificador de banco: schema, tabela ou coluna. Tudo o que este modulo
// interpola no SQL passa por aqui.
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/

/**
 * Confere um identificador ANTES de interpola-lo no SQL.
 *
 * O nome da TABELA e o das GEOMETRIAS vem do mapa de entidades, que e codigo, e
 * nesse caso isto so acusaria um erro de digitacao. Mas a COLUNA e parametro de
 * funcao (`lerAntes(t, tabela, id, nome, coluna)`), e um chamador futuro pode
 * passar algo que veio do corpo da requisicao sem perceber -- a assinatura nao
 * o impede. Confiar em "o chamador nao faria isso" e exatamente o que produz
 * injecao, e o custo de conferir e uma expressao regular.
 *
 * Falha ALTO, e nao silenciosamente: identificador invalido aqui e defeito de
 * programacao, e degradar para uma consulta vazia esconderia o defeito.
 */
const identificador = (valor, papel) => {
  const texto = String(valor)
  if (!IDENTIFICADOR.test(texto)) {
    throw new Error(`Auditoria: ${papel} invalido: "${texto}"`)
  }
  return texto
}

/**
 * Monta o SELECT de uma linha, resolvendo geometria para EWKT.
 *
 * `SELECT *` numa tabela com coluna geometrica devolve o WKB em hexadecimal, que
 * e ilegivel e longo. As colunas declaradas em `geometrias` saem por
 * ST_AsEWKT com um apelido proprio, e a troca acontece no JS: `SELECT *,
 * ST_AsEWKT(geom) AS geom` teria DUAS colunas com o mesmo nome, e qual delas
 * sobrevive no objeto passa a depender do driver.
 *
 * O ID vai como PARAMETRO (`$<id>`); so os identificadores sao interpolados, e
 * todos passam pela conferencia acima.
 */
const montarSelect = (tabela, coluna, geometrias) => {
  const [schema, nome] = String(tabela).split('.')
  const alvo = `${identificador(schema, 'schema')}.${identificador(nome, 'tabela')}`

  const extras = (geometrias || [])
    .map(g => {
      const col = identificador(g, 'coluna de geometria')
      return `, ST_AsEWKT(t.${col})::text AS "${col}__ewkt"`
    })
    .join('')

  return `SELECT t.*${extras} FROM ${alvo} AS t WHERE t.${identificador(coluna, 'coluna')} = $<id>`
}

const trocarGeometrias = (linha, geometrias) => {
  if (!linha) return linha
  for (const g of geometrias || []) {
    const apelido = `${g}__ewkt`
    if (apelido in linha) {
      linha[g] = linha[apelido]
      delete linha[apelido]
    }
  }
  return linha
}

/**
 * A linha INTEIRA antes da mudanca, e o 404 amigavel de quebra.
 *
 * SUBSTITUI o `SELECT id` que hoje existe em cerca de 20 funcoes so para
 * produzir a mensagem de "nao encontrado". Por isso ela lanca o AppError com a
 * frase que a funcao ja lancava: se fosse mais uma consulta ao lado daquela, o
 * rastro custaria uma ida a mais ao banco em cada uma delas.
 *
 * Recebe `t` (a transacao da mudanca) e nunca abre conexao propria: ler o estado
 * anterior fora da transacao que vai altera-lo deixa uma janela em que outra
 * requisicao muda a linha no meio, e o `dados_antes` passaria a descrever um
 * estado que ninguem viu.
 *
 * @param {object} t - transacao do pg-promise
 * @param {string} tabela - 'schema.tabela', que TEM de estar no mapa
 * @param {string|number} id
 * @param {string} nomeAmigavel - como a mensagem de 404 chama o registro
 * @param {string} [coluna] - a chave, quando nao e `id`
 * @returns {Promise<object>} a linha inteira
 */
controller.lerAntes = async (t, tabela, id, nomeAmigavel, coluna = 'id') => {
  const entrada = entradaDe(tabela)
  const linha = await t.oneOrNone(
    montarSelect(tabela, coluna, entrada.geometrias),
    { id }
  )
  if (!linha) {
    throw new AppError(`${nomeAmigavel} não encontrado(a)`, httpCode.NotFound)
  }
  return trocarGeometrias(linha, entrada.geometrias)
}

/**
 * A linha INTEIRA depois da mudanca, da mesma fonte.
 *
 * Existe porque os dois lados do diff tem de sair do BANCO: o corpo da
 * requisicao traz o que o cliente PEDIU, e o que interessa auditar e o que o
 * banco GRAVOU. Onde o UPDATE ja devolve `RETURNING *`, use o retorno e nao
 * chame isto -- e a mesma linha, por uma ida a menos.
 *
 * Devolve null quando a linha sumiu (exclusao), sem erro: o chamador ja sabe.
 */
controller.lerDepois = async (t, tabela, id, coluna = 'id') => {
  const entrada = entradaDe(tabela)
  const linha = await t.oneOrNone(
    montarSelect(tabela, coluna, entrada.geometrias),
    { id }
  )
  return trocarGeometrias(linha, entrada.geometrias)
}

// --- Escrita do evento ------------------------------------------------------

/**
 * Grava um evento de rastreabilidade.
 *
 * Recebe a transacao `t` de proposito, e nunca abre conexao propria: a linha do
 * rastro tem de cair JUNTO com a mudanca que ela descreve, ou nao cair. Com
 * conexao propria, um rollback da operacao deixaria para tras o registro de uma
 * alteracao que nunca aconteceu.
 *
 * A consequencia e deliberada: falhar ao auditar DERRUBA a escrita. Uma trilha
 * que se perde em silencio quando da erro e pior do que trilha nenhuma, porque
 * quem a le acredita nela.
 *
 * `modulo`, `entidade` e `entidade_id` NAO sao passados pelo chamador: saem do
 * mapa. Passa-los a mao seria a lista digitada que envelhece, com outro nome, e
 * dois controllers escrevendo na mesma tabela com entidades diferentes e
 * divergencia que nada acusa.
 *
 * @param {object} t - transacao do pg-promise (a MESMA da mudanca)
 * @param {object} evento
 * @param {string} evento.tabela - 'schema.tabela'
 * @param {string|number} [evento.registroId]
 * @param {string} evento.operacao - 'I', 'U' ou 'D'
 * @param {object} [evento.antes] - a linha antes, lida do banco
 * @param {object} [evento.depois] - a linha depois, lida do banco
 * @param {string} [evento.usuarioUuid] - o usuario do token
 * @param {object} [evento.contexto] - { origem, rota, loteId }, do middleware
 * @param {string} [evento.motivo] - so onde a rota pergunta
 * @param {string|number} [evento.entidadeId] - so quando o agregado nao sai da linha
 */
controller.registrar = async (
  t,
  { tabela, registroId, operacao, antes, depois, usuarioUuid, contexto, motivo, entidadeId }
) => {
  const entrada = entradaDe(tabela)
  const linha = depois || antes

  // O diff sai da linha CRUA, e a sanitizacao vem depois. E o que faz a troca de
  // senha aparecer como campos_alterados: ['senha'] com os dois valores nulos.
  const camposAlterados = diffCampos(antes, depois)

  const agregado = entidadeId != null
    ? entidadeId
    : await entrada.agregado(t, linha)

  // `entidade` e quase sempre uma constante, e por isso ela e declarada como
  // texto. UMA tabela do sistema nao tem entidade fixa: `orcamento.arquivo`
  // pertence a exatamente um de nota_credito_id, dfd_id ou pdr_ano (o CHECK
  // `arquivo_um_vinculo` garante), e o historico do anexo tem de aparecer na
  // ficha do DONO -- o PDF do SIAFI e parte da NC, e nao um registro que alguem
  // abra por si. Uma entidade fixa mandaria os tres vinculos para a mesma ficha
  // inexistente. Aceitar funcao aqui e a mesma porta que `agregado` ja tem, e
  // pelo mesmo motivo.
  const entidade = typeof entrada.entidade === 'function'
    ? entrada.entidade(linha)
    : entrada.entidade

  if (agregado == null) {
    throw new Error(
      `Auditoria de "${tabela}": o agregado dono nao foi resolvido. ` +
      'Evento sem agregado nao aparece em ficha nenhuma.'
    )
  }

  const ctx = contexto || {}

  await t.none(
    `INSERT INTO auditoria.evento
       (modulo, entidade, entidade_id, tabela, registro_id, operacao,
        dados_antes, dados_depois, campos_alterados, usuario_uuid,
        origem, rota, lote_id, motivo)
     VALUES
       ($<modulo>, $<entidade>, $<entidadeId>, $<tabela>, $<registroId>, $<operacao>,
        $<dadosAntes>::jsonb, $<dadosDepois>::jsonb, $<camposAlterados>::text[],
        $<usuarioUuid>, $<origem>, $<rota>, $<loteId>, $<motivo>)`,
    {
      modulo: entrada.modulo,
      entidade,
      entidadeId: String(agregado),
      tabela,
      registroId: registroId != null ? String(registroId) : null,
      operacao,
      dadosAntes: antes ? JSON.stringify(sanitizar(antes, entrada)) : null,
      dadosDepois: depois ? JSON.stringify(sanitizar(depois, entrada)) : null,
      camposAlterados,
      usuarioUuid: usuarioUuid != null ? usuarioUuid : null,
      origem: ctx.origem || 'web',
      rota: ctx.rota || null,
      loteId: ctx.loteId || null,
      motivo: motivo != null ? motivo : null
    }
  )
}

/**
 * Um evento de OPERACAO: o que muda estado sem ter linha antes e depois.
 *
 * Sao quatro no sistema: as duas visoes materializadas, a limpeza de downloads
 * expirados e a verificacao de volume. A pergunta que essas acoes produzem na
 * pratica e "quem mandou rodar isso, e quando", e a resposta cabe inteira aqui.
 *
 * `verificarConsistencia` merece o caso especial: dois dos UPDATEs dela nao tem
 * lista de ids e podem reescrever a `acervo.arquivo` inteira. Uma linha por
 * arquivo ali seria a auditoria crescendo mais rapido que o acervo, para
 * registrar algo que ninguem decidiu arquivo a arquivo.
 */
controller.registrarOperacao = async (
  t,
  { tabela, resultado, usuarioUuid, contexto, entidadeId }
) => {
  return controller.registrar(t, {
    tabela,
    operacao: 'U',
    depois: resultado,
    usuarioUuid,
    contexto: { ...(contexto || {}), origem: (contexto && contexto.origem) || 'sistema' },
    entidadeId: entidadeId != null ? entidadeId : 'operacao'
  })
}

// --- Leitura do historico ---------------------------------------------------

const SELECT_EVENTO = `
  SELECT a.id, a.modulo, a.entidade, a.entidade_id, a.tabela, a.registro_id,
         a.operacao, a.dados_antes, a.dados_depois, a.campos_alterados,
         a.data_evento, a.usuario_uuid, a.origem, a.rota, a.lote_id, a.motivo,
         u.nome AS usuario_nome, u.nome_guerra AS usuario_nome_guerra,
         pg.nome_abrev AS usuario_posto
    FROM auditoria.evento AS a
    -- LEFT JOIN porque o usuario e nulo em evento de migracao e do sistema, e
    -- porque a pessoa pode ter sido apagada: o rastro sobrevive a ela.
    LEFT JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
    LEFT JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id`

/**
 * Historico de uma ficha, mais novo primeiro.
 *
 * NAO confere se o registro ainda existe, de proposito: a exclusao e justamente
 * o evento que este rastro existe para guardar, e um 404 aqui esconderia o unico
 * registro de que o pedido, o produto ou o usuario existiu.
 */
controller.listarPorEntidade = async (modulo, entidade, entidadeId) => {
  return db.conn.any(
    `${SELECT_EVENTO}
      WHERE a.modulo = $<modulo> AND a.entidade = $<entidade>
        AND a.entidade_id = $<entidadeId>
      ORDER BY a.data_evento DESC, a.id DESC`,
    { modulo, entidade, entidadeId: String(entidadeId) }
  )
}

/**
 * A varredura da tela de rastreabilidade, paginada no servidor.
 *
 * O RECORTE POR MODULO vem do GUARDA (`req.rastreabilidade`), e nao dos filtros:
 * `modulosPermitidos` nulo quer dizer administrador (ve tudo), e uma lista quer
 * dizer gerente daqueles modulos. O `filtros.modulo` que a tela manda so
 * ESTREITA o que o guarda ja permitiu, nunca alarga -- por isso ele entra como
 * uma condicao a mais, e nao no lugar da outra.
 *
 * Paginacao de SERVIDOR porque isto e a lapide do sistema inteiro e nao cabe
 * numa resposta. O envelope segue o formato do `gerencia_ctrl`, que e o que o
 * `components/paginacao/` do cliente ja consome.
 *
 * SEM busca por texto livre dentro dos JSONs: seria varredura de JSONB sobre a
 * tabela inteira, e a tela e o lugar errado para descobrir isso em producao. O
 * filtro por CAMPO ALTERADO cobre a pergunta real ("quem mexeu no valor
 * empenhado") usando o array indexavel.
 *
 * @param {object} filtros
 * @param {string[]|null} modulosPermitidos - null = sem recorte (administrador)
 */
controller.listarGeral = async (filtros = {}, modulosPermitidos = null) => {
  const page = filtros.page || 1
  const limit = filtros.limit || 20
  const offset = (page - 1) * limit

  const condicoes = []
  const params = {
    limit,
    offset,
    modulosPermitidos,
    modulo: filtros.modulo || null,
    entidade: filtros.entidade || null,
    entidadeId: filtros.entidade_id || null,
    usuarioUuid: filtros.usuario_uuid || null,
    operacao: filtros.operacao || null,
    origem: filtros.origem || null,
    campo: filtros.campo || null,
    loteId: filtros.lote_id || null,
    dataInicio: filtros.data_inicio || null,
    dataFim: filtros.data_fim || null
  }

  // O recorte do guarda, primeiro e sempre.
  if (modulosPermitidos) {
    condicoes.push('a.modulo IN ($<modulosPermitidos:csv>)')
  }

  condicoes.push('($<modulo> IS NULL OR a.modulo = $<modulo>)')
  condicoes.push('($<entidade> IS NULL OR a.entidade = $<entidade>)')
  condicoes.push('($<entidadeId> IS NULL OR a.entidade_id = $<entidadeId>)')
  condicoes.push('($<usuarioUuid> IS NULL OR a.usuario_uuid = $<usuarioUuid>::uuid)')
  condicoes.push('($<operacao> IS NULL OR a.operacao = $<operacao>)')
  condicoes.push('($<origem> IS NULL OR a.origem = $<origem>)')
  condicoes.push('($<loteId> IS NULL OR a.lote_id = $<loteId>::uuid)')
  // Casa contra o ARRAY, e nao contra texto: `campos_alterados` guarda o nome
  // exato da coluna, e um LIKE acharia 'valor' dentro de 'valor_recolhido'.
  condicoes.push('($<campo> IS NULL OR $<campo> = ANY(a.campos_alterados))')
  condicoes.push('($<dataInicio> IS NULL OR a.data_evento >= $<dataInicio>::date)')
  // O fim do dia, e nao a meia-noite dele: quem escolhe "ate 02/08" quer os
  // eventos do dia 2, e nao os de antes dele comecar.
  condicoes.push("($<dataFim> IS NULL OR a.data_evento < ($<dataFim>::date + INTERVAL '1 day'))")

  const onde = `WHERE ${condicoes.join(' AND ')}`

  return db.conn.task(async t => {
    const total = await t.one(
      `SELECT COUNT(*)::int AS total FROM auditoria.evento AS a ${onde}`,
      params
    )

    const dados = await t.any(
      `${SELECT_EVENTO}
        ${onde}
        ORDER BY a.data_evento DESC, a.id DESC
        LIMIT $<limit> OFFSET $<offset>`,
      params
    )

    return {
      dados,
      pagination: {
        totalItems: total.total,
        totalPages: Math.max(1, Math.ceil(total.total / limit)),
        currentPage: page,
        pageSize: limit
      }
    }
  })
}

/**
 * As opcoes dos combos da tela, recortadas pelo mesmo criterio da lista.
 *
 * Saem de uma rota propria, e nao junto dos eventos, porque a tela as pede uma
 * vez e a lista muda a cada filtro. Vem do que EXISTE na tabela, e nao de uma
 * lista fixa: modulo ou origem novos aparecem sozinhos, e o que nunca gerou
 * evento nao entra para virar filtro que sempre devolve vazio.
 */
controller.opcoesDeFiltro = async (modulosPermitidos = null) => {
  // O recorte entra por APELIDO, e nao por uma unica string reaproveitada com
  // `replace`: a consulta dos usuarios junta duas tabelas e precisa de
  // `a.modulo`, enquanto as outras tres nao tem apelido nenhum. Costurar isso
  // com troca de texto funciona hoje e quebra calado no dia em que alguem
  // acrescentar um apelido ou renomear a coluna.
  const recorte = apelido =>
    modulosPermitidos ? `WHERE ${apelido}modulo IN ($<modulosPermitidos:csv>)` : ''

  const params = { modulosPermitidos }

  return db.conn.task(async t => {
    const [modulos, entidades, origens, usuarios] = await Promise.all([
      t.any(`SELECT DISTINCT modulo FROM auditoria.evento ${recorte('')} ORDER BY modulo`, params),
      t.any(`SELECT DISTINCT modulo, entidade FROM auditoria.evento ${recorte('')} ORDER BY modulo, entidade`, params),
      t.any(`SELECT DISTINCT origem FROM auditoria.evento ${recorte('')} ORDER BY origem`, params),
      t.any(
        `SELECT DISTINCT a.usuario_uuid, u.nome, u.nome_guerra, pg.nome_abrev AS posto
           FROM auditoria.evento AS a
           INNER JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
           LEFT JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
           ${recorte('a.')}
          ORDER BY u.nome_guerra`,
        params
      )
    ])

    return {
      modulos: modulos.map(m => m.modulo),
      entidades,
      origens: origens.map(o => o.origem),
      usuarios
    }
  })
}

module.exports = controller
