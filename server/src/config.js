'use strict'

const dotenv = require('dotenv')
const Joi = require('joi')
const fs = require('fs')
const path = require('path')

const AppError = require('./utils/app_error')
const errorHandler = require('./utils/error_handler')

const configFile =
  process.env.NODE_ENV === 'test' ? 'config_testing.env' : 'config.env'

const configPath = path.join(__dirname, '..', configFile)

if (!fs.existsSync(configPath)) {
  errorHandler.critical(
    new AppError(
      'Arquivo de configuração não encontrado. Configure o serviço primeiro.'
    )
  )
}

dotenv.config({
  path: configPath
})

// `MIN_DATABASE_VERSION` é o PISO do banco, e sobe junto com toda migração que
// acrescenta schema, tabela ou coluna que o código passa a ler. Banco abaixo do
// piso não sobe o serviço (`database/database_version.js`). O carimbo do banco
// mora em `public.versao` e é escrito por cada migração.
//
// MIGRAÇÃO QUE SÓ REMOVE NÃO SOBE O PISO. A 1.26.0 apaga uma função e um índice
// que o código nunca leu, então um banco carimbado 1.25.0 roda esta versão sem
// faltar nada. Subir o piso obrigaria toda instalação a migrar para não ganhar
// nada. Por isso os dois números divergem aqui, e a divergência é deliberada.
const VERSION = '1.26.0'
const MIN_DATABASE_VERSION = '1.25.0'

const configSchema = Joi.object().keys({
  PORT: Joi.number()
    .integer()
    .required(),
  DB_SERVER: Joi.string().required(),
  DB_PORT: Joi.number()
    .integer()
    .required(),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  // Duração da sessão, no formato do jsonwebtoken ('8h', '30m', '1d'). Não há
  // renovação de token: quando ele expira, a próxima requisição volta 401 e o
  // client desloga no meio do trabalho.
  JWT_EXPIRACAO: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('8h'),
  DB_USER_READONLY: Joi.string().allow('').default(''),
  DB_PASSWORD_READONLY: Joi.string().allow('').default(''),
  // Onde os shares do acervo estão MONTADOS nesta máquina. Só importa fora do
  // Windows: `acervo.volume_armazenamento.volume` guarda caminho UNC, que no
  // Linux não existe. Com VOLUMES_RAIZ=/mnt, o share "acervo_sca" da UNC é lido
  // em /mnt/acervo_sca; VOLUME_<SHARE>_CAMINHO manda sobre a convenção
  // (`utils/caminho_volume.js`). No Linux, sem isso todo download responde 404.
  VOLUMES_RAIZ: Joi.string().allow('').default(''),
  // Teto, em GB, do arquivo que o NAVEGADOR envia por
  // POST /api/arquivo/upload-web/{produto,versao,arquivos}. O byte atravessa o
  // processo do servidor, e uma requisição de horas não é o que o navegador nem
  // o proxy aguentam. Arquivo maior entra pelo plugin, por SMB, sem passar aqui.
  UPLOAD_WEB_MAX_GB: Joi.number().positive().default(2),
  VERSION: Joi.string().required(),
  MIN_DATABASE_VERSION: Joi.string().required()
})

const config = {
  PORT: process.env.PORT,
  DB_SERVER: process.env.DB_SERVER,
  DB_PORT: process.env.DB_PORT,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_USER_READONLY: process.env.DB_USER_READONLY || '',
  DB_PASSWORD_READONLY: process.env.DB_PASSWORD_READONLY || '',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRACAO: process.env.JWT_EXPIRACAO || '8h',
  VOLUMES_RAIZ: process.env.VOLUMES_RAIZ || '',
  // Ausente vale 2, e nao NaN: `Number(undefined)` reprovaria a validacao e
  // mataria o boot de toda instalacao que nunca ouviu falar desta chave.
  UPLOAD_WEB_MAX_GB: process.env.UPLOAD_WEB_MAX_GB
    ? Number(process.env.UPLOAD_WEB_MAX_GB)
    : 2,
  VERSION,
  MIN_DATABASE_VERSION
}

const { error } = configSchema.validate(config, {
  abortEarly: false
})
if (error) {
  const { details } = error
  const message = details.map(i => i.message).join(',')

  errorHandler.critical(
    new AppError(
      'Arquivo de configuração inválido. Configure novamente o serviço.',
      null,
      message
    )
  )
}

module.exports = config
