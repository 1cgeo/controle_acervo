// Path: login\verify_login.js
'use strict'

const { AppError, asyncHandler, httpCode } = require('../utils')

const validateToken = require('./validate_token')

// middleware para verificar o JWT
const verifyLogin = asyncHandler(async (req, res, next) => {
  // Verifica o header authorization para pegar o token
  const token = req.headers.authorization;
  
  const decoded = await validateToken(token);
  
  // Registra o UUID do usuário e ID para uso nas rotas
  req.usuarioUuid = decoded.uuid;
  req.usuarioId = decoded.id;
  req.administrador = decoded.administrador || false;
  
  // Verificação de segurança expandida - verifica em params, body e query
  const requestedUuid = req.params.usuario_uuid || req.body.usuario_uuid || req.query.usuario_uuid;
  
  if (requestedUuid && decoded.uuid !== requestedUuid && !decoded.administrador) {
    throw new AppError(
      'Usuário só pode acessar sua própria informação',
      httpCode.Unauthorized
    );
  }
  
  next();
});

module.exports = verifyLogin
