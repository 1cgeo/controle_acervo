'use strict'

const { db } = require('../../database')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')
const { invalidarCatalogos } = require('../../auditoria/renderizar')

const { AppError, httpCode } = require('../utils')

const controller = {}

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

// Codigo duplicado na criacao vira 409 amigavel.
const tratarCriar = err => {
  if (err && err.code === UNIQUE_VIOLATION) {
    throw new AppError('Já existe um registro com este código', httpCode.Conflict, err)
  }
  throw err
}

// Tentar excluir um codigo em uso (FK de NC/NE/PDR) vira 409 amigavel.
const tratarDeletar = err => {
  if (err && err.code === FK_VIOLATION) {
    throw new AppError('Não é possível excluir: há lançamentos vinculados a este código', httpCode.Conflict, err)
  }
  throw err
}

controller.getTipoPostoGrad = async () => {
  return db.conn.any('SELECT code, nome, nome_abrev FROM dominio.tipo_posto_grad ORDER BY code')
}

// AS TRES LISTAGENS DEVOLVEM `em_uso`: quantos lancamentos apontam para cada
// codigo. E o que permite a tela avisar ANTES do clique, em vez de deixar a
// pessoa confirmar "esta acao nao pode ser desfeita" para so entao levar o 409
// do `tratarDeletar`.
//
// As FKs contadas sao TODAS as que o DDL declara para as tres tabelas. O
// `::integer` evita o BIGINT do COUNT chegar como texto no JSON.
//
// A LISTA CRESCEU DUAS VEZES, e cada esquecimento custava a mesma coisa: o
// catalogo dizia "em uso: 0", a tela oferecia excluir, a pessoa confirmava a
// acao irreversivel e levava o 409 do `tratarDeletar` sobre um codigo que ela
// acabara de ler como livre. `nota_credito_recolhimento` (ND e UG) nasceu na
// 1.40.0 e `dgeo.instituicao` (UG) na 1.51.0, e nenhuma das duas entrou aqui.
// Quem acrescentar chave estrangeira para estes tres catalogos acrescenta a
// contagem junto.
controller.getNaturezaDespesa = async () => {
  return db.conn.any(
    `SELECT nd.code, nd.nome, nd.gnd, nd.grupo,
            ((SELECT COUNT(*) FROM orcamento.nota_credito WHERE cod_nd = nd.code)
           + (SELECT COUNT(*) FROM orcamento.pdr_item WHERE cod_nd = nd.code)
           + (SELECT COUNT(*) FROM orcamento.nota_credito_recolhimento
               WHERE cod_nd = nd.code))::integer AS em_uso
     FROM dominio.natureza_despesa AS nd
     ORDER BY nd.code`
  )
}

controller.getPlanoInterno = async () => {
  return db.conn.any(
    `SELECT pi.code, pi.nome, pi.alinea,
            (SELECT COUNT(*) FROM orcamento.nota_credito
              WHERE cod_pi = pi.code)::integer AS em_uso
     FROM dominio.plano_interno AS pi
     ORDER BY pi.code`
  )
}

controller.getUg = async () => {
  return db.conn.any(
    `SELECT ug.code, ug.nome,
            ((SELECT COUNT(*) FROM orcamento.nota_credito
               WHERE ug_emitente = ug.code)
           + (SELECT COUNT(*) FROM orcamento.nota_credito_recolhimento
               WHERE ug_emitente = ug.code)
           + (SELECT COUNT(*) FROM dgeo.instituicao
               WHERE ug_code = ug.code))::integer AS em_uso
     FROM dominio.ug AS ug
     ORDER BY ug.code`
  )
}

controller.getTipoLicitacao = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.tipo_licitacao ORDER BY code')
}

controller.getFaseLicitacao = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.fase_licitacao ORDER BY code')
}

controller.getClassificacaoNc = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.classificacao_nc ORDER BY code')
}

controller.getTipoItemDfd = async () => {
  return db.conn.any('SELECT code, nome FROM dominio.tipo_item_dfd ORDER BY code')
}

// NAO HA `getGrauPrioridade`, e a ausencia e a modelagem. `dominio.grau_prioridade`
// (Alta, Normal, Baixa) tinha UM consumidor no sistema inteiro,
// `orcamento.dfd.grau_prioridade_id`, preenchido em 1 linha de 8 e sempre com o
// mesmo codigo. A coluna saiu na 1.43.0 e a tabela de dominio saiu no mesmo
// commit, junto com a rota `GET /orcamento/dominio/grau_prioridade`: deixar o
// catalogo servindo codigo que nada mais referencia e o tipo de meio cadaver que
// a 1.34.0 ja recusou uma vez.

// ---------------------------------------------------------------------------
// CRUD dos dominios editaveis pela Configuracao: natureza de despesa, plano
// interno e UG emitente. O `code` e a chave (informado pelo usuario).
//
// AS NOVE FUNCOES ABAIXO AUDITAM, DENTRO DE TRANSACAO E COM AUTOR. Elas sao a
// alteracao de MAIOR ALCANCE do modulo: mudar o nome ou o GND de uma ND
// RECLASSIFICA toda NC e toda NE ja lancadas com aquele codigo.
//
// As tres tabelas moram no schema `dominio`, e nao em `orcamento`, mas o CRUD e
// do orcamento e o mapa de auditoria as declara com `modulo: 'orcamento'`: quem
// procura "por que a ND 339030 mudou de nome" procura no orcamento.
// ---------------------------------------------------------------------------

// grupo (custeio/capital) e derivado do GND (3 = custeio, 4 = capital).
const grupoDoGnd = gnd => (Number(gnd) === 4 ? 'capital' : 'custeio')

