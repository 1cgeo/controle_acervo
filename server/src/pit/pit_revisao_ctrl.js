'use strict'

// O exercício do PIT e as revisões dele.
//
// O FLUXO, do jeito que o gerente o vive. Chega um DIEx da DSG com o PIT novo:
//
//   1. abre o exercício, se o ano ainda não existe;
//   2. abre a revisão (código, data do documento, assinante), SEM data de
//      vigência, e é isso que a deixa em rascunho;
//   3. anexa o PDF assinado;
//   4. altera, cancela e adiciona as metas, que caem na revisão aberta sozinhas;
//   5. confere `alteracoes()`, que é literalmente o que a revisão faz;
//   6. publica, informando a data de vigência.
//
// A GRADE SÓ MUDA NO PASSO 6. Enquanto a revisão é rascunho ela não rege nada, e
// o RPCMTec do mês anterior continua reportando o que reportava.
//
// UM RASCUNHO POR ANO, cobrado por índice parcial no banco. Com dois abertos, a
// alteração de uma meta cairia na revisão errada sem ninguém perceber.

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')
const { motivoDaCorrecao } = require('./motivo_correcao')

const controller = {}

// --- Exercício --------------------------------------------------------------

const colunasExercicio = `e.ano, e.situacao_id, s.nome AS situacao, e.observacao,
  (SELECT count(*)::int FROM pit.meta_item mi
    INNER JOIN pit.meta m ON m.id = mi.meta_id
    WHERE m.ano = e.ano) AS metas,
  (SELECT count(*)::int FROM pit.revisao r WHERE r.ano = e.ano) AS revisoes,
  e.data_cadastramento, e.usuario_cadastramento_uuid,
  e.data_modificacao, e.usuario_modificacao_uuid`

controller.listarExercicios = async () => {
  return db.conn.any(
    `SELECT ${colunasExercicio}
     FROM pit.pit AS e
     INNER JOIN dominio.situacao_exercicio AS s ON s.code = e.situacao_id
     ORDER BY e.ano DESC`
  )
}

controller.criarExercicio = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const existe = await t.oneOrNone(
      'SELECT ano FROM pit.pit WHERE ano = $<ano>', { ano: dados.ano }
    )
    if (existe) {
      throw new AppError(
        `O exercício de ${dados.ano} já existe.`, httpCode.Conflict
      )
    }

    const criado = await t.one(
      `INSERT INTO pit.pit (ano, situacao_id, observacao, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<situacao_id>, $<observacao>, $<usuarioUuid>)
       RETURNING *`,
      {
        ano: dados.ano,
        situacao_id: dados.situacao_id === undefined ? 2 : dados.situacao_id,
        observacao: dados.observacao === undefined ? null : dados.observacao,
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.pit',
      registroId: criado.ano,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    return { ano: criado.ano }
  })
}

controller.atualizarExercicio = async (ano, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.pit', ano, 'Exercício do PIT', 'ano'
    )

    // Encerrar com rascunho aberto deixaria uma revisão sem futuro: ela nunca
    // poderia ser publicada, e ninguém saberia por quê.
    if (dados.situacao_id === 3) {
      const { rascunhos } = await t.one(
        `SELECT count(*)::int AS rascunhos FROM pit.revisao
         WHERE ano = $<ano> AND data_vigencia IS NULL`,
        { ano }
      )
      if (rascunhos > 0) {
        throw new AppError(
          'O exercício tem uma revisão em rascunho. Publique-a ou exclua-a ' +
          'antes de encerrar o ano.',
          httpCode.BadRequest
        )
      }
    }

    const depois = await t.one(
      `UPDATE pit.pit
       SET situacao_id = $<situacao_id>, observacao = $<observacao>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE ano = $<ano>
       RETURNING *`,
      {
        ano,
        situacao_id: dados.situacao_id,
        observacao: dados.observacao === undefined ? null : dados.observacao,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.pit',
      registroId: ano,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { ano: depois.ano }
  })
}

// --- Revisão ----------------------------------------------------------------

// `alteracoes` é a contagem das linhas da revisão, e não um cálculo: a tabela é
// esparsa, então as linhas de uma revisão SÃO as alterações dela.
const colunasRevisao = `r.id, r.ano, r.codigo, r.data_documento::text AS data_documento,
  r.data_assinatura::text AS data_assinatura, r.assinante,
  r.data_vigencia::text AS data_vigencia,
  (r.data_vigencia IS NULL) AS rascunho,
  r.observacao,
  (SELECT count(*)::int FROM pit.meta_item_revisao mr WHERE mr.revisao_id = r.id) AS alteracoes,
  (SELECT count(*)::int FROM pit.anexo_revisao a WHERE a.revisao_id = r.id) AS anexos,
  r.data_cadastramento, r.usuario_cadastramento_uuid,
  r.data_modificacao, r.usuario_modificacao_uuid`

