'use strict'

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const {
  SITUACAO_TRANSFERENCIA,
  TIPO_TRANSFERENCIA
} = require('../utils/domain_constants')

const controller = {}

// --- Erros do banco que viram resposta amigavel ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const EXCLUSION_VIOLATION = '23P01'

/**
 * Traduz o erro do PostgreSQL para o 4xx que diz o que fazer.
 *
 * O 500 cru cita o nome da restricao ('indisponibilidade_sem_sobreposicao'), que
 * nao ajuda quem acabou de digitar. Os tres codigos abaixo sao os unicos que uma
 * requisicao BEM formada consegue produzir neste modulo, e cada um tem uma causa
 * unica:
 *
 *   23505 - o `nr_patrimonio` (UNIQUE) ou o `nome` do tipo (UNIQUE)
 *   23503 - um `classe_id`, `tipo_id`, `secao_detentora_id` ou `equipamento_id`
 *           que nao existe; na EXCLUSAO, alguem ainda aponta para o registro
 *   23P01 - o EXCLUDE de sobreposicao de `indisponibilidade` e `afastamento`
 *
 * O Joi nao cobre o 23503 de proposito: `classe_id` e `secao_detentora_id` sao
 * `Joi.number().integer().required()` por contrato, e quem decide se o codigo
 * existe e a chave estrangeira. Traduzir aqui e o que evita o 500.
 */
const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err
  const frase = mensagens[err.code]
  if (!frase) return err
  return new AppError(frase, mensagens.status || httpCode.Conflict, err)
}

const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    throw traduzirErro(err, mensagens)
  }
}

// --- Normalizacao do corpo ---------------------------------------------------

/**
 * O opcional AUSENTE vira null antes da consulta.
 *
 * Sem isto, um corpo valido que omite um campo opcional derruba o pg-promise com
 * "Property doesn't exist", que chega como 500 onde nao houve erro nenhum.
 *
 * @param {string[]} colunas
 * @param {object} dados
 * @returns {object}
 */
const normaliza = (colunas, dados) => {
  const saida = {}
  for (const coluna of colunas) {
    saida[coluna] = dados[coluna] !== undefined ? dados[coluna] : null
  }
  return saida
}

// --- Dominio -----------------------------------------------------------------

// AS CINCO LISTAS NUMA RESPOSTA SO. A tela de bens precisa das cinco para
// desenhar um formulario, e cinco requisicoes para cinco catalogos de duas a
// cinco linhas seria cinco vezes o custo de rede para o mesmo desenho.
controller.getDominio = async () => {
  return db.conn.task(async t => {
    const [
      classeSuprimento,
      secaoDetentora,
      situacao,
      situacaoTransferencia,
      tipoTransferencia
    ] = await Promise.all([
      t.any('SELECT code, nome FROM equipamento.classe_suprimento ORDER BY code'),
      t.any('SELECT code, nome FROM equipamento.secao_detentora ORDER BY code'),
      // A `precedencia` SAI JUNTO, e e o dado: ela e a escada da situacao
      // derivada (10 Disponivel, 20 Afastado, 30 Em manutencao, 40 Indisponivel,
      // 50 Baixado), e e por ela que a tela ordena as colunas do painel. Ordenar
      // por `code` daria a mesma sequencia hoje e deixaria de dar no dia em que
      // um degrau novo entrar no meio.
      t.any('SELECT code, nome, precedencia FROM equipamento.situacao ORDER BY precedencia'),
      t.any('SELECT code, nome FROM equipamento.situacao_transferencia ORDER BY code'),
      t.any('SELECT code, nome FROM equipamento.tipo_transferencia ORDER BY code')
    ])

    return {
      classe_suprimento: classeSuprimento,
      secao_detentora: secaoDetentora,
      situacao,
      situacao_transferencia: situacaoTransferencia,
      tipo_transferencia: tipoTransferencia
    }
  })
}

// --- Tipo de equipamento -----------------------------------------------------

const COLUNAS_TIPO = ['nome', 'descricao', 'vida_util_meses', 'ativo']

const ERROS_TIPO = {
  [UNIQUE_VIOLATION]: 'Já existe um tipo de equipamento com este nome'
}

const ERROS_TIPO_DELETE = {
  [FK_VIOLATION]:
    'Não é possível remover o tipo: existe bem cadastrado com ele. Marque-o como inativo em vez de removê-lo'
}

controller.listarTipo = async () => {
  return db.conn.any(
    `SELECT id, nome, descricao, vida_util_meses, ativo
       FROM equipamento.tipo_equipamento
      ORDER BY nome`
  )
}

controller.criarTipo = async (dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criado = await t.one(
          `INSERT INTO equipamento.tipo_equipamento (nome, descricao, vida_util_meses, ativo)
           VALUES ($<nome>, $<descricao>, $<vida_util_meses>, $<ativo>)
           RETURNING *`,
          normaliza(COLUNAS_TIPO, dados)
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'equipamento.tipo_equipamento',
          registroId: criado.id,
          operacao: 'I',
          depois: criado,
          usuarioUuid,
          contexto
        })

        return { id: criado.id }
      }),
    ERROS_TIPO
  )
}

