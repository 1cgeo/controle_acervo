'use strict'

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// --- Erros do banco que viram resposta amigavel ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

/**
 * Traduz o erro do PostgreSQL para o 4xx que diz o que fazer.
 *
 * O 500 cru cita o nome da restricao ('campo_ano_fkey'), que nao ajuda quem
 * acabou de digitar. Dois codigos sao os unicos que uma requisicao BEM formada
 * consegue produzir aqui:
 *
 *   23505 - o `nome` do campo (UNIQUE)
 *   23503 - o `ano` sem exercicio no PIT, uma `categoria_id` que nao existe, um
 *           `usuario_uuid` que nao existe ou uma `versao_id` que nao existe
 *
 * O DO ANO E O QUE MAIS VAI APARECER, e e deliberado. `campo.ano` referencia
 * `pit.exercicio`, e o dump do SAP tem campo de 2013 a 2026 enquanto o PIT so
 * tem 2025 e 2026: sem o exercicio cadastrado, o campo daquele ano e RECUSADO.
 * A mensagem abaixo e o que transforma essa recusa num pedido claro em vez de
 * um 500.
 */
const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err
  const frase = mensagens[err.code]
  if (!frase) return err
  return new AppError(frase, mensagens.status || httpCode.BadRequest, err)
}

const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    throw traduzirErro(err, mensagens)
  }
}

const ERROS_CAMPO = {
  [UNIQUE_VIOLATION]: 'Já existe um campo com esse nome',
  [FK_VIOLATION]:
    'Ano sem exercício do PIT cadastrado, ou categoria, militar ou versão inexistente. ' +
    'Cadastre o exercício do ano em "PIT do ano" antes de lançar o campo',
  status: httpCode.BadRequest
}

// --- Leitura -----------------------------------------------------------------

controller.getDominio = async () => {
  // AS TRES LISTAS NUMA IDA SO, e nao tres rotas. A tela precisa das tres para
  // montar os filtros e o formulario, e servi-las separadas obrigaria a um
  // `Promise.all` no cliente -- que, pela regra da casa, derrubaria a tela
  // inteira se qualquer uma falhasse.
  const [situacoes, categorias, anos] = await db.conn.task(async t => [
    await t.any('SELECT code, nome FROM campo.situacao ORDER BY code'),
    await t.any('SELECT code, nome FROM campo.categoria ORDER BY code'),
    // OS ANOS SAO OS DO PIT, e nao os que ja tem campo: o formulario precisa
    // oferecer o exercicio vigente mesmo antes do primeiro campo dele.
    await t.any(
      `SELECT e.ano, s.nome AS situacao
         FROM pit.exercicio AS e
         INNER JOIN dominio.situacao_exercicio AS s ON s.code = e.situacao_id
        ORDER BY e.ano DESC`
    )
  ])

  return { situacoes, categorias, anos }
}

// As colunas da LISTA. `geom` NAO esta aqui, e nao e esquecimento: a lista
// tabular nao desenha nada, e um MULTIPOLYGON por linha em 54 linhas e carga
// paga a toa. Quem quer geometria pede `/geojson`.
const SELECT_LISTA = `
  SELECT c.id, c.nome, c.descricao, c.ano, c.situacao_id, s.nome AS situacao,
         c.data_inicio, c.data_fim, c.placas_vtr, c.militares_externos,
         COALESCE(cat.categorias, '[]'::json) AS categorias,
         COALESCE(mil.militares, '[]'::json) AS militares,
         COALESCE(ver.versoes, '[]'::json) AS versoes,
         COALESCE(img.total, 0)::int AS total_imagens,
         COALESCE(trk.total, 0)::int AS total_tracks
    FROM campo.campo AS c
    INNER JOIN campo.situacao AS s ON s.code = c.situacao_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('id', k.code, 'nome', k.nome) ORDER BY k.code) AS categorias
        FROM campo.campo_categoria AS cc
        INNER JOIN campo.categoria AS k ON k.code = cc.categoria_id
       WHERE cc.campo_id = c.id
    ) AS cat ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'usuario_uuid', u.uuid,
               'nome_guerra', u.nome_guerra,
               'posto_abrev', pg.nome_abrev
             ) ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra) AS militares
        FROM campo.campo_militar AS cm
        INNER JOIN dgeo.usuario AS u ON u.uuid = cm.usuario_uuid
        INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
       WHERE cm.campo_id = c.id
    ) AS mil ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'versao_id', v.id,
               'uuid_versao', v.uuid_versao,
               'versao', v.versao,
               'mi', p.mi,
               'inom', p.inom
             ) ORDER BY p.mi, v.versao) AS versoes
        FROM campo.campo_versao AS cv
        INNER JOIN acervo.versao AS v ON v.id = cv.versao_id
        INNER JOIN acervo.produto AS p ON p.id = v.produto_id
       WHERE cv.campo_id = c.id
    ) AS ver ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM campo.imagem AS i WHERE i.campo_id = c.id
    ) AS img ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM campo.track AS tk WHERE tk.campo_id = c.id
    ) AS trk ON TRUE
`