controller.listarRevisoes = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunasRevisao} FROM pit.revisao AS r
       WHERE r.ano = $<ano>
       ORDER BY r.data_vigencia NULLS LAST, r.id`,
      { ano }
    )
  }
  return db.conn.any(
    `SELECT ${colunasRevisao} FROM pit.revisao AS r
     ORDER BY r.ano DESC, r.data_vigencia NULLS LAST, r.id`
  )
}

controller.getRevisao = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunasRevisao} FROM pit.revisao AS r WHERE r.id = $<id>`,
    { id }
  )
}

// O QUE A REVISÃO FAZ, meta a meta, com o valor anterior ao lado. É a tela de
// conferência do passo 5: o gerente lê isto contra o DIEx antes de publicar.
//
// O "anterior" sai da revisão vigente ANTES desta, o que para um rascunho é a
// que está no ar hoje.
controller.alteracoes = async id => {
  return db.conn.any(
    `WITH alvo AS (
       SELECT r.id, r.ano, r.data_vigencia FROM pit.revisao r WHERE r.id = $<id>
     )
     SELECT mr.meta_item_id AS meta_id, mi.item, g.numero_meta, g.nome,
            mr.descricao, mr.quantidade_prevista,
            mr.prazo::text AS prazo, mr.demandante, mr.cancelada,
            ant.quantidade_prevista AS quantidade_anterior,
            ant.prazo::text AS prazo_anterior,
            ant.cancelada AS cancelada_anterior,
            (ant.meta_item_id IS NULL) AS meta_nova
     FROM pit.meta_item_revisao mr
     INNER JOIN alvo ON alvo.id = mr.revisao_id
     INNER JOIN pit.meta_item mi ON mi.id = mr.meta_item_id
     INNER JOIN pit.meta g ON g.id = mi.meta_id
     LEFT JOIN LATERAL (
       SELECT x.* FROM pit.meta_item_revisao x
       INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
       WHERE x.meta_item_id = mr.meta_item_id
         AND rr.id <> alvo.id
         AND rr.data_vigencia IS NOT NULL
         AND (alvo.data_vigencia IS NULL OR rr.data_vigencia <= alvo.data_vigencia)
       ORDER BY rr.data_vigencia DESC, rr.id DESC
       LIMIT 1
     ) ant ON TRUE
     ORDER BY g.numero_meta, mi.item`,
    { id }
  )
}

const paraBancoRevisao = (dados, usuarioUuid) => ({
  ano: dados.ano,
  codigo: dados.codigo,
  data_documento: dados.data_documento === undefined ? null : dados.data_documento,
  data_assinatura: dados.data_assinatura === undefined ? null : dados.data_assinatura,
  assinante: dados.assinante === undefined ? null : dados.assinante,
  observacao: dados.observacao === undefined ? null : dados.observacao,
  usuarioUuid
})

