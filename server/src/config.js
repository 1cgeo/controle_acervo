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

// 1.6.0 acrescenta o schema `ponto_controle` (2026-07-28), que a plataforma
// passa a exigir: sem ele as rotas de /ponto_controle quebram em runtime.
// A 1.5.0 foi a versao unica depois da fusao com o SCO (2026-07-27).
// 1.10.0 acrescenta `acervo.miniatura_versao` (2026-07-31), que a ficha do
// produto le para mostrar a imagem da carta.
// 1.11.0 acrescenta o schema `rpcmtec` (2026-08-01), para onde a edicao mensal
// do relatorio saiu do orcamento, e `mapoteca.tipo_material.categoria_id`, que
// e o que separa as tabelas 7.2 e 7.3 do RPCMTec. As duas sao exigidas: sem a
// primeira as rotas de /rpcmtec quebram em runtime, e sem a segunda a consulta
// de insumos falha na coluna que nao existe.
const VERSION = '1.11.0'
const MIN_DATABASE_VERSION = '1.11.0'

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
  // client desloga no meio do trabalho. Era '1h' fixo até 2026-07-27.
  JWT_EXPIRACAO: Joi.string()
    .pattern(/^\d+[smhd]$/)
    .default('8h'),
  AUTH_SERVER: Joi.string()
    .uri()
    .required(),
  DB_USER_READONLY: Joi.string().allow('').default(''),
  DB_PASSWORD_READONLY: Joi.string().allow('').default(''),
  USE_PROXY: Joi.boolean().default(false),
  // Onde os shares do acervo estao MONTADOS nesta maquina. So importa fora do
  // Windows: acervo.volume_armazenamento.volume guarda caminho UNC do Windows,
  // que no Linux nao existe em forma nenhuma. Com VOLUMES_RAIZ=/mnt, o share
  // "acervo_sca" da UNC passa a ser lido em /mnt/acervo_sca. Para o share que
  // fugir da convencao, VOLUME_<SHARE>_CAMINHO manda (utils/caminho_volume.js).
  // Vazio no Windows; no Linux, sem isso TODO download responde 404.
  VOLUMES_RAIZ: Joi.string().allow('').default(''),
  // Teto, em GB, do arquivo que o NAVEGADOR pode enviar por
  // PUT /api/arquivo/upload-web/... Existe porque o byte atravessa o processo
  // do servidor: o upload pela web e o unico caminho em que o Node segura a
  // conexao do começo ao fim da transferencia, e uma requisicao de horas nao e
  // o que o navegador (nem o proxy da rede) aguenta. A mediana em producao e de
  // 6 a 11 MB e o maximo e 500 MB, entao 2 GB deixa folga larga e ainda barra o
  // .img de 7,4 GB, que continua entrando pelo plugin, por SMB, sem passar por
  // aqui. E configuravel porque o teto certo depende da rede da instalacao.
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
  AUTH_SERVER: process.env.AUTH_SERVER,
  USE_PROXY: process.env.USE_PROXY === 'true',
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
