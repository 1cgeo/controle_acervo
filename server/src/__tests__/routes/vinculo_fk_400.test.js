'use strict'

// APAGAR O QUE AINDA ESTA AMARRADO responde 400 em portugues, e nao 500.
//
// O QUE ISTO GUARDA. `acervo.lote` e `acervo.volume_armazenamento` sao apontados
// por tabelas de OUTROS schemas (`ponto_controle.ponto`,
// `ponto_controle.arquivo`), todas NOT NULL e sem `ON DELETE`. Sem tradução, a
// violação de chave estrangeira sobe crua e o `error_handler` devolve 500 com a
// mensagem literal do Postgres, em inglês e citando o nome interno da
// constraint: quem apertou o botão lê "erro interno do servidor" e não sabe o
// que desfazer.
//
// A tradução de `deleteLotes` existia sem teste nenhum: quem removesse o
// `.catch` por engano nao deixaria uma suite vermelha, e o 500 em ingles voltava
// em silencio. A do volume nao existia, e as duas tabelas do ponto de controle
// nem eram conferidas.

const request = require('supertest')

const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')
const { createProjeto, createLote, createVolume } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
}, 60000)

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

const GEOM_PONTO = 'SRID=4674;POINT(-50 -15)'

// `acervo.lote.id` e BIGSERIAL e o driver o entrega como STRING (o unico
// `setTypeParser` do projeto e o do DATE), enquanto `loteIds` e
// `Joi.number().integer().strict()`. Sem o cast o DELETE responde 400 do Joi
// antes de chegar ao controlador -- e o teste passaria a provar a validacao de
// tipo em vez da traducao da chave estrangeira, que e o que ele existe para
// guardar. `acervo.volume_armazenamento.id` e INTEGER e ja chega como numero.
const id = (linha) => Number(linha.id)

/** Um ponto de controle, que e quem amarra o lote E o volume. */
const criarPonto = async (loteId, codPonto = 'PC-VINCULO-1') =>
  conn.one(
    `INSERT INTO ponto_controle.ponto
       (cod_ponto, lote_id, data_rastreio, geom, usuario_cadastramento_uuid)
     VALUES ($<codPonto>, $<loteId>, '2026-03-01', ST_GeomFromEWKT($<geom>), $<usuario>)
     RETURNING id`,
    { codPonto, loteId, geom: GEOM_PONTO, usuario: ADMIN_UUID }
  )

describe('DELETE /api/projetos/lote com vínculo', () => {
  it('responde 400 com a frase de vínculo, e não 500 em inglês', async () => {
    const projeto = await createProjeto()
    const lote = await createLote(projeto.id)
    await criarPonto(lote.id)

    const res = await request(app)
      .delete('/api/projetos/lote')
      .set('Authorization', admin())
      .send({ lote_ids: [id(lote)] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/não é possível deletar/i)
    expect(res.body.message).toMatch(/ponto de controle/i)
    // A mensagem crua do Postgres nao chega a quem usa.
    expect(res.body.message).not.toMatch(/violates foreign key/i)

    // E o lote continua la: a transacao deu rollback.
    const ainda = await conn.one(
      'SELECT COUNT(*)::int AS n FROM acervo.lote WHERE id = $1', [lote.id]
    )
    expect(ainda.n).toBe(1)
  })

  // CONTROLE POSITIVO: sem ele, uma guarda que recusasse SEMPRE passaria acima.
  it('o lote sem vínculo continua sendo apagado', async () => {
    const projeto = await createProjeto()
    const lote = await createLote(projeto.id)

    const res = await request(app)
      .delete('/api/projetos/lote')
      .set('Authorization', admin())
      .send({ lote_ids: [id(lote)] })

    expect(res.status).toBe(200)
    const ainda = await conn.one(
      'SELECT COUNT(*)::int AS n FROM acervo.lote WHERE id = $1', [lote.id]
    )
    expect(ainda.n).toBe(0)
  })
})

describe('DELETE /api/volumes/volume_armazenamento com vínculo do ponto de controle', () => {
  it('responde 400 nomeando o ponto de controle, e não 500 em inglês', async () => {
    const projeto = await createProjeto()
    const lote = await createLote(projeto.id)
    const ponto = await criarPonto(lote.id, 'PC-VINCULO-VOL')
    const volume = await createVolume({ nome: 'Volume PC', volume: '/volumes/pc' })

    await conn.none(
      `INSERT INTO ponto_controle.arquivo
         (ponto_id, tipo_arquivo_id, nome_arquivo, extensao, tamanho_mb, checksum,
          volume_armazenamento_id, usuario_cadastramento_uuid)
       VALUES ($<pontoId>, 1, 'PC-VINCULO-VOL_pacote', 'zip', 10, $<checksum>,
               $<volumeId>, $<usuario>)`,
      {
        pontoId: ponto.id,
        checksum: 'a'.repeat(64),
        volumeId: volume.id,
        usuario: ADMIN_UUID
      }
    )

    const res = await request(app)
      .delete('/api/volumes/volume_armazenamento')
      .set('Authorization', admin())
      .send({ volume_armazenamento_ids: [id(volume)] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/ponto de controle/i)
    expect(res.body.message).not.toMatch(/violates foreign key/i)

    const ainda = await conn.one(
      'SELECT COUNT(*)::int AS n FROM acervo.volume_armazenamento WHERE id = $1',
      [volume.id]
    )
    expect(ainda.n).toBe(1)
  })

  it('o volume sem vínculo nenhum continua sendo apagado', async () => {
    const volume = await createVolume({ nome: 'Volume Livre', volume: '/volumes/livre' })

    const res = await request(app)
      .delete('/api/volumes/volume_armazenamento')
      .set('Authorization', admin())
      .send({ volume_armazenamento_ids: [id(volume)] })

    expect(res.status).toBe(200)
    const ainda = await conn.one(
      'SELECT COUNT(*)::int AS n FROM acervo.volume_armazenamento WHERE id = $1',
      [volume.id]
    )
    expect(ainda.n).toBe(0)
  })
})