controller.atualizarTipo = async (id, dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado anterior
        // para o rastro e lanca o 404 quando o registro nao existe.
        const antes = await auditoriaCtrl.lerAntes(
          t,
          'equipamento.tipo_equipamento',
          id,
          'Tipo de equipamento'
        )

        const depois = await t.one(
          // `ativo` PRESERVA A COLUNA quando a chave nao vem. O schema de
          // atualizacao tirou o default `true` justamente para que a ausencia
          // deixe de significar "reative"; sem o COALESCE aqui, `normaliza`
          // mandaria NULL contra uma coluna NOT NULL.
          `UPDATE equipamento.tipo_equipamento SET
             nome = $<nome>, descricao = $<descricao>,
             vida_util_meses = $<vida_util_meses>,
             ativo = COALESCE($<ativo>, ativo)
           WHERE id = $<id>
           RETURNING *`,
          { ...normaliza(COLUNAS_TIPO, dados), id }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'equipamento.tipo_equipamento',
          registroId: id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })
      }),
    ERROS_TIPO
  )
}

controller.deletarTipo = async (id, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const antes = await auditoriaCtrl.lerAntes(
          t,
          'equipamento.tipo_equipamento',
          id,
          'Tipo de equipamento'
        )

        await t.none('DELETE FROM equipamento.tipo_equipamento WHERE id = $<id>', { id })

        await auditoriaCtrl.registrar(t, {
          tabela: 'equipamento.tipo_equipamento',
          registroId: id,
          operacao: 'D',
          antes,
          usuarioUuid,
          contexto
        })
      }),
    ERROS_TIPO_DELETE
  )
}

// --- O bem -------------------------------------------------------------------

// A SITUACAO VEM DO BANCO, e nao do JavaScript, e isto PARECE defeito.
//
// `equipamento.situacao_em(p_dia)` e uma funcao SQL que recebe o DIA e devolve o
// degrau mais alto que se aplica nele: Disponivel (10), Afastado (20), Em
// manutencao (30), Indisponivel (40), Baixado (50). Reimplementar a escada aqui
// custaria menos linhas hoje e daria DUAS definicoes da mesma verdade: a do
// relatorio DMT, a do painel e a da lista se responderiam diferente no dia em
// que uma das copias esquecesse um degrau. Ela e funcao (e nao view) pelo mesmo
// motivo de `pit.meta_em(d)`: a pergunta "qual era a situacao em 31/07" tem de
// ter resposta, e a view so sabe hoje.
const SELECT_EQUIPAMENTO = `
  SELECT e.id, e.nr_patrimonio, e.patrimonio_pendente,
         e.classe_id, c.nome AS classe,
         e.tipo_id, t.nome AS tipo,
         e.modelo, e.nr_serie,
         e.data_entrada_carga,
         -- A vida util do BEM manda; na falta dela vale a do TIPO, e a coluna
         -- vida_util_herdada diz de onde ela veio. Sem a segunda coluna, a tela
         -- nao teria como mostrar o campo vazio no formulario e o numero
         -- herdado na listagem. (Sem crase neste comentario: template literal.)
         COALESCE(e.vida_util_meses, t.vida_util_meses) AS vida_util_meses,
         (e.vida_util_meses IS NULL AND t.vida_util_meses IS NOT NULL) AS vida_util_herdada,
         e.secao_detentora_id, sd.nome AS secao_detentora,
         e.ativo,
         s.situacao_id, sit.nome AS situacao,
         e.observacao
    FROM equipamento.equipamento AS e
    INNER JOIN equipamento.classe_suprimento AS c ON c.code = e.classe_id
    INNER JOIN equipamento.tipo_equipamento AS t ON t.id = e.tipo_id
    INNER JOIN equipamento.secao_detentora AS sd ON sd.code = e.secao_detentora_id
    INNER JOIN equipamento.situacao_em(CURRENT_DATE) AS s ON s.equipamento_id = e.id
    INNER JOIN equipamento.situacao AS sit ON sit.code = s.situacao_id`

// SEM `data_cadastramento`, `usuario_cadastramento_uuid`, `data_modificacao` e
// `usuario_modificacao_uuid` na resposta, embora as quatro colunas EXISTAM e
// sejam escritas. Quem guarda "quem mexeu e quando" neste sistema e
// `auditoria.evento`, e a ficha le o rastro por
// `/api/auditoria/equipamento/equipamento/:id`. E a mesma escolha da 1.43.0 no
// orcamento.

const COLUNAS_EQUIPAMENTO = [
  'nr_patrimonio', 'patrimonio_pendente', 'classe_id', 'tipo_id', 'modelo',
  'nr_serie', 'data_entrada_carga', 'vida_util_meses', 'secao_detentora_id',
  'ativo', 'observacao'
]

const ERROS_EQUIPAMENTO = {
  [UNIQUE_VIOLATION]: 'Já existe um bem cadastrado com este número de patrimônio',
  [FK_VIOLATION]: 'Classe, tipo ou seção detentora inexistente'
}

const ERROS_EQUIPAMENTO_DELETE = {
  [FK_VIOLATION]:
    'Não é possível remover o bem: existe indisponibilidade, afastamento, manutenção ou transferência lançada nele'
}

controller.listar = async (filtros = {}) => {
  return db.conn.any(
    `${SELECT_EQUIPAMENTO}
      WHERE ($<situacaoId> IS NULL OR s.situacao_id = $<situacaoId>)
        AND ($<secaoDetentoraId> IS NULL OR e.secao_detentora_id = $<secaoDetentoraId>)
        AND ($<tipoId> IS NULL OR e.tipo_id = $<tipoId>)
        AND ($<ativo> IS NULL OR e.ativo = $<ativo>)
      ORDER BY t.nome, e.modelo, e.nr_patrimonio`,
    {
      situacaoId: filtros.situacao_id !== undefined ? filtros.situacao_id : null,
      secaoDetentoraId:
        filtros.secao_detentora_id !== undefined ? filtros.secao_detentora_id : null,
      tipoId: filtros.tipo_id !== undefined ? filtros.tipo_id : null,
      ativo: filtros.ativo !== undefined ? filtros.ativo : null
    }
  )
}