controller.listar = async filtros => {
  const { ano, situacao_id: situacaoId, categoria_id: categoriaId, busca } = filtros || {}

  const condicoes = []
  const params = {}

  if (ano) {
    condicoes.push('c.ano = $<ano>')
    params.ano = ano
  }
  if (situacaoId) {
    condicoes.push('c.situacao_id = $<situacaoId>')
    params.situacaoId = situacaoId
  }
  if (categoriaId) {
    condicoes.push(
      `EXISTS (SELECT 1 FROM campo.campo_categoria AS f
                WHERE f.campo_id = c.id AND f.categoria_id = $<categoriaId>)`
    )
    params.categoriaId = categoriaId
  }
  if (busca) {
    condicoes.push('(c.nome ILIKE $<busca> OR c.descricao ILIKE $<busca>)')
    params.busca = `%${busca}%`
  }

  const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''

  return db.conn.any(
    `${SELECT_LISTA} ${onde} ORDER BY c.data_inicio DESC, c.nome`,
    params
  )
}

controller.buscarPorId = async id => {
  const campo = await db.conn.oneOrNone(
    `${SELECT_LISTA} WHERE c.id = $<id>`,
    { id }
  )
  if (!campo) {
    throw new AppError('Campo não encontrado', httpCode.NotFound)
  }

  // A GEOMETRIA SO SAI NA FICHA, uma linha por vez, e ja em GeoJSON: a tela nao
  // tem como desenhar EWKT, e converter no cliente exigiria uma biblioteca a
  // mais para nada.
  const geo = await db.conn.one(
    'SELECT ST_AsGeoJSON(geom) AS geometria FROM campo.campo WHERE id = $<id>',
    { id }
  )
  campo.geometria = JSON.parse(geo.geometria)

  return campo
}

/**
 * Os campos como FeatureCollection, para a visao de mapa.
 *
 * `ST_AsGeoJSON` por linha, e nao a agregacao inteira em SQL: o que muda e so
 * onde o JSON e montado, e aqui as propriedades ja vem prontas do SELECT da
 * lista -- inclusive a situacao, que e o que pinta o poligono.
 */
controller.geojson = async filtros => {
  const linhas = await controller.listar(filtros)
  if (!linhas.length) return { type: 'FeatureCollection', features: [] }

  const geometrias = await db.conn.any(
    `SELECT id, ST_AsGeoJSON(geom) AS geometria
       FROM campo.campo
      WHERE id IN ($<ids:csv>)`,
    { ids: linhas.map(l => l.id) }
  )
  const porId = new Map(geometrias.map(g => [String(g.id), g.geometria]))

  return {
    type: 'FeatureCollection',
    features: linhas
      .map(linha => {
        const bruta = porId.get(String(linha.id))
        if (!bruta) return null
        return {
          type: 'Feature',
          id: linha.id,
          geometry: JSON.parse(bruta),
          properties: linha
        }
      })
      .filter(Boolean)
  }
}

// --- Escrita do campo --------------------------------------------------------

// A LINHA SINTETICA do rastro para cada lista. O `campo_id` vai nela porque e
// dele que o mapa de auditoria tira o agregado dono. E o mesmo desenho de
// `rpcmtec.capacitacao_militar`: a lista e regravada INTEIRA a cada salvamento,
// entao auditar linha a linha faria o historico dizer "removeu 3, acrescentou 3"
// toda vez que alguem abrisse e salvasse.
const lerLinhaDasCategorias = async (t, campoId) => {
  const linhas = await t.any(
    `SELECT k.nome
       FROM campo.campo_categoria AS cc
       INNER JOIN campo.categoria AS k ON k.code = cc.categoria_id
      WHERE cc.campo_id = $<campoId>
      ORDER BY k.code`,
    { campoId }
  )
  return { campo_id: campoId, categorias: linhas.map(l => l.nome) }
}

