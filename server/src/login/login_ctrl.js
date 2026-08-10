'use strict'

const jwt = require('jsonwebtoken')
const semver = require('semver')

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { JWT_SECRET, JWT_EXPIRACAO } = require('../config')

const senhaUtils = require('./senha')

const { AUDIENCIA } = require('./validate_token')

const controller = {}

/**
 * QUANTO VIVE O TOKEN DE TILE. Minutos, e não as 8 horas de `JWT_EXPIRACAO`.
 *
 * Ele anda na QUERY STRING da URL da camada (é o único canal que uma camada XYZ
 * oferece), e por isso ele fica em log de acesso, histórico de navegador,
 * `Referer` e proxy do caminho. Nada disso se apaga depois. O que dá para
 * encurtar é o tempo em que o que ficou registrado ainda vale, e é isso que este
 * número é.
 *
 * DEZ MINUTOS, E NÃO MENOS, porque cada renovação é uma ida ao servidor no meio
 * de um mapa aberto. E não mais, porque o ganho todo é este. Quando ele vence, o
 * MapLibre recebe 401 na próxima tile e o client refaz a fonte com um token novo
 * (`mapas-mapa.js`), sem que ninguém precise recarregar a página.
 *
 * NÃO É CHAVE DE `config.env` de propósito: não é ajuste de instalação, é a
 * meia-vida de uma credencial que anda em URL, e afrouxá-la numa instalação
 * desfaria a correção justamente onde ninguém estaria olhando.
 */
const TILE_EXPIRACAO = '10m'

const signJWT = (data, secret, expiracao = JWT_EXPIRACAO) => {
  return new Promise((resolve, reject) => {
    jwt.sign(
      data,
      secret,
      {
        expiresIn: expiracao
      },
      (err, token) => {
        if (err) {
          // `null` no lugar do status deixava `statusCode` nulo: o default do
          // AppError só vale para argumento AUSENTE, e quem salvava o 500 era o
          // `||` do errorHandler, dois arquivos adiante.
          return reject(
            new AppError(
              'Erro durante a assinatura do token',
              httpCode.InternalError,
              err
            )
          )
        }
        resolve(token)
      }
    )
  })
}

// ---------------------------------------------------------------------------
// O GATE DE VERSAO: o cliente atrasado nao entra
// ---------------------------------------------------------------------------
//
// POR QUE ELE EXISTE. O plugin do QGIS ESCREVE no banco de produção pelas rotas
// de `/api/distribuicao`, e o contrato dessas rotas muda de versão para versão.
// Um plugin velho grava atividade com contrato velho, e o estrago não aparece no
// dia: aparece semanas depois, numa contagem de produção que não fecha. Barrar
// no login é o único ponto em que ainda dá para dizer "atualize" antes de o dado
// entrar.
//
// SÓ VALE PARA 'sap_fp', E ISSO É DELIBERADO -- é o que o SAP 2.3.5 fazia, e a
// razão é que 'sap_fp' é a PONTA DA PRODUÇÃO: é ele que executa a atividade e
// grava o dado. O 'sap_fg' (SAP Gerente) publica catálogo do QGIS e distribui
// trabalho, e travá-lo pela versão do plugin trancaria do lado de fora
// justamente quem PUBLICA a versão nova. O schema continua exigindo `plugins` e
// `qgis` dos dois, porque saber o que cada máquina roda é útil de qualquer jeito.
//
// AS TABELAS MUDARAM DE SCHEMA na travessia: `dgeo.versao_qgis` e `dgeo.plugin`
// do SAP são `qgis.versao_qgis` e `qgis.plugin` aqui, porque no SCA `dgeo` é
// GENTE e configuração de ferramenta não é gente. Ver o cabeçalho de
// `er/qgis.sql`.
//
// TABELA VAZIA NÃO BARRA NINGUÉM, nos dois casos. Instalação nova nasce sem
// linha em `qgis.plugin`, e recusar todo mundo enquanto o administrador não
// cadastrar o mínimo trancaria o sistema no primeiro dia. A ausência de exigência
// é uma resposta legítima: não há mínimo declarado.