// Os quatro historicos da FICHA, cada um ja com o nome dos dominios resolvido.
// Eles saem da MESMA task do bem: a ficha e uma foto do bem num instante, e
// cinco conexoes separadas poderiam fotografar cinco instantes diferentes.
const historicosDoBem = async (t, id) => {
  const [indisponibilidades, afastamentos, manutencoes, transferencias] =
    await Promise.all([
      t.any(
        `SELECT id, equipamento_id, data_inicio, data_fim, motivo, previsao_retorno
           FROM equipamento.indisponibilidade
          WHERE equipamento_id = $<id>
          ORDER BY data_inicio DESC, id DESC`,
        { id }
      ),
      t.any(
        `SELECT id, equipamento_id, om, motivo, data_inicio, previsao_termino, data_fim
           FROM equipamento.afastamento
          WHERE equipamento_id = $<id>
          ORDER BY data_inicio DESC, id DESC`,
        { id }
      ),
      t.any(
        `SELECT id, equipamento_id, indisponibilidade_id, data_inicio, data_fim,
                descricao, valor, valor_orcado, valor_pdr, certame
           FROM equipamento.manutencao
          WHERE equipamento_id = $<id>
          ORDER BY data_inicio DESC, id DESC`,
        { id }
      ),
      // A TRANSFERENCIA ORDENA POR `data_solicitacao`, e nao por `data_inicio`,
      // que ela nao tem: uma transferencia e um pedido, e o que a data as
      // ordena e quando ele foi feito. `NULLS LAST` porque as 10 descargas
      // solicitadas da carga inicial nao trazem data nenhuma, e sem isso elas
      // encabecariam a lista de todo bem.
      t.any(
        `SELECT tr.id, tr.equipamento_id,
                tr.tipo_id, tt.nome AS tipo,
                tr.situacao_id, st.nome AS situacao,
                tr.om, tr.documento_solicitacao, tr.data_solicitacao,
                tr.data_transferencia, tr.transferido_siafi, tr.apropriado_siafi,
                tr.publicacao_autorizacao, tr.descricao
           FROM equipamento.transferencia AS tr
           INNER JOIN equipamento.tipo_transferencia AS tt ON tt.code = tr.tipo_id
           INNER JOIN equipamento.situacao_transferencia AS st ON st.code = tr.situacao_id
          WHERE tr.equipamento_id = $<id>
          ORDER BY tr.data_solicitacao DESC NULLS LAST, tr.id DESC`,
        { id }
      )
    ])

  return { indisponibilidades, afastamentos, manutencoes, transferencias }
}

controller.getPorId = async id => {
  return db.conn.task(async t => {
    const bem = await t.oneOrNone(`${SELECT_EQUIPAMENTO} WHERE e.id = $<id>`, { id })
    if (!bem) {
      throw new AppError('Equipamento não encontrado', httpCode.NotFound)
    }

    const historicos = await historicosDoBem(t, id)

    return { ...bem, ...historicos }
  })
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criado = await t.one(
          // O COALESCE de `patrimonio_pendente` guarda a coluna NOT NULL: o Joi
          // ja poe `false` no corpo validado, e `normaliza` transformaria em NULL
          // um campo que chegasse por outro caminho. Sem ele, o INSERT falharia
          // com violacao de NOT NULL em vez de gravar o caso normal.
          `INSERT INTO equipamento.equipamento
             (nr_patrimonio, patrimonio_pendente, classe_id, tipo_id, modelo,
              nr_serie, data_entrada_carga, vida_util_meses, secao_detentora_id,
              ativo, observacao, usuario_cadastramento_uuid)
           VALUES
             ($<nr_patrimonio>, COALESCE($<patrimonio_pendente>, FALSE),
              $<classe_id>, $<tipo_id>, $<modelo>, $<nr_serie>,
              $<data_entrada_carga>, $<vida_util_meses>, $<secao_detentora_id>,
              $<ativo>, $<observacao>, $<usuarioUuid>)
           RETURNING *`,
          { ...normaliza(COLUNAS_EQUIPAMENTO, dados), usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'equipamento.equipamento',
          registroId: criado.id,
          operacao: 'I',
          depois: criado,
          usuarioUuid,
          contexto
        })

        // O `RETURNING *` e do rastro; a rota devolve so o id.
        return { id: criado.id }
      }),
    ERROS_EQUIPAMENTO
  )
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const antes = await auditoriaCtrl.lerAntes(
          t,
          'equipamento.equipamento',
          id,
          'Equipamento'
        )

        const depois = await t.one(
          // OS DOIS BOOLEANOS PRESERVAM A COLUNA, e nao um literal.
          //
          // `patrimonio_pendente = COALESCE(..., FALSE)` resolvia o NOT NULL e
          // ainda assim APAGAVA a marca: um PUT sem a chave declarava conferido
          // um numero que ninguem conferiu, e o Relatorio DMT parava de escrever
          // "Patrimonio por conferir". `ativo = $<ativo>` era pior, porque o
          // default `true` do schema de criacao ressuscitava o bem BAIXADO.
          //
          // Com o default fora do schema de atualizacao, a chave ausente chega
          // como NULL e o COALESCE devolve o que ja estava gravado.
          `UPDATE equipamento.equipamento SET
             nr_patrimonio = $<nr_patrimonio>,
             patrimonio_pendente = COALESCE($<patrimonio_pendente>, patrimonio_pendente),
             classe_id = $<classe_id>,
             tipo_id = $<tipo_id>, modelo = $<modelo>, nr_serie = $<nr_serie>,
             data_entrada_carga = $<data_entrada_carga>,
             vida_util_meses = $<vida_util_meses>,
             secao_detentora_id = $<secao_detentora_id>,
             ativo = COALESCE($<ativo>, ativo),
             observacao = $<observacao>,
             data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
           WHERE id = $<id>
           RETURNING *`,
          { ...normaliza(COLUNAS_EQUIPAMENTO, dados), id, usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'equipamento.equipamento',
          registroId: id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })
      }),
    ERROS_EQUIPAMENTO
  )
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const antes = await auditoriaCtrl.lerAntes(
          t,
          'equipamento.equipamento',
          id,
          'Equipamento'
        )

        await t.none('DELETE FROM equipamento.equipamento WHERE id = $<id>', { id })

        await auditoriaCtrl.registrar(t, {
          tabela: 'equipamento.equipamento',
          registroId: id,
          operacao: 'D',
          antes,
          usuarioUuid,
          contexto
        })
      }),
    ERROS_EQUIPAMENTO_DELETE
  )
}

