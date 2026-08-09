'use strict'

// O SCHEMA `campo` CONTRA O BANCO DE VERDADE.
//
// O que este arquivo mede são as promessas que o DDL faz e que nenhum teste de
// rota alcança: a geometria obrigatória, o ano preso ao exercício do PIT, o
// CASCADE, e a linha do trajeto costurada na leitura.
//
// Mais a subseção 2.5, que passou a ser CALCULADA em 2026-08-08. Ela é o motivo
// de o schema existir, e o recorte dela (o mês INTEIRO, e não um dia) diverge do
// da 7.1 ao lado de propósito -- campo é intervalo, indisponibilidade é estado.

const { conn, cleanTestData, closeConnection } = require('../helpers/db')
// `db.createConn()` no `beforeAll` porque o `rpcmtec_ctrl` fala pelo `db.conn`
// do servico, e nao pelo pool dos testes. Sem isso, `calcular` estoura em
// "Cannot read properties of undefined (reading 'any')" -- e o erro aparece na
// PRIMEIRA consulta dele, que e a da 2.7, longe do que este arquivo mede.
const { db } = require('../../database')
const { ADMIN_UUID } = require('../helpers/auth')
const rpcmtecCtrl = require('../../rpcmtec/rpcmtec_ctrl')
const { SITUACAO_CAMPO, CATEGORIA_CAMPO } = require('../../utils/domain_constants')

const ANO = 2026
const AREA = 'POLYGON((-53.5 -29.5,-52.5 -29.5,-52.5 -29.2,-53.5 -29.2,-53.5 -29.5))'

const criarExercicio = (ano = ANO) =>
  conn.none(
    `INSERT INTO pit.pit (ano, situacao_id, usuario_cadastramento_uuid)
     VALUES ($1, 2, $2) ON CONFLICT (ano) DO NOTHING`,
    [ano, ADMIN_UUID]
  )

const criarCampo = async ({
  nome, ano = ANO, situacao = SITUACAO_CAMPO.FINALIZADO,
  inicio = '2026-07-28', fim = '2026-08-03', externos = null, area = AREA
}) => {
  const linha = await conn.one(
    `INSERT INTO campo.campo
       (nome, ano, situacao_id, data_inicio, data_fim, militares_externos, geom,
        usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $4, $5, $6, ST_Multi(ST_GeomFromText($7, 4674)), $8)
     RETURNING id`,
    [nome, ano, situacao, inicio, fim, externos, area, ADMIN_UUID]
  )
  return linha.id
}

beforeAll(async () => {
  await db.createConn()
})

afterAll(async () => {
  await closeConnection()
})

beforeEach(async () => {
  await conn.none('DELETE FROM campo.campo')
  await criarExercicio()
})

afterEach(async () => {
  await conn.none('DELETE FROM campo.campo')
  await cleanTestData()
})

describe('campo: os domínios', () => {
  // Os códigos são os do SAP, que é a regra da fusão: a linha migrada não
  // precisa de tabela de tradução.
  it('a situação tem QUATRO códigos, e são os do SAP', async () => {
    const linhas = await conn.any('SELECT code, nome FROM campo.situacao ORDER BY code')
    expect(linhas.map(l => l.code)).toEqual([1, 2, 3, 4])
    expect(linhas.map(l => l.nome))
      .toEqual(['Previsto', 'Em execução', 'Finalizado', 'Cancelado'])
  })

  // Aqui os códigos são NOVOS, e é a única divergência deliberada de código
  // desta travessia: no SAP isto era um ENUM do Postgres, que não tem número a
  // herdar. A ordem é a da declaração do ENUM de lá.
  it('a categoria tem CINCO códigos, na ordem do ENUM do SAP', async () => {
    const linhas = await conn.any('SELECT code, nome FROM campo.categoria ORDER BY code')
    expect(linhas.map(l => l.code)).toEqual([1, 2, 3, 4, 5])
    expect(linhas.map(l => l.nome)).toEqual([
      'Reambulação', 'Modelos 3D', 'Imagens Panorâmicas em 360º',
      'Pontos de Controle', 'Ortoimagens de Drone'
    ])
  })

  // O CÓDIGO DO BANCO E O DO JAVASCRIPT NASCERAM JUNTOS, e este caso é o que
  // impede um de andar sem o outro: `domain_constants.js` é escrito à mão.
  it('as constantes do servidor espelham o banco', async () => {
    const situacoes = await conn.any('SELECT code, nome FROM campo.situacao')
    const porNome = Object.fromEntries(situacoes.map(s => [s.nome, s.code]))
    expect(SITUACAO_CAMPO.PREVISTO).toBe(porNome.Previsto)
    expect(SITUACAO_CAMPO.FINALIZADO).toBe(porNome.Finalizado)
    expect(SITUACAO_CAMPO.CANCELADO).toBe(porNome.Cancelado)

    const categorias = await conn.any('SELECT code, nome FROM campo.categoria')
    const catPorNome = Object.fromEntries(categorias.map(c => [c.nome, c.code]))
    expect(CATEGORIA_CAMPO.REAMBULACAO).toBe(catPorNome['Reambulação'])
    expect(CATEGORIA_CAMPO.ORTOIMAGENS_DE_DRONE).toBe(catPorNome['Ortoimagens de Drone'])
  })
})

