'use strict'

const { AppError, httpCode } = require('../utils')

/**
 * O CARIMBO DA SENHA: o que faz trocar a senha DERRUBAR as sessões abertas.
 *
 * O PROBLEMA, e ele é concreto. O JWT carrega `{ id, uuid, administrador,
 * cliente, aud }` e nada que o ligue à senha. Alguém deixa a sessão aberta numa
 * máquina compartilhada; quem a encontrou continua dentro; o dono percebe e
 * troca a senha em `#/perfil`. O token da outra sessão continuava valendo por
 * até `JWT_EXPIRACAO` (8 horas por padrão), lendo e escrevendo tudo. O mesmo
 * valia para o reset feito pelo administrador: resetar a senha de uma conta
 * comprometida NÃO expulsava quem já estava dentro. O único remédio era
 * `ativo = false`, que tranca o dono legítimo junto.
 *
 * A SOLUÇÃO, SEM COLUNA NOVA E SEM MIGRAÇÃO. As sete guardas do sistema já
 * fazem um `SELECT ... FROM dgeo.usuario WHERE uuid = ...` por requisição, e a
 * linha que elas leem tem o hash. Então o token passa a levar um CARIMBO
 * derivado do hash vigente, e cada guarda pede ao banco o mesmo carimbo -- na
 * consulta que ela já faz, sem uma ida a mais ao banco. Trocar a senha troca o
 * hash, trocar o hash troca o carimbo, e o token antigo deixa de bater na
 * requisição SEGUINTE. Vale para a troca pelo dono e para o reset pelo
 * administrador, pelo mesmo mecanismo, porque os dois gravam hash novo.
 *
 * O HASH NUNCA SAI DO BANCO. O que viaja são os OITO primeiros caracteres do
 * md5 do hash bcrypt: 32 bits, que não reconstroem o hash nem a senha, e que
 * mudam a cada gravação porque o bcrypt sorteia sal novo -- trocar a senha PELA
 * MESMA senha também derruba as sessões, e é o comportamento certo. Oito
 * caracteres porque isto não é prova criptográfica: é uma etiqueta de versão da
 * credencial, e quem forjasse um token com o carimbo escolhido já teria o
 * `JWT_SECRET`, caso em que o carimbo é o menor dos problemas.
 *
 * UMA IMPLEMENTAÇÃO SÓ, E EM SQL, e isso é o ponto mais importante deste
 * arquivo. O carimbo do token e o carimbo que cada guarda confere saem os dois
 * do MESMO `left(md5(senha), 8)`, calculado pelo PostgreSQL: o do token entra na
 * consulta que o login já faz para ler o hash, e o das guardas na consulta que
 * elas já fazem para ler `ativo`. Nenhuma das duas custa uma ida a mais. Calcular
 * um dos lados em JS funcionaria hoje (md5 é md5), mas seriam duas
 * implementações do mesmo número em duas linguagens, e o dia em que elas
 * divergissem TODA sessão nova responderia 401 em TODA requisição -- a falha
 * mais cara que este sistema conseguiria produzir, por uma economia de nada.
 * O `md5` é também o que o PostgreSQL tem sem extensão nenhuma: `sha256` só
 * chega com o `pgcrypto`, que este banco não instala.
 *
 * TOKEN SEM O CLAIM CONTINUA VALENDO, e a assimetria é a mesma que
 * `validate_token.js` usa para o `aud`: exigir o carimbo de todo mundo
 * deslogaria, no deploy, toda sessão aberta e todo CLI com token em cache
 * (`~/.sca`). O que se cobra é a DIVERGÊNCIA -- carimbo presente e diferente do
 * banco é sessão de senha velha, e essa cai. O token sem carimbo some sozinho em
 * oito horas.
 *
 * QUEM TROCA A PRÓPRIA SENHA TAMBÉM CAI, e é consequência, não descuido: o
 * token que ele tem na mão carrega o carimbo do hash ANTIGO. Ele lê a frase de
 * `SESSAO_ENCERRADA` na primeira requisição seguinte e entra de novo com a senha
 * que acabou de escolher. Manter essa sessão de pé exigiria devolver um token
 * novo na resposta de `PUT /usuarios/perfil/senha` e o client guardá-lo, o que
 * é mudança dos dois lados e decisão à parte.
 */

// OITO caracteres do md5. O número mora aqui porque as duas pontas o usam --
// a coluna do login e a coluna das guardas, as duas por `colunaCarimbo` --, e
// mudá-lo invalida toda sessão aberta no deploy seguinte.
const TAMANHO = 8

/**
 * A coluna que o login e cada guarda acrescentam ao SELECT que já fazem.
 *
 * @param {string} [alias] - o alias de `dgeo.usuario` na consulta, quando houver
 *   ('u' no `verify_perfil`; nenhum nas outras)
 * @returns {string} o fragmento SQL, sempre com o apelido `carimbo`
 */
const colunaCarimbo = (alias = '') => {
  const coluna = alias ? `${alias}.senha` : 'senha'
  return `left(md5(${coluna}), ${TAMANHO}) AS carimbo`
}

// A frase é do DONO da conta, e não do administrador: ela diz o que aconteceu e
// o que fazer, sem sugerir defeito. O client trata 401 deslogando e mostrando a
// mensagem do servidor, então esta é a última coisa que a pessoa lê antes da
// tela de login.
const SESSAO_ENCERRADA =
  'Sessão encerrada: a senha desta conta foi alterada. Entre de novo.'

/**
 * Recusa a sessão cujo carimbo não bate mais com o hash vigente.
 *
 * ASSIMÉTRICA DE PROPÓSITO: token SEM o claim passa (é o legado, emitido antes
 * de 2026-09-05); token COM o claim tem de bater.
 *
 * CONTA SEM SENHA (importada do Auth Server e ainda sem o hash copiado) tem
 * `carimbo` nulo no banco, e aí o token com carimbo diverge e cai. É o lado
 * certo: o hash que autorizou aquele token não existe mais.
 *
 * @param {object} decoded - o payload do JWT já validado
 * @param {object} usuario - a linha lida pela guarda, com a coluna `carimbo`
 */
const conferirCarimbo = (decoded, usuario) => {
  const doToken = decoded ? decoded.carimbo : undefined
  if (!doToken) return

  if (!usuario || usuario.carimbo !== doToken) {
    throw new AppError(SESSAO_ENCERRADA, httpCode.Unauthorized)
  }
}

module.exports = {
  TAMANHO,
  colunaCarimbo,
  conferirCarimbo,
  SESSAO_ENCERRADA
}