// --- Os quatro historicos ----------------------------------------------------

/**
 * O CRUD dos quatro historicos, numa fabrica so.
 *
 * As quatro tabelas (`indisponibilidade`, `afastamento`, `manutencao`,
 * `transferencia`) tem a MESMA forma: pertencem a um bem, sao lancadas na ficha
 * dele, entram no rastro pelo mesmo agregado e sao lidas por uma lista solta com
 * os mesmos dois filtros. O que muda entre elas e a lista de colunas, a ordem e
 * o que "aberta" quer dizer -- e isso e DADO, declarado logo abaixo.
 *
 * Quatro copias do mesmo corpo divergiriam: bastaria uma delas esquecer o
 * `data_modificacao`, ou auditar fora da transacao, para o defeito existir num
 * canto e nao no outro, sem nada acusar.
 *
 * @param {object} config
 * @param {string} config.tabela - 'equipamento.<nome>'
 * @param {string} config.nomeAmigavel - como o 404 e o 409 chamam o registro
 * @param {string[]} config.colunas - as colunas de dado, fora `equipamento_id`
 * @param {string} config.selectExtra - colunas resolvidas por JOIN, ou ''
 * @param {string} config.joins - os JOIN de dominio, ou ''
 * @param {string} config.ordem - o ORDER BY da lista solta
 * @param {string} config.aberta - a condicao de "ainda em curso"
 * @param {string[]} config.preservarSeAusente - colunas NOT NULL com default no
 *   banco cuja chave ausente no PUT quer dizer "nao mexe", e nao o default. O
 *   UPDATE as grava por `COALESCE($<c>, c)`. Ver a nota do `equipamento_schema`.
 * @param {object} config.erros - as frases por codigo do PostgreSQL
 */
const crudDoHistorico = ({
  tabela,
  nomeAmigavel,
  colunas,
  preservarSeAusente = [],
  selectExtra = '',
  joins = '',
  ordem,
  aberta,
  erros = {}
}) => {
  const colunasSql = colunas.map(c => `h.${c}`).join(', ')
  // O UPDATE do PUT reescreve a linha inteira, entao coluna com default no
  // schema de criacao precisa que a chave ausente signifique "nao mexe". As
  // declaradas em `preservarSeAusente` gravam a PROPRIA coluna quando o corpo
  // nao as traz; as outras gravam o que veio (NULL inclusive, que e o que
  // "apague este campo" quer dizer nelas).
  const setSql = colunas
    .map(c =>
      preservarSeAusente.includes(c)
        ? `${c} = COALESCE($<${c}>, ${c})`
        : `${c} = $<${c}>`
    )
    .join(', ')
  const insertColunas = colunas.join(', ')
  const insertValores = colunas.map(c => `$<${c}>`).join(', ')

  return {
    // A LISTA SOLTA traz `nr_patrimonio` e `modelo` do bem junto, e nao so o
    // `equipamento_id`: a tela de lancamento mostra uma linha por lancamento de
    // TODOS os bens, e um id nu nao diz de qual maquina se fala.
    listar: async (filtros = {}) => {
      return db.conn.any(
        `SELECT h.id, h.equipamento_id, e.nr_patrimonio, e.modelo${selectExtra},
                ${colunasSql}
           FROM ${tabela} AS h
           INNER JOIN equipamento.equipamento AS e ON e.id = h.equipamento_id
           ${joins}
          WHERE ($<equipamentoId> IS NULL OR h.equipamento_id = $<equipamentoId>)
            -- IS NOT TRUE cobre os dois casos que nao filtram nada com uma
            -- comparacao so: o parametro ausente (null) e o aberta=false, que
            -- pede a lista INTEIRA e nao a dos ja fechados. So aberta=true
            -- estreita.
            AND ($<abertaFiltro> IS NOT TRUE OR ${aberta})
          ORDER BY ${ordem}`,
        {
          equipamentoId:
            filtros.equipamento_id !== undefined ? filtros.equipamento_id : null,
          abertaFiltro: filtros.aberta !== undefined ? filtros.aberta : null
        }
      )
    },

    criar: async (dados, usuarioUuid, contexto) => {
      return comTraducao(
        () =>
          db.conn.tx(async t => {
            const criado = await t.one(
              `INSERT INTO ${tabela}
                 (equipamento_id, ${insertColunas}, usuario_cadastramento_uuid)
               VALUES
                 ($<equipamento_id>, ${insertValores}, $<usuarioUuid>)
               RETURNING *`,
              {
                ...normaliza(colunas, dados),
                equipamento_id: dados.equipamento_id,
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela,
              registroId: criado.id,
              operacao: 'I',
              depois: criado,
              usuarioUuid,
              contexto
            })

            return { id: criado.id }
          }),
        erros
      )
    },

    atualizar: async (id, dados, usuarioUuid, contexto) => {
      return comTraducao(
        () =>
          db.conn.tx(async t => {
            const antes = await auditoriaCtrl.lerAntes(t, tabela, id, nomeAmigavel)

            const depois = await t.one(
              // `COALESCE` NO DONO, e nao `equipamento_id = $<equipamento_id>`:
              // o formulario da ficha do bem edita o lancamento sem reafirmar de
              // quem ele e, e sem o COALESCE o ausente viraria NULL contra uma
              // coluna NOT NULL. Quando o campo VEM, ele vale, e um lancamento
              // digitado no bem errado se conserta sem apagar e recriar.
              `UPDATE ${tabela} SET
                 equipamento_id = COALESCE($<equipamento_id>, equipamento_id),
                 ${setSql},
                 data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
               WHERE id = $<id>
               RETURNING *`,
              {
                ...normaliza(colunas, dados),
                equipamento_id:
                  dados.equipamento_id !== undefined ? dados.equipamento_id : null,
                id,
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela,
              registroId: id,
              operacao: 'U',
              antes,
              depois,
              usuarioUuid,
              contexto
            })
          }),
        erros
      )
    },

    deletar: async (id, usuarioUuid, contexto) => {
      return comTraducao(
        () =>
          db.conn.tx(async t => {
            const antes = await auditoriaCtrl.lerAntes(t, tabela, id, nomeAmigavel)

            await t.none(`DELETE FROM ${tabela} WHERE id = $<id>`, { id })

            await auditoriaCtrl.registrar(t, {
              tabela,
              registroId: id,
              operacao: 'D',
              antes,
              usuarioUuid,
              contexto
            })
          }),
        erros
      )
    }
  }
}

