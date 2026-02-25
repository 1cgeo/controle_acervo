// Path: authentication\get_usuarios.js
'use strict'

const { AppError, httpCode, httpClient } = require('../utils')

const { AUTH_SERVER } = require('../config')

const getUsuarios = async () => {
  const server = `${AUTH_SERVER}/api/usuarios`
  try {
    const response = await httpClient.get(server)

    if (!response || response.status !== 200 || !('data' in response) || !('dados' in response.data)) {
      throw new Error()
    }

    return response.data.dados
  } catch (err) {
    if (
      'response' in err &&
      'data' in err.response &&
      'message' in err.response.data
    ) {
      throw new AppError(
        err.response.data.message,
        httpCode.BadRequest
      )
    } else {
      throw new AppError(
        'Erro ao se comunicar com o servidor de autenticação'
      )
    }
  }
}

module.exports = getUsuarios
