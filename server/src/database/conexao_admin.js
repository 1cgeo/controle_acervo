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
//
// AS DUAS VALEM JUNTAS OU NENHUMA, e sem elas este subsistema fica DESLIGADO --
// nao quebrado. `configurado()` e quem responde, e o resto do sistema continua
// inteiro: o pacote da atividade sai com a secao de acesso dizendo que o acesso
// nao esta configurado nesta instalacao, e as tres rotas de gerencia respondem
// 503 em vez de 500. E o mesmo desenho do banco da telemetria em `db.js`.
//
// ELAS NAO PASSAM POR `config.js` de proposito. O catalogo de `.env.example` e o
// `create_config.js` sao de outro dono nesta leva, e cadastra-las la sem
// combinar produziria colisao de merge no arquivo que TODA instalacao le. Lidas
// aqui, elas nao existem para o resto do codigo, e quem for cadastra-las depois
// so precisa acrescentar duas linhas ao catalogo: nada neste arquivo muda.
//
// SAO LIDAS A CADA CHAMADA, e nao uma vez no `require`. Ler no topo do modulo
// congelaria o valor no instante em que o primeiro `require` acontece, e sob
// teste isso quer dizer que trocar a chave depois nao teria efeito nenhum.
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

conexaoAdmin.SEM_CHAVES = SEM_CHAVES
conexaoAdmin.FORA_DO_AR = FORA_DO_AR
conexaoAdmin.CONFIGURACAO_INVALIDA = CONFIGURACAO_INVALIDA

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
 * @param {{servidor: string, porta: string, banco: string}} alvo
 */
conexaoAdmin.para = alvo => {
  if (!conexaoAdmin.configurado()) {
    throw new AppError(SEM_CHAVES, httpCode.ServiceUnavailable)
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
 * TRES SAIDAS, e as tres sao 503 e nunca 500:
 *   - chaves vazias           -> a instalacao nunca ligou este subsistema
 *   - configuracao malformada -> o cadastro do dado de producao esta incompleto
 *   - banco fora do ar        -> o outro servidor nao respondeu
 *
 * O ERRO DE ORIGEM NAO VIAJA JUNTO. `new AppError(msg, status, err)` guarda o
 * erro serializado em `errorTrace`, e `errorHandler` o passa a
 * `res.sendJsonAndLog`, que o grava no log e o devolve no corpo em toda resposta
 * que nao seja 500. A mensagem do driver traz o HOST. Aqui ela morre.
 *
 * ERRO QUE NAO E DE CONEXAO SOBE INTEIRO: sintaxe de DDL errada e defeito nosso,
 * e virar 503 mandaria procurar o servidor do outro lado por um bug daqui.
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
    if (err && INDISPONIVEL.has(err.code)) {
      throw new AppError(FORA_DO_AR, httpCode.ServiceUnavailable)
    }
    throw err
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