const SOBREPOSICAO_INDISPONIBILIDADE =
  'Este bem já tem uma indisponibilidade que cobre parte deste período. Feche a anterior antes de lançar a nova.'

const SOBREPOSICAO_AFASTAMENTO =
  'Este bem já tem um afastamento que cobre parte deste período. Feche o anterior antes de lançar o novo.'

const BEM_INEXISTENTE = 'Equipamento inexistente'

controller.indisponibilidade = crudDoHistorico({
  tabela: 'equipamento.indisponibilidade',
  nomeAmigavel: 'Indisponibilidade',
  colunas: ['data_inicio', 'data_fim', 'motivo', 'previsao_retorno'],
  ordem: 'h.data_inicio DESC, h.id DESC',
  aberta: 'h.data_fim IS NULL',
  erros: {
    [EXCLUSION_VIOLATION]: SOBREPOSICAO_INDISPONIBILIDADE,
    [FK_VIOLATION]: BEM_INEXISTENTE
  }
})

controller.afastamento = crudDoHistorico({
  tabela: 'equipamento.afastamento',
  nomeAmigavel: 'Afastamento',
  colunas: ['om', 'motivo', 'data_inicio', 'previsao_termino', 'data_fim'],
  ordem: 'h.data_inicio DESC, h.id DESC',
  aberta: 'h.data_fim IS NULL',
  erros: {
    [EXCLUSION_VIOLATION]: SOBREPOSICAO_AFASTAMENTO,
    [FK_VIOLATION]: BEM_INEXISTENTE
  }
})

controller.manutencao = crudDoHistorico({
  tabela: 'equipamento.manutencao',
  nomeAmigavel: 'Manutenção',
  colunas: [
    'indisponibilidade_id', 'data_inicio', 'data_fim', 'descricao',
    'valor', 'valor_orcado', 'valor_pdr', 'certame'
  ],
  ordem: 'h.data_inicio DESC, h.id DESC',
  aberta: 'h.data_fim IS NULL',
  erros: {
    [FK_VIOLATION]: 'Equipamento ou indisponibilidade inexistente'
  }
})

controller.transferencia = crudDoHistorico({
  tabela: 'equipamento.transferencia',
  nomeAmigavel: 'Transferência',
  colunas: [
    'tipo_id', 'situacao_id', 'om', 'documento_solicitacao', 'data_solicitacao',
    'data_transferencia', 'transferido_siafi', 'apropriado_siafi',
    'publicacao_autorizacao', 'descricao'
  ],
  // OS DOIS SIAFI SAO NOT NULL, e o schema de criacao lhes da default `false`.
  // Num PUT sem eles, o default gravaria: um bem ja transferido e apropriado no
  // SIAFI voltaria a "em transito contabil" com 200 e sem aviso. Aqui a chave
  // ausente preserva o que esta gravado.
  preservarSeAusente: ['transferido_siafi', 'apropriado_siafi'],
  selectExtra: ', tt.nome AS tipo, st.nome AS situacao',
  joins: `INNER JOIN equipamento.tipo_transferencia AS tt ON tt.code = h.tipo_id
           INNER JOIN equipamento.situacao_transferencia AS st ON st.code = h.situacao_id`,
  ordem: 'h.data_solicitacao DESC NULLS LAST, h.id DESC',
  // "ABERTA" AQUI NAO E `data_fim IS NULL`, porque `transferencia` nao tem
  // `data_fim`: uma transferencia nao dura, ela se resolve. O equivalente honesto
  // de "ainda em curso" e a situacao que nao terminou -- nem Concluída nem
  // Cancelada. E o mesmo filtro que a tela usa para achar as descargas
  // solicitadas que esperam autorizacao.
  aberta: `h.situacao_id NOT IN (${SITUACAO_TRANSFERENCIA.CONCLUIDA}, ${SITUACAO_TRANSFERENCIA.CANCELADA})`,
  erros: {
    [FK_VIOLATION]: 'Equipamento, tipo ou situação de transferência inexistente'
  }
})