const lerLinhaDosMilitares = async (t, campoId) => {
  const linhas = await t.any(
    `SELECT pg.nome_abrev, u.nome_guerra
       FROM campo.campo_militar AS cm
       INNER JOIN dgeo.usuario AS u ON u.uuid = cm.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS pg ON pg.code = u.tipo_posto_grad_id
      WHERE cm.campo_id = $<campoId>
      ORDER BY u.tipo_posto_grad_id DESC, u.nome_guerra`,
    { campoId }
  )
  return {
    campo_id: campoId,
    militares: linhas.map(l => `${l.nome_abrev} ${l.nome_guerra}`.trim())
  }
}

const lerLinhaDasVersoes = async (t, campoId) => {
  const linhas = await t.any(
    `SELECT p.mi, v.versao
       FROM campo.campo_versao AS cv
       INNER JOIN acervo.versao AS v ON v.id = cv.versao_id
       INNER JOIN acervo.produto AS p ON p.id = v.produto_id
      WHERE cv.campo_id = $<campoId>
      ORDER BY p.mi, v.versao`,
    { campoId }
  )
  return {
    campo_id: campoId,
    versoes: linhas.map(l => `${l.mi || 's/ MI'} v${l.versao}`)
  }
}

/**
 * Regrava uma lista inteira: apaga e reinsere.
 *
 * `ON CONFLICT DO NOTHING` NAO serve aqui, e nao e detalhe: sem o DELETE,
 * REMOVER alguem da lista simplesmente nao funcionaria.
 *
 * UM insert em lote, e nao um por item, pelo mesmo motivo de
 * `rpcmtec_capacitacao_ctrl`: cada ida ao banco segura a conexao dentro da
 * transacao. A lista vazia NAO chega ao helper, que lanca se receber array
 * vazio -- e nesse caso o DELETE ja e a gravacao inteira.
 */
const regravarLista = async (t, { tabela, coluna, campoId, valores }) => {
  await t.none(
    `DELETE FROM campo.${tabela} WHERE campo_id = $<campoId>`,
    { campoId }
  )

  const lista = valores || []
  if (!lista.length) return

  const cs = new db.pgp.helpers.ColumnSet(
    ['campo_id', coluna],
    { table: { table: tabela, schema: 'campo' } }
  )
  await t.none(
    db.pgp.helpers.insert(
      lista.map(valor => ({ campo_id: campoId, [coluna]: valor })),
      cs
    )
  )
}

// So registra quando a lista MUDOU. Salvar o cabecalho sem mexer nas categorias
// nao pode produzir uma linha de historico dizendo que elas mudaram.
const registrarLista = async (t, { tabela, chave, antes, depois, usuarioUuid, contexto }) => {
  if (JSON.stringify(antes[chave]) === JSON.stringify(depois[chave])) return

  await auditoriaCtrl.registrar(t, {
    tabela,
    operacao: antes[chave].length ? 'U' : 'I',
    antes: antes[chave].length ? antes : undefined,
    depois,
    usuarioUuid,
    contexto
  })
}

// A geometria entra por `ST_GeomFromGeoJSON`, que nasce SEM SRID: sem o
// `ST_SetSRID` o PostGIS recusa a coluna tipada, e a mensagem fala de SRID 0.
//
// O `ST_Multi` e o que aceita o Polygon simples que o Joi ja normalizou para
// MultiPolygon -- ele e barato e idempotente, e cobre o caso de a normalizacao
// do schema mudar um dia sem que este SQL saiba.
const GEOM_SQL = 'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($<geometria>), 4674))'

const paraBanco = dados => ({
  nome: dados.nome,
  descricao: dados.descricao || null,
  ano: dados.ano,
  situacaoId: dados.situacao_id,
  dataInicio: dados.data_inicio,
  dataFim: dados.data_fim,
  placasVtr: dados.placas_vtr || null,
  militaresExternos: dados.militares_externos || null,
  geometria: dados.geometria
})

