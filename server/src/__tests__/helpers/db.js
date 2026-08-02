'use strict'

const pgp = require('pg-promise')()
const bcrypt = require('bcryptjs')

const {
  DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
} = require('../../config')

// `max: 2` pela mesma razao do `POOL_TESTE` em `database/db.js`: este e o
// SEGUNDO pool de cada arquivo do pacote de banco, e sem teto os workers em
// paralelo pedem mais conexoes do que o PostgreSQL aceita. Os testes de um
// arquivo sao sequenciais, entao duas conexoes sobram.
const conn = pgp({
  host: DB_SERVER,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 2
})

/**
 * Hash bcrypt da senha de cada usuario da semente, que e o PROPRIO login (a
 * convencao do reset administrativo, ver `usuario_ctrl.resetaSenhas`).
 *
 * Memoizado: bcrypt a custo 10 leva dezenas de milissegundos de proposito, e o
 * `cleanTestData` roda depois de CADA teste do pacote de banco. Calcular a cada
 * limpeza somaria minutos a suite; calcular uma vez por processo nao soma nada.
 * Duas senhas iguais nao produzem o mesmo hash (o sal e aleatorio), e nao
 * precisam: o que importa e que `bcrypt.compare` aceite a senha.
 */
let hashesMemo = null
const hashesDaSemente = () => {
  if (!hashesMemo) {
    hashesMemo = Promise.all([
      bcrypt.hash('test_admin', 10),
      bcrypt.hash('test_user', 10)
    ])
  }
  return hashesMemo
}

/**
 * Cleans all test data from the database while preserving
 * domain/lookup tables and the seed users + volume.
 * Tables are truncated in reverse-dependency order.
 */
