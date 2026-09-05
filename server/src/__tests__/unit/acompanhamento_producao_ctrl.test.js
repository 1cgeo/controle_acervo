'use strict'

// O ACOMPANHAMENTO DA PRODUÇÃO, PELO SQL QUE ELE MANDA AO BANCO.
//
// POR QUE ASSIM, e não por varredura do fonte: os outros dois arquivos deste
// módulo (`routes/acompanhamento_producao/`) leem o texto do ROTEADOR com
// `fs.readFileSync`, porque o que eles medem (a ordem das rotas, a guarda de
// cada uma) não aparece numa resposta HTTP. Aqui o assunto é outro: `linhaDoTempo`
// é um GERADOR DE STRING, e o defeito de 2026-08-09 estava numa cláusula que ele
// monta. Este arquivo faz `require` do controlador de verdade, com o banco
// dublado, e olha o SQL que chegaria ao Postgres -- que é o artefato onde o
// defeito morava.
//
// E POR QUE NÃO PRECISA DE PostgreSQL: o dublê abaixo é um objeto simples, e
// `jest.config.js` decide o pacote LENDO O FONTE de cada teste -- ele procura o
// `require` dos dois ajudantes que abrem conexão. Nenhum deles é citado aqui,
// nem em comentário: a varredura não distingue prosa de código, e citar um
// mandaria este arquivo para o pacote lento, onde esperaria por um banco que não
// usa.

const capturado = []
// AS DUAS LISTAS SÃO SEPARADAS DE PROPÓSITO: quase toda consulta deste módulo
// sai por `any`, e `ultimoSql()` conta com isso. `getLayerGeoJSON` é a exceção
// -- ele sai inteiro por `oneOrNone` (a existência em `pg_matviews` e depois o
// GeoJSON) --, e misturar as duas faria o `oneOrNone` de projeto de
// `getInfoProjetoDetalhada` virar "a última consulta".
const capturadoUm = []

const mockDb = {
  conn: {
    any: jest.fn(async (sql, params) => {
      capturado.push({ sql, params })
      return []
    }),
    // O 404 de projeto sai de um `oneOrNone` ANTES da consulta detalhada: sem
    // projeto, `getInfoProjetoDetalhada` nem chega a montar o SQL do ano. A
    // mesma linha serve a `camadaExiste`, que só olha se veio algo.
    oneOrNone: jest.fn(async (sql, params) => {
      capturadoUm.push({ sql, params })
      return { id: 1, nome: 'Projeto de teste' }
    }),
    one: jest.fn(async () => ({})),
    tx: jest.fn()
  },
  pgp: { as: { format: sql => sql } }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() },
  refreshViews: {}
}))

const ctrl = require('../../acompanhamento_producao/acompanhamento_producao_ctrl')

/** O SQL da última chamada, com o espaço em branco normalizado. */
const ultimoSql = () =>
  capturado[capturado.length - 1].sql.replace(/\s+/g, ' ').trim()

/** O SQL da última consulta de linha única, com o espaço em branco normalizado. */
const ultimoSqlUm = () =>
  capturadoUm[capturadoUm.length - 1].sql.replace(/\s+/g, ' ').trim()

/** A última cláusula de nome `clausula` (o SELECT final é o último). */
const clausulaFinal = (sql, clausula) => {
  const pedacos = sql.split(new RegExp(`\\b${clausula}\\b`, 'i'))
  return pedacos.length > 1 ? pedacos[pedacos.length - 1].trim() : null
}

beforeEach(() => {
  capturado.length = 0
  capturadoUm.length = 0
  mockDb.conn.any.mockClear()
  mockDb.conn.oneOrNone.mockClear()
})

// ---------------------------------------------------------------------------
// A SÉRIE É A CHAVE, E NUNCA O RÓTULO
// ---------------------------------------------------------------------------
//
// `producao.subfase` é UNIQUE (nome, fase_id), então "Edição" existe na linha da
// Carta Topográfica E na do CDGV, e 61 dos 102 lotes com versão atravessam mais
// de um subtipo. Até 2026-08-09 o SELECT final agrupava pelas EXPRESSÕES DE
// SAÍDA (`l.nome, s.nome`), e as duas subfases caíam numa barra só, com o
// `array_agg(... ORDER BY f.inicio)` intercalando as faixas das duas: o mesmo dia
// aparecia duas vezes, uma com valor 1 e outra com 0.

