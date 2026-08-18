'use strict'

const express = require('express')
const path = require('path')
const fs = require('fs')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const swaggerUi = require('swagger-ui-express')
const swaggerJSDoc = require('swagger-jsdoc')
const noCache = require('nocache')

const appRoutes = require('../routes')
const config = require('../config')
const swaggerOptions = require('./swagger_options')

const swaggerSpec = swaggerJSDoc(swaggerOptions)

const {
  AppError,
  httpCode,
  logger,
  errorHandler,
  sendJsonAndLogMiddleware
} = require('../utils')

const app = express()

// ATRÁS DE UM PROXY REVERSO, `req.ip` É O IP DO PROXY para todo mundo. Isso
// quebra duas coisas ao mesmo tempo: o rate limit deixa de ser por cliente e
// passa a ser um balde único de 3000/min para a rede inteira, e o log registra
// sempre o mesmo endereço, o que apaga o rastro de quem fez o quê. Com a lista
// de proxies confiáveis, o Express resolve o IP real a partir do
// X-Forwarded-For.
//
// A LISTA É NOMINAL, e nunca `true`: confiar em qualquer origem deixa qualquer
// cliente forjar o próprio IP pelo header, e aí o limite por IP não limita nada
// e o log passa a registrar o endereço que o cliente escolheu.
if (config.TRUST_PROXY) {
  app.set(
    'trust proxy',
    config.TRUST_PROXY.split(',')
      .map(item => item.trim())
      .filter(Boolean)
  )
}

// PREFIXO PÚBLICO (PUBLIC_PATH), quando um proxy reverso publica o SAP num
// subcaminho em vez da raiz do host. O build carrega o prefixo dentro de si (o
// `base` do Vite entra no `index.html` e nas URLs que o bundle monta), então o
// navegador pede `<prefixo>/assets/...` e `<prefixo>/api/...`.
//
// O proxy costuma remover o prefixo antes de repassar, e aí nada disto roda. O
// que isto resolve é o acesso DIRETO NA PORTA, sem proxy na frente: sem remover
// o prefixo aqui, `<prefixo>/assets/x.js` cairia no fallback da SPA e o
// navegador receberia o `index.html` no lugar do JavaScript.
//
// "/" NÃO É REDIRECIONADO para o prefixo, de propósito: atrás do proxy que
// remove o prefixo, "/" é justamente o que chega, e o redirecionamento voltaria
// ao proxy para ser removido outra vez, em laço infinito.
const publicPath = config.PUBLIC_PATH.replace(/\/+$/, '')
if (publicPath) {
  app.use((req, res, next) => {
    if (req.url === publicPath) {
      return res.redirect(`${publicPath}/`)
    }
    if (req.url.startsWith(`${publicPath}/`)) {
      req.url = req.url.slice(publicPath.length)
    }
    return next()
  })
}

app.use(sendJsonAndLogMiddleware)

// CORS antes do rate limit: respostas 429 também precisam dos headers CORS
app.use(cors())

// O teto é dimensionado para CLIENTE DE LOTE, não para navegador: o acervo_cli
// move o acervo inteiro, e um teto de tela partia a operação no meio com 429,
// deixando parte das versões migradas e parte não. É aplicação de intranet, e o
// limitador só existe para conter cliente com laço desgovernado.
// `standardHeaders` publica RateLimit-Limit/Remaining/Reset, para o cliente de
// lote pausar antes de bater no teto.
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  // Desligado sob NODE_ENV=test. A suite faz centenas de requisicoes em poucos
  // segundos, contra o mesmo processo, e passava de 200 no meio do arquivo de
  // rotas da mapoteca: dali em diante tudo virava 429. O efeito pior nao era
  // falhar, era falhar em teste QUE NAO MUDOU, so porque um teste novo entrou
  // antes dele no mesmo minuto. Isso torna a suite dependente de ordem e de
  // relogio, e o resultado deixa de significar alguma coisa.
  //
  // O limite protege contra abuso vindo da rede, que nao e o que a suite
  // imita. Nenhum teste cobre o 429 hoje; se um dia cobrir, ele monta o proprio
  // limitador em vez de depender deste.
  skip: () => process.env.NODE_ENV === 'test'
})

// Rate limit antes do body parser: requisição acima do limite não paga o parse de 60mb
app.use(limiter)

// 60mb, e era 50mb até 2026-08-08. Quem levantou o teto foi o VÍDEO DE CAMPO:
// `POST /api/campo/:id/imagem` recebe o arquivo em base64, e base64 cresce o
// binário em um terço. O maior vídeo do acervo do SAP tem 37 MB, o que dá cerca
// de 49,3 MiB de texto -- passava raspando no teto antigo, e qualquer campo de
// JSON ao lado (descrição, data, tipo) o estourava.
//
// O TETO DO Joi (`campo_schema.MAX_BASE64`, 56 MiB) TEM DE CABER AQUI. Com o
// teto do Express menor, o corpo grande morre com um 413 do body parser antes
// de chegar ao schema, e a mensagem não diz qual campo excedeu -- o Joi nunca
// roda. Mexer num dos dois sem o outro reabre exatamente esse buraco.
app.use(express.json({ limit: '60mb' })) // parsear POST em JSON

