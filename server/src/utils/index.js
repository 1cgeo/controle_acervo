'use strict'

module.exports = {
  logger: require('./logger'),
  sendJsonAndLogMiddleware: require('./send_json_and_log'),
  schemaValidation: require('./schema_validation'),
  asyncHandler: require('./async_handler'),
  asyncHandlerWithQueue: require('./async_handler_with_queue'),
  errorHandler: require('./error_handler'),
  AppError: require('./app_error'),
  httpCode: require('./http_code'),
  generateLocalizador: require('./generate_localizador'),
  // Sem `httpClient`: ele existia SO para falar com o Auth Server externo, que
  // saiu em 2026-08-02 quando a autenticacao veio para dentro. Com ele saiu o
  // axios do package.json -- o SCA nao faz mais nenhuma chamada de saida.
  serializeErrorLoader: require('./serialize_error_loader'),
  domainConstants: require('./domain_constants'),
  csvExport: require('./csv_export'),
  enviarArquivo: require('./enviar_arquivo'),
  preserveOmitted: require('./preserve_omitted'),
}