describe('atividadeSubfase: duas subfases de mesmo nome são DUAS séries', () => {
  test('o GROUP BY é pelas chaves, e o nome entra só depois delas', async () => {
    await ctrl.atividadeSubfase()
    const sql = ultimoSql()

    // A prova: `subfase_id` está na identidade do grupo. Com ele ali, duas
    // subfases de mesmo nome NÃO podem cair na mesma linha do resultado --
    // agrupar por uma coluna é, por definição, separar por ela.
    expect(clausulaFinal(sql, 'GROUP BY')).toBe(
      'f.lote_id, f.subfase_id, l.nome, s.nome, lp.nome_abrev ' +
      'ORDER BY l.nome, s.nome, lp.nome_abrev, f.lote_id, f.subfase_id'
    )
  })

  test('o GROUP BY não é SÓ de rótulos, que era o defeito', async () => {
    await ctrl.atividadeSubfase()
    const grupo = clausulaFinal(ultimoSql(), 'GROUP BY')

    // Controle negativo do texto exato que estava lá antes.
    expect(grupo.startsWith('l.nome, s.nome ORDER BY')).toBe(false)
    expect(grupo).toContain('f.lote_id')
    expect(grupo).toContain('f.subfase_id')
  })

  test('as chaves SAEM na resposta, senão o cliente não distingue as duas', async () => {
    await ctrl.atividadeSubfase()
    const sql = ultimoSql()

    // O SELECT final começa depois do último CTE.
    expect(sql).toContain(
      'SELECT f.lote_id, f.subfase_id, l.nome AS lote, s.nome AS subfase, ' +
      'lp.nome_abrev AS linha_producao'
    )
  })

  test('a linha de produção vem junto, e é ela que desempata na tela', async () => {
    await ctrl.atividadeSubfase()
    const sql = ultimoSql()

    // O apelido é `fs`, e não `f`: `f` já é `faixas` no SELECT final.
    expect(sql).toContain('INNER JOIN producao.fase AS fs ON fs.id = s.fase_id')
    expect(sql).toContain(
      'INNER JOIN producao.linha_producao AS lp ON lp.id = fs.linha_producao_id'
    )
  })

  test('a ORDEM continua pelo rótulo, para a tela agrupar na ordem em que lê', async () => {
    await ctrl.atividadeSubfase()
    const ordem = clausulaFinal(ultimoSql(), 'ORDER BY')

    // O lote vem primeiro: o cliente quebra o quadro sequencialmente, e uma
    // ordem por id espalharia as linhas de um lote pela lista inteira.
    expect(ordem.startsWith('l.nome, s.nome')).toBe(true)
    // E a chave desempata, para dois homônimos saírem em ordem estável.
    expect(ordem.endsWith('f.lote_id, f.subfase_id')).toBe(true)
  })
})

describe('atividadeUsuario: dois homônimos são DUAS séries', () => {
  test('o GROUP BY leva o usuario_uuid, e não só o posto com o nome de guerra', async () => {
    await ctrl.atividadeUsuario()
    const sql = ultimoSql()

    expect(clausulaFinal(sql, 'GROUP BY')).toBe(
      "f.usuario_uuid, tpg.nome_abrev || ' ' || u.nome_guerra " +
      "ORDER BY tpg.nome_abrev || ' ' || u.nome_guerra, f.usuario_uuid"
    )
    expect(sql).toContain(
      "SELECT f.usuario_uuid, tpg.nome_abrev || ' ' || u.nome_guerra AS usuario"
    )
  })
})

describe('a grade da linha do tempo', () => {
  test('marca o dia por JUNÇÃO, e não por EXISTS correlacionado', async () => {
    await ctrl.atividadeSubfase()
    const sql = ultimoSql()

    // O `EXISTS` ficava na lista de seleção de `chaves CROSS JOIN dias`, isto é,
    // rodava uma vez por célula: ~100 séries x 365 dias são 36 mil varreduras de
    // `intervalos`. `marcados` responde a mesma pergunta UMA vez.
    expect(sql).not.toContain('EXISTS')
    expect(sql).toContain('marcados AS ( SELECT DISTINCT')
    expect(sql).toContain('(m.dia IS NOT NULL)::int AS valor')
  })

  test('o recorte de ano da grade sai do próprio INNER JOIN com os dias', async () => {
    await ctrl.atividadeUsuario()
    const sql = ultimoSql()

    // `dias` só tem o ano corrente, então o intervalo que não o toca não gera
    // linha nenhuma em `marcados`. A série continua saindo (ela vem de
    // `chaves`, que lê `intervalos` inteiro), só que com a barra vazia.
    expect(sql).toContain(
      "SELECT generate_series( date_trunc('year', CURRENT_DATE)::date, CURRENT_DATE, '1 day' )::date AS dia"
    )
    expect(sql).toContain('INNER JOIN dias AS d ON d.dia BETWEEN i.inicio AND i.fim')
    expect(sql).toContain('chaves AS (SELECT DISTINCT usuario_uuid FROM intervalos)')
  })
})

