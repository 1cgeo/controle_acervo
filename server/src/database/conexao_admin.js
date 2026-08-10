'use strict'

// ---------------------------------------------------------------------------
// A CONEXAO ADMINISTRATIVA A UM BANCO DE PRODUCAO ARBITRARIO
// ---------------------------------------------------------------------------
//
// O QUE ELA E. Quando a unidade de trabalho e editada num PostGIS COM CONTROLE
// DE PERMISSAO (`dominio.tipo_dado_producao` code 2), este servico precisa
// entrar NAQUELE banco como superusuario para criar o papel efemero da pessoa,
// dar-lhe permissao so nas camadas da atividade dela e revogar tudo no fim. Este
// arquivo e a unica porta para esse banco.
//
// POR QUE ELA MORA AQUI, E NAO EM `db.js`. `db.js` responde por DUAS conexoes
// nomeadas e fixas -- o banco do SCA e o da telemetria -- e as duas nascem do
// `config.env` no boot. Esta e de outra natureza: o alvo NAO esta em
// configuracao nenhuma, ele vem do DADO
// (`producao.dado_producao.configuracao_producao`), e ha um por banco de edicao.
// Sao N conexoes descobertas em tempo de execucao contra 2 declaradas, e
// misturar as duas coisas no mesmo arquivo faria a leitura de `db.js` ter de
// adivinhar quais das conexoes existem no boot.
//
// ELA NAO ESTA NO BARRIL (`database/index.js`), e quem precisa dela a importa
// pelo caminho. Ver o relatorio da entrega: ligar no barril e uma linha, e cabe
// a quem for mexer naquele arquivo.
//
// ---------------------------------------------------------------------------
// AS CHAVES DE AMBIENTE, e por que elas sao lidas de `process.env`
// ---------------------------------------------------------------------------
//
//   PRODUCAO_DB_ADMIN_USER      o papel de SUPERUSUARIO nos bancos de producao
//   PRODUCAO_DB_ADMIN_PASSWORD  a senha dele
//   PRODUCAO_DB_HOSTS           os servidores que esta instalacao pode discar
//
// AS TRES VALEM JUNTAS OU NENHUMA, e sem elas este subsistema fica DESLIGADO --
// nao quebrado. `configurado()` e `hostsPermitidos()` sao quem responde, e o
// resto do sistema continua inteiro: o pacote da atividade sai com a secao de
// acesso dizendo que o acesso nao esta configurado nesta instalacao, e as tres
// rotas de gerencia respondem 503 em vez de 500. E o mesmo desenho do banco da
// telemetria em `db.js`.
//
// ELAS PASSAM POR `config.js` DESDE 2026-08-09, e o `Joi.and` de la cobra as
// TRES no BOOT, exatamente como ja fazia com as cinco `MICRO_DB_*`. Ate essa
// data elas eram lidas so aqui, para nao colidir com outra entrega no catalogo
// de `.env.example` e no `create_config.js`; a entrega passou, e o preco de
// deixa-las fora era alto: meia configuracao (credencial sem lista, ou lista sem
// credencial) so aparecia na primeira requisicao, longe de quem digitou, e uma
// instalacao nova pelo caminho documentado subia com o subsistema desligado em
// silencio.
//
// SAO LIDAS A CADA CHAMADA, e nao uma vez no `require`. `config.js` as VALIDA no
// boot; quem as LE e este arquivo, direto de `process.env`. Ler no topo do
// modulo congelaria o valor no instante em que o primeiro `require` acontece, e
// sob teste isso quer dizer que trocar a chave depois nao teria efeito nenhum.
//
// ---------------------------------------------------------------------------
// A LISTA DE SERVIDORES PERMITIDOS, e por que ela e cobrada AQUI
// ---------------------------------------------------------------------------
//
// O ALVO VEM DO DADO, e o dado e digitado por um GERENTE do modulo producao:
// `producao.dado_producao.configuracao_producao` e gravavel por
// POST/PUT /api/producao/dado_producao. Sem lista, quem escreve aquele campo
// escolhe para QUAL servidor este servico disca -- e ele disca com o par de
// SUPERUSUARIO acima. Um PostgreSQL falso do outro lado pede
// `AuthenticationCleartextPassword` e recebe a senha do superusuario em claro,
// valida em TODOS os bancos de edicao; e o mesmo campo serve de varredura da
// rede interna, um endereco e uma porta por vez. Era escalada de gerente de
// modulo a superusuario dos bancos de producao, e e o que esta lista fecha.
//
// A COBRANCA E NO PONTO DE DISCAGEM (`para()`), E NAO SO NO Joi DA ROTA. Schema
// de rota alcanca a PROXIMA escrita; o cadastro ja gravado continua no banco e
// seria discado do mesmo jeito. Enquanto a conferencia estiver dentro de
// `para()`, nao ha caminho para o pool que a pule -- e `noBanco()`, que e por
// onde todo o subsistema passa, chama `para()`.
//
// A LISTA E DE SERVIDOR, e a porta e OPCIONAL em cada item:
//   PRODUCAO_DB_HOSTS=servidor_de_edicao,outro_servidor:5433
// Item sem porta permite qualquer porta daquele servidor; item com porta permite
// so aquela. Sem curinga e sem faixa: os bancos de edicao de uma instalacao sao
// poucos e conhecidos, e curinga devolveria o defeito pela porta dos fundos.
//
// CHAVE AUSENTE OU VAZIA RECUSA TUDO, e a decisao segue o precedente de
// `SEM_CHAVES`: chave que falta DESLIGA o subsistema (503 com a frase que manda
// configurar), e nunca o afrouxa. O contrario -- ausente querendo dizer "pode
// qualquer servidor" -- deixaria de pe, em toda instalacao ja existente, o
// defeito que esta entrega fecha.
//
// O IMPACTO DISSO E MEDIDO, e nao e o de uma chave nova qualquer:
//   - instalacao SEM as duas chaves de credencial, que e o estado de quem nunca
//     ligou este subsistema, nao muda em nada: ela ja respondia 503 por
//     `SEM_CHAVES`, e continua respondendo;
//   - instalacao COM as duas precisa acrescentar a terceira, e ela NAO descobre
//     isso em producao: `config.js` recusa o BOOT quando ha credencial sem lista
//     (`Joi.and`), dizendo qual chave falta. E a mesma cobranca das `MICRO_DB_*`.
//
// ---------------------------------------------------------------------------
// O QUE NUNCA SAI DAQUI
// ---------------------------------------------------------------------------
//
// NEM O ENDERECO, NEM A CREDENCIAL, NEM O ERRO CRU DO DRIVER. Este repositorio e
// publico, e o endereco do banco de edicao e topologia da rede. O erro do
// PostgreSQL diz o host na propria mensagem (`getaddrinfo ENOTFOUND ...`), e
// `errorHandler` entrega o `errorTrace` de um `AppError` para
// `res.sendJsonAndLog`, que o GRAVA NO LOG e -- fora do 500 -- o devolve no
// corpo. Por isso `noBanco()` traduz a indisponibilidade numa frase propria e
// NAO repassa o erro de origem, que e o unico lugar do sistema em que se
// descarta a causa de proposito.
//
// SAO DUAS CAMADAS, e a segunda nasceu de uma fresta da primeira. A lista
// `INDISPONIVEL` era FECHADA, e o que nao estivesse nela subia CRU: `EAI_AGAIN`
// (o resolvedor de nomes que nao respondeu, comum em rede interna) e o erro de
// POOL SEM `code` ("Connection terminated unexpectedly") escapavam por ali.
// Mascarado no corpo do 500, o endereco ia para o LOG do mesmo jeito, pelo
// `res.sendJsonAndLog`. Hoje:
//
//   1. `pareceIndisponibilidade()` reconhece por FAMILIA (todo `EAI_*`, `ECONN*`,
//      `ENET*`, `EHOST*`, `ETIME*`...) e, quando nao ha `code`, pela frase do
//      driver. Nenhum SQLSTATE do PostgreSQL comeca por essas letras, entao erro
//      nosso continua subindo.
//   2. O que ainda assim sobe passa por `semEndereco()`, que apaga servidor,
//      porta e banco da `message` e do `stack` antes de deixar o erro seguir. E
//      a rede de baixo: erro de forma imprevista nao carrega o endereco consigo,
//      e "erro que nao e de conexao sobe inteiro" continua valendo, porque o que
//      se apaga e so o endereco.