// --- Painel ------------------------------------------------------------------

controller.getDashboard = async () => {
  return db.conn.task(async t => {
    const [
      porSituacao,
      porSecao,
      porTipo,
      indisponiveisHa,
      custoManutencao,
      descargas,
      patrimoniosPendentes
    ] = await Promise.all([
      // LEFT JOIN a partir do DOMINIO, e nao GROUP BY do que existe: a situacao
      // com zero bem tem de aparecer com zero. Um painel que some a coluna
      // 'Em manutenção' no dia em que nada esta em manutencao faz quem le achar
      // que a coluna nunca existiu.
      t.any(
        `SELECT s.code AS situacao_id, s.nome AS situacao,
                COUNT(x.equipamento_id)::integer AS quantidade
           FROM equipamento.situacao AS s
           LEFT JOIN equipamento.situacao_em(CURRENT_DATE) AS x ON x.situacao_id = s.code
          GROUP BY s.code, s.nome, s.precedencia
          ORDER BY s.precedencia`
      ),
      t.any(
        `SELECT sd.code AS secao_detentora_id, sd.nome AS secao_detentora,
                COUNT(e.id)::integer AS quantidade
           FROM equipamento.secao_detentora AS sd
           LEFT JOIN equipamento.equipamento AS e ON e.secao_detentora_id = sd.code
          GROUP BY sd.code, sd.nome
          ORDER BY sd.code`
      ),
      t.any(
        `SELECT tp.id AS tipo_id, tp.nome AS tipo,
                COUNT(e.id)::integer AS quantidade
           FROM equipamento.tipo_equipamento AS tp
           LEFT JOIN equipamento.equipamento AS e ON e.tipo_id = tp.id
          GROUP BY tp.id, tp.nome
          ORDER BY COUNT(e.id) DESC, tp.nome`
      ),
      // O PARADO HA MAIS TEMPO PRIMEIRO (`data_inicio` ASC), e no maximo 10: e a
      // lista que responde "o que esta encalhado", e nao "o que quebrou ontem".
      //
      // A JANELA E A DE `situacao_em`, LETRA POR LETRA, e nao "sem data_fim".
      // `data_inicio <= CURRENT_DATE` porque `dias` seria NEGATIVO num
      // lancamento com data futura; `data_fim IS NULL OR data_fim >=
      // CURRENT_DATE` porque a funcao conta como indisponivel o lancamento que
      // FECHA HOJE (`data_fim >= p_dia`). Com so o `IS NULL`, o bem cujo
      // conserto terminou hoje contava no cartao 'Indisponivel' logo acima e
      // sumia desta lista, no unico dia em que os dois numeros se olham.
      t.any(
        `SELECT e.id, e.nr_patrimonio, e.patrimonio_pendente, e.modelo,
                tp.nome AS tipo,
                i.data_inicio, (CURRENT_DATE - i.data_inicio)::integer AS dias,
                i.motivo
           FROM equipamento.indisponibilidade AS i
           INNER JOIN equipamento.equipamento AS e ON e.id = i.equipamento_id
           INNER JOIN equipamento.tipo_equipamento AS tp ON tp.id = e.tipo_id
          WHERE i.data_inicio <= CURRENT_DATE
            AND (i.data_fim IS NULL OR i.data_fim >= CURRENT_DATE)
          ORDER BY i.data_inicio ASC, i.id ASC
          LIMIT 10`
      ),
      // O cartao que veio do Resumo Anual da mapoteca. `::float8` porque o
      // NUMERIC do pg-promise chega como TEXTO, e o cartao soma no cliente:
      // '600.00' + '600.00' daria '600.00600.00'.
      //
      // O ANO CORRENTE recorta por `data_inicio`: a manutencao entra no ano em
      // que ela COMECOU, que e quando o dinheiro foi comprometido.
      t.one(
        `SELECT EXTRACT(YEAR FROM CURRENT_DATE)::integer AS ano,
                COUNT(*)::integer AS quantidade,
                COALESCE(SUM(m.valor), 0)::float8 AS valor
           FROM equipamento.manutencao AS m
          WHERE m.data_inicio >= date_trunc('year', CURRENT_DATE)::date
            AND m.data_inicio < (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year')::date`
      ),
      t.one(
        `SELECT COUNT(*)::integer AS quantidade
           FROM equipamento.transferencia
          WHERE tipo_id = $<descarga> AND situacao_id = $<solicitada>`,
        {
          descarga: TIPO_TRANSFERENCIA.DESCARGA,
          solicitada: SITUACAO_TRANSFERENCIA.SOLICITADA
        }
      ),
      // OS BENS CUJO NUMERO DE PATRIMONIO ESTA POR CONFERIR, e NOMEADOS, e nao
      // contados. Um cartao com "1" nao diz a quem for a prateleira qual etiqueta
      // ler; a lista da o tipo, o modelo e a entrada em carga, que e o que
      // distingue os dois bens que brigam pelo mesmo numero.
      //
      // SEM LIMIT, de proposito. A lista e a fila de trabalho, e ela e curta por
      // natureza: um numero por conferir e defeito, e nao estado. No dia em que
      // ela crescer, o tamanho dela e a noticia, e cortar em 10 esconderia
      // justamente essa noticia.
      t.any(
        `SELECT e.id, e.nr_patrimonio, e.modelo, e.data_entrada_carga,
                tp.nome AS tipo, e.observacao
           FROM equipamento.equipamento AS e
           INNER JOIN equipamento.tipo_equipamento AS tp ON tp.id = e.tipo_id
          WHERE e.patrimonio_pendente
          ORDER BY tp.nome, e.modelo, e.id`
      )
    ])

    return {
      porSituacao,
      porSecao,
      porTipo,
      indisponiveisHa,
      custoManutencao,
      descargasSolicitadas: descargas.quantidade,
      patrimoniosPendentes
    }
  })
}

