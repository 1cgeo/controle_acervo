"use strict";

const { AppError, asyncHandler, httpCode } = require("../utils");

const { db } = require("../database");

const validateToken = require("./validate_token");

const { montarContexto } = require("./contexto");

// Niveis DENTRO de um modulo, hierarquicos: quem e gerente satisfaz operador e
// consulta. O administrador NAO e um nivel daqui, e a flag global
// dgeo.usuario.administrador, que vale em qualquer modulo.
const PERFIL = {
  consulta: 1,
  operador: 2,
  gerente: 3
};

// Espelha dominio.modulo, code a code. Os seis sao compartimentos distintos de
// proposito: quem atende a mapoteca nao precisa catalogar o acervo, quem lanca
// empenho nao precisa de nenhum dos dois, e quem lanca a execucao do PIT nao
// mexe em dinheiro.
//
// PRODUCAO e EFETIVO entraram na 1.33.0 para haver como dar MENOS que a flag
// global. Ate ali a execucao do PIT, o Extra-PIT, a capacitacao e o
// aproveitamento so tinham `verifyAdmin`, e por isso 5 das 7 contas que
// trabalhavam no sistema eram administradoras (medido em 2026-08-06).
//
// PRODUCAO cobre a execucao do PIT, o Extra-PIT e a capacitacao MINISTRADA (2.6
// do RPCMTec). EFETIVO cobre a passagem pela DGEO, o impedimento e a capacitacao
// RECEBIDA (6.2). As METAS do PIT ficaram de fora, e nao por esquecimento:
// altera-las e ato da DSG, e o que esta no sistema e transcricao de documento
// assinado.
//
// EQUIPAMENTO entrou na 1.46.0, com o material permanente da Divisao (o antigo
// Relatorio DMT, que era uma planilha). Ele e compartimento proprio pelo mesmo
// criterio: quem controla estacao total e drone nao e quem atende a mapoteca,
// ainda que os dois plotteres aparecam nos dois lugares por enquanto.
//
// O `code` NAO E SERIAL nem opiniao: ele espelha `dominio.modulo.code`, que
// `dgeo.usuario_perfil.modulo_id` referencia. Os dois lados nascem juntos, no
// mesmo commit, e divergir aqui derruba a autorizacao sem erro de sintaxe.
const MODULO = {
  acervo: 1,
  mapoteca: 2,
  orcamento: 3,
  producao: 4,
  efetivo: 5,
  equipamento: 6
};

// Uso: verifyPerfil('operador') no acervo, verifyPerfil('gerente', 'mapoteca')
// na mapoteca, verifyPerfil('operador', 'orcamento') no orcamento. O default e
// 'acervo', entao rota de outro modulo TEM de passar o modulo explicitamente.
// Nome errado falha no carregamento do modulo, nao em runtime.
const verifyPerfil = (minimo, modulo = "acervo") => {
  if (!(minimo in PERFIL)) {
    throw new Error(`Perfil mínimo desconhecido: ${minimo}`);
  }
  if (!(modulo in MODULO)) {
    throw new Error(`Módulo desconhecido: ${modulo}`);
  }

  return asyncHandler(async (req, res, next) => {
    const decoded = await validateToken(req.headers.authorization);

    if (!("uuid" in decoded && decoded.uuid)) {
      throw new AppError("Falta informação de usuário", httpCode.Unauthorized);
    }

    // Le o BANCO a cada requisicao, e nao o token: e o que faz desativar um
    // usuario ou rebaixar o perfil dele valer na hora, sem esperar o token
    // expirar. O token so diz quem a pessoa e; o que ela pode vem daqui.
    const usuario = await db.conn.oneOrNone(
      `SELECT u.id, u.administrador, up.perfil_id
       FROM dgeo.usuario AS u
       LEFT JOIN dgeo.usuario_perfil AS up
         ON up.usuario_id = u.id AND up.modulo_id = $<moduloId>
       WHERE u.uuid = $<uuid> AND u.ativo IS TRUE`,
      { uuid: decoded.uuid, moduloId: MODULO[modulo] }
    );

    if (!usuario) {
      throw new AppError(
        "Usuário não encontrado ou inativo",
        httpCode.Forbidden
      );
    }

    req.usuarioUuid = decoded.uuid;
    req.usuarioId = usuario.id;
    req.administrador = usuario.administrador;
    req.perfilId = usuario.perfil_id;

    // Origem, rota e lote da rastreabilidade. Montado aqui, e nao num
    // middleware proprio, porque o token ja esta decodificado: decodifica-lo
    // uma segunda vez seria dois lugares para divergir.
    montarContexto(req, decoded);

    // AQUI HAVIA UMA TRAVA DE `usuario_uuid`, e ela saiu em 2026-08-08.
    //
    // A regra era: quem nao e administrador global nao pode mandar um
    // `usuario_uuid` diferente do proprio, em params, body ou query. Ela parecia
    // dizer "cada um mexe no proprio registro", e nao dizia: ela lia um NOME DE
    // CAMPO, e o campo com esse nome nas rotas que existem hoje e o ALVO do
    // lancamento, nunca "o meu registro".
    //
    // O QUE ELA QUEBRAVA. Sob `verifyPerfil` so duas rotas carregam o campo:
    // `POST /efetivo/periodos` e `POST /efetivo/impedimentos`, onde o uuid e o
    // MILITAR de quem se lanca a passagem ou o impedimento. Com a trava, so o
    // administrador global conseguia lancar pelos outros -- exatamente o
    // trabalho que a regua nova poe no gerente do efetivo. Ela respondia 401
    // ("Usuário só pode acessar sua própria informação") a quem tinha o perfil
    // certo, antes mesmo do Joi.
    //
    // POR QUE TIRAR NAO ABRE PORTA NENHUMA. As rotas que sao mesmo da PROPRIA
    // pessoa -- `GET`/`PUT /usuarios/perfil` e `PUT /usuarios/perfil/senha` --
    // nunca leram uuid do pedido: elas usam `req.usuarioUuid`, que sai do token
    // ja validado. Nao existe rota sob esta guarda em que o `usuario_uuid` do
    // corpo signifique "de quem e o dado que eu posso ver". Quem recorta acesso
    // aqui e o perfil no modulo, logo abaixo.
    //
    // A MESMA TRAVA CONTINUA EM `verify_login.js`, onde hoje nao alcanca rota
    // nenhuma (nenhuma rota de `verifyLogin` recebe o campo). Se um dia uma
    // receber, o mesmo 401 aparece la, e a leitura acima e a resposta.

    // Administrador da plataforma passa em qualquer modulo, em qualquer nivel
    if (usuario.administrador) {
      return next();
    }

    if (!usuario.perfil_id || usuario.perfil_id < PERFIL[minimo]) {
      throw new AppError(
        `Usuário necessita do perfil ${minimo} no módulo ${modulo}`,
        httpCode.Forbidden
      );
    }

    next();
  });
};

module.exports = verifyPerfil;
module.exports.PERFIL = PERFIL;
module.exports.MODULO = MODULO;
