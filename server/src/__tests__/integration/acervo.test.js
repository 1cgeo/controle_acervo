'use strict'

// A FUNÇÃO DE LIMPEZA DE UPLOAD, no banco, contra o banco.
//
// `acervo.cleanup_expired_uploads()` é PL/pgSQL, e o controller a chama sem ler
// resultado nenhum (ele conta as sessões antes, porque a função não devolve
// contagem). Quem confere o número, então, confere a contagem do JavaScript, e
// não o que a função fez: se ela parasse de escrever, `uploads_fechados`
// continuaria certo e ninguém saberia.
//
// O QUE SÓ AQUI SE PROVA, e por isso este arquivo existe:
//
//   1. a sessão vencida vira 'failed' COM a mensagem, que é o que a tela mostra;
//   2. o efeito DESCE para `upload_arquivo_temp`, o segundo UPDATE da função;
//   3. a sessão dentro do prazo não é tocada.
//
// O item 3 é o que dá sentido aos outros dois: sem uma sessão viva no cenário,
// uma função que marcasse TUDO como 'failed' passaria igual.
//
// O CONTRATO EM NÚMERO (quantas sessões e quantos downloads a rotina fecha) é do
// controller, e está em routes/cleanup_downloads.test.js. Aqui se prova o efeito
// no banco, e lá o número que a rota devolve.

const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const MENSAGEM_SESSAO = 'Upload expired - client never confirmed completion'
const MENSAGEM_ARQUIVO = 'Upload session expired'

/**
 * Sessão de upload com um arquivo temporário pendente dentro.
 *
 * `expiracaoSql` entra como SQL para o prazo ser calculado pelo relógio do
 * BANCO, que é o mesmo `NOW()` que a função compara. Um `new Date()` do Node
 * abriria uma diferença de fuso entre o cenário e a regra sob teste.
 */
const criarSessao = async (expiracaoSql) => {
  const sessao = await conn.one(
    `INSERT INTO acervo.upload_session
       (operation_type, status, expiration_time, usuario_uuid)
     VALUES ('add_files', 'pending', ${expiracaoSql}, $1)
     RETURNING id, uuid_session`,
    [ADMIN_UUID]
  )

  await conn.none(
    `INSERT INTO acervo.upload_arquivo_temp
       (session_id, nome, nome_arquivo, destination_path, tipo_arquivo_id,
        situacao_carregamento_id, status)
     VALUES ($1, 'Arquivo pendente', 'arquivo_pendente.tif',
             '/tmp/arquivo_pendente.tif', 1, 1, 'pending')`,
    [sessao.id]
  )

  return sessao
}

const limpar = () => conn.any('SELECT acervo.cleanup_expired_uploads()')

const lerSessao = (id) =>
  conn.one(
    'SELECT status, error_message FROM acervo.upload_session WHERE id = $1',
    [id]
  )

const lerArquivos = (sessaoId) =>
  conn.any(
    `SELECT status, error_message FROM acervo.upload_arquivo_temp
      WHERE session_id = $1`,
    [sessaoId]
  )

describe('acervo.cleanup_expired_uploads()', () => {
  it('marca a sessão vencida como failed, com a mensagem que a tela mostra', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")

    await limpar()

    const depois = await lerSessao(vencida.id)
    expect(depois.status).toBe('failed')
    expect(depois.error_message).toBe(MENSAGEM_SESSAO)
  })

  // O SEGUNDO UPDATE da função. Sem ele o arquivo temporário fica 'pending'
  // para sempre, apontando uma sessão que já morreu.
  it('desce o fechamento para os arquivos temporários da sessão', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")

    await limpar()

    const arquivos = await lerArquivos(vencida.id)
    expect(arquivos).toHaveLength(1)
    expect(arquivos[0].status).toBe('failed')
    expect(arquivos[0].error_message).toBe(MENSAGEM_ARQUIVO)
  })

  // A VARIÂNCIA que dá sentido aos dois casos acima: com as duas sessões na
  // mesma tabela, uma função que marcasse tudo como 'failed' cai aqui.
  it('não toca a sessão que ainda está no prazo', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")
    const viva = await criarSessao("NOW() + INTERVAL '24 hours'")

    await limpar()

    expect((await lerSessao(vencida.id)).status).toBe('failed')

    const depois = await lerSessao(viva.id)
    expect(depois.status).toBe('pending')
    expect(depois.error_message).toBeNull()

    const arquivos = await lerArquivos(viva.id)
    expect(arquivos[0].status).toBe('pending')
  })

  // Rodar duas vezes seguidas não é erro, e a segunda passada não reescreve o
  // que a primeira fechou: a função filtra por `status = 'pending'`.
  it('rodar de novo não muda o que já foi fechado', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")

    await limpar()
    await limpar()

    const depois = await lerSessao(vencida.id)
    expect(depois.status).toBe('failed')
    expect(depois.error_message).toBe(MENSAGEM_SESSAO)
  })
})