/**
 * Compara duas versões tolerando o que o QGIS reporta ('3.22.2-Białowieża').
 *
 * `semver.coerce` DEVOLVE NULL para o que ele não consegue ler, e `semver.gte`
 * com null LANÇA. O SAP não tratava isso: uma string de versão estranha vinda do
 * cliente derrubava o login com 500 em vez de recusá-lo com 400. Aqui o
 * ilegível conta como ATRASADO, que é o lado seguro: quem não sabe dizer a
 * própria versão não prova estar em dia.
 */
const versaoAtende = (informada, minima) => {
  const atual = semver.coerce(informada)
  const piso = semver.coerce(minima)
  // Sem mínimo legível não há o que cobrar. Com mínimo e sem versão legível do
  // lado do cliente, recusa.
  if (!piso) return true
  if (!atual) return false
  return semver.gte(atual, piso)
}

/**
 * A versão mínima do QGIS. UMA linha em `qgis.versao_qgis`, e a chave `code`
 * existe justamente para não haver duas.
 */
const verificaQGIS = async (t, qgis) => {
  const minimo = await t.oneOrNone(
    'SELECT versao_minima FROM qgis.versao_qgis LIMIT 1'
  )
  if (!minimo || !minimo.versao_minima) return

  if (!versaoAtende(qgis, minimo.versao_minima)) {
    throw new AppError(
      `Versão incorreta do QGIS. A seguinte versão é necessária: ${minimo.versao_minima}`,
      httpCode.BadRequest
    )
  }
}

/**
 * A versão mínima de CADA plugin exigido.
 *
 * TODO PLUGIN DE `qgis.plugin` TEM DE ESTAR NA LISTA que o cliente mandou, e em
 * versão igual ou maior. Plugin exigido e ausente é recusado do mesmo modo que
 * plugin desatualizado, porque para o servidor os dois são a mesma coisa: o
 * cliente não tem o que precisa. E o desabilitado cai aqui também, porque o QGIS
 * só reporta o que está ligado.
 *
 * A MENSAGEM LISTA TODOS OS EXIGIDOS, e não só o que faltou. Quem está com dois
 * plugins atrasados descobriria um por vez, e cada descoberta custa um ciclo de
 * atualizar e tentar de novo.
 */
const verificaPlugins = async (t, plugins) => {
  const exigidos = await t.any('SELECT nome, versao_minima FROM qgis.plugin')
  if (!exigidos || exigidos.length === 0) return

  const informados = new Map(
    (plugins || []).map(p => [p.nome, p.versao])
  )

  const emFalta = exigidos.filter(exigido => {
    // Ausente da lista é ausente da máquina, para efeito de trabalho: pode estar
    // desinstalado ou apenas desligado, e nos dois casos o cliente não o tem.
    if (!informados.has(exigido.nome)) return true
    // Linha sem `versao_minima` exige PRESENÇA e nada mais.
    if (!exigido.versao_minima) return false
    return !versaoAtende(informados.get(exigido.nome), exigido.versao_minima)
  })

  if (emFalta.length > 0) {
    const lista = exigidos
      .map(p => `${p.nome} - Versão: ${p.versao_minima}`)
      .join('\n ')

    throw new AppError(
      `Plugins desatualizados, não instalados ou desabilitados. Os seguintes plugins são necessários: \n ${lista}`,
      httpCode.BadRequest
    )
  }
}

/**
 * Perfil por MODULO no formato que o client consome ({ acervo: 1, mapoteca: 2 }).
 *
 * A lista sai de dominio.modulo, entao modulo novo entra sozinho. Virou funcao
 * porque o login e a rota de sessao respondem a MESMA foto: duas copias da
 * consulta divergiriam na primeira coluna nova.
 */
