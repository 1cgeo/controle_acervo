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

// Espelha dominio.modulo, code a code. Os cinco sao compartimentos distintos de
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
const MODULO = {
  acervo: 1,
  mapoteca: 2,
  orcamento: 3,
  producao: 4,
  efetivo: 5
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

    // Quem nao e administrador so mexe no proprio registro
    const requestedUuid =
      (req.params && req.params.usuario_uuid) ||
      (req.body && req.body.usuario_uuid) ||
      (req.query && req.query.usuario_uuid);

    if (requestedUuid && decoded.uuid !== requestedUuid && !usuario.administrador) {
      throw new AppError(
        "Usuário só pode acessar sua própria informação",
        httpCode.Unauthorized
      );
    }

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