// ---------------------------------------------------------------------------
// UMA LINHA POR PESSOA NO RESUMO
// ---------------------------------------------------------------------------
//
// O `LEFT JOIN producao.atividade` simples que estava aqui devolvia DUAS linhas
// para quem tivesse ao mesmo tempo uma atividade EM EXECUÇÃO e uma PAUSADA -- e
// esse par é o desfecho NORMAL de apontar um problema: `/problema_atividade`
// encerra a viva, abre uma PAUSADA no nome da mesma pessoa e tira a unidade de
// trabalho da distribuição, e o próximo `/inicia` entrega OUTRA folha. A tela
// contava a mesma pessoa duas vezes, e o total deixava de bater com o efetivo.

describe('resumoUsuario: a pessoa aparece UMA vez', () => {
  test('a atividade entra por LATERAL com LIMIT 1, e não por junção que multiplica', async () => {
    await ctrl.resumoUsuario()
    const sql = ultimoSql()

    expect(sql).toContain('LEFT JOIN LATERAL (')
    expect(sql).toContain('LIMIT 1 ) AS a ON TRUE')
    // Controle negativo do texto exato que estava lá antes.
    expect(sql).not.toContain('LEFT JOIN producao.atividade AS a ON a.usuario_uuid')
  })

  test('o desempate é a situação, e a em execução vence a pausada', async () => {
    await ctrl.resumoUsuario()
    const sql = ultimoSql()

    // 2 ('Em execução') ordena antes de 3 ('Pausada'), então é ela que sobra:
    // onde a pessoa ESTÁ agora é onde ela está trabalhando.
    expect(sql).toContain(
      'ORDER BY ativ.tipo_situacao_atividade_id, ativ.data_inicio DESC NULLS LAST'
    )
  })
})

// ---------------------------------------------------------------------------
// O FILTRO POR ANO NÃO PODE ZERAR O QUE ESTÁ EM EXECUÇÃO
// ---------------------------------------------------------------------------
//
// `data_fim` é NULA justamente na versão que ainda está na fase -- que é a linha
// que alimenta `em_execucao` e `restantes`. Com o filtro antigo
// (`EXTRACT(YEAR FROM vf.data_fim) = ano`), `/informacao_detalhada/:ano` devolvia
// toda fase com os dois em zero enquanto a mesma rota sem ano mostrava o
// trabalho andando. A tela lia "o projeto parou".

describe('getInfoProjetoDetalhada: o recorte por ano', () => {
  const filtroDeAno = sql => {
    const inicio = sql.indexOf('WHERE ($<ano> IS NULL')
    const fim = sql.indexOf('GROUP BY l.id')
    return sql.slice(inicio, fim).trim()
  }

  test('o ano NÃO descarta a linha sem data_fim', async () => {
    await ctrl.getInfoProjetoDetalhada(1, 2026)
    const filtro = filtroDeAno(ultimoSql())

    expect(filtro).toBe(
      'WHERE ($<ano> IS NULL ' +
      'OR EXTRACT(YEAR FROM vf.data_fim) = $<ano> ' +
      'OR (vf.data_fim IS NULL ' +
      'AND (vf.data_inicio IS NULL ' +
      'OR EXTRACT(YEAR FROM vf.data_inicio) <= $<ano>)))'
    )
  })

  test('e o que nunca começou (as duas datas nulas) entra sempre', async () => {
    await ctrl.getInfoProjetoDetalhada(1, 2026)
    const filtro = filtroDeAno(ultimoSql())

    // `restantes` conta `data_inicio IS NULL`, que não tem data nenhuma e por
    // isso não pertence a ano algum. Sem este ramo a coluna seria sempre zero
    // com ano, que é metade do defeito.
    expect(filtro).toContain('vf.data_inicio IS NULL')
  })

  test('as duas rotas continuam sendo a MESMA consulta, com e sem ano', async () => {
    await ctrl.getInfoProjetoDetalhada(1, 2026)
    const comAno = ultimoSql()
    await ctrl.getInfoProjetoDetalhada(1)
    const semAno = ultimoSql()

    expect(semAno).toBe(comAno)
    // Quem muda é o parâmetro, e o `$<ano> IS NULL` é que abre o filtro inteiro.
    expect(capturado[capturado.length - 1].params.ano).toBeNull()
    expect(capturado[capturado.length - 2].params.ano).toBe(2026)
  })
})