const lerPerfis = async (t, usuarioId) => {
  const perfisDb = await t.any(
    `SELECT m.nome_abrev AS modulo, up.perfil_id
     FROM dgeo.usuario_perfil AS up
     INNER JOIN dominio.modulo AS m ON m.code = up.modulo_id
     WHERE up.usuario_id = $<usuarioId>`,
    { usuarioId }
  )

  const perfis = {}
  perfisDb.forEach(p => {
    perfis[p.modulo] = p.perfil_id
  })
  return perfis
}

/**
 * Catalogo dos modulos, para o client montar o seletor com o NOME de cada um em
 * vez de decorar codigo ou rotulo. Vai junto da sessao, e nao numa rota propria,
 * porque GET /usuarios/dominio/modulo e verifyAdmin: quem so tem perfil de
 * consulta tambem precisa saber como o modulo se chama.
 */
const lerModulos = async t =>
  t.any('SELECT code, nome, nome_abrev FROM dominio.modulo ORDER BY code')

/**
 * A INSTITUICAO que opera esta instalacao, para o client DESENHAR com ela.
 *
 * VAI JUNTO DA SESSAO, ao lado de `perfis` e `modulos`, e pelos mesmos dois
 * motivos: o client precisa dela para montar tela (o remetente da etiqueta de
 * envio, o orgao produtor que o formulario de versao sugere, o nome de arquivo
 * do Anuario quando o cabecalho nao vem), e uma chamada extra no boot seria uma
 * volta a mais para um dado que muda uma vez por instalacao. Ate 2026-08-09 o
 * "1º CGEO" estava escrito em QUATRO lugares do client, e outro Centro veria o
 * nosso nome depois de configurar o proprio.
 *
 * SO `nome` E `sigla`, e a falta do `ug_code` e deliberada: ele e do modulo
 * orcamento e nao se desenha com ele. Quem precisa dos tres campos, do `ug_nome`
 * e do rastro e a TELA de edicao (`#/instituicao`), que continua lendo
 * `GET /api/instituicao`.
 *
 * `oneOrNone`, e nao `one`: a linha e semeada pelo `er/dgeo.sql` e pela
 * migracao, mas um banco sem ela nao pode impedir alguem de ENTRAR -- a pessoa
 * ficaria trancada do lado de fora por causa de um rotulo. Quem cobra a
 * ausencia e o `GET /api/instituicao`, com a mensagem que diz qual migracao
 * aplicar. Aqui a resposta e `null`, e o client cai no que ele mostra sem nome.
 *
 * O `id = 1` nao e numero magico: e o `DEFAULT 1` com `CHECK (id = 1)` do DDL,
 * que e o que faz a tabela ter uma linha so.
 */
const lerInstituicao = async t =>
  t.oneOrNone('SELECT nome, sigla FROM dgeo.instituicao WHERE id = 1')

/**
 * Autentica contra o próprio banco: o hash bcrypt mora em `dgeo.usuario.senha`.
 *
 * @param {string} login
 * @param {string} senha
 * @param {string} cliente - 'sap_web', 'sap_fp', 'sap_fg', 'sca_web' ou
 *   'sca_qgis' (o Joi já restringiu; os dois últimos são os nomes que os
 *   clientes anteriores à renomeação de 2026-08-09 ainda enviam)
 * @param {Array<{nome: string, versao: string}>} [plugins] - os plugins
 *   HABILITADOS no QGIS de quem entra. Só os dois clientes de QGIS o mandam.
 * @param {string} [qgis] - a versão do QGIS de quem entra
 */