controller.criarRevisao = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const exercicio = await t.oneOrNone(
      'SELECT situacao_id FROM pit.pit WHERE ano = $<ano>', { ano: dados.ano }
    )
    if (!exercicio) {
      throw new AppError(
        `O exercício de ${dados.ano} não existe. Crie o ano primeiro.`,
        httpCode.BadRequest
      )
    }
    if (exercicio.situacao_id === 3) {
      throw new AppError(
        `O exercício de ${dados.ano} está encerrado.`, httpCode.BadRequest
      )
    }

    const aberta = await t.oneOrNone(
      `SELECT codigo FROM pit.revisao
       WHERE ano = $<ano> AND data_vigencia IS NULL`,
      { ano: dados.ano }
    )
    if (aberta) {
      throw new AppError(
        `O exercício de ${dados.ano} já tem a revisão ${aberta.codigo} em ` +
        'rascunho. Publique-a ou exclua-a antes de abrir outra.',
        httpCode.Conflict
      )
    }

    // Nasce SEMPRE rascunho: a data de vigência entra na publicação, depois de o
    // gerente conferir as alterações contra o documento.
    const criada = await t.one(
      `INSERT INTO pit.revisao
         (ano, codigo, data_documento, data_assinatura, assinante, observacao,
          usuario_cadastramento_uuid)
       VALUES ($<ano>, $<codigo>, $<data_documento>, $<data_assinatura>,
               $<assinante>, $<observacao>, $<usuarioUuid>)
       RETURNING *`,
      paraBancoRevisao(dados, usuarioUuid)
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.revisao',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

controller.atualizarRevisao = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.revisao', id, 'Revisão do PIT'
    )

    // A REVISÃO PUBLICADA ACEITA ESTA EDIÇÃO, e é deliberado: o que esta rota
    // toca é a IDENTIFICAÇÃO do documento (código, datas, assinante,
    // observação), que é transcrição e não plano. Nada aqui move um número.
    //
    // O que fica congelado numa revisão publicada é o que ela PROMETE, e isso
    // esta rota não alcança: declaração só entra pela revisão em rascunho, e a
    // vigência só muda em `publicar`.

    const depois = await t.one(
      `UPDATE pit.revisao
       SET codigo = $<codigo>, data_documento = $<data_documento>,
           data_assinatura = $<data_assinatura>, assinante = $<assinante>,
           observacao = $<observacao>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...paraBancoRevisao(dados, usuarioUuid), id, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.revisao',
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

// PUBLICAR: o ato que faz a revisão passar a reger.
//
// A data pode ser RETROATIVA, e às vezes tem de ser: o R1 de 2026 foi assinado
// em 14/05 e o documento é de 11/05. Quem escolhe é quem publica.
controller.publicar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.revisao', id, 'Revisão do PIT'
    )

    if (antes.data_vigencia !== null) {
      throw new AppError('A revisão já foi publicada.', httpCode.BadRequest)
    }

    // Revisão que não altera nada não é revisão. Publicá-la só sujaria a lista e
    // deslocaria a leitura para uma linha que repete a anterior.
    const { alteracoes } = await t.one(
      'SELECT count(*)::int AS alteracoes FROM pit.meta_item_revisao WHERE revisao_id = $<id>',
      { id }
    )
    if (alteracoes === 0) {
      throw new AppError(
        'A revisão não altera meta nenhuma. Faça as alterações antes de publicar.',
        httpCode.BadRequest
      )
    }

    const depois = await t.one(
      `UPDATE pit.revisao
       SET data_vigencia = $<data_vigencia>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        data_vigencia: dados.data_vigencia,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.revisao',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto,
      motivo: `Publicada com vigência em ${dados.data_vigencia}, com ${alteracoes} alteração(ões).`
    })

    return { id: depois.id, alteracoes }
  })
}

/**
 * Tira a declaração de UM ITEM de uma revisão em RASCUNHO.
 *
 * POR QUE ELA EXISTE. A tabela `pit.meta_item_revisao` é esparsa: a linha só
 * nasce quando algo muda, e por isso as linhas de uma revisão SÃO as alterações
 * dela. Faltava o caminho de volta: quem acrescentasse um item por engano ao
 * rascunho só saía publicando o erro, e revisão publicada não se apaga.
 *
 * A lacuna apareceu na carga do PIT de 2026: a 6.9 não existe no R0, e teve de
 * entrar nele marcada `cancelada` porque não havia como deixá-la AUSENTE.
 *
 * NA REVISÃO PUBLICADA, EXIGE MOTIVO, e antes era proibida. A assimetria não se
 * justificava: a mesma rota que ACRESCENTA a meta que a cópia esqueceu de
 * transcrever, e que EDITA a que ela copiou errado, recusava remover a que ela
 * inventou. As três são a mesma correção, a da TRANSCRIÇÃO, e a regra do motivo
 * (`motivo_correcao.js`) é o que separa "transcrevi errado" de "a DSG mudou".
 *
 * O caso que a abriu, em 2026-08-06: o R1 de 2026 declarava a 4.2 em 252, e o
 * documento assinado não toca essa meta. O RTM confirmou 247, o mesmo do R0. Sem
 * a remoção, a única saída era editar o R1 para repetir o 247 do R0, deixando no
 * histórico uma alteração que nunca existiu.
 *
 * O evento cai no agregado do ITEM, e não no do exercício: a pergunta que se
 * faz depois é "por que a 4.2 voltou a 247", e ela se faz na ficha do item.
 */
controller.removerDeclaracao = async (revisaoId, metaId, usuarioUuid, contexto, motivoPedido) => {
  return db.conn.tx(async t => {
    const revisao = await t.oneOrNone(
      'SELECT id, ano, codigo, data_vigencia FROM pit.revisao WHERE id = $<revisaoId>',
      { revisaoId }
    )
    if (!revisao) {
      throw new AppError('Revisão do PIT não encontrada', httpCode.NotFound)
    }
    // Rascunho devolve nulo; publicada cobra o motivo e o devolve para o rastro.
    const motivo = motivoDaCorrecao(revisao, motivoPedido)

    const antes = await t.oneOrNone(
      `SELECT * FROM pit.meta_item_revisao
       WHERE revisao_id = $<revisaoId> AND meta_item_id = $<metaId>`,
      { revisaoId, metaId }
    )
    if (!antes) {
      throw new AppError(
        'Este item não é alterado por esta revisão', httpCode.NotFound
      )
    }

    await t.none(
      'DELETE FROM pit.meta_item_revisao WHERE id = $<id>', { id: antes.id }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta_item_revisao',
      registroId: antes.id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto,
      // O motivo do RASTRO diz qual dos dois casos foi. "Removida do rascunho"
      // numa revisao publicada seria falso, e o historico e onde alguem vai
      // procurar por que a 4.2 voltou a 247.
      motivo: motivo
        ? `Correção da transcrição do ${revisao.codigo} de ${revisao.ano}: ${motivo}`
        : `Removida do rascunho da revisão ${revisao.codigo} de ${revisao.ano}.`
    })

    return { revisaoId, metaId, removida: true }
  })
}