describe('campo: o que o DDL recusa', () => {
  // `geom` É NOT NULL por decisão do chefe em 2026-08-08. Os 7 campos sem
  // polígono do dump do SAP (todos voos de drone de 2026) não entram inventados:
  // a carga para e cobra o desenho.
  it('recusa campo sem geometria', async () => {
    await expect(conn.none(
      `INSERT INTO campo.campo
         (nome, ano, situacao_id, data_inicio, data_fim, usuario_cadastramento_uuid)
       VALUES ('Voo sem área', $1, 3, '2026-05-19', '2026-05-19', $2)`,
      [ANO, ADMIN_UUID]
    )).rejects.toThrow(/geom/)
  })

  // O ANO APONTA `pit.pit` DE VERDADE, e é a decisão que contraria o
  // precedente de `rpcmtec.capacitacao.ano` (um SMALLINT solto). Sem o
  // exercício, o campo daquele ano é RECUSADO -- e é exatamente o
  // comportamento desejado: a carga do SAP cria os dez exercícios que faltam.
  it('recusa ano sem exercício no PIT', async () => {
    await expect(criarCampo({ nome: 'Campo de 2013', ano: 2013 }))
      .rejects.toThrow(/exercicio|exercício|foreign key|chave estrangeira/i)
  })

  it('recusa término antes do início', async () => {
    await expect(criarCampo({
      nome: 'Campo invertido', inicio: '2026-08-03', fim: '2026-07-28'
    })).rejects.toThrow(/campo_fim_apos_inicio/)
  })

  it('recusa nome repetido', async () => {
    await criarCampo({ nome: 'Reambulação Santiago 2026' })
    await expect(criarCampo({ nome: 'Reambulação Santiago 2026' }))
      .rejects.toThrow(/campo_nome_key|duplicad/i)
  })
})

