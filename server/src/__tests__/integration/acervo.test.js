'use strict'

// A FUNÇÃO DE LIMPEZA DE UPLOAD, no banco, contra o banco.
//
// `acervo.cleanup_expired_uploads()` é PL/pgSQL, e ela é quem MEDE o que fez: o
// controller lê `fechadas` e `apagadas` do retorno dela, e não conta as sessões
// por fora. Até 06/08/2026 ela devolvia `void` e o controller contava antes de
// chamá-la, então quem conferisse o número conferia a aritmética do JavaScript:
// se a função parasse de escrever, o número continuaria certo.
//
// O QUE SÓ AQUI SE PROVA, e por isso este arquivo existe:
//
//   1. a sessão vencida vira 'failed' COM a mensagem, que é o que a tela mostra;
//   2. a sessão encerrada há mais de 30 dias é APAGADA, que é o DELETE que o
//      nome da função promete e que ela não tinha;
//   3. a sessão dentro do prazo não é tocada;
//   4. a sessão encerrada RECENTE não é apagada.
//
// Os itens 3 e 4 são o que dá sentido aos outros dois: sem uma sessão viva e uma
// sessão recém-encerrada no cenário, uma função que marcasse TUDO como 'failed'
// ou apagasse a tabela inteira passaria igual.
//
// O CONTRATO EM NÚMERO (quantas a rotina fecha e quantas apaga) é do controller,
// e está em routes/cleanup_uploads.test.js. Aqui se prova o efeito no banco, e
// lá o número que a rota devolve.

const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const MENSAGEM_SESSAO = 'Upload expired - client never confirmed completion'

/**
 * Uma sessão de upload com um arquivo no rascunho.
 *
 * `expiracaoSql` entra como SQL para o prazo ser calculado pelo relógio do
 * BANCO, que é o mesmo `NOW()` que a função compara. Um `new Date()` do Node
 * abriria uma diferença de fuso entre o cenário e a regra sob teste.
 */
const criarSessao = async (expiracaoSql, status = 'pending') => {
  return conn.one(
    `INSERT INTO acervo.upload_session
       (operation_type, status, expiration_time, usuario_uuid, payload)
     VALUES ('add_files', $2, ${expiracaoSql}, $1, $3)
     RETURNING id, uuid_session`,
    [
      ADMIN_UUID,
      status,
      {
        arquivos: [{
          nome: 'Arquivo pendente',
          nome_arquivo: 'arquivo_pendente',
          destination_path: '/tmp/arquivo_pendente.tif',
          tipo_arquivo_id: 1,
          situacao_carregamento_id: 1,
          versao_id: 1,
          status: 'pending',
          error_message: null
        }]
      }
    ]
  )
}

const limpar = () => conn.one('SELECT fechadas, apagadas FROM acervo.cleanup_expired_uploads()')

const lerSessao = (id) =>
  conn.oneOrNone(
    'SELECT status, error_message FROM acervo.upload_session WHERE id = $1',
    [id]
  )

describe('acervo.cleanup_expired_uploads()', () => {
  it('marca a sessão vencida como failed, com a mensagem que a tela mostra', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")

    const contagem = await limpar()

    const depois = await lerSessao(vencida.id)
    expect(depois.status).toBe('failed')
    expect(depois.error_message).toBe(MENSAGEM_SESSAO)
    expect(contagem.fechadas).toBe(1)
  })

  // O DELETE QUE FALTAVA. Este caso REPROVA a função anterior a 06/08/2026: ela
  // tinha dois comandos, e os dois eram UPDATE. A sessão encerrada ficava na
  // tabela para sempre, e foi assim que produção chegou a 2.571 delas.
  it('apaga a sessão encerrada há mais de 30 dias', async () => {
    const velha = await criarSessao("NOW() - INTERVAL '40 days'", 'completed')

    const contagem = await limpar()

    expect(await lerSessao(velha.id)).toBeNull()
    expect(contagem.apagadas).toBe(1)
  })

  it('apaga a sessão falha antiga, e não só a que deu certo', async () => {
    const velha = await criarSessao("NOW() - INTERVAL '40 days'", 'failed')

    await limpar()

    expect(await lerSessao(velha.id)).toBeNull()
  })

  // A VARIÂNCIA que dá sentido ao primeiro caso: com as duas sessões na mesma
  // tabela, uma função que marcasse tudo como 'failed' cai aqui.
  it('não toca a sessão que ainda está no prazo', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")
    const viva = await criarSessao("NOW() + INTERVAL '24 hours'")

    await limpar()

    expect((await lerSessao(vencida.id)).status).toBe('failed')

    const depois = await lerSessao(viva.id)
    expect(depois.status).toBe('pending')
    expect(depois.error_message).toBeNull()
  })

  // A VARIÂNCIA do DELETE: sem este caso, uma função que apagasse toda sessão
  // encerrada passaria, e a tela de uploads com problema ficaria vazia no dia
  // seguinte a uma falha.
  it('não apaga a sessão que falhou ontem', async () => {
    const recente = await criarSessao("NOW() - INTERVAL '1 day'", 'failed')

    const contagem = await limpar()

    expect((await lerSessao(recente.id)).status).toBe('failed')
    expect(contagem.apagadas).toBe(0)
  })

  // A sessão que ela acabou de fechar no passo 1 NÃO é apagada no passo 2:
  // ela venceu agora, e os 30 dias contam da expiração. Sem isto, a falha
  // sumiria no mesmo instante em que foi registrada.
  it('a sessão que ela acabou de fechar sobrevive à mesma passada', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")

    const contagem = await limpar()

    expect(contagem.fechadas).toBe(1)
    expect(contagem.apagadas).toBe(0)
    expect((await lerSessao(vencida.id)).status).toBe('failed')
  })

  // Rodar duas vezes seguidas não é erro, e a segunda passada não reescreve o
  // que a primeira fechou: a função filtra por `status = 'pending'`.
  it('rodar de novo não muda o que já foi fechado', async () => {
    const vencida = await criarSessao("NOW() - INTERVAL '1 hour'")

    await limpar()
    const segunda = await limpar()

    const depois = await lerSessao(vencida.id)
    expect(depois.status).toBe('failed')
    expect(depois.error_message).toBe(MENSAGEM_SESSAO)
    expect(segunda.fechadas).toBe(0)
  })
})
