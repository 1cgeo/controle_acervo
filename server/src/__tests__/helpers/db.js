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
 * As tabelas que o `cleanTestData` esvazia, num TRUNCATE SO.
 *
 * UM COMANDO, E NAO 43. Medido em 2026-08-07, com o banco sem concorrencia:
 * as 43 uma a uma custavam 585 ms; as mesmas 43 juntas custam 234 ms. O resto
 * do `cleanTestData` (o reseed dos dois usuarios da semente) custa 2 ms, entao
 * ERA ISTO a suite inteira. Com 883 testes no pacote de banco, e ~0,3 s por
 * teste, sao ~4,5 minutos de trabalho serial que somem.
 *
 * O ganho nao e so o relogio. Cada TRUNCATE toma ACCESS EXCLUSIVE e sincroniza
 * arquivo; 43 por teste, vezes N workers, batem todos no MESMO PostgreSQL, e e
 * essa disputa que fazia mais worker deixar a suite MAIS lenta em vez de mais
 * rapida.
 *
 * A ORDEM NAO IMPORTA MAIS, e por isso a lista pode ser lida por assunto em vez
 * de por dependencia: o TRUNCATE de varias tabelas as esvazia JUNTAS, e o
 * CASCADE alcanca quem referencia e nao esta na lista. A ordem reversa que este
 * arquivo mantinha existia porque os comandos eram separados.
 *
 * NAO ENTRAM aqui, e cada uma por um motivo:
 *   - as tabelas de dominio, que sao carga do `er/`;
 *   - `orcamento.configuracao`, singleton criada pelo `er/orcamento.sql`;
 *   - `pit.exercicio` e `acervo.volume_armazenamento`, que sao SEMENTE (o
 *     volume perde so as linhas que o teste acrescentou, logo abaixo);
 *   - `dgeo.usuario`, que volta ao estado da semente em vez de sumir.
 */
const TABELAS_DO_CLEAN = `
  auditoria.evento,
  orcamento.arquivo, orcamento.rpnp, orcamento.recebimento_material,
  orcamento.liquidacao, orcamento.nota_empenho_nota_credito,
  orcamento.nota_empenho, orcamento.nota_credito, orcamento.pdr_item,
  orcamento.licitacao, orcamento.dfd_item, orcamento.dfd,
  pit.revisao, pit.meta,
  rpcmtec.edicao,
  mapoteca.impressao_item, mapoteca.consumo_material, mapoteca.estoque_material,
  mapoteca.manutencao_plotter, mapoteca.produto_pedido, mapoteca.pedido,
  mapoteca.plotter, mapoteca.cliente, mapoteca.tipo_material,
  ponto_controle.upload_arquivo_temp, ponto_controle.upload_ponto_temp,
  ponto_controle.upload_session, ponto_controle.arquivo, ponto_controle.ponto,
  acervo.upload_session, acervo.download_deletado, acervo.download,
  acervo.arquivo_deletado, acervo.arquivo, acervo.versao_relacionamento,
  acervo.versao, acervo.lote, acervo.projeto, acervo.produto,
  acervo.volume_tipo_produto,
  dgeo.impedimento, dgeo.efetivo_periodo, dgeo.login`
// O EFETIVO ESTA NA LISTA, e o TRUNCATE dela roda ANTES do `DELETE FROM
// dgeo.usuario` la embaixo. As duas tabelas tem FK para `dgeo.usuario(uuid)` SEM
// cascade, entao a passagem de um usuario que o clean apaga travaria aquele
// DELETE. A ausencia delas ja foi defeito: o DELETE so alcanca quem NAO e da
// semente, e a passagem lancada para `test_user` sobrevivia e vazava para o caso
// seguinte. Como `efetivo_periodo` tem EXCLUDE de sobreposicao por pessoa, o
// segundo teste que lancasse passagem para o mesmo militar levava 23P01, falha
// em arquivo que ninguem tocou.

/**
 * Cleans all test data from the database while preserving
 * domain/lookup tables and the seed users + volume.
 */
const cleanTestData = async () => {
  await conn.tx(async t => {
    // O ESVAZIAMENTO INTEIRO NUM COMANDO. Ver TABELAS_DO_CLEAN acima: era
    // aqui, em 43 TRUNCATE separados, que a suite de banco gastava o relogio.
    //
    // `auditoria.evento` entra na lista como qualquer outra, mas por uma razao
    // propria: ela nao tem chave estrangeira nenhuma (de proposito, para o
    // rastro sobreviver ao registro e ao usuario apagados), entao CASCADE
    // nenhum a alcanca. Fora da lista, os eventos de um teste vazariam para o
    // seguinte e as contagens passariam a depender da ordem dos arquivos.
    await t.none(`TRUNCATE ${TABELAS_DO_CLEAN} CASCADE`)

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
    // Apagar quem sobrou nao basta: o que o teste MUDA nos dois usuarios da
    // semente sobrevive ao clean e vaza para o arquivo seguinte. Um teste que
    // rebaixe o `test_admin` para provar que o sistema deixa rebaixar
    // administrador faz TODO teste seguinte que use o token de admin levar 403,
    // inclusive em arquivo que ninguem tocou, e com a falha aparecendo longe da
    // causa. E a mesma classe de defeito que o rate limit desligado sob
    // NODE_ENV=test evita: suite que depende de ordem.
    //
    // A senha e regravada junto porque a troca de senha e testavel, e uma senha
    // trocada e invisivel ate o proximo teste que tente logar.
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