controller.criar = async (dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criado = await t.one(
          `INSERT INTO campo.campo
             (nome, descricao, ano, situacao_id, data_inicio, data_fim,
              placas_vtr, militares_externos, geom, usuario_cadastramento_uuid)
           VALUES ($<nome>, $<descricao>, $<ano>, $<situacaoId>, $<dataInicio>,
                   $<dataFim>, $<placasVtr>, $<militaresExternos>, ${GEOM_SQL},
                   $<usuarioUuid>)
           RETURNING id, nome, descricao, ano, situacao_id, data_inicio, data_fim,
                     placas_vtr, militares_externos, data_cadastramento,
                     usuario_cadastramento_uuid`,
          { ...paraBanco(dados), usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'campo.campo',
          registroId: criado.id,
          operacao: 'I',
          depois: criado,
          usuarioUuid,
          contexto
        })

        await regravarLista(t, {
          tabela: 'campo_categoria',
          coluna: 'categoria_id',
          campoId: criado.id,
          valores: dados.categorias
        })
        await regravarLista(t, {
          tabela: 'campo_militar',
          coluna: 'usuario_uuid',
          campoId: criado.id,
          valores: dados.militares
        })
        await regravarLista(t, {
          tabela: 'campo_versao',
          coluna: 'versao_id',
          campoId: criado.id,
          valores: dados.versoes
        })

        const vazio = { campo_id: criado.id, categorias: [], militares: [], versoes: [] }
        await registrarLista(t, {
          tabela: 'campo.campo_categoria',
          chave: 'categorias',
          antes: vazio,
          depois: await lerLinhaDasCategorias(t, criado.id),
          usuarioUuid,
          contexto
        })
        await registrarLista(t, {
          tabela: 'campo.campo_militar',
          chave: 'militares',
          antes: vazio,
          depois: await lerLinhaDosMilitares(t, criado.id),
          usuarioUuid,
          contexto
        })
        await registrarLista(t, {
          tabela: 'campo.campo_versao',
          chave: 'versoes',
          antes: vazio,
          depois: await lerLinhaDasVersoes(t, criado.id),
          usuarioUuid,
          contexto
        })

        return { id: criado.id }
      }),
    ERROS_CAMPO
  )
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado anterior
        // para o rastro e lanca o 404 quando o registro nao existe.
        const antes = await auditoriaCtrl.lerAntes(t, 'campo.campo', id, 'Campo')

        const listasAntes = {
          categorias: await lerLinhaDasCategorias(t, id),
          militares: await lerLinhaDosMilitares(t, id),
          versoes: await lerLinhaDasVersoes(t, id)
        }

        const depois = await t.one(
          `UPDATE campo.campo SET
             nome = $<nome>, descricao = $<descricao>, ano = $<ano>,
             situacao_id = $<situacaoId>, data_inicio = $<dataInicio>,
             data_fim = $<dataFim>, placas_vtr = $<placasVtr>,
             militares_externos = $<militaresExternos>, geom = ${GEOM_SQL},
             data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
           WHERE id = $<id>
           RETURNING id, nome, descricao, ano, situacao_id, data_inicio, data_fim,
                     placas_vtr, militares_externos, data_cadastramento,
                     usuario_cadastramento_uuid, data_modificacao,
                     usuario_modificacao_uuid`,
          { ...paraBanco(dados), id, usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'campo.campo',
          registroId: id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })

        await regravarLista(t, {
          tabela: 'campo_categoria', coluna: 'categoria_id',
          campoId: id, valores: dados.categorias
        })
        await regravarLista(t, {
          tabela: 'campo_militar', coluna: 'usuario_uuid',
          campoId: id, valores: dados.militares
        })
        await regravarLista(t, {
          tabela: 'campo_versao', coluna: 'versao_id',
          campoId: id, valores: dados.versoes
        })

        await registrarLista(t, {
          tabela: 'campo.campo_categoria', chave: 'categorias',
          antes: listasAntes.categorias,
          depois: await lerLinhaDasCategorias(t, id),
          usuarioUuid, contexto
        })
        await registrarLista(t, {
          tabela: 'campo.campo_militar', chave: 'militares',
          antes: listasAntes.militares,
          depois: await lerLinhaDosMilitares(t, id),
          usuarioUuid, contexto
        })
        await registrarLista(t, {
          tabela: 'campo.campo_versao', chave: 'versoes',
          antes: listasAntes.versoes,
          depois: await lerLinhaDasVersoes(t, id),
          usuarioUuid, contexto
        })

        return { id }
      }),
    ERROS_CAMPO
  )
}

/**
 * Apaga o campo, e com ele TUDO o que pendia dele.
 *
 * O `ON DELETE CASCADE` do DDL leva as categorias, os militares, as versoes, as
 * fotos, os videos, os tracks e os pontos de GPS. E por isso que esta rota e de
 * GERENTE e as outras escritas sao de operador: apagar um campo de 2019 leva
 * junto as unicas copias daquelas fotos.
 *
 * O RASTRO E DO PAI, e so dele. Registrar um evento por foto apagada encheria a
 * ficha com dezenas de linhas que dizem a mesma coisa; o resumo do campo ja diz
 * quantas havia.
 */
