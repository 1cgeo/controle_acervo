'use strict'

const fs = require('fs')
const path = require('path')

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const { SITUACAO_ATIVIDADE } = require('../utils/domain_constants')

const controller = {}

// A PSEUDO-TABELA DA ZONA DE PERIGO. As tres operacoes em massa deste modulo
// mudam estado sem ter UMA linha antes e depois: elas varrem. A pergunta que
// produzem e "quem mandou rodar isso, quando, e quanto levou junto", e essa
// resposta cabe inteira num evento so -- e a mesma escolha de `acervo.mv_produto`
// e da limpeza de downloads. Uma linha de auditoria por unidade de trabalho
// apagada faria a trilha crescer mais rapido que a producao para registrar uma
// decisao que ninguem tomou linha a linha.
//
// Ver a entrada em `auditoria/mapa/producao.js`.
const ZONA_PERIGO = 'producao.zona_perigo'

// As situacoes que uma atividade PRESA a uma pessoa pode ter sem que apaga-la
// reescreva historia. Ver `limpaAtividades`.
const SITUACAO_SOLTAVEL = [
  SITUACAO_ATIVIDADE.NAO_INICIADA,
  SITUACAO_ATIVIDADE.EM_EXECUCAO,
  SITUACAO_ATIVIDADE.PAUSADA
]

// A geometria entra por `ST_GeomFromGeoJSON`, que nasce SEM SRID: sem o
// `ST_SetSRID` o PostGIS recusa a coluna tipada e a mensagem fala de SRID 0. O
// `::text` e obrigatorio porque `ST_GeomFromGeoJSON` tem sobrecarga para text e
// para json, e um NULL sem cast e ambiguo para o planejador.
const GEOM_SQL = 'ST_SetSRID(ST_GeomFromGeoJSON($<geom>::text), 4674)'

// --- Propriedades de camada ---------------------------------------------------

controller.getPropriedadesCamada = async () => {
  return db.conn.any(
    `SELECT pc.id, pc.camada_id, c.schema AS camada_schema, c.nome AS camada_nome,
            pc.camada_incomum, pc.atributo_filtro_subfase,
            pc.camada_apontamento, pc.atributo_situacao_correcao,
            pc.atributo_justificativa_apontamento,
            pc.subfase_id, s.nome AS subfase
       FROM producao.propriedades_camada AS pc
       INNER JOIN producao.camada AS c ON c.id = pc.camada_id
       INNER JOIN producao.subfase AS s ON s.id = pc.subfase_id
      ORDER BY c.schema, c.nome, s.nome`
  )
}

controller.criaPropriedadesCamada = async (propriedades, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criadas = []

    for (const p of propriedades) {
      // UMA LINHA POR VEZ, COM `RETURNING *`, e nao um `helpers.insert` em lote.
      // A auditoria da casa grava o que o BANCO gravou, e nao o que o cliente
      // pediu -- e o `RETURNING` e o unico jeito de ter os defaults (`id`,
      // `data_cadastramento`) na mesma ida. Sao listas de configuracao, com
      // dezenas de linhas no maximo: o lote de insercao compraria pouco e
      // custaria a trilha.
      const linha = await t.one(
        `INSERT INTO producao.propriedades_camada
           (camada_id, camada_incomum, atributo_filtro_subfase, camada_apontamento,
            atributo_situacao_correcao, atributo_justificativa_apontamento,
            subfase_id, usuario_cadastramento_uuid)
         VALUES
           ($<camada_id>, $<camada_incomum>, $<atributo_filtro_subfase>,
            $<camada_apontamento>, $<atributo_situacao_correcao>,
            $<atributo_justificativa_apontamento>, $<subfase_id>, $<usuarioUuid>)
         RETURNING *`,
        {
          camada_id: p.camada_id,
          camada_incomum: p.camada_incomum,
          atributo_filtro_subfase: p.atributo_filtro_subfase ?? null,
          camada_apontamento: p.camada_apontamento,
          atributo_situacao_correcao: p.atributo_situacao_correcao ?? null,
          atributo_justificativa_apontamento:
            p.atributo_justificativa_apontamento ?? null,
          subfase_id: p.subfase_id,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.propriedades_camada',
        registroId: linha.id,
        operacao: 'I',
        depois: linha,
        usuarioUuid,
        contexto
      })

      criadas.push(linha)
    }

    return criadas
  })
}