const { AppError, httpCode } = require('../utils')

// `db.pgp` E A MESMA INSTANCIA DA BIBLIOTECA, e nao uma segunda. Duas
// inicializacoes de pg-promise no mesmo processo tem dois registros de tipo
// (`setTypeParser`) e dois conjuntos de eventos, e o parser de DATE que `db.js`
// instala e justamente o que impede a data de voltar um dia. Nada aqui e
// escrito em `db`; so se le a fabrica.
const db = require('./db')

const conexaoAdmin = {}

// Os codigos que significam "o outro banco nao esta la", e nao "a consulta
// estava errada". Copia deliberada da lista de `microcontrole_ctrl.js`: e a
// mesma pergunta feita sobre outro banco, e uni-las obrigaria um dos dois
// modulos a importar do outro por causa de uma constante.
const INDISPONIVEL = new Set([
  'ECONNREFUSED', // ninguem escutando na porta
  'ENOTFOUND', // o nome do host nao resolve
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P03', // cannot_connect_now: o servidor esta subindo
  '3D000', // invalid_catalog_name: o banco nao existe
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '53300' // too_many_connections
])

conexaoAdmin.INDISPONIVEL = INDISPONIVEL

// AS FAMILIAS DE ERRO DE SOCKET E DE NOME do Node, para a lista acima deixar de
// ser fechada. `EAI_AGAIN` (resolvedor sem resposta) faltava, e faltaria de novo
// no proximo codigo que ninguem lembrou: e mais seguro perguntar pela familia.
//
// NENHUM SQLSTATE DO PostgreSQL COMECA POR ESSAS LETRAS -- as classes sao 00,
// 08, 22, 23, 28, 42, 53, 57, 3D, XX e companhia --, entao um defeito nosso
// (sintaxe de DDL, por exemplo) continua subindo inteiro, que e a regra do
// cabecalho.
const FAMILIA_DE_REDE = /^(EAI_|ECONN|ENET|EHOST|ETIME|EPIPE|EADDR|EPROTO|ERR_SOCKET)/