controller.login = async (login, senha, cliente, plugins, qgis) => {
  return db.conn.tx(async t => {
    const usuarioDb = await t.oneOrNone(
      `SELECT id, uuid, administrador, senha
       FROM dgeo.usuario WHERE login = $<login> AND ativo IS TRUE`,
      { login }
    )
    if (!usuarioDb) {
      throw new AppError(
        'Usuário não autorizado para utilizar o Sistema de Apoio à Produção',
        httpCode.BadRequest
      )
    }

    // Senha nula e o estado de quem foi importado do Auth Server e ainda nao
    // teve o hash copiado por `scripts/copiar_usuarios_auth.js`. Responder
    // "usuário ou senha inválida" mandaria a pessoa tentar para sempre a senha
    // certa; a causa e administrativa, e a frase diz a quem recorrer.
    if (!usuarioDb.senha) {
      throw new AppError(
        'Usuário sem senha cadastrada no sistema. Procure um administrador.',
        httpCode.BadRequest
      )
    }

    const senhaConfere = await senhaUtils.conferir(senha, usuarioDb.senha)
    if (!senhaConfere) {
      throw new AppError('Usuário ou senha inválida', httpCode.BadRequest)
    }

    // O GATE DE VERSÃO VEM DEPOIS DA SENHA, e a ordem é a do SAP. Conferi-lo
    // antes contaria ao mundo qual é o QGIS mínimo da Divisão e quais plugins
    // ela exige, sem que ninguém precisasse de conta.
    if (cliente === 'sap_fp') {
      await verificaQGIS(t, qgis)
      await verificaPlugins(t, plugins)
    }

    const { id, uuid, administrador } = usuarioDb

    // O token NAO carrega os perfis de proposito: quem decide o que a pessoa
    // pode e o verifyPerfil, lendo o banco a cada requisicao, senao rebaixar
    // perfil so valeria quando o token expirasse.
    const perfis = await lerPerfis(t, id)
    const modulos = await lerModulos(t)
    const instituicao = await lerInstituicao(t)

    // O `cliente` alimenta a coluna `origem` da rastreabilidade, que separa a
    // carga em lote do plugin do trabalho feito na tela. Ele pode viajar no
    // token, ao contrário dos PERFIS, porque é imutável enquanto o token vive;
    // o perfil muda, e por isso o `verifyPerfil` o relê do banco a cada
    // requisição.
    //
    // `aud` ENTROU EM 2026-08-09, e diz PARA QUE este token serve: a sessão
    // inteira, e não a tile. Quem confere é `validate_token.js`, e o cabeçalho
    // de lá explica por que o token ANTERIOR a esta data, que não tem o claim,
    // continua valendo nas guardas normais.
    const token = await signJWT(
      { id, uuid, administrador, cliente, aud: AUDIENCIA.SESSAO },
      JWT_SECRET
    )

    // Historico de acesso, que alimenta a tela #/acessos. Fica DEPOIS da
    // assinatura do token e dentro da mesma transacao: gravar antes contaria
    // como acesso um login que terminasse em erro.
    await t.none(
      'INSERT INTO dgeo.login (usuario_id, cliente) VALUES ($<id>, $<cliente>)',
      { id, cliente }
    )

    return { token, administrador, uuid, perfis, modulos, instituicao }
  })
}

/**
 * Perfil ATUAL de quem já está logado, sem trocar o token. O client reconfere a
 * foto no boot e sempre que leva um 403, e aí o que a tela oferece volta a bater
 * com o que o servidor aceita.
 *
 * Lê o BANCO, e nunca o próprio token: o `administrador` que viaja no token é do
 * momento do login e envelhece igual ao perfil. Usuário apagado ou inativo cai
 * em 401 de propósito, porque aí a sessão acabou mesmo e o client desloga.
 */
controller.sessao = async uuid => {
  return db.conn.task(async t => {
    const usuarioDb = await t.oneOrNone(
      'SELECT id, uuid, administrador FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE',
      { uuid }
    )
    if (!usuarioDb) {
      throw new AppError(
        'Usuário não encontrado ou inativo',
        httpCode.Unauthorized
      )
    }

    const perfis = await lerPerfis(t, usuarioDb.id)
    const modulos = await lerModulos(t)
    const instituicao = await lerInstituicao(t)

    return {
      administrador: usuarioDb.administrador,
      uuid: usuarioDb.uuid,
      perfis,
      modulos,
      instituicao
    }
  })
}