controller.apagar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'campo.campo', id, 'Campo')

    await t.none('DELETE FROM campo.campo WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.campo',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })

    return { id }
  })
}

// --- Imagem ------------------------------------------------------------------

/**
 * As imagens de um campo, SEM os bytes.
 *
 * `octet_length(conteudo)` no lugar do conteudo: a tela precisa do tamanho para
 * decidir se mostra a miniatura ou um aviso, e trafegar 186 MB para listar 143
 * linhas seria pagar o arquivo inteiro para desenhar um nome.
 */
controller.listarImagens = async campoId => {
  return db.conn.any(
    `SELECT i.id, i.campo_id, i.descricao, i.data_imagem, i.tipo, i.mime_type,
            octet_length(i.conteudo) AS bytes, i.data_cadastramento
       FROM campo.imagem AS i
      WHERE i.campo_id = $<campoId>
      ORDER BY i.data_imagem NULLS LAST, i.id`,
    { campoId }
  )
}

controller.lerImagem = async imagemId => {
  const imagem = await db.conn.oneOrNone(
    `SELECT id, tipo, mime_type, conteudo FROM campo.imagem WHERE id = $<imagemId>`,
    { imagemId }
  )
  if (!imagem) {
    throw new AppError('Imagem não encontrada', httpCode.NotFound)
  }
  return imagem
}

const garantirCampo = async (t, campoId) => {
  const existe = await t.oneOrNone(
    'SELECT id FROM campo.campo WHERE id = $<campoId>',
    { campoId }
  )
  if (!existe) {
    throw new AppError('Campo não encontrado', httpCode.NotFound)
  }
}

controller.criarImagem = async (campoId, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await garantirCampo(t, campoId)

    const criada = await t.one(
      `INSERT INTO campo.imagem
         (campo_id, descricao, data_imagem, tipo, mime_type, conteudo,
          usuario_cadastramento_uuid)
       VALUES ($<campoId>, $<descricao>, $<dataImagem>, $<tipo>, $<mimeType>,
               decode($<conteudo>, 'base64'), $<usuarioUuid>)
       RETURNING id, campo_id, descricao, data_imagem, tipo, mime_type,
                 data_cadastramento, usuario_cadastramento_uuid`,
      {
        campoId,
        descricao: dados.descricao || null,
        dataImagem: dados.data_imagem || null,
        tipo: dados.tipo,
        mimeType: dados.mime_type || null,
        conteudo: dados.conteudo_base64,
        usuarioUuid
      }
    )

    // `conteudo` NAO volta do RETURNING, e o mapa de auditoria tambem o omite:
    // gravar 37 MB de video dentro de `auditoria.evento` faria a trilha crescer
    // mais que a tabela que ela audita.
    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.imagem',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

controller.atualizarImagem = async (imagemId, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'campo.imagem', imagemId, 'Imagem')

    const depois = await t.one(
      `UPDATE campo.imagem SET
         descricao = $<descricao>, data_imagem = $<dataImagem>
       WHERE id = $<imagemId>
       RETURNING id, campo_id, descricao, data_imagem, tipo, mime_type,
                 data_cadastramento, usuario_cadastramento_uuid`,
      {
        imagemId,
        descricao: dados.descricao || null,
        dataImagem: dados.data_imagem || null
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.imagem',
      registroId: imagemId,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: imagemId }
  })
}

controller.apagarImagem = async (imagemId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'campo.imagem', imagemId, 'Imagem')

    await t.none('DELETE FROM campo.imagem WHERE id = $<imagemId>', { imagemId })

    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.imagem',
      registroId: imagemId,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })

    return { id: imagemId }
  })
}

// --- Track -------------------------------------------------------------------

/**
 * Os tracks de um campo, com a linha do trajeto ja em GeoJSON.
 *
 * A LINHA VEM DA VIEW `campo.track_linha`, que a costura dos pontos na leitura.
 * O `LEFT JOIN` e o que faz um track de um ponto so (que a view descarta pelo
 * HAVING) ainda aparecer na lista, sem geometria: ele existe, foi cadastrado, e
 * some-lo da tabela seria esconder um lancamento.
 */