describe('campo: o CASCADE', () => {
  // É ISTO que põe a exclusão no piso de GERENTE: apagar um campo de 2019 leva
  // junto as únicas cópias daquelas fotos.
  it('apagar o campo leva categoria, militar, imagem, trajeto e ponto', async () => {
    const id = await criarCampo({ nome: 'Campo com tudo' })

    await conn.none(
      'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
      [id, CATEGORIA_CAMPO.REAMBULACAO]
    )
    await conn.none(
      'INSERT INTO campo.campo_militar (campo_id, usuario_uuid) VALUES ($1, $2)',
      [id, ADMIN_UUID]
    )
    await conn.none(
      `INSERT INTO campo.imagem (campo_id, tipo, conteudo, usuario_cadastramento_uuid)
       VALUES ($1, 'foto', decode('Zm90bw==', 'base64'), $2)`,
      [id, ADMIN_UUID]
    )
    const track = await conn.one(
      `INSERT INTO campo.track
         (campo_id, chefe_vtr, motorista, placa_vtr, dia, usuario_cadastramento_uuid)
       VALUES ($1, 'Chefe', 'Motorista', 'EB-1234', '2026-07-28', $2) RETURNING id`,
      [id, ADMIN_UUID]
    )
    await conn.none(
      `INSERT INTO campo.track_ponto (track_id, geom, momento)
       VALUES ($1, ST_SetSRID(ST_MakePoint(-53.1, -29.1), 4674), '2026-07-28T13:00:00Z')`,
      [track.id]
    )

    await conn.none('DELETE FROM campo.campo WHERE id = $1', [id])

    const resto = await conn.one(
      `SELECT (SELECT count(*) FROM campo.campo_categoria)::int AS categorias,
              (SELECT count(*) FROM campo.campo_militar)::int AS militares,
              (SELECT count(*) FROM campo.imagem)::int AS imagens,
              (SELECT count(*) FROM campo.track)::int AS tracks,
              (SELECT count(*) FROM campo.track_ponto)::int AS pontos`
    )
    expect(resto).toEqual({
      categorias: 0, militares: 0, imagens: 0, tracks: 0, pontos: 0
    })
  })
})

describe('campo.track_linha: o trajeto se costura na LEITURA', () => {
  const criarTrack = async (campoId, placa) => {
    const linha = await conn.one(
      `INSERT INTO campo.track
         (campo_id, chefe_vtr, motorista, placa_vtr, dia, usuario_cadastramento_uuid)
       VALUES ($1, 'Chefe', 'Motorista', $2, '2026-07-28', $3) RETURNING id`,
      [campoId, placa, ADMIN_UUID]
    )
    return linha.id
  }

  const ponto = (trackId, lon, hora) =>
    conn.none(
      `INSERT INTO campo.track_ponto (track_id, geom, momento)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, -29.1), 4674), $3)`,
      [trackId, lon, `2026-07-28T${hora}:00:00Z`]
    )

  // VIEW COMUM, e não materializada como no SAP. Materializar obrigaria alguém a
  // lembrar de atualizar depois de cada importação, e linha velha mente sem
  // avisar. Este caso prova que ela responde ao dado NOVO na hora.
  it('a linha aparece assim que o segundo ponto entra', async () => {
    const campoId = await criarCampo({ nome: 'Campo com trajeto' })
    const trackId = await criarTrack(campoId, 'EB-1234')

    await ponto(trackId, -53.1, '13')
    const comUm = await conn.oneOrNone(
      'SELECT track_id FROM campo.track_linha WHERE track_id = $1', [trackId]
    )
    // UM PONTO NÃO É LINHA: `ST_MakeLine` com um ponto devolve um ponto, e a
    // coluna se declara LineString. O HAVING da view o descarta em vez de
    // derrubar a consulta.
    expect(comUm).toBeNull()

    await ponto(trackId, -53.2, '14')
    const comDois = await conn.one(
      `SELECT pontos, ST_GeometryType(geom) AS tipo,
              ST_NPoints(geom) AS vertices
         FROM campo.track_linha WHERE track_id = $1`,
      [trackId]
    )
    expect(comDois.pontos).toBe('2')
    expect(comDois.tipo).toBe('ST_LineString')
    expect(Number(comDois.vertices)).toBe(2)
  })

  // A ORDEM VEM DO `momento`, e não da ordem de inserção: um GPX importado fora
  // de ordem desenharia um ziguezague se a view confiasse no id.
  it('a linha sai ordenada pelo momento, e não pela ordem de inserção', async () => {
    const campoId = await criarCampo({ nome: 'Campo fora de ordem' })
    const trackId = await criarTrack(campoId, 'EB-9999')

    await ponto(trackId, -53.3, '15')
    await ponto(trackId, -53.1, '13')
    await ponto(trackId, -53.2, '14')

    const linha = await conn.one(
      `SELECT ST_X(ST_PointN(geom, 1)) AS primeiro,
              ST_X(ST_PointN(geom, 3)) AS ultimo,
              momento_inicio, momento_fim
         FROM campo.track_linha WHERE track_id = $1`,
      [trackId]
    )
    expect(Number(linha.primeiro)).toBeCloseTo(-53.1, 5)
    expect(Number(linha.ultimo)).toBeCloseTo(-53.3, 5)
  })
})