// Só o rascunho se exclui. A revisão publicada é o que o relatório de um mês
// passado reporta, e apagá-la reescreveria esse passado.
controller.deletarRevisao = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.revisao', id, 'Revisão do PIT'
    )

    if (antes.data_vigencia !== null) {
      throw new AppError(
        'A revisão já foi publicada e não pode ser excluída: ela é o que o ' +
        'relatório dos meses em que vigeu reporta.',
        httpCode.BadRequest
      )
    }

    await t.none('DELETE FROM pit.revisao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.revisao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

// --- Anexo da revisão -------------------------------------------------------

// Mesma forma do anexo do pedido da mapoteca: os bytes vivem na linha, e a
// listagem NUNCA traz `conteudo` (o PIT assinado tem 300 KB, e uma lista de dez
// revisões carregaria 3 MB para mostrar nome e tamanho).
const colunasAnexo = `a.id, a.revisao_id, a.tipo_anexo_id, t.nome AS tipo_anexo,
  a.nome_original, a.extensao, a.mimetype, a.tamanho_bytes, a.descricao,
  a.data_cadastramento, a.usuario_cadastramento_uuid`

controller.listarAnexos = async revisaoId => {
  return db.conn.any(
    `SELECT ${colunasAnexo}
     FROM pit.anexo_revisao AS a
     INNER JOIN pit.tipo_anexo_revisao AS t ON t.code = a.tipo_anexo_id
     WHERE a.revisao_id = $<revisaoId>
     ORDER BY a.tipo_anexo_id, a.id`,
    { revisaoId }
  )
}

controller.criarAnexo = async (revisaoId, arquivo, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const revisao = await t.oneOrNone(
      'SELECT id FROM pit.revisao WHERE id = $<revisaoId>', { revisaoId }
    )
    if (!revisao) {
      throw new AppError('Revisão do PIT não encontrada', httpCode.NotFound)
    }

    const ponto = arquivo.originalname.lastIndexOf('.')
    const extensao = ponto >= 0 ? arquivo.originalname.slice(ponto) : ''

    const criado = await t.one(
      `INSERT INTO pit.anexo_revisao
         (revisao_id, tipo_anexo_id, nome_original, extensao, mimetype,
          tamanho_bytes, conteudo, descricao, usuario_cadastramento_uuid)
       VALUES ($<revisaoId>, $<tipo_anexo_id>, $<nome_original>, $<extensao>,
               $<mimetype>, $<tamanho_bytes>, $<conteudo>, $<descricao>, $<usuarioUuid>)
       RETURNING id, revisao_id, tipo_anexo_id, nome_original, extensao,
                 mimetype, tamanho_bytes, descricao`,
      {
        revisaoId,
        tipo_anexo_id: dados.tipo_anexo_id === undefined ? 4 : dados.tipo_anexo_id,
        nome_original: arquivo.originalname,
        extensao,
        mimetype: arquivo.mimetype || null,
        tamanho_bytes: arquivo.size,
        conteudo: arquivo.buffer,
        descricao: dados.descricao === undefined ? null : dados.descricao,
        usuarioUuid
      }
    )

    // `conteudo` fica FORA do rastro de propósito: o evento guardaria uma
    // segunda cópia dos bytes em `auditoria.evento`, e o que se audita é que o
    // anexo entrou, não o PDF de novo.
    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.anexo_revisao',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    return { id: criado.id }
  })
}

controller.getAnexoParaDownload = async id => {
  const anexo = await db.conn.oneOrNone(
    `SELECT nome_original, mimetype, conteudo
     FROM pit.anexo_revisao WHERE id = $<id>`,
    { id }
  )
  if (!anexo) {
    throw new AppError('Anexo não encontrado', httpCode.NotFound)
  }
  return anexo
}

controller.deletarAnexo = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await t.oneOrNone(
      `SELECT id, revisao_id, tipo_anexo_id, nome_original, extensao, mimetype,
              tamanho_bytes, descricao
       FROM pit.anexo_revisao WHERE id = $<id>`,
      { id }
    )
    if (!antes) {
      throw new AppError('Anexo não encontrado', httpCode.NotFound)
    }

    await t.none('DELETE FROM pit.anexo_revisao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.anexo_revisao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