const cleanTestData = async () => {
  await conn.tx(async t => {
    // A RASTREABILIDADE entra primeiro, e por TRUNCATE proprio: `auditoria.evento`
    // nao tem chave estrangeira nenhuma (de proposito, para o rastro sobreviver
    // ao registro e ao usuario apagados), entao nenhum CASCADE a alcanca. Sem
    // esta linha os eventos de um teste vazariam para o teste seguinte, e as
    // contagens de "quantos eventos este caso gerou" passariam a depender da
    // ordem dos arquivos. E o mesmo motivo pelo qual a antiga
    // `mapoteca.pedido_auditoria` tinha a sua linha propria aqui, na secao da
    // mapoteca, antes de virar `auditoria.evento`.
    await t.none('TRUNCATE auditoria.evento CASCADE')

    // Orcamento tables (modulo absorvido do SCO). A configuracao e singleton
    // (linha id=1 criada pelo er/orcamento.sql), entao NAO entra no truncate.
    await t.none('TRUNCATE orcamento.arquivo CASCADE')
    await t.none('TRUNCATE orcamento.rpnp CASCADE')
    await t.none('TRUNCATE orcamento.recebimento_material CASCADE')
    await t.none('TRUNCATE orcamento.liquidacao CASCADE')
    await t.none('TRUNCATE orcamento.nota_empenho_nota_credito CASCADE')
    await t.none('TRUNCATE orcamento.nota_empenho CASCADE')
    await t.none('TRUNCATE orcamento.nota_credito CASCADE')
    await t.none('TRUNCATE orcamento.pdr_item CASCADE')
    await t.none('TRUNCATE orcamento.licitacao CASCADE')
    await t.none('TRUNCATE orcamento.dfd_item CASCADE')
    await t.none('TRUNCATE orcamento.dfd CASCADE')
    await t.none('TRUNCATE pit.meta CASCADE')

    // A edicao mensal do RPCMTec. Era `orcamento.relatorio_rpcmtec` ate
    // 2026-08-01; saiu para schema proprio quando o relatorio deixou de ser do
    // modulo orcamento (ver migrations/2026-08-01_rpcmtec_schema_proprio.sql).
    await t.none('TRUNCATE rpcmtec.edicao CASCADE')

    // Mapoteca tables.
    await t.none('TRUNCATE mapoteca.impressao_item CASCADE')
    await t.none('TRUNCATE mapoteca.consumo_material CASCADE')
    await t.none('TRUNCATE mapoteca.estoque_material CASCADE')
    await t.none('TRUNCATE mapoteca.manutencao_plotter CASCADE')
    await t.none('TRUNCATE mapoteca.produto_pedido CASCADE')
    await t.none('TRUNCATE mapoteca.pedido CASCADE')
    await t.none('TRUNCATE mapoteca.plotter CASCADE')
    await t.none('TRUNCATE mapoteca.cliente CASCADE')
    await t.none('TRUNCATE mapoteca.tipo_material CASCADE')

    // Ponto de controle. Entra ANTES do acervo: ponto.lote_id referencia
    // acervo.lote, e o TRUNCATE do lote arrastaria os pontos por CASCADE.
    await t.none('TRUNCATE ponto_controle.upload_arquivo_temp CASCADE')
    await t.none('TRUNCATE ponto_controle.upload_ponto_temp CASCADE')
    await t.none('TRUNCATE ponto_controle.upload_session CASCADE')
    await t.none('TRUNCATE ponto_controle.arquivo CASCADE')
    await t.none('TRUNCATE ponto_controle.ponto CASCADE')

    // Acervo upload temp tables
    await t.none('TRUNCATE acervo.upload_arquivo_temp CASCADE')
    await t.none('TRUNCATE acervo.upload_versao_temp CASCADE')
    await t.none('TRUNCATE acervo.upload_produto_temp CASCADE')
    await t.none('TRUNCATE acervo.upload_session CASCADE')

    // Acervo main tables
    await t.none('TRUNCATE acervo.download_deletado CASCADE')
    await t.none('TRUNCATE acervo.download CASCADE')
    await t.none('TRUNCATE acervo.arquivo_deletado CASCADE')
    await t.none('TRUNCATE acervo.arquivo CASCADE')
    await t.none('TRUNCATE acervo.versao_relacionamento CASCADE')
    await t.none('TRUNCATE acervo.versao CASCADE')
    await t.none('TRUNCATE acervo.lote CASCADE')
    await t.none('TRUNCATE acervo.projeto CASCADE')
    await t.none('TRUNCATE acervo.produto CASCADE')
    await t.none('TRUNCATE acervo.volume_tipo_produto CASCADE')

    await t.none('DELETE FROM acervo.volume_armazenamento WHERE id > 1')

    // Reset users to only seed rows (o perfil sai antes: FK para dgeo.usuario)
    await t.none(`DELETE FROM dgeo.usuario_perfil WHERE usuario_id IN (
      SELECT id FROM dgeo.usuario WHERE uuid NOT IN (
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      )
    )`)
    await t.none(`DELETE FROM dgeo.usuario WHERE uuid NOT IN (
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
    )`)

    // As duas linhas da semente voltam ao estado do setup.js.
    //
    // Apagar quem sobrou nunca bastou: o que o teste MUDA nos dois usuarios da
    // semente sobrevivia ao clean e vazava para o arquivo seguinte. Medido em
    // 2026-08-02, com o cadastro de usuario pela API: um teste rebaixava o
    // `test_admin` para provar que o sistema deixa rebaixar administrador
    // quando ha outro ativo, e dali em diante TODO teste que usasse o token de
    // admin levava 403 -- inclusive em arquivo que ninguem tinha tocado, e com
    // a falha aparecendo longe da causa. E a mesma classe de defeito que o
    // rate limit desligado sob NODE_ENV=test evita: suite que depende de ordem.
    //
    // A senha e regravada junto porque a troca de senha e testavel agora (ela
    // nao existia enquanto a senha morava no Auth Server), e uma senha trocada
    // e invisivel ate o proximo teste que tente logar.
    const [hashAdmin, hashUser] = await hashesDaSemente()
    await t.none(
      `UPDATE dgeo.usuario SET
         login = 'test_admin', senha = $<hashAdmin>, nome = 'Test Admin',
         nome_guerra = 'Admin', tipo_posto_grad_id = 1,
         administrador = TRUE, ativo = TRUE
       WHERE uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'`,
      { hashAdmin }
    )
    await t.none(
      `UPDATE dgeo.usuario SET
         login = 'test_user', senha = $<hashUser>, nome = 'Test User',
         nome_guerra = 'User', tipo_posto_grad_id = 1,
         administrador = FALSE, ativo = TRUE
       WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'`,
      { hashUser }
    )

    // O perfil da semente (acervo consulta, mapoteca operador) tambem volta: um
    // teste que conceda ou revogue perfil ao `test_user` mudaria o que ele pode
    // em todos os arquivos seguintes.
    await t.none(`
      INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
      SELECT id, 1, 1 FROM dgeo.usuario WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id
    `)
    await t.none(`
      INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
      SELECT id, 2, 2 FROM dgeo.usuario WHERE uuid = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id
    `)
    await t.none(`
      DELETE FROM dgeo.usuario_perfil
      WHERE usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
    `)

    // O historico de acesso e do teste, nao da semente: o setup.js nao grava
    // nenhum, e cada login feito por um teste deixa uma linha aqui.
    await t.none('TRUNCATE dgeo.login')
  })
}

const closeConnection = async () => {
  await pgp.end()
}

module.exports = {
  conn,
  pgp,
  cleanTestData,
  closeConnection
}