// O ERRO DE POOL SEM `code`. `pg` e `pg-promise` derrubam a espera do pool com
// um Error simples, sem codigo nenhum: sem esta frase ele subia cru, e o
// `res.sendJsonAndLog` gravava no log a mensagem do driver, que traz o host.
const FRASE_DE_REDE =
  /getaddrinfo|connect\s+E[A-Z]|connection terminated|connection error|connection ended|timeout exceeded when trying to connect|server closed the connection|terminating connection|socket hang up/i

/**
 * O erro veio de "o outro banco nao esta la", e nao de "a consulta estava
 * errada"?
 */
const pareceIndisponibilidade = err => {
  if (!err) return false
  const code = err.code === undefined || err.code === null ? '' : String(err.code)
  if (INDISPONIVEL.has(code)) return true
  if (code && FAMILIA_DE_REDE.test(code)) return true
  return FRASE_DE_REDE.test(String(err.message || ''))
}

conexaoAdmin.pareceIndisponibilidade = pareceIndisponibilidade

const OMITIDO = '[endereço omitido]'

const escaparRegex = texto => String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Apaga do texto o servidor, a porta e o banco do alvo.
 *
 * A REDE DE BAIXO, e nao a primeira linha de defesa: o que deveria virar 503 ja
 * virou antes de chegar aqui. Isto existe para o erro de FORMA IMPREVISTA, que
 * sobe inteiro por decisao e nao pode levar o endereco junto.
 *
 * PECA COM MENOS DE TRES CARACTERES NAO ENTRA: um banco chamado `x` apagaria
 * todo `x` da mensagem, e o remedio ficaria pior do que a doenca.
 */
const semEndereco = (texto, alvo) => {
  if (typeof texto !== 'string' || !texto || !alvo) return texto
  let saida = texto
  // `servidor:porta` primeiro: trocado o servidor sozinho, a porta ficaria orfa
  // colada no marcador.
  for (const parte of [`${alvo.servidor}:${alvo.porta}`, alvo.servidor, alvo.banco]) {
    if (!parte || String(parte).length < 3) continue
    saida = saida.replace(new RegExp(escaparRegex(parte), 'gi'), OMITIDO)
  }
  return saida
}