describe('RPCMTec 2.5: as atividades de campo', () => {
  // A malha do IBGE entra por CARGA, e o banco de teste não a tem: sem estes
  // dois municípios a coluna "Local" cairia no fallback em toda linha, e o caso
  // que mede a derivação não mediria nada.
  const semearMalha = async () => {
    await conn.none(
      `INSERT INTO limites.estado (id, sigla, nome, regiao, geom)
       VALUES (43, 'RS', 'Rio Grande do Sul', 'Sul',
               ST_Multi(ST_GeomFromText('POLYGON((-54 -30,-52 -30,-52 -28,-54 -28,-54 -30))', 4674)))
       ON CONFLICT (id) DO NOTHING`
    )
    await conn.none(
      `INSERT INTO limites.municipio (id, nome, nome_busca, estado_id, geom) VALUES
       (4399001, 'Santiago', 'santiago', 43,
        ST_Multi(ST_GeomFromText('POLYGON((-54 -30,-53 -30,-53 -29,-54 -29,-54 -30))', 4674))),
       (4399002, 'Jaguari', 'jaguari', 43,
        ST_Multi(ST_GeomFromText('POLYGON((-53 -30,-52 -30,-52 -29,-53 -29,-53 -30))', 4674)))
       ON CONFLICT (id) DO NOTHING`
    )
  }

  const limparMalha = () =>
    conn.none('DELETE FROM limites.municipio WHERE id IN (4399001, 4399002)')

  const bloco = async (ano, mes) => {
    const tabelas = await rpcmtecCtrl.calcular({ ano, mes })
    return tabelas['2.5']
  }

  beforeEach(semearMalha)
  afterEach(limparMalha)

  // O RECORTE É O INTERVALO, e não um dia. A 7.1 ao lado pergunta "quem estava
  // parado no último dia do mês", porque indisponibilidade é um ESTADO; aqui a
  // pergunta é "que campo houve em julho", e um campo de 28/07 a 03/08 houve em
  // julho E em agosto.
  it('o campo que atravessa a virada sai nas DUAS edições', async () => {
    const id = await criarCampo({ nome: 'Reambulação Santiago 2026' })
    await conn.none(
      'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
      [id, CATEGORIA_CAMPO.REAMBULACAO]
    )

    const julho = await bloco(2026, 7)
    const agosto = await bloco(2026, 8)
    const setembro = await bloco(2026, 9)

    expect(julho).toHaveLength(1)
    expect(agosto).toHaveLength(1)
    expect(setembro).toHaveLength(0)
  })

  // CAMPO CANCELADO NÃO ACONTECEU, e reportá-lo diria que a Divisão fez o que
  // não fez. É a única situação que fica de fora.
  it('o cancelado não sai, e o previsto sai', async () => {
    const cancelado = await criarCampo({
      nome: 'Campo cancelado', situacao: SITUACAO_CAMPO.CANCELADO,
      inicio: '2026-07-10', fim: '2026-07-12'
    })
    const previsto = await criarCampo({
      nome: 'Campo previsto', situacao: SITUACAO_CAMPO.PREVISTO,
      inicio: '2026-07-15', fim: '2026-07-16'
    })
    for (const id of [cancelado, previsto]) {
      await conn.none(
        'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
        [id, CATEGORIA_CAMPO.REAMBULACAO]
      )
    }

    const linhas = await bloco(2026, 7)

    // O PREVISTO cujo período já passou CONTINUA SAINDO, e não é descuido: ele é
    // atraso de cadastro, e escondê-lo faria o relatório sair silenciosamente
    // mais curto que o trabalho. Aparecer no documento é o que faz alguém
    // corrigir a situação.
    expect(linhas).toHaveLength(1)
    expect(linhas[0][1]).toBe('de 15/07/2026 a 16/07/2026')
  })

  // O "LOCAL" É DERIVADO da geometria, por `limites.municipio`, que existe
  // exatamente para responder onde as coisas estão.
  it('o Local sai dos municípios que a área toca', async () => {
    const id = await criarCampo({ nome: 'Campo entre dois municípios' })
    await conn.none(
      'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
      [id, CATEGORIA_CAMPO.REAMBULACAO]
    )

    const linhas = await bloco(2026, 7)

    expect(linhas[0][0]).toBe('Jaguari/RS, Santiago/RS')
  })

  // A REDE DE SEGURANÇA. `limites.municipio` nasce VAZIA numa instalação nova:
  // a malha do IBGE entra por carga, e `er/limites.sql` só cria a tabela. Sem
  // este fallback a coluna sairia em branco em todo banco que ainda não a
  // carregou, e ninguém ligaria a causa ao efeito.
  it('sem malha carregada, o Local cai no NOME do campo', async () => {
    await limparMalha()
    const id = await criarCampo({ nome: 'Voo de drone Beira-Rio 15ABR2026' })
    await conn.none(
      'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
      [id, CATEGORIA_CAMPO.ORTOIMAGENS_DE_DRONE]
    )

    const linhas = await bloco(2026, 7)

    expect(linhas[0][0]).toBe('Voo de drone Beira-Rio 15ABR2026')
  })

  // O EFETIVO SÃO AS DUAS LISTAS JUNTAS. `campo_militar` traz quem tem conta no
  // SCA; `militares_externos` traz quem não tem -- gente de outra OM, motorista
  // da guarnição e, sobretudo, quem já saiu. Dos 145 nomes distintos dos 13 anos
  // de campo do SAP, 59 casam com o cadastro de hoje e 86 não: publicar só a
  // primeira lista faria a 2.5 de um mês de 2019 sair com um terço do efetivo.
  it('o Efetivo junta o cadastro e o texto de quem não tem conta', async () => {
    const id = await criarCampo({
      nome: 'Campo com efetivo misto', externos: 'Cb Bueno, Sd Externo'
    })
    await conn.none(
      'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
      [id, CATEGORIA_CAMPO.REAMBULACAO]
    )
    await conn.none(
      'INSERT INTO campo.campo_militar (campo_id, usuario_uuid) VALUES ($1, $2)',
      [id, ADMIN_UUID]
    )

    const linhas = await bloco(2026, 7)
    const efetivo = linhas[0][3]

    expect(efetivo).toMatch(/Cb Bueno, Sd Externo$/)
    // O do cadastro vem ANTES, e sai como "posto nome_guerra".
    expect(efetivo).not.toBe('Cb Bueno, Sd Externo')
  })

  // A FINALIDADE É LISTA. Dos 54 campos do dump, a soma das categorias dá 90:
  // a maioria tem mais de uma.
  it('a Finalidade junta as categorias do campo', async () => {
    const id = await criarCampo({ nome: 'Campo com três finalidades' })
    for (const cat of [
      CATEGORIA_CAMPO.REAMBULACAO,
      CATEGORIA_CAMPO.MODELOS_3D,
      CATEGORIA_CAMPO.ORTOIMAGENS_DE_DRONE
    ]) {
      await conn.none(
        'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
        [id, cat]
      )
    }

    const linhas = await bloco(2026, 7)

    expect(linhas[0][2]).toBe('Reambulação, Modelos 3D, Ortoimagens de Drone')
  })

  // A DATA sai do `formatDia`, que fatia a string 'AAAA-MM-DD' em vez de passar
  // por `new Date()`: só-data parseada assim vira meia-noite UTC, e em UTC-3 o
  // dia vira o anterior.
  it('a Data não escorrega um dia no fuso', async () => {
    const id = await criarCampo({
      nome: 'Campo de um dia só', inicio: '2026-07-01', fim: '2026-07-01'
    })
    await conn.none(
      'INSERT INTO campo.campo_categoria (campo_id, categoria_id) VALUES ($1, $2)',
      [id, CATEGORIA_CAMPO.REAMBULACAO]
    )

    const linhas = await bloco(2026, 7)

    expect(linhas[0][1]).toBe('01/07/2026')
  })
})