controller.atualizaPropriedadesCamada = async (propriedades, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const p of propriedades) {
      const antes = await auditoriaCtrl.lerAntes(
        t, 'producao.propriedades_camada', p.id, 'Propriedade de camada'
      )

      const depois = await t.one(
        `UPDATE producao.propriedades_camada
            SET camada_id = $<camada_id>,
                camada_incomum = $<camada_incomum>,
                atributo_filtro_subfase = $<atributo_filtro_subfase>,
                camada_apontamento = $<camada_apontamento>,
                atributo_situacao_correcao = $<atributo_situacao_correcao>,
                atributo_justificativa_apontamento = $<atributo_justificativa_apontamento>,
                subfase_id = $<subfase_id>,
                data_modificacao = CURRENT_TIMESTAMP,
                usuario_modificacao_uuid = $<usuarioUuid>
          WHERE id = $<id>
          RETURNING *`,
        {
          id: p.id,
          camada_id: p.camada_id,
          camada_incomum: p.camada_incomum,
          atributo_filtro_subfase: p.atributo_filtro_subfase ?? null,
          camada_apontamento: p.camada_apontamento,
          atributo_situacao_correcao: p.atributo_situacao_correcao ?? null,
          atributo_justificativa_apontamento:
            p.atributo_justificativa_apontamento ?? null,
          subfase_id: p.subfase_id,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.propriedades_camada',
        registroId: p.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.deletePropriedadesCamada = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const id of ids) {
      // O ESTADO ANTERIOR E LIDO ANTES DE APAGAR, e e o unico registro que
      // sobrara: `lerAntes` lanca o 404 com a frase da casa quando o id nao
      // existe, o que tambem faz a transacao inteira voltar. Um id errado no
      // meio da lista nao apaga os anteriores.
      const antes = await auditoriaCtrl.lerAntes(
        t, 'producao.propriedades_camada', id, 'Propriedade de camada'
      )

      await t.none(
        'DELETE FROM producao.propriedades_camada WHERE id = $<id>', { id }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.propriedades_camada',
        registroId: id,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- Insumo -------------------------------------------------------------------

controller.getInsumo = async () => {
  return db.conn.any(
    `SELECT i.id, i.nome, i.caminho, i.epsg, i.tipo_insumo_id, i.grupo_insumo_id,
            ti.nome AS tipo_insumo, gi.nome AS grupo_insumo,
            ST_AsGeoJSON(i.geom)::json AS geom,
            (SELECT COUNT(*)::int
               FROM producao.insumo_unidade_trabalho AS iut
              WHERE iut.insumo_id = i.id) AS unidades_trabalho
       FROM producao.insumo AS i
       INNER JOIN dominio.tipo_insumo AS ti ON ti.code = i.tipo_insumo_id
       INNER JOIN producao.grupo_insumo AS gi ON gi.id = i.grupo_insumo_id
      ORDER BY gi.nome, i.nome`
  )
}

controller.criaInsumo = async (insumos, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criados = []

    for (const i of insumos) {
      const linha = await t.one(
        `INSERT INTO producao.insumo
           (nome, caminho, epsg, tipo_insumo_id, grupo_insumo_id, geom,
            usuario_cadastramento_uuid)
         VALUES
           ($<nome>, $<caminho>, $<epsg>, $<tipo_insumo_id>, $<grupo_insumo_id>,
            ${GEOM_SQL}, $<usuarioUuid>)
         RETURNING id, nome, caminho, epsg, tipo_insumo_id, grupo_insumo_id,
                   ST_AsEWKT(geom) AS geom, data_cadastramento,
                   usuario_cadastramento_uuid, data_modificacao,
                   usuario_modificacao_uuid`,
        {
          nome: i.nome,
          caminho: i.caminho,
          epsg: i.epsg ?? null,
          tipo_insumo_id: i.tipo_insumo_id,
          grupo_insumo_id: i.grupo_insumo_id,
          geom: i.geom ?? null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.insumo',
        registroId: linha.id,
        operacao: 'I',
        depois: linha,
        usuarioUuid,
        contexto
      })

      criados.push(linha)
    }

    return criados
  })
}

controller.atualizaInsumo = async (insumos, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const i of insumos) {
      const antes = await auditoriaCtrl.lerAntes(t, 'producao.insumo', i.id, 'Insumo')

      const depois = await t.one(
        `UPDATE producao.insumo
            SET nome = $<nome>,
                caminho = $<caminho>,
                epsg = $<epsg>,
                tipo_insumo_id = $<tipo_insumo_id>,
                grupo_insumo_id = $<grupo_insumo_id>,
                geom = ${GEOM_SQL},
                data_modificacao = CURRENT_TIMESTAMP,
                usuario_modificacao_uuid = $<usuarioUuid>
          WHERE id = $<id>
          RETURNING id, nome, caminho, epsg, tipo_insumo_id, grupo_insumo_id,
                    ST_AsEWKT(geom) AS geom, data_cadastramento,
                    usuario_cadastramento_uuid, data_modificacao,
                    usuario_modificacao_uuid`,
        {
          id: i.id,
          nome: i.nome,
          caminho: i.caminho,
          epsg: i.epsg ?? null,
          tipo_insumo_id: i.tipo_insumo_id,
          grupo_insumo_id: i.grupo_insumo_id,
          geom: i.geom ?? null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.insumo',
        registroId: i.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.deleteInsumo = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const id of ids) {
      const antes = await auditoriaCtrl.lerAntes(t, 'producao.insumo', id, 'Insumo')

      // A LIGACAO COM AS UNIDADES DE TRABALHO SAI JUNTO, e por FK: o DDL de
      // `insumo_unidade_trabalho` nao tem `ON DELETE CASCADE`, entao sem esta
      // linha o DELETE abaixo morre com 23503 e a mensagem cita o nome da
      // constraint, que nao diz nada a quem cadastrou.
      const ligacoes = await t.result(
        'DELETE FROM producao.insumo_unidade_trabalho WHERE insumo_id = $<id>',
        { id }
      )

      await t.none('DELETE FROM producao.insumo WHERE id = $<id>', { id })

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.insumo',
        registroId: id,
        operacao: 'D',
        antes: { ...antes, unidades_trabalho_desligadas: ligacoes.rowCount },
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- As três operações em massa ----------------------------------------------

/**
 * Solta as atividades que uma pessoa está segurando.
 *
 * O ESCOPO É MENOR QUE O DA ORIGEM, E A DIFERENÇA É DELIBERADA.
 *
 * No SAP 2.3.5 esta rota fazia `UPDATE ... WHERE usuario_id = X` sem filtro de
 * situacao: ela zerava TAMBEM as atividades FINALIZADAS, devolvendo-as ao estado
 * "Nao iniciada" e apagando `data_inicio` e `data_fim`. O efeito nao e soltar
 * trabalho -- e apagar producao entregue. O lote passava a mostrar como nao feito
 * o que foi feito, as views de acompanhamento refaziam a matriz sem aquelas
 * datas, e o PIT do ano perdia as folhas daquela pessoa. Nao ha desfazer, e o
 * dado nao esta em lugar nenhum alem dali.
 *
 * O QUE ESTA ROTA EXISTE PARA RESOLVER e outra coisa: o operador saiu da Divisao
 * (ou foi desativado) segurando atividade, e a fila nao anda porque a atividade
 * viva daquele par (etapa, unidade de trabalho) e dele. Isso se resolve nas
 * situacoes 1, 2 e 3. A finalizada (4) e a descartada (5) ficam onde estao.
 *
 * OS GATILHOS FICAM LIGADOS, e isto e a decisao consciente do lado caro. Cada
 * linha alterada dispara `refresh_view_acompanhamento_atividade` e
 * `refresh_bloco_atividade`, que fazem `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
 * O SAP desligava os gatilhos e refazia as views no fim, por um utilitario
 * (`disableTriggers`) que este repositorio NAO TEM -- e traze-lo seria abrir uma
 * porta para desligar gatilho em transacao, na zona de perigo, sem nenhuma outra
 * rota precisando dela. Fica o custo: soltar dezenas de atividades demora.
 */
controller.limpaAtividades = async (usuarioUuid, usuarioAtorUuid, contexto, motivo) => {
  return db.conn.tx(async t => {
    const alvo = await t.oneOrNone(
      `SELECT u.uuid, u.ativo, tpg.nome_abrev || ' ' || u.nome_guerra AS usuario
         FROM dgeo.usuario AS u
         INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
        WHERE u.uuid = $<usuarioUuid>`,
      { usuarioUuid }
    )

    if (!alvo) {
      throw new AppError('Usuário não encontrado', httpCode.NotFound)
    }

    const preservadas = await t.one(
      `SELECT COUNT(*)::int AS total
         FROM producao.atividade
        WHERE usuario_uuid = $<usuarioUuid>
          AND tipo_situacao_atividade_id NOT IN ($<soltavel:csv>)`,
      { usuarioUuid, soltavel: SITUACAO_SOLTAVEL }
    )

    const soltas = await t.any(
      `UPDATE producao.atividade
          SET usuario_uuid = NULL,
              data_inicio = NULL,
              data_fim = NULL,
              tipo_situacao_atividade_id = $<naoIniciada>
        WHERE usuario_uuid = $<usuarioUuid>
          AND tipo_situacao_atividade_id IN ($<soltavel:csv>)
        RETURNING id`,
      {
        usuarioUuid,
        naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
        soltavel: SITUACAO_SOLTAVEL
      }
    )

    if (soltas.length === 0) {
      throw new AppError(
        `${alvo.usuario} não está segurando nenhuma atividade não iniciada, em execução ou pausada` +
        (preservadas.total > 0
          ? `. As ${preservadas.total} atividades finalizadas ou descartadas dele NÃO são tocadas por esta rota.`
          : ''),
        httpCode.BadRequest
      )
    }

    const resumo = {
      operacao: 'atividades_do_usuario',
      alvo: `${alvo.usuario} (${usuarioUuid})`,
      removidos: soltas.length,
      preservados: preservadas.total,
      detalhe: soltas.map(a => String(a.id))
    }

    await auditoriaCtrl.registrar(t, {
      tabela: ZONA_PERIGO,
      operacao: 'D',
      depois: resumo,
      usuarioUuid: usuarioAtorUuid,
      contexto,
      motivo
    })

    return resumo
  })
}

/**
 * Apaga do `combined.log` as entradas anteriores a três dias.
 *
 * ORDEM: A TRILHA PRIMEIRO, O ARQUIVO DEPOIS, E OS DOIS DENTRO DA TRANSACAO.
 * Escrever no disco antes de gravar o evento deixaria o log truncado sem rastro
 * quando o INSERT da auditoria falhasse; gravar o evento e falhar na escrita
 * derruba a transacao e a trilha nao afirma o que nao houve. A ordem so tem um
 * furo possivel (o processo morrer entre as duas), e ele deixa a trilha dizendo
 * de mais, nunca de menos -- que e o lado certo para errar.
 *
 * AGRUPA ENTRADA MULTILINHA: uma entrada comeca numa linha com data e inclui as
 * seguintes sem data (a continuacao de um stack trace). A decisao de manter e da
 * ENTRADA INTEIRA, pela data do cabecalho. Um filtro por linha descartaria toda
 * linha sem data, porque `Invalid Date > corte` e falso, e o log ficaria com
 * cabecalhos sem corpo.
 */
controller.limpaLog = async (usuarioUuid, contexto, motivo) => {
  const arquivo = path.join(__dirname, '..', '..', 'logs', 'combined.log')
  const DIAS = 3
  const corte = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000)

  if (!fs.existsSync(arquivo)) {
    throw new AppError(
      'O arquivo de log combinado não existe neste servidor', httpCode.NotFound
    )
  }

  const conteudo = await fs.promises.readFile(arquivo, 'utf8')

  const linhas = conteudo.split('\n')
  const mantidas = []
  let mantendo = true
  for (const linha of linhas) {
    const data = new Date(linha.split('|')[0])
    if (!Number.isNaN(data.getTime())) {
      mantendo = data > corte
    }
    if (mantendo) mantidas.push(linha)
  }

  const resumo = {
    operacao: 'log_combinado',
    alvo: `entradas anteriores a ${DIAS} dias`,
    removidos: linhas.length - mantidas.length,
    preservados: mantidas.length
  }

  await db.conn.tx(async t => {
    await auditoriaCtrl.registrar(t, {
      tabela: ZONA_PERIGO,
      operacao: 'D',
      depois: resumo,
      usuarioUuid,
      contexto,
      motivo
    })

    await fs.promises.writeFile(arquivo, mantidas.join('\n'), 'utf8')
  })

  return resumo
}

/**
 * Apaga as unidades de trabalho que não têm nenhuma atividade.
 *
 * A unidade de trabalho sem atividade e configuracao que nunca virou trabalho:
 * ela foi carregada e o passo seguinte (criar as atividades das etapas) nao
 * aconteceu, ou foi desfeito. Apaga-la nao perde execucao nenhuma, porque nao ha
 * execucao.
 *
 * `insumo_unidade_trabalho` SAI ANTES, por FK sem `ON DELETE CASCADE` -- era
 * essa a causa do 23503 na origem. `relacionamento_ut` e `relacionamento_versao`
 * NAO entram aqui: eles sao limpos pelo gatilho AFTER DELETE
 * `a_relacionamento_unidade_trabalho`, que fica LIGADO nesta transacao.
 */
// O TETO DO `detalhe`, pelo mesmo motivo de `producao/insumo_ctrl.js:451`: esta
// varredura alcanca a instalacao inteira, e uma lista com milhares de linhas
// dentro de UM `auditoria.evento` fica maior que a operacao que ela descreve. Os
// primeiros ficam porque sao o que permite conferir, e o resto vira contagem. A
// trilha e append-only, entao inchar o evento e uma decisao sem volta.
const TETO_IDS_NO_EVENTO = 20

const detalheComTeto = alvos => {
  const descrever = a => `${a.id} (${a.nome || 'sem nome'}, lote ${a.lote_id})`
  const mostrados = alvos.slice(0, TETO_IDS_NO_EVENTO).map(descrever)
  const restantes = alvos.length - mostrados.length

  return restantes > 0
    ? [...mostrados, `e mais ${restantes}`]
    : mostrados
}

controller.deleteUtSemAtividade = async (usuarioUuid, contexto, motivo) => {
  return db.conn.tx(async t => {
    const alvos = await t.any(
      `SELECT ut.id, ut.nome, ut.lote_id
         FROM producao.unidade_trabalho AS ut
        WHERE NOT EXISTS (
          SELECT 1 FROM producao.atividade AS a WHERE a.unidade_trabalho_id = ut.id
        )
        ORDER BY ut.id`
    )

    // VARREDURA SEM ALVO TAMBEM DEIXA RASTRO, e a saida antecipada que morava
    // aqui era o unico caminho da zona de perigo que nao registrava nada: alguem
    // digitava a confirmacao, escrevia o motivo, e a operacao nao acontecia nem
    // no papel. Numa rota destrutiva, "rodei e nao havia nada" e informacao, e e
    // exatamente a que responde "entao quem apagou?" depois. O irmao
    // `producao/insumo_ctrl.js` ja fazia assim, e `limpaLog` com zero removidos
    // tambem registra.
    if (alvos.length === 0) {
      const vazio = {
        operacao: 'unidade_trabalho_sem_atividade',
        alvo: 'unidades de trabalho sem atividade',
        removidos: 0,
        detalhe: []
      }

      await auditoriaCtrl.registrar(t, {
        tabela: ZONA_PERIGO,
        operacao: 'D',
        depois: vazio,
        usuarioUuid,
        contexto,
        motivo
      })

      return vazio
    }

    const ids = alvos.map(a => a.id)

    await t.none(
      `DELETE FROM producao.insumo_unidade_trabalho
        WHERE unidade_trabalho_id IN ($<ids:csv>)`,
      { ids }
    )

    const removidas = await t.any(
      'DELETE FROM producao.unidade_trabalho WHERE id IN ($<ids:csv>) RETURNING id',
      { ids }
    )

    const resumo = {
      operacao: 'unidade_trabalho_sem_atividade',
      alvo: 'unidades de trabalho sem atividade',
      removidos: removidas.length,
      detalhe: detalheComTeto(alvos)
    }

    await auditoriaCtrl.registrar(t, {
      tabela: ZONA_PERIGO,
      operacao: 'D',
      depois: resumo,
      usuarioUuid,
      contexto,
      motivo
    })

    return resumo
  })
}

module.exports = controller
