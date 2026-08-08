'use strict'

// A GUARDA DA ESCRITA DE UMA SUBSEÇÃO: o módulo DAQUELA subseção contra o
// perfil de gerente da pessoa NAQUELE módulo.
//
// Ela NÃO autentica ninguém. Ela roda depois do `verifyGerente`, que já validou
// o token, leu `dgeo.usuario` do banco, preencheu `req.usuarioId` e
// `req.administrador` e montou o contexto de rastreabilidade. Aqui só se
// responde a segunda pergunta, que é a única de que este arquivo entende: "esta
// pessoa é gerente do módulo DE QUE FALA esta subseção?".
//
// POR QUE MIDDLEWARE, E NÃO CONFERÊNCIA NO CONTROLADOR. O alvo está em
// `req.params.numero`, que a rota já tem na mão, e a resposta é AUTORIZAÇÃO,
// que nesta casa mora na camada de rota (CLAUDE.md, "Rota"). Levá-la ao
// controlador exigiria empurrar `usuarioId` e `administrador` para dentro de
// quatro métodos que hoje não sabem quem chamou, e a mesma conferência apareceria
// quatro vezes: a quinta rota de subseção nasceria sem ela e ninguém veria.
// Como middleware, ela é UM nome na declaração da rota, do mesmo jeito que
// `verifyPerfil`, e uma rota nova sem ele salta aos olhos na revisão.
//
// POR QUE NÃO É UM `verify_*` EM `login/`. O `login/` não sabe -- e não deve
// saber -- que "3.3" é uma subseção nem que ela fala de Extra-PIT. Quem sabe
// disso é `rpcmtec_estrutura.js`, que fica ao lado. Um middleware genérico em
// `login/` que recebesse "de que módulo é este pedido?" por função seria a mesma
// coisa com uma camada de indireção a mais e um único chamador.
//
// POR QUE NÃO SUBSTITUI O `verifyGerente`, e sim se soma a ele: são duas
// perguntas diferentes, e a primeira é a que autentica. Encadeadas, o operador
// para na primeira ("não é gerente em módulo nenhum") e o gerente do módulo
// errado para na segunda, que diz de qual módulo é a subseção.

const { AppError, asyncHandler, httpCode } = require('../utils')

const { db } = require('../database')
// `login/verify_perfil` DIRETO, e não `require('../login')`: o que se busca ali
// é o mapa `MODULO`, que é DADO e não guarda. Pelo índice, todo teste que dubla
// `../login` (e há vários, com `mockLogin`) devolveria um `verifyPerfil` sem o
// mapa, e este arquivo quebraria no carregamento por causa de um dublê que não
// tem nada com o assunto.
const verifyPerfil = require('../login/verify_perfil')

const estrutura = require('./rpcmtec_estrutura')

// 3 = gerente, em dominio.tipo_perfil. Editar o relatório da Divisão é ato de
// quem responde pela área, e não de quem lança nela.
const PERFIL_GERENTE = 3

// O mesmo mapa que o `verifyPerfil` usa, e não uma cópia: os dois comparam o
// `nome_abrev` de `dominio.modulo`, e duas listas divergiriam no primeiro módulo
// novo -- com a divergência aparecendo como 403 sem causa visível.
const MODULO = verifyPerfil.MODULO

// A CONFERÊNCIA DO MAPA ACONTECE NO CARREGAMENTO DO MÓDULO, e não na primeira
// requisição que topar com o erro. Mesma escolha do `verifyPerfil`, e aqui ela
// pesa mais: um `modulo` escrito errado não quebra nada visível, só faz a
// subseção responder 403 a TODO gerente, para sempre.
for (const bloco of estrutura.BLOCOS) {
  if (!('modulo' in bloco)) {
    throw new Error(
      `A subseção ${bloco.numero} do RPCMTec não declara o módulo dela. ` +
      'Use `modulo: null` para o que é do administrador.'
    )
  }
  if (bloco.modulo !== null && !(bloco.modulo in MODULO)) {
    throw new Error(
      `Módulo desconhecido na subseção ${bloco.numero} do RPCMTec: ${bloco.modulo}`
    )
  }
}

/**
 * Fabrica o middleware que cobra o gerente do módulo da subseção.
 *
 * @param {string|null} numeroFixo - o número da subseção, quando a ROTA o fixa
 *   no caminho (a importação da 5.1). Nulo lê `req.params.numero`.
 * @returns {Function} middleware
 */
const verifyModuloSubsecao = (numeroFixo = null) =>
  asyncHandler(async (req, res, next) => {
    // Sem `req.usuarioId` este middleware não tem a quem perguntar, e responder
    // "não é gerente" seria esconder um erro de montagem da rota atrás de um
    // 403. Quebrar alto é o certo: quer dizer que faltou o `verifyGerente`.
    if (!req.usuarioId) {
      throw new Error(
        'verifyModuloSubsecao exige um verifyGerente antes dele na rota'
      )
    }

    // O administrador global edita TUDO, inclusive as subseções de módulo
    // nenhum. Ele curto-circuita antes de qualquer consulta.
    if (req.administrador) {
      return next()
    }

    const numero = numeroFixo || req.params.numero
    const bloco = estrutura.bloco(numero)

    // Número que não é subseção nenhuma. 403, e não 404: quem não é
    // administrador não descobre por esta porta que números existem, e o 404 de
    // verdade continua vindo do controlador para quem passou. A mensagem NÃO
    // repete o que o cliente mandou.
    if (!bloco) {
      throw new AppError(
        'A subseção informada não existe no RPCMTec', httpCode.Forbidden
      )
    }

    if (bloco.modulo === null) {
      throw new AppError(
        `A subseção ${bloco.numero} não é de módulo nenhum, e só o ` +
        'administrador do sistema a altera',
        httpCode.Forbidden
      )
    }

    const { gerente } = await db.conn.one(
      `SELECT EXISTS (
         SELECT 1 FROM dgeo.usuario_perfil
         WHERE usuario_id = $<usuarioId> AND modulo_id = $<moduloId>
           AND perfil_id >= $<minimo>
       ) AS gerente`,
      {
        usuarioId: req.usuarioId,
        moduloId: MODULO[bloco.modulo],
        minimo: PERFIL_GERENTE
      }
    )

    if (!gerente) {
      throw new AppError(
        `A subseção ${bloco.numero} é do módulo ${bloco.modulo}, e ` +
        `alterá-la exige o perfil gerente no módulo ${bloco.modulo}`,
        httpCode.Forbidden
      )
    }

    return next()
  })

module.exports = verifyModuloSubsecao