conexaoAdmin.semEndereco = semEndereco

/**
 * O mesmo erro, com `message` e `stack` sem o endereco.
 *
 * MUTILA O ERRO ORIGINAL EM VEZ DE EMBRULHA-LO NUM NOVO: quem chama espera o
 * tipo e a pilha de origem para depurar defeito nosso, e um embrulho perderia os
 * dois. `stack` entra porque `serialize-error` o grava no `errorTrace`, e ele
 * comeca justamente pela mensagem.
 *
 * AS PROPRIEDADES PROPRIAS TAMBEM, e nao por excesso de zelo: `serialize-error`
 * copia TODA chave propria para o `errorTrace`, e erro de socket do Node carrega
 * `address` e `hostname` ao lado da mensagem. `code` e numero passam intactos,
 * porque so texto e trocado.
 */
const semEnderecoNoErro = (err, alvo) => {
  if (!err || typeof err !== 'object') return err
  try {
    if (typeof err.message === 'string') err.message = semEndereco(err.message, alvo)
    if (typeof err.stack === 'string') err.stack = semEndereco(err.stack, alvo)
    for (const chave of Object.keys(err)) {
      if (typeof err[chave] === 'string') err[chave] = semEndereco(err[chave], alvo)
    }
  } catch (naoGravavel) {
    // Propriedade so de leitura: nada a fazer aqui, e engolir e melhor do que
    // trocar o erro de origem por um TypeError deste arquivo.
  }
  return err
}

const SEM_CHAVES =
  'O acesso administrativo aos bancos de produção não está configurado nesta ' +
  'instalação. As chaves PRODUCAO_DB_ADMIN_USER e PRODUCAO_DB_ADMIN_PASSWORD do ' +
  'arquivo de configuração do servidor estão vazias, e sem elas o sistema não ' +
  'cria nem revoga usuário de banco. O restante da produção continua funcionando.'

const FORA_DO_AR =
  'O banco de produção desta atividade não respondeu. Ele é um banco separado ' +
  'deste, e o restante do sistema não é afetado. Procure quem cuida do servidor ' +
  'dele.'

const CONFIGURACAO_INVALIDA =
  'O dado de produção desta atividade não tem endereço de banco no formato ' +
  'esperado. Corrija o cadastro do dado de produção.'

const SEM_HOSTS =
  'O acesso administrativo aos bancos de produção não está configurado nesta ' +
  'instalação. A chave PRODUCAO_DB_HOSTS do arquivo de configuração do servidor ' +
  'está vazia, e sem ela o sistema não disca para servidor nenhum. Quem administra ' +
  'o servidor lista ali os bancos de edição que esta instalação pode alcançar. O ' +
  'restante da produção continua funcionando.'

// A FRASE NAO DIZ QUAL ERA O SERVIDOR, e a omissao e a mesma de `FORA_DO_AR`:
// ela viaja para o log e para o corpo da resposta.
const HOST_NAO_PERMITIDO =
  'O servidor de banco de dados cadastrado neste dado de produção não está entre ' +
  'os que esta instalação pode alcançar (chave PRODUCAO_DB_HOSTS do arquivo de ' +
  'configuração do servidor). Corrija o cadastro do dado de produção ou peça a ' +
  'quem administra o servidor para incluir o endereço na lista.'

conexaoAdmin.SEM_CHAVES = SEM_CHAVES
conexaoAdmin.FORA_DO_AR = FORA_DO_AR
conexaoAdmin.CONFIGURACAO_INVALIDA = CONFIGURACAO_INVALIDA
conexaoAdmin.SEM_HOSTS = SEM_HOSTS
conexaoAdmin.HOST_NAO_PERMITIDO = HOST_NAO_PERMITIDO

const credencial = () => ({
  user: process.env.PRODUCAO_DB_ADMIN_USER,
  password: process.env.PRODUCAO_DB_ADMIN_PASSWORD
})

/**
 * As duas chaves estao preenchidas?
 *
 * VAZIO CONTA COMO AUSENTE, e nao como usuario de nome vazio: quem escreve o
 * arquivo de configuracao a mao deixa a chave presente e em branco, e um `''`
 * aqui produziria uma tentativa de conexao que so falha no outro servidor.
 */