// --- O relatorio DMT ---------------------------------------------------------

/**
 * As linhas do Relatorio DMT, uma por bem, na ordem de saida.
 *
 * O documento e o que a Secao ja entrega hoje numa planilha de 26 colunas, e ele
 * e CONTRATO DE SAIDA: quem o recebe compara com o do mes passado. Por isso as
 * chaves daqui espelham as colunas da planilha, e nao a modelagem do banco.
 *
 * UMA CONSULTA SO, com quatro LATERAL. Para cada bem ela pega:
 *   - o AFASTAMENTO que vale HOJE, pela mesma janela de `situacao_em`;
 *   - a INDISPONIBILIDADE que vale HOJE, pela mesma janela;
 *   - a MANUTENCAO ligada AQUELA indisponibilidade (e nao a ultima do bem: a
 *     planilha poe o valor orcado na mesma linha do motivo da parada, e as duas
 *     colunas tem de falar do mesmo evento);
 *   - a TRANSFERENCIA mais recente.
 *
 * `ORDER BY e.id` reproduz a ordem da planilha de origem, que e a ordem em que a
 * carga inicial inseriu os bens (a coluna 0 da planilha e o ID da Secao).
 *
 * @returns {Promise<object[]>}
 */
controller.linhasDoRelatorioDmt = async () => {
  const linhas = await db.conn.any(
    `SELECT e.id,
            c.nome AS classe,
            tp.nome AS tipo,
            e.modelo,
            e.nr_patrimonio,
            e.patrimonio_pendente,
            e.data_entrada_carga,
            COALESCE(e.vida_util_meses, tp.vida_util_meses) AS vida_util_meses,
            sd.nome AS secao_detentora,
            sit.nome AS situacao,
            af.om AS afastamento_om,
            af.motivo AS afastamento_motivo,
            af.data_inicio AS afastamento_data_inicio,
            af.previsao_termino AS afastamento_previsao_termino,
            ind.motivo AS indisponibilidade_motivo,
            ind.data_inicio AS indisponibilidade_data_inicio,
            ind.previsao_retorno AS indisponibilidade_previsao_retorno,
            man.valor_orcado::float8 AS manutencao_valor_orcado,
            man.valor_pdr::float8 AS manutencao_valor_pdr,
            man.certame AS manutencao_certame,
            (dsc.id IS NOT NULL) AS tem_descarga_solicitada,
            tr.om AS transferencia_om,
            tr.documento_solicitacao AS transferencia_documento_solicitacao,
            tr.data_transferencia AS transferencia_data,
            COALESCE(tr.transferido_siafi, FALSE) AS transferido_siafi,
            COALESCE(tr.apropriado_siafi, FALSE) AS apropriado_siafi,
            tr.publicacao_autorizacao AS transferencia_publicacao,
            tr.descricao AS transferencia_descricao
       FROM equipamento.equipamento AS e
       INNER JOIN equipamento.classe_suprimento AS c ON c.code = e.classe_id
       INNER JOIN equipamento.tipo_equipamento AS tp ON tp.id = e.tipo_id
       INNER JOIN equipamento.secao_detentora AS sd ON sd.code = e.secao_detentora_id
       INNER JOIN equipamento.situacao_em(CURRENT_DATE) AS s ON s.equipamento_id = e.id
       INNER JOIN equipamento.situacao AS sit ON sit.code = s.situacao_id
       -- A JANELA DAS DUAS LATERAIS E A DE situacao_em(CURRENT_DATE), e nao
       -- "sem data_fim". A coluna 9 (Situacao) sai da funcao, e as colunas 10 a
       -- 15 saem daqui: com regras diferentes, o bem cujo afastamento ou
       -- conserto TERMINA HOJE (data_fim = CURRENT_DATE, que a funcao ainda
       -- conta por data_fim >= p_dia) saia do relatorio como 'Afastado' ou
       -- 'Indisponivel' com Local, Motivo e Inicio em branco. O documento e
       -- contrato de saida, e uma linha que se contradiz e pior que uma vazia.
       LEFT JOIN LATERAL (
         SELECT a.om, a.motivo, a.data_inicio, a.previsao_termino
           FROM equipamento.afastamento AS a
          WHERE a.equipamento_id = e.id
            AND a.data_inicio <= CURRENT_DATE
            AND (a.data_fim IS NULL OR a.data_fim >= CURRENT_DATE)
          ORDER BY a.data_inicio DESC, a.id DESC
          LIMIT 1
       ) AS af ON TRUE
       LEFT JOIN LATERAL (
         SELECT i.id, i.motivo, i.data_inicio, i.previsao_retorno
           FROM equipamento.indisponibilidade AS i
          WHERE i.equipamento_id = e.id
            AND i.data_inicio <= CURRENT_DATE
            AND (i.data_fim IS NULL OR i.data_fim >= CURRENT_DATE)
          ORDER BY i.data_inicio DESC, i.id DESC
          LIMIT 1
       ) AS ind ON TRUE
       LEFT JOIN LATERAL (
         SELECT m.valor_orcado, m.valor_pdr, m.certame
           FROM equipamento.manutencao AS m
          WHERE m.indisponibilidade_id = ind.id
          ORDER BY m.data_inicio DESC, m.id DESC
          LIMIT 1
       ) AS man ON TRUE
       LEFT JOIN LATERAL (
         SELECT x.om, x.documento_solicitacao, x.data_transferencia,
                x.transferido_siafi, x.apropriado_siafi,
                x.publicacao_autorizacao, x.descricao
           FROM equipamento.transferencia AS x
          WHERE x.equipamento_id = e.id
          ORDER BY x.data_solicitacao DESC NULLS LAST, x.id DESC
          LIMIT 1
       ) AS tr ON TRUE
       LEFT JOIN LATERAL (
         SELECT d.id
           FROM equipamento.transferencia AS d
          WHERE d.equipamento_id = e.id
            AND d.tipo_id = $<descarga> AND d.situacao_id = $<solicitada>
          ORDER BY d.id DESC
          LIMIT 1
       ) AS dsc ON TRUE
      ORDER BY e.id`,
    {
      descarga: TIPO_TRANSFERENCIA.DESCARGA,
      solicitada: SITUACAO_TRANSFERENCIA.SOLICITADA
    }
  )

  // O OBJETO E MONTADO CAMPO A CAMPO, e nao por espalhamento da linha, para as
  // chaves sairem na ORDEM das colunas da planilha. O gerador do .ods le por
  // nome, mas a ordem e o que faz este bloco se conferir contra o documento sem
  // ter de saltar entre dois arquivos.
  return linhas.map(linha => {
    return {
      id: linha.id,
      classe: linha.classe,
      tipo: linha.tipo,
      modelo: linha.modelo,
      nr_patrimonio: linha.nr_patrimonio,
      data_entrada_carga: linha.data_entrada_carga,
      vida_util_meses: linha.vida_util_meses,
      secao_detentora: linha.secao_detentora,
      situacao: linha.situacao,
      afastamento_om: linha.afastamento_om,
      afastamento_motivo: linha.afastamento_motivo,
      afastamento_data_inicio: linha.afastamento_data_inicio,
      afastamento_previsao_termino: linha.afastamento_previsao_termino,
      indisponibilidade_motivo: linha.indisponibilidade_motivo,
      indisponibilidade_data_inicio: linha.indisponibilidade_data_inicio,
      manutencao_valor_orcado: linha.manutencao_valor_orcado,
      manutencao_valor_pdr: linha.manutencao_valor_pdr,
      manutencao_certame: linha.manutencao_certame,
      // A COLUNA 18 DA PLANILHA PROMETE DUAS COISAS NUM CAMPO SO, e isto parece
      // defeito. Ela se chama 'Previsão de disponibilidade ou descarga': ora traz
      // uma DATA (quando o bem volta), ora traz o texto 'solicitado descarga'
      // (quando ele nao volta, porque esta saindo da carga). Sao grandezas
      // diferentes no mesmo lugar.
      //
      // A modelagem as SEPARA -- a data e `indisponibilidade.previsao_retorno`,
      // a descarga e uma linha de `transferencia` de tipo Descarga em situacao
      // Solicitada -- e este campo as junta de volta SO NA SAIDA, porque o
      // documento e contrato: quem o recebe compara com o do mes passado, e
      // duas colunas onde havia uma quebrariam a conferencia.
      //
      // A descarga MANDA sobre a previsao: um bem que esta saindo da carga nao
      // tem data de volta, e anunciar uma seria promessa falsa.
      previsao_disponibilidade_ou_descarga: linha.tem_descarga_solicitada
        ? 'solicitado descarga'
        : linha.indisponibilidade_previsao_retorno,
      transferencia_om: linha.transferencia_om,
      transferencia_documento_solicitacao: linha.transferencia_documento_solicitacao,
      transferencia_data: linha.transferencia_data,
      transferido_siafi: linha.transferido_siafi,
      apropriado_siafi: linha.apropriado_siafi,
      transferencia_publicacao: linha.transferencia_publicacao,
      // O AVISO DE PATRIMONIO POR CONFERIR SAI NA COLUNA 'Descricao', e nao numa
      // coluna nova. O documento e contrato de saida, e coluna 27 onde ha 26
      // quebraria a conferencia de quem o recebe. O aviso VEM NA FRENTE do texto
      // que ja houvesse: sem ele, a planilha entregaria um numero provisorio
      // indistinguivel de um verdadeiro, que e exatamente o que a coluna
      // `patrimonio_pendente` existe para impedir.
      transferencia_descricao: linha.patrimonio_pendente
        ? ['Patrimônio por conferir: o número acima é provisório.',
            linha.transferencia_descricao].filter(Boolean).join(' ')
        : linha.transferencia_descricao
    }
  })
}

module.exports = controller