controller.listarTracks = async campoId => {
  return db.conn.any(
    `SELECT tk.id, tk.campo_id, tk.chefe_vtr, tk.motorista, tk.placa_vtr, tk.dia,
            tl.momento_inicio, tl.momento_fim,
            COALESCE(tl.pontos, 0)::int AS pontos,
            CASE WHEN tl.geom IS NULL THEN NULL
                 ELSE ST_AsGeoJSON(ST_Force2D(tl.geom))
            END AS geometria
       FROM campo.track AS tk
       LEFT JOIN campo.track_linha AS tl ON tl.track_id = tk.id
      WHERE tk.campo_id = $<campoId>
      ORDER BY tk.dia, tk.id`,
    { campoId }
  ).then(linhas =>
    linhas.map(l => ({
      ...l,
      // `ST_Force2D` derruba a dimensao M antes de serializar: com ela o
      // GeoJSON sai com um terceiro numero por vertice que o MapLibre lê como
      // ALTITUDE, e a linha some do mapa sem erro nenhum.
      geometria: l.geometria ? JSON.parse(l.geometria) : null
    }))
  )
}

controller.criarTrack = async (campoId, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await garantirCampo(t, campoId)

    const criado = await t.one(
      `INSERT INTO campo.track
         (campo_id, chefe_vtr, motorista, placa_vtr, dia, usuario_cadastramento_uuid)
       VALUES ($<campoId>, $<chefeVtr>, $<motorista>, $<placaVtr>, $<dia>, $<usuarioUuid>)
       RETURNING *`,
      {
        campoId,
        chefeVtr: dados.chefe_vtr,
        motorista: dados.motorista,
        placaVtr: dados.placa_vtr,
        dia: dados.dia,
        usuarioUuid
      }
    )

    // OS PONTOS ENTRAM EM LOTE, num insert so. Um track do dump do SAP tem
    // cerca de 6.500 pontos: um INSERT por ponto seriam 6.500 idas ao banco
    // segurando a mesma transacao.
    //
    // `ST_MakePoint` no lugar de `ST_GeomFromGeoJSON`: sao dois numeros, e
    // montar e reparsear um objeto GeoJSON por ponto e trabalho a toa.
    const cs = new db.pgp.helpers.ColumnSet(
      [
        'track_id',
        'elevacao',
        'momento',
        {
          name: 'geom',
          mod: '^',
          init: c => db.pgp.as.format(
            'ST_SetSRID(ST_MakePoint($1, $2), 4674)',
            [c.source.longitude, c.source.latitude]
          )
        }
      ],
      { table: { table: 'track_ponto', schema: 'campo' } }
    )
    await t.none(
      db.pgp.helpers.insert(
        dados.pontos.map(p => ({
          track_id: criado.id,
          elevacao: p.elevacao ?? null,
          momento: p.momento ?? null,
          longitude: p.longitude,
          latitude: p.latitude
        })),
        cs
      )
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.track',
      registroId: criado.id,
      operacao: 'I',
      // `pontos` e SINTETICO: nao ha coluna `pontos` em `campo.track`. Ele
      // existe no rastro porque a quantidade e o unico jeito de a ficha dizer
      // o tamanho do que entrou -- os 6.500 pontos nao cabem no evento.
      depois: { ...criado, pontos: dados.pontos.length },
      usuarioUuid,
      contexto
    })

    return { id: criado.id, pontos: dados.pontos.length }
  })
}

controller.atualizarTrack = async (trackId, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'campo.track', trackId, 'Track')

    const depois = await t.one(
      `UPDATE campo.track SET
         chefe_vtr = $<chefeVtr>, motorista = $<motorista>,
         placa_vtr = $<placaVtr>, dia = $<dia>
       WHERE id = $<trackId>
       RETURNING *`,
      {
        trackId,
        chefeVtr: dados.chefe_vtr,
        motorista: dados.motorista,
        placaVtr: dados.placa_vtr,
        dia: dados.dia
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.track',
      registroId: trackId,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: trackId }
  })
}

controller.apagarTrack = async (trackId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'campo.track', trackId, 'Track')

    // Os pontos vao junto pelo ON DELETE CASCADE, e sem evento proprio: o
    // rastro do track ja diz o que se perdeu.
    await t.none('DELETE FROM campo.track WHERE id = $<trackId>', { trackId })

    await auditoriaCtrl.registrar(t, {
      tabela: 'campo.track',
      registroId: trackId,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })

    return { id: trackId }
  })
}

module.exports = controller