// SEM hpp (proteção contra poluição de parâmetro). Foi removido de propósito.
// NÃO recoloque numa próxima auditoria de segurança. Duas razões, nesta ordem:
//
// 1. Sob Express 5 ele não faz nada. O req.query virou getter sem cache: cada
//    acesso reparseia a URL e devolve um objeto NOVO. O hpp lê o objeto, colapsa
//    o array dentro dele e devolve o controle. O objeto que ele escreveu morre
//    ali, e o handler recebe o array intacto do acesso seguinte.
// 2. Se voltasse a funcionar, quebraria a busca do acervo. Os filtros de domínio
//    aceitam VÁRIOS códigos de propósito, na forma tipo_produto_id=1 repetida na
//    URL, e utils/lista_schema.js existe para tratar essa lista. O hpp colapsa o
//    array para o ÚLTIMO valor. O filtro passaria a devolver resultado a mais,
//    plausível e errado, sem erro nenhum na tela.
//
// A proteção de verdade já existe e é mais forte: toda rota que lê req.query tem
// schema de query no Joi. Campo escalar recusa o array com 400; campo de lista o
// aceita porque é o contrato dele. Prova em __tests__/unit/server/hpp_removido.

// Helmet, com CSP desligado: o Express serve o client SPA e o Swagger UI, que
// usam script e estilo inline, e é aplicação de intranet.
//
// COOP e Origin-Agent-Cluster ficam DESLIGADOS enquanto o serviço responder em
// http por IP: fora de origem confiável o navegador ignora os dois e escreve
// aviso no console a cada carga. Ligue-os de volta se o serviço for para https.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false
}))
app.use(noCache())

// O LOG NÃO PODE CARREGAR CREDENCIAL, e `req.originalUrl` inclui a query
// string. A única rota que leva token na query é a da tile MVT
// (`verify_login_tile.js`), e a rota `/logs` logo abaixo publica este arquivo
// SEM guarda nenhuma: sem a redação, o token da tile ficava legível a quem
// abrisse a página do log. Ver `login/redigir_token_da_url.js`.
//
// O `require` é do arquivo, e não do `../login`: aquele índice puxa banco e
// configuração, e isto aqui é uma função de string sem dependência nenhuma.
const redigirTokenDaUrl = require('../login/redigir_token_da_url')

app.use((req, res, next) => {
  const url = redigirTokenDaUrl(
    req.protocol + '://' + req.get('host') + req.originalUrl
  )

  logger.info(`${req.method} request`, {
    url,
    ip: req.ip
  })
  return next()
})

app.use('/api', appRoutes)

app.use('/logs', (req, res) => {
  const logFile = path.join(__dirname, '..', '..', 'logs/combined.log')
  const daysToShow = 3
  const cutofftimestamp = new Date(Date.now() - daysToShow * 24 * 60 * 60 * 1000)
  // Ler apenas o fim do arquivo (5 MB) em vez do arquivo inteiro em memória
  const maxBytes = 5 * 1024 * 1024

  fs.stat(logFile, (statErr, stats) => {
    if (statErr) {
      return res.status(500).send('Error reading log file')
    }

    const start = Math.max(0, stats.size - maxBytes)
    const stream = fs.createReadStream(logFile, { start, encoding: 'utf8' })
    let data = ''
    stream.on('data', chunk => { data += chunk })
    stream.on('error', () => res.status(500).send('Error reading log file'))
    stream.on('end', () => {
      const logData = data.split('\n').filter(entry => {
        const logDate = new Date(entry.split('|')[0])
        return logDate > cutofftimestamp
      }).reverse().join('\n')

      res.setHeader('Content-Type', 'text/plain')
      res.send(logData)
    })
  })
})

// Serve SwaggerDoc
app.use('/api/api_docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

// 404 em JSON para rota de API. Tem de vir ANTES do estático e do
// fallback da SPA, que respondem qualquer caminho.
app.use('/api', (req, res, next) => {
  const err = new AppError(
    `URL não encontrada para o método ${req.method}`,
    httpCode.NotFound
  )
  return next(err)
})

// Interface ÚNICA do SCA, com os módulos dentro dela. Um build só, em
// build/, servido na raiz. Trocar de módulo é trocar de rota (#/acervo/...,
// #/mapoteca/..., #/orcamento/...), sem recarregar e sem novo login.
app.use(express.static(path.join(__dirname, "..", "build")));

app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "build", "index.html"));
})

// Error handling
app.use((err, req, res, next) => {
  // Resposta já iniciada (ex: streaming): delega ao handler default do Express
  if (res.headersSent) {
    return next(err)
  }
  return errorHandler.log(err, res)
})

module.exports = app