conexaoAdmin.configurado = () => {
  const { user, password } = credencial()
  return Boolean(user && String(user).trim() && password && String(password).trim())
}

/**
 * A lista de `PRODUCAO_DB_HOSTS`, ja separada, aparada e em minusculas.
 *
 * VAZIA QUANDO A CHAVE FALTA, e o chamador trata isso como "este subsistema esta
 * desligado", nunca como "pode qualquer servidor". Ver o cabecalho.
 *
 * Cada item e `servidor` ou `servidor:porta`.
 *
 * @returns {Array<{servidor: string, porta: string|null}>}
 */
conexaoAdmin.hostsPermitidos = () =>
  String(process.env.PRODUCAO_DB_HOSTS || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .map(item => {
      const achado = /^(.+):(\d+)$/.exec(item)
      return achado
        ? { servidor: achado[1], porta: achado[2] }
        : { servidor: item, porta: null }
    })

/**
 * O alvo esta na lista?
 *
 * ITEM SEM PORTA PERMITE QUALQUER PORTA daquele servidor, e item com porta
 * permite so aquela. A comparacao e por IGUALDADE de string, sem curinga: um
 * `startsWith` deixaria `servidor_de_edicao.atacante` passar por
 * `servidor_de_edicao`.
 */
conexaoAdmin.permitido = alvo => {
  if (!alvo || !alvo.servidor) return false
  const servidor = String(alvo.servidor).trim().toLowerCase()
  const porta = String(alvo.porta === undefined || alvo.porta === null ? '' : alvo.porta).trim()

  return conexaoAdmin
    .hostsPermitidos()
    .some(item => item.servidor === servidor && (item.porta === null || item.porta === porta))
}

// O cache de POOLS, por alvo. Sem ele, cada atividade iniciada abriria um pool
// novo para o mesmo banco e o abandonaria: o plugin manda rajada, e o efeito
// seria dezenas de conexoes ociosas no banco de edicao. A chave inclui o
// usuario porque a credencial pode mudar entre dois `require` sob teste.
const pools = new Map()

/**
 * Separa `servidor:porta/banco` em tres.
 *
 * O FORMATO E O DO SAP 2.3.5, e a coluna guarda exatamente isso. Ele NAO esta
 * escrito em lugar nenhum deste repositorio como valor -- so como forma.
 *
 * DEVOLVE `null` EM VEZ DE ESTOURAR quando a coluna vem vazia ou malformada, e
 * o chamador decide o que fazer. E a mesma analise defensiva de
 * `metadado_ctrl.js`, e pelo mesmo motivo: cadastro incompleto e erro de quem
 * cadastrou, e virar 500 esconderia isso.
 *
 * @param {string} [texto] - o valor de `producao.dado_producao.configuracao_producao`
 * @returns {{servidor: string, porta: string, banco: string}|null}
 */
conexaoAdmin.separar = texto => {
  if (!texto) return null
  const achado = /^([^:/\s]+):(\d+)\/(\S+)$/.exec(String(texto).trim())
  if (!achado) return null
  return { servidor: achado[1], porta: achado[2], banco: achado[3] }
}

/**
 * A chave de `producao.login_temporario.configuracao`: o SERVIDOR e a PORTA, sem
 * o banco.
 *
 * O PAPEL DO PostgreSQL E DO CLUSTER, e nao do banco: `CREATE USER` vale para
 * todos os bancos daquele servidor. Guardar a linha por banco criaria duas
 * senhas para o MESMO papel assim que um lote tivesse dois bancos de edicao no
 * mesmo servidor, e a segunda sobrescreveria a primeira sem ninguem ver.
 */
conexaoAdmin.chaveDoCluster = ({ servidor, porta }) => `${servidor}:${porta}`

/**
 * O objeto de conexao administrativa ao alvo, montado SEM TOCAR A REDE.
 *
 * PREGUICOSO como `db.microConn`: o pg-promise so disca no primeiro `query`.
 * Montar aqui nao prova que o banco existe, e e o que faz o servico subir com
 * todos os bancos de producao fora do ar.
 *
 * E O PONTO DE DISCAGEM, e por isso a lista de servidores permitidos e cobrada
 * AQUI. Toda porta para o banco de edicao passa por esta funcao, inclusive com
 * cadastro gravado antes de a lista existir -- que e o caso que um schema de
 * rota nao alcanca. Ver o cabecalho.
 *
 * @param {{servidor: string, porta: string, banco: string}} alvo
 */
conexaoAdmin.para = alvo => {
  if (!conexaoAdmin.configurado()) {
    throw new AppError(SEM_CHAVES, httpCode.ServiceUnavailable)
  }

  // Lista vazia RECUSA TUDO, como a credencial que falta. Ausencia desliga o
  // subsistema, e nunca o afrouxa.
  if (conexaoAdmin.hostsPermitidos().length === 0) {
    throw new AppError(SEM_HOSTS, httpCode.ServiceUnavailable)
  }

  if (!conexaoAdmin.permitido(alvo)) {
    throw new AppError(HOST_NAO_PERMITIDO, httpCode.ServiceUnavailable)
  }

  const { user, password } = credencial()
  const chave = `${user}@${alvo.servidor}:${alvo.porta}/${alvo.banco}`

  if (!pools.has(chave)) {
    pools.set(
      chave,
      db.pgp({
        host: alvo.servidor,
        port: Number(alvo.porta),
        database: alvo.banco,
        user,
        password,
        // Teto baixo de proposito: este pool serve DDL esporadico (criar papel,
        // conceder, revogar), e nao carga de leitura. O default de 10 por banco
        // de edicao multiplicaria por quantos bancos a instalacao tiver.
        max: 2
      })
    )
  }

  return pools.get(chave)
}

/**
 * Roda algo na conexao administrativa do alvo, traduzindo a indisponibilidade.
 *
 * CINCO SAIDAS, e as cinco sao 503 e nunca 500:
 *   - chaves vazias           -> a instalacao nunca ligou este subsistema
 *   - lista de hosts vazia    -> idem, e recusar tudo e o lado seguro
 *   - servidor fora da lista  -> o cadastro aponta um servidor nao autorizado
 *   - configuracao malformada -> o cadastro do dado de producao esta incompleto
 *   - banco fora do ar        -> o outro servidor nao respondeu
 *
 * O ERRO DE ORIGEM NAO VIAJA JUNTO. `new AppError(msg, status, err)` guarda o
 * erro serializado em `errorTrace`, e `errorHandler` o passa a
 * `res.sendJsonAndLog`, que o grava no log e o devolve no corpo em toda resposta
 * que nao seja 500. A mensagem do driver traz o HOST. Aqui ela morre.
 *
 * ERRO QUE NAO E DE CONEXAO SOBE INTEIRO: sintaxe de DDL errada e defeito nosso,
 * e virar 503 mandaria procurar o servidor do outro lado por um bug daqui. Ele
 * sobe SEM O ENDERECO, e so isso: o tipo, a pilha e o resto da mensagem
 * continuam la (`semEnderecoNoErro`).
 *
 * @param {string} configuracaoProducao - 'servidor:porta/banco', vindo do DADO
 * @param {Function} tarefa - recebe (conexao, alvo)
 */
conexaoAdmin.noBanco = async (configuracaoProducao, tarefa) => {
  const alvo = conexaoAdmin.separar(configuracaoProducao)
  if (!alvo) {
    throw new AppError(CONFIGURACAO_INVALIDA, httpCode.ServiceUnavailable)
  }

  const conn = conexaoAdmin.para(alvo)

  try {
    return await tarefa(conn, alvo)
  } catch (err) {
    if (err instanceof AppError) throw err
    if (pareceIndisponibilidade(err)) {
      throw new AppError(FORA_DO_AR, httpCode.ServiceUnavailable)
    }
    throw semEnderecoNoErro(err, alvo)
  }
}

/**
 * Fecha os pools abertos. So para o encerramento ordenado e para teste; nada no
 * caminho de requisicao chama isto.
 */
conexaoAdmin.encerrar = async () => {
  for (const pool of pools.values()) {
    await pool.$pool.end()
  }
  pools.clear()
}

module.exports = conexaoAdmin