/**
 * Descarta o cache de catalogos que a renderizacao do historico mantem.
 *
 * O `renderizar.js` traduz `cod_nd: '339030'` para "Material de consumo (339030)"
 * a partir de um cache em memoria carregado sob demanda. Estas nove funcoes sao
 * as UNICAS escritas em tabela de dominio do sistema inteiro, entao a
 * invalidacao mora aqui: sem ela, um nome corrigido hoje continuaria aparecendo
 * errado no historico ate o processo reiniciar.
 *
 * Chamado DEPOIS do commit de proposito. Invalidar dentro da transacao que
 * depois volta atras custaria uma recarga desnecessaria (barata), mas o
 * contrario -- deixar o cache velho apos um commit -- e o erro que se ve na
 * tela.
 */
const aposEscritaDeDominio = () => {
  invalidarCatalogos()
}

controller.criarNaturezaDespesa = async ({ code, nome, gnd }, usuarioUuid, contexto) => {
  await db.conn
    .tx(async t => {
      const criada = await t.one(
        `INSERT INTO dominio.natureza_despesa (code, nome, gnd, grupo)
         VALUES ($<code>, $<nome>, $<gnd>, $<grupo>)
         RETURNING *`,
        { code, nome, gnd, grupo: grupoDoGnd(gnd) }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'dominio.natureza_despesa',
        registroId: criada.code,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      })
    })
    .catch(tratarCriar)

  aposEscritaDeDominio()
}

controller.atualizarNaturezaDespesa = async (code, { nome, gnd }, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    // `lerAntes` SUBSTITUI o teste de existencia: antes era o `rowCount` do
    // UPDATE que produzia o 404, e o estado anterior se perdia. Agora o mesmo
    // numero de idas ao banco devolve a linha inteira.
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'dominio.natureza_despesa',
      code,
      'Natureza de despesa',
      'code'
    )

    const depois = await t.one(
      `UPDATE dominio.natureza_despesa
       SET nome = $<nome>, gnd = $<gnd>, grupo = $<grupo>
       WHERE code = $<code>
       RETURNING *`,
      { code, nome, gnd, grupo: grupoDoGnd(gnd) }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'dominio.natureza_despesa',
      registroId: code,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })

  aposEscritaDeDominio()
}

controller.deletarNaturezaDespesa = async (code, usuarioUuid, contexto) => {
  await db.conn
    .tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'dominio.natureza_despesa',
        code,
        'Natureza de despesa',
        'code'
      )

      await t.none('DELETE FROM dominio.natureza_despesa WHERE code = $<code>', { code })

      await auditoriaCtrl.registrar(t, {
        tabela: 'dominio.natureza_despesa',
        registroId: code,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    })
    .catch(tratarDeletar)

  aposEscritaDeDominio()
}

controller.criarPlanoInterno = async ({ code, nome, alinea }, usuarioUuid, contexto) => {
  await db.conn
    .tx(async t => {
      const criado = await t.one(
        `INSERT INTO dominio.plano_interno (code, nome, alinea)
         VALUES ($<code>, $<nome>, $<alinea>)
         RETURNING *`,
        { code, nome, alinea: alinea || null }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'dominio.plano_interno',
        registroId: criado.code,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      })
    })
    .catch(tratarCriar)

  aposEscritaDeDominio()
}

controller.atualizarPlanoInterno = async (code, { nome, alinea }, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'dominio.plano_interno',
      code,
      'Plano interno',
      'code'
    )

    const depois = await t.one(
      `UPDATE dominio.plano_interno
       SET nome = $<nome>, alinea = $<alinea>
       WHERE code = $<code>
       RETURNING *`,
      { code, nome, alinea: alinea || null }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'dominio.plano_interno',
      registroId: code,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })

  aposEscritaDeDominio()
}

controller.deletarPlanoInterno = async (code, usuarioUuid, contexto) => {
  await db.conn
    .tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'dominio.plano_interno',
        code,
        'Plano interno',
        'code'
      )

      await t.none('DELETE FROM dominio.plano_interno WHERE code = $<code>', { code })

      await auditoriaCtrl.registrar(t, {
        tabela: 'dominio.plano_interno',
        registroId: code,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    })
    .catch(tratarDeletar)

  aposEscritaDeDominio()
}

controller.criarUg = async ({ code, nome }, usuarioUuid, contexto) => {
  await db.conn
    .tx(async t => {
      const criada = await t.one(
        `INSERT INTO dominio.ug (code, nome)
         VALUES ($<code>, $<nome>)
         RETURNING *`,
        { code, nome }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'dominio.ug',
        registroId: criada.code,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      })
    })
    .catch(tratarCriar)

  aposEscritaDeDominio()
}

controller.atualizarUg = async (code, { nome }, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'dominio.ug',
      code,
      'Unidade gestora',
      'code'
    )

    const depois = await t.one(
      `UPDATE dominio.ug SET nome = $<nome> WHERE code = $<code> RETURNING *`,
      { code, nome }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'dominio.ug',
      registroId: code,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })

  aposEscritaDeDominio()
}

controller.deletarUg = async (code, usuarioUuid, contexto) => {
  await db.conn
    .tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'dominio.ug',
        code,
        'Unidade gestora',
        'code'
      )

      await t.none('DELETE FROM dominio.ug WHERE code = $<code>', { code })

      await auditoriaCtrl.registrar(t, {
        tabela: 'dominio.ug',
        registroId: code,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    })
    .catch(tratarDeletar)

  aposEscritaDeDominio()
}

module.exports = controller