// ---------------------------------------------------------------------------
// A VIEW VAZIA É UMA COLEÇÃO VAZIA, E NUNCA `features: null`
// ---------------------------------------------------------------------------
//
// A view materializada de acompanhamento nasce JUNTO com a primeira etapa da
// linha de produção, e nesse instante o lote ainda não tem unidade de trabalho
// nenhuma -- é a decisão registrada em `er/acompanhamento_producao.sql`, "a
// etapa existe antes de haver geometria nenhuma, que é exatamente quando a view
// precisa nascer vazia". `camadaExiste` acha a view, então não há 404; sobre
// zero linhas `array_agg` devolve NULL e `array_to_json(NULL)` devolve NULL, e a
// rota respondia `{"type":"FeatureCollection","features":null}`. A tela
// `#/producao/mapas` lê `resultado.geojson.features.length` logo depois de
// entregar isso ao MapLibre, e o `catch` da página trocava o mapa inteiro pelo
// bloco de erro -- para um lote cuja resposta certa é um mapa em branco.

describe('getLayerGeoJSON: a camada sem feição nenhuma', () => {
  test('o array de feições sai por COALESCE, e nunca nulo', async () => {
    await ctrl.getLayerGeoJSON('lote_1_linha_2')
    const sql = ultimoSqlUm()

    expect(sql).toContain(
      "COALESCE(array_to_json(array_agg(f)), '[]'::json) AS features"
    )
    // Controle negativo do texto exato que estava lá antes: o `array_to_json`
    // cru, sem rede embaixo.
    expect(sql).not.toMatch(/(?<!COALESCE\()array_to_json\(array_agg\(f\)\) AS features/)
  })

  test('o tipo continua FeatureCollection, e a consulta é a mesma no resto', async () => {
    await ctrl.getLayerGeoJSON('lote_1_linha_2')
    const sql = ultimoSqlUm()

    expect(sql).toContain("SELECT 'FeatureCollection' AS type")
    expect(sql).toContain('FROM acompanhamento.$<nome:raw> AS lg')
    expect(sql).toContain('LATERAL ST_Dump(lg.geom) AS d')
  })

  test('a existência em pg_matviews continua vindo ANTES do GeoJSON', async () => {
    await ctrl.getLayerGeoJSON('lote_1_linha_2')

    expect(capturadoUm).toHaveLength(2)
    expect(capturadoUm[0].sql).toContain('FROM pg_matviews')
    expect(capturadoUm[1].sql).toContain('COALESCE(array_to_json(array_agg(f))')
  })
})

// ---------------------------------------------------------------------------
// O PIT POR SUBFASE TAMBEM AGRUPA PELA CHAVE
// ---------------------------------------------------------------------------
//
// A mesma armadilha de atividadeSubfase, na outra ponta do arquivo: agrupar por
// (l.nome, s.nome) juntava numa linha so o que sao DUAS series. producao.subfase
// e UNIQUE (nome, fase_id), entao Edicao existe na linha da Carta Topografica E
// na do CDGV; acervo.lote so e UNIQUE em (projeto_id, pit), entao dois projetos
// podem ter lotes homonimos. A secao Por subfase de #/producao/pit somava os
// dois na mesma linha enquanto a secao Por lote, logo acima, ja os mostrava
// separados: as duas metades da mesma tela discordavam sem que nada acusasse.

describe('getInfoSubfasePIT: a chave sai junto com o rotulo', () => {
  test('o GROUP BY comeca pelas chaves, e nao pelos nomes', async () => {
    await ctrl.getInfoSubfasePIT(2026)
    const grupo = clausulaFinal(ultimoSql(), 'GROUP BY')

    expect(grupo.startsWith('vs.lote_id, vs.subfase_id, l.nome, s.nome, s.ordem')).toBe(true)
    // Controle negativo do texto exato que estava la antes.
    expect(grupo.startsWith('l.nome, s.nome, s.ordem')).toBe(false)
  })

  test('as chaves SAEM na resposta, que e o que o cliente agrupa', async () => {
    await ctrl.getInfoSubfasePIT(2026)
    const sql = ultimoSql()

    expect(sql).toContain('SELECT vs.lote_id, vs.subfase_id, l.nome AS lote, s.nome AS subfase')
  })

  test('o rotulo, o mes e a quantidade continuam saindo como sempre sairam', async () => {
    await ctrl.getInfoSubfasePIT(2026)
    const sql = ultimoSql()

    expect(sql).toContain('l.nome AS lote, s.nome AS subfase')
    expect(sql).toContain('EXTRACT(MONTH FROM vs.data_fim)::int AS mes')
    expect(sql).toContain('COUNT(*)::int AS quantidade')
  })

  test('e a ORDEM continua pelo rotulo, para a tela ler na ordem em que quebra', async () => {
    await ctrl.getInfoSubfasePIT(2026)
    const ordem = clausulaFinal(ultimoSql(), 'ORDER BY')

    expect(ordem).toBe('l.nome, s.ordem, mes')
  })
})