/**
 * O TOKEN DA TILE: uma credencial de audiência `tile`, de vida curta, que abre
 * `verifyLoginTile` e mais nada.
 *
 * POR QUE ELE EXISTE. Até 2026-08-09 a URL da camada MVT levava o token de
 * SESSÃO na query (`?token=`), e essa URL era gravada inteira em
 * `logs/combined.log` pelo middleware de log, que a rota aberta `/logs` publica.
 * Uma credencial de oito horas, aceita por todas as guardas, ficava legível a
 * quem abrisse a página do log. O `/logs` continua aberto por decisão; o que
 * saiu de circulação foi a credencial.
 *
 * NÃO LÊ O BANCO, e não é esquecimento: quem chama é a rota `POST /login/tile`,
 * sob `verifyLogin`, e ele acabou de conferir no banco que a conta existe e está
 * ATIVA. Uma segunda consulta aqui responderia à mesma pergunta na mesma
 * requisição. Quem confere de novo, a cada tile, é o próprio `verifyLoginTile`,
 * que também lê o banco.
 *
 * ELE NÃO CARREGA PERFIL NENHUM, como o token de sessão: o que a pessoa pode
 * continua saindo do banco a cada requisição.
 *
 * O `cliente` VIAJA JUNTO para a rastreabilidade não perder a origem: sem ele,
 * `montarContexto` marcaria toda tile como 'desconhecido'.
 *
 * @param {{id:number, uuid:string, administrador:boolean, cliente?:string}} usuario
 * @returns {Promise<{token:string, expira_em_segundos:number}>}
 */
controller.tokenDeTile = async ({ id, uuid, administrador, cliente }) => {
  const token = await signJWT(
    { id, uuid, administrador, cliente, aud: AUDIENCIA.TILE },
    JWT_SECRET,
    TILE_EXPIRACAO
  )

  // O prazo vai junto para o client poder renovar ANTES de tomar 401, se um dia
  // quiser: hoje ele renova por reação ao erro da fonte de tiles.
  const { exp, iat } = jwt.decode(token)

  return { token, expira_em_segundos: exp - iat }
}

/**
 * Confere a senha VIGENTE de quem ja esta logado.
 *
 * Existe para a troca de senha (`usuario_ctrl.atualizaSenhaPropria`) poder
 * exigi-la: sem isso, uma sessao esquecida aberta viraria uma conta tomada.
 * Mora aqui, e nao em usuario/, porque conferir senha e o que ESTA feature faz
 * -- assim ha um caminho unico de conferencia no sistema inteiro.
 *
 * O `executor` existe para a troca de senha poder conferir e gravar na MESMA
 * transacao. Com duas conexoes cabia outra requisicao no meio, e a segunda
 * gravaria por cima com a autorizacao da primeira. Ele e opcional e cai em
 * `db.conn` porque quem confere fora de transacao (o login) nao tem `t` nenhum.
 *
 * @param {string} uuid
 * @param {string} senha
 * @param {object} [executor] - a transacao de quem vai gravar em seguida
 */
controller.conferirSenha = async (uuid, senha, executor) => {
  const conexao = executor || db.conn
  const usuarioDb = await conexao.oneOrNone(
    'SELECT senha FROM dgeo.usuario WHERE uuid = $<uuid> AND ativo IS TRUE',
    { uuid }
  )
  if (!usuarioDb) {
    throw new AppError(
      'Usuário não encontrado ou inativo',
      httpCode.Unauthorized
    )
  }

  const confere = await senhaUtils.conferir(senha, usuarioDb.senha)
  if (!confere) {
    throw new AppError('Senha atual inválida', httpCode.BadRequest)
  }
}

// Exposto SÓ para o teste unitário do gate de versão, que precisa exercitar as
// duas funções com a tabela vazia, com a versão ilegível e com o plugin
// desabilitado -- casos que o caminho do login inteiro esconderia atrás da
// senha. Não é ponto de extensão: nada mais no servidor as chama.
controller._gateDeVersao = { verificaQGIS, verificaPlugins, versaoAtende }

module.exports = controller
