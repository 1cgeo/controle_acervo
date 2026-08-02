// Path: scripts/copiar_usuarios_auth.js

/**
 * Copia os hashes de senha do banco do Auth Server para o banco do SCA.
 *
 * POR QUE ELE EXISTE. Em 2026-08-02 a autenticacao veio do Auth Server externo
 * (https://github.com/1cgeo/auth_server) para dentro do SCA. Ate ali
 * `dgeo.usuario` era um ESPELHO, sem senha; a migracao
 * `migrations/2026-08-02_autenticacao_local.sql` criou a coluna `senha`
 * ANULAVEL justamente porque quem a preenche e este script, rodando UMA vez,
 * FORA do sistema. Enquanto ela e nula a pessoa nao entra, e o login diz isso
 * com todas as letras em vez de responder "senha invalida"
 * (`login/login_ctrl.js`).
 *
 * O HASH BCRYPT E PORTATIL. Ele carrega o custo dentro de si e o SCA usa o
 * mesmo custo do Auth Server (10, em `server/src/login/senha.js`). O hash
 * copiado vale como esta: nao ha rehash, e ninguem precisa trocar de senha.
 *
 * ENSAIO POR PADRAO. Sem `--aplicar` este script NAO escreve nada: ele le os
 * dois bancos, monta o plano e imprime o que faria. E o ensaio que permite
 * conferir o resultado contra uma copia de producao antes de tocar no banco
 * real. Com `--aplicar`, tudo acontece numa transacao unica: ou entra inteiro
 * ou nao entra nada.
 *
 * O QUE ELE NUNCA COPIA: `administrador` e `ativo`. O modelo de autorizacao do
 * SCA e DELE, e nao do Auth Server. Sobrescrever essas duas colunas promoveria
 * ou rebaixaria gente em silencio, no meio de uma migracao que ninguem esta
 * lendo linha a linha. Por isso elas nem entram no SELECT da origem: o que nao
 * se le nao se copia por acidente.
 *
 * QUEM SO EXISTE NA ORIGEM NAO ENTRA POR PADRAO. Com `--incluir-novos` ele
 * entra SEM perfil em modulo nenhum, com `administrador = FALSE` e
 * `ativo = FALSE`. Conceder acesso e ato explicito, na tela de perfis, nunca
 * efeito colateral de migracao. O `ativo = FALSE` e deliberado e nao e copia da
 * origem: a pessoa desligada la entraria aqui com uma senha que funciona, e
 * "consigo logar sem dever" e uma falha que ninguem percebe, enquanto "nao
 * consigo entrar" aparece no mesmo dia e se resolve com um clique.
 *
 * IDEMPOTENTE. Rodar duas vezes nao estraga nada: quem ja esta com o hash igual
 * aparece como "ja em dia" e nao e reescrito, e a criacao usa
 * ON CONFLICT (uuid) DO NOTHING.
 *
 * Uso:
 *   node scripts/copiar_usuarios_auth.js                        # ensaio
 *   node scripts/copiar_usuarios_auth.js --aplicar
 *   node scripts/copiar_usuarios_auth.js --atualizar-dados --incluir-novos
 *   node scripts/copiar_usuarios_auth.js --amostra 30
 *   node scripts/copiar_usuarios_auth.js --ajuda
 *
 * CONEXOES, SO POR VARIAVEL DE AMBIENTE. Credencial NUNCA entra por argumento
 * de linha de comando: ela ficaria no historico do shell e visivel no `ps` para
 * qualquer um logado na maquina. Argumento com cara de credencial e recusado.
 *
 *   destino (SCA)         DB_SERVER, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 *   origem (Auth Server)  AUTH_DB_SERVER, AUTH_DB_PORT, AUTH_DB_NAME,
 *                         AUTH_DB_USER, AUTH_DB_PASSWORD
 *
 * As do destino sao as que o servidor ja usa e saem de `server/config.env`. As
 * da origem existem SO para esta copia: o catalogo comentado esta no
 * `.env.example`, e depois de rodar elas devem sair do `config.env` (ver o
 * `scripts/README.md`).
 *
 * PASSO FINAL, do administrador, depois de conferir o relatorio: resolver quem
 * ficou na lista de SEM SENHA. Nao ha `ALTER ... SET NOT NULL` a rodar -- a
 * coluna e anulavel tanto no `er/dgeo.sql` quanto na migracao, de proposito:
 * "cadastrada e ainda sem senha local" e um estado de verdade do sistema, e
 * travar a coluna aqui faria a atualizacao divergir da instalacao nova, que e o
 * que o `migrations/ensaiar_migracao.cjs` existe para impedir. Quem ficar na
 * lista simplesmente nao entra, com mensagem propria no login, e aparece
 * marcado na tela #/usuarios ate alguem lhe dar uma senha.
 *
 * Extensao .js, e nao .cjs como `gerar_miniaturas.cjs`: o package.json da RAIZ
 * declara "type": "module", entao este arquivo e um MODULO ES. O nome com .js
 * ja esta citado em `er/dgeo.sql`, na migracao e em `login/senha.js`, e um
 * arquivo com nome diferente do que tres arquivos versionados prometem e o tipo
 * de divergencia que ninguem corrige depois. `pg-promise` e `dotenv` continuam
 * vindo do `server/`, por createRequire, como nos outros scripts.
 */

import path from 'path'
import process from 'process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '..')

// `pg-promise` e `dotenv` sao dependencias do SERVIDOR, e nao da raiz. Resolver
// por ele evita duplicar as duas no package.json da raiz so para este script, e
// garante que a copia fale com os bancos pela mesma versao de driver que o
// servico usa.
const requireDoServer = createRequire(path.join(RAIZ, 'server', 'package.json'))

// --- Chaves de configuracao --------------------------------------------------

export const CHAVES_ORIGEM = [
  'AUTH_DB_SERVER',
  'AUTH_DB_PORT',
  'AUTH_DB_NAME',
  'AUTH_DB_USER',
  'AUTH_DB_PASSWORD'
]

export const CHAVES_DESTINO = [
  'DB_SERVER',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD'
]

// --- SQL ---------------------------------------------------------------------

// `administrador` e `ativo` NAO entram aqui de proposito: ver o cabecalho. O
// teste guarda essa ausencia, porque acrescenta-las seria uma linha inocente.
export const SQL_ORIGEM = `
  SELECT uuid, login, senha, nome, nome_guerra, tipo_posto_grad_id
  FROM dgeo.usuario
  ORDER BY login`

export const SQL_DESTINO = `
  SELECT uuid, login, senha, nome, nome_guerra, tipo_posto_grad_id
  FROM dgeo.usuario
  ORDER BY login`

export const SQL_POSTOS = 'SELECT code FROM dominio.tipo_posto_grad ORDER BY code'

export const SQL_ATUALIZAR_SENHA = `
  UPDATE dgeo.usuario SET senha = $<senha> WHERE uuid = $<uuid>`

export const SQL_ATUALIZAR_SENHA_E_DADOS = `
  UPDATE dgeo.usuario
  SET senha = $<senha>,
      nome = $<nome>,
      nome_guerra = $<nomeGuerra>,
      tipo_posto_grad_id = $<tipoPostoGradId>
  WHERE uuid = $<uuid>`

export const SQL_ATUALIZAR_DADOS = `
  UPDATE dgeo.usuario
  SET nome = $<nome>,
      nome_guerra = $<nomeGuerra>,
      tipo_posto_grad_id = $<tipoPostoGradId>
  WHERE uuid = $<uuid>`

// FALSE literal nas duas colunas, e nao parametro: elas nao vem da origem, e um
// `$<administrador>` aqui abriria a porta para alguem liga-lo depois.
export const SQL_CRIAR = `
  INSERT INTO dgeo.usuario
    (uuid, login, senha, nome, nome_guerra, tipo_posto_grad_id, administrador, ativo)
  VALUES
    ($<uuid>, $<login>, $<senha>, $<nome>, $<nomeGuerra>, $<tipoPostoGradId>, FALSE, FALSE)
  ON CONFLICT (uuid) DO NOTHING`

export const SQL_SEM_SENHA =
  'SELECT login FROM dgeo.usuario WHERE senha IS NULL ORDER BY login'

// --- Higiene de saida --------------------------------------------------------

// Hash bcrypt: $2a$/$2b$/$2y$ + custo + 53 caracteres. Toda linha impressa passa
// por aqui. Nao e para o caso normal (nada no relatorio imprime hash de
// proposito), e sim para a mensagem de erro do driver, que pode trazer o
// parametro da consulta que falhou.
const HASH_RE = /\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}/g

export const mascarar = texto => String(texto).replace(HASH_RE, '<hash>')

const imprimir = (linha = '') => process.stdout.write(mascarar(linha) + '\n')

// --- Argumentos --------------------------------------------------------------

const FLAGS_CONHECIDAS = new Set([
  'aplicar',
  'atualizar-dados',
  'incluir-novos',
  'amostra',
  'ajuda'
])

// Qualquer coisa com cara de credencial ou de string de conexao. Recusar e o
// unico jeito de a regra valer: aceitar "so desta vez" poe a senha do banco no
// historico do shell e no `ps` de todo mundo que estiver logado na maquina.
const FLAGS_PROIBIDAS = /senha|password|passwd|pwd|secret|token|credencial|conexao|dsn|url|uri/i

/**
 * @param {string[]} argv - argumentos, ja sem `node` e sem o caminho do script
 * @returns {{aplicar: boolean, atualizarDados: boolean, incluirNovos: boolean,
 *            amostra: number, ajuda: boolean}}
 */
export const parseArgumentos = (argv = []) => {
  const opcoes = {
    aplicar: false,
    atualizarDados: false,
    incluirNovos: false,
    amostra: 10,
    ajuda: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const atual = argv[i]
    if (!atual.startsWith('--')) {
      throw new Error(`Argumento solto nao reconhecido: ${atual}`)
    }

    const [chaveCrua, valorColado] = atual.replace(/^--/, '').split('=')
    const chave = chaveCrua.toLowerCase()

    if (FLAGS_PROIBIDAS.test(chave)) {
      throw new Error(
        `A opcao --${chaveCrua} nao existe, e credencial nunca entra por ` +
        'argumento de linha de comando: ela fica no historico do shell e ' +
        'aparece no `ps`. Use as variaveis de ambiente ' +
        `(${CHAVES_ORIGEM.join(', ')}).`
      )
    }

    if (!FLAGS_CONHECIDAS.has(chave)) {
      throw new Error(`Opcao desconhecida: --${chaveCrua}`)
    }

    if (chave === 'amostra') {
      let valor = valorColado
      if (valor === undefined) {
        valor = argv[i + 1]
        i += 1
      }
      const n = Number.parseInt(valor, 10)
      if (!Number.isInteger(n) || n < 0) {
        throw new Error('--amostra exige um inteiro maior ou igual a zero')
      }
      opcoes.amostra = n
      continue
    }

    if (valorColado !== undefined) {
      throw new Error(`--${chaveCrua} nao recebe valor`)
    }

    if (chave === 'aplicar') opcoes.aplicar = true
    if (chave === 'atualizar-dados') opcoes.atualizarDados = true
    if (chave === 'incluir-novos') opcoes.incluirNovos = true
    if (chave === 'ajuda') opcoes.ajuda = true
  }

  return opcoes
}

// --- Plano de copia ----------------------------------------------------------

const normalizarUuid = valor => String(valor || '').trim().toLowerCase()

const temHash = valor => typeof valor === 'string' && valor.trim().length > 0

/**
 * Monta o plano de copia sem tocar em banco nenhum. Funcao PURA: o ensaio e a
 * aplicacao leem o MESMO plano, entao o que o relatorio promete e exatamente o
 * que a transacao executa.
 *
 * @param {Array} origem  - linhas de SQL_ORIGEM
 * @param {Array} destino - linhas de SQL_DESTINO
 * @param {{atualizarDados?: boolean, incluirNovos?: boolean,
 *          postosValidos?: Set<number>|null}} opcoes
 */
export const montarPlano = (origem = [], destino = [], opcoes = {}) => {
  const atualizarDados = Boolean(opcoes.atualizarDados)
  const incluirNovos = Boolean(opcoes.incluirNovos)
  const postosValidos = opcoes.postosValidos || null

  const plano = {
    atualizar: [],      // ja existe no SCA: recebe hash (e talvez dados)
    criar: [],          // so existe na origem, com --incluir-novos
    inalterados: [],    // ja esta em dia: nada a escrever
    novosIgnorados: [], // so existe na origem, sem --incluir-novos
    origemSemHash: [],  // a origem nao tem hash para dar
    conflitoLogin: [],  // uuid ausente no SCA, mas o login ja esta ocupado
    loginDivergente: [], // mesmo uuid, login diferente nos dois bancos
    soNoDestino: [],    // existe no SCA e nao existe na origem
    erros: [],          // impedem a aplicacao
    semSenhaPrevisto: []
  }

  const origemPorUuid = new Map()
  const duplicados = new Map()
  for (const u of origem) {
    const chave = normalizarUuid(u.uuid)
    if (!chave) {
      plano.erros.push(`Usuario "${u.login}" na origem esta sem uuid.`)
      continue
    }
    if (origemPorUuid.has(chave)) {
      const logins = duplicados.get(chave) || [origemPorUuid.get(chave).login]
      logins.push(u.login)
      duplicados.set(chave, logins)
      continue
    }
    origemPorUuid.set(chave, u)
  }
  for (const [uuid, logins] of duplicados) {
    plano.erros.push(
      `uuid repetido na origem (${uuid}): ${logins.join(', ')}. ` +
      'A correspondencia entre os dois bancos e por uuid, e com repeticao ela ' +
      'fica ambigua. Resolva na origem antes de copiar.'
    )
  }

  const destinoPorUuid = new Map()
  const destinoPorLogin = new Map()
  for (const d of destino) {
    destinoPorUuid.set(normalizarUuid(d.uuid), d)
    destinoPorLogin.set(String(d.login).toLowerCase(), d)
  }

  const postoOk = code =>
    postosValidos === null || postosValidos.has(Number(code))

  const recebemHash = new Set()

  for (const u of origem) {
    const uuid = normalizarUuid(u.uuid)
    if (!uuid) continue
    if (duplicados.has(uuid)) continue

    const temSenhaNaOrigem = temHash(u.senha)
    if (!temSenhaNaOrigem) plano.origemSemHash.push({ login: u.login, uuid })

    const d = destinoPorUuid.get(uuid)

    if (!d) {
      const ocupado = destinoPorLogin.get(String(u.login).toLowerCase())
      if (ocupado) {
        // O mesmo login com uuid diferente nos dois bancos. Criar quebraria a
        // UNIQUE do login e derrubaria a transacao inteira; atualizar por login
        // copiaria a senha de uma pessoa para outra. Nenhuma das duas: isto e
        // trabalho de gente, e o ensaio existe para mostra-lo antes.
        plano.conflitoLogin.push({
          login: u.login,
          uuidOrigem: uuid,
          uuidDestino: normalizarUuid(ocupado.uuid)
        })
        continue
      }
      if (!incluirNovos) {
        plano.novosIgnorados.push({ login: u.login, uuid })
        continue
      }
      if (!postoOk(u.tipo_posto_grad_id)) {
        plano.erros.push(
          `Usuario "${u.login}" tem tipo_posto_grad_id ${u.tipo_posto_grad_id}, ` +
          'que nao existe em dominio.tipo_posto_grad no destino.'
        )
        continue
      }
      plano.criar.push({
        uuid,
        login: u.login,
        senha: temSenhaNaOrigem ? u.senha : null,
        nome: u.nome,
        nomeGuerra: u.nome_guerra,
        tipoPostoGradId: u.tipo_posto_grad_id
      })
      if (temSenhaNaOrigem) recebemHash.add(uuid)
      continue
    }

    if (String(d.login) !== String(u.login)) {
      plano.loginDivergente.push({
        uuid,
        loginOrigem: u.login,
        loginDestino: d.login
      })
    }

    const senhaMuda = temSenhaNaOrigem && d.senha !== u.senha
    const dadosMudam =
      atualizarDados &&
      (String(d.nome) !== String(u.nome) ||
        String(d.nome_guerra) !== String(u.nome_guerra) ||
        Number(d.tipo_posto_grad_id) !== Number(u.tipo_posto_grad_id))

    if (!senhaMuda && !dadosMudam) {
      plano.inalterados.push({ login: d.login, uuid })
      continue
    }

    if (dadosMudam && !postoOk(u.tipo_posto_grad_id)) {
      plano.erros.push(
        `Usuario "${u.login}" tem tipo_posto_grad_id ${u.tipo_posto_grad_id}, ` +
        'que nao existe em dominio.tipo_posto_grad no destino.'
      )
      continue
    }

    plano.atualizar.push({
      uuid,
      login: d.login,
      senha: senhaMuda ? u.senha : null,
      dados: dadosMudam
        ? {
            nome: u.nome,
            nomeGuerra: u.nome_guerra,
            tipoPostoGradId: u.tipo_posto_grad_id
          }
        : null
    })
    if (senhaMuda) recebemHash.add(uuid)
  }

  for (const d of destino) {
    const uuid = normalizarUuid(d.uuid)
    if (!origemPorUuid.has(uuid)) {
      plano.soNoDestino.push({ login: d.login, uuid })
    }
  }

  // A lista que importa: quem fica sem poder entrar. Ela sai do MESMO plano que
  // a transacao executa, e depois de aplicar e conferida contra o banco.
  for (const d of destino) {
    if (temHash(d.senha)) continue
    const uuid = normalizarUuid(d.uuid)
    if (recebemHash.has(uuid)) continue
    const naOrigem = origemPorUuid.get(uuid)
    plano.semSenhaPrevisto.push({
      login: d.login,
      motivo: naOrigem
        ? 'a origem tambem nao tem hash para esta pessoa'
        : 'nao existe na origem'
    })
  }
  for (const c of plano.criar) {
    if (!c.senha) {
      plano.semSenhaPrevisto.push({
        login: c.login,
        motivo: 'criado agora, e a origem nao tem hash'
      })
    }
  }
  plano.semSenhaPrevisto.sort((a, b) => String(a.login).localeCompare(String(b.login)))

  return plano
}

// --- Relatorio ---------------------------------------------------------------

const descreverMudanca = item => {
  if (item.senha && item.dados) return 'hash + nome/nome de guerra/posto'
  if (item.senha) return 'hash'
  return 'nome/nome de guerra/posto'
}

/**
 * Monta o relatorio inteiro como texto. Separado da impressao para o teste
 * poder provar o que ele diz, inclusive que nenhum hash escapa nele.
 *
 * @param {object} plano
 * @param {object} opcoes
 * @param {{aplicado?: boolean, semSenhaReal?: Array<{login: string}>|null,
 *          criados?: number, atualizados?: number}} resultado
 * @returns {string}
 */
export const formatarRelatorio = (plano, opcoes = {}, resultado = {}) => {
  const l = []
  const aplicado = Boolean(resultado.aplicado)

  l.push('=== COPIA DE USUARIOS DO AUTH SERVER PARA O SCA ===')
  l.push(
    aplicado
      ? 'modo: APLICADO (transacao unica, ja comitada)'
      : 'modo: ENSAIO. Nada foi escrito. Use --aplicar para valer.'
  )
  l.push(
    `opcoes: --atualizar-dados=${opcoes.atualizarDados ? 'sim' : 'nao'} ` +
    `--incluir-novos=${opcoes.incluirNovos ? 'sim' : 'nao'}`
  )
  l.push('')

  if (plano.erros.length) {
    l.push(`ERROS QUE IMPEDEM A COPIA (${plano.erros.length}):`)
    for (const e of plano.erros) l.push(`  - ${e}`)
    l.push('')
  }

  // Rotulo com largura fixa: o do ensaio e o do aplicado tem tamanhos
  // diferentes ("a atualizar" e "atualizados"), e sem o preenchimento a coluna
  // de numeros sai serrilhada.
  const linhaResumo = (rotulo, valor, sufixo = '') =>
    l.push(`${(rotulo + ':').padEnd(22)}${valor}${sufixo}`)

  l.push('--- resumo ---')
  linhaResumo(aplicado ? 'atualizados' : 'a atualizar', plano.atualizar.length)
  linhaResumo(aplicado ? 'criados' : 'a criar', plano.criar.length)
  linhaResumo('ja em dia', plano.inalterados.length)
  linhaResumo('ignorados', plano.novosIgnorados.length + plano.conflitoLogin.length)
  linhaResumo(
    '  so na origem',
    plano.novosIgnorados.length,
    plano.novosIgnorados.length && !opcoes.incluirNovos ? '  (use --incluir-novos)' : ''
  )
  linhaResumo('  conflito de login', plano.conflitoLogin.length)
  linhaResumo('so no SCA', plano.soNoDestino.length)
  linhaResumo('origem sem hash', plano.origemSemHash.length)
  l.push('')

  const amostra = Number.isInteger(opcoes.amostra) ? opcoes.amostra : 10

  if (amostra > 0 && plano.atualizar.length) {
    l.push(`--- amostra do que ${aplicado ? 'mudou' : 'mudaria'} (ate ${amostra}) ---`)
    for (const item of plano.atualizar.slice(0, amostra)) {
      l.push(`  ${item.login}: ${descreverMudanca(item)}`)
    }
    if (plano.atualizar.length > amostra) {
      l.push(`  ... e mais ${plano.atualizar.length - amostra}`)
    }
    l.push('')
  }

  if (amostra > 0 && plano.criar.length) {
    l.push(`--- amostra de quem ${aplicado ? 'entrou' : 'entraria'} (ate ${amostra}) ---`)
    l.push('  (sem perfil em modulo nenhum, administrador = FALSE, ativo = FALSE)')
    for (const item of plano.criar.slice(0, amostra)) {
      l.push(`  ${item.login}${item.senha ? '' : '  [SEM HASH NA ORIGEM]'}`)
    }
    if (plano.criar.length > amostra) {
      l.push(`  ... e mais ${plano.criar.length - amostra}`)
    }
    l.push('')
  }

  if (plano.conflitoLogin.length) {
    l.push('--- CONFLITO DE LOGIN (nao tocados) ---')
    l.push('  O login existe nos dois bancos com uuid diferente. Copiar por')
    l.push('  login daria a senha de uma pessoa a outra. Resolva a mao.')
    for (const c of plano.conflitoLogin) {
      l.push(`  ${c.login}: origem ${c.uuidOrigem} / SCA ${c.uuidDestino}`)
    }
    l.push('')
  }

  if (plano.loginDivergente.length) {
    l.push('--- AVISO: mesmo uuid, login diferente ---')
    l.push('  O hash copiado e o do login da ORIGEM. Confira se sao a mesma pessoa.')
    l.push('  O script nao altera login nenhum.')
    for (const a of plano.loginDivergente) {
      l.push(`  ${a.uuid}: origem "${a.loginOrigem}" / SCA "${a.loginDestino}"`)
    }
    l.push('')
  }

  const semSenha = resultado.semSenhaReal || plano.semSenhaPrevisto
  const rotulo = resultado.semSenhaReal
    ? 'SEM SENHA NO SCA, lido do banco depois da copia'
    : 'SEM SENHA NO SCA ao fim desta execucao (previsto)'

  l.push(`--- ${rotulo}: ${semSenha.length} ---`)
  if (!semSenha.length) {
    l.push('  Ninguem. Todo mundo consegue entrar.')
  } else {
    l.push('  Estas pessoas NAO conseguem entrar no SCA:')
    for (const s of semSenha) {
      l.push(`  ${s.login}${s.motivo ? `  (${s.motivo})` : ''}`)
    }
  }
  l.push('')

  l.push('--- passo final, do administrador ---')
  if (semSenha.length) {
    l.push('  AINDA NAO ACABOU. Cada pessoa da lista acima precisa de uma senha:')
    l.push('  crie-a pela tela #/usuarios (Resetar senha) ou pelo auth_cli, ou')
    l.push('  desative quem nao entra mais. Ate la, ela nao consegue entrar.')
  } else if (!aplicado) {
    l.push('  Este foi um ENSAIO: nada foi escrito. Rode de novo com --aplicar.')
  } else {
    l.push('  Ninguem ficou sem senha. Todo usuario do SCA consegue entrar.')
  }

  return l.join('\n')
}

const AJUDA = `
Copia os hashes de senha do banco do Auth Server para o banco do SCA.

  node scripts/copiar_usuarios_auth.js [opcoes]

  --aplicar           escreve de verdade. Sem ele o script so relata (ensaio).
  --atualizar-dados   copia tambem nome, nome de guerra e posto/graduacao.
  --incluir-novos     cria quem so existe na origem, sem perfil, sem
                      administrador e inativo.
  --amostra N         quantas linhas de exemplo mostrar (padrao 10, 0 desliga).
  --ajuda             esta ajuda.

Conexoes so por variavel de ambiente. Credencial nunca entra por argumento.
  destino (SCA):     ${CHAVES_DESTINO.join(', ')}
  origem (auth):     ${CHAVES_ORIGEM.join(', ')}
`

// --- Banco -------------------------------------------------------------------

/**
 * Le as duas conexoes do ambiente. Nunca devolve nem imprime valor: quem chama
 * so repassa o objeto ao driver.
 */
const lerConexoes = () => {
  const faltando = []
  for (const chave of [...CHAVES_DESTINO, ...CHAVES_ORIGEM]) {
    // A porta tem padrao; as demais sao obrigatorias.
    if (chave.endsWith('_PORT')) continue
    if (!process.env[chave]) faltando.push(chave)
  }
  if (faltando.length) {
    throw new Error(
      'Faltam variaveis de ambiente: ' + faltando.join(', ') +
      '. O catalogo comentado esta no .env.example, e o modo de uso no ' +
      'scripts/README.md. Nenhuma delas entra por argumento.'
    )
  }

  const destino = {
    host: process.env.DB_SERVER,
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  }
  const origem = {
    host: process.env.AUTH_DB_SERVER,
    port: Number.parseInt(process.env.AUTH_DB_PORT || '5432', 10),
    database: process.env.AUTH_DB_NAME,
    user: process.env.AUTH_DB_USER,
    password: process.env.AUTH_DB_PASSWORD
  }

  if (
    origem.host === destino.host &&
    origem.port === destino.port &&
    origem.database === destino.database
  ) {
    throw new Error(
      'Origem e destino apontam para o MESMO banco. Confira as chaves ' +
      'AUTH_DB_* : elas descrevem o banco do Auth Server, e nao o do SCA.'
    )
  }

  return { origem, destino }
}

const aplicarPlano = async (bancoDestino, plano) => {
  return bancoDestino.tx(async t => {
    let atualizados = 0
    let criados = 0

    for (const item of plano.atualizar) {
      if (item.senha && item.dados) {
        await t.none(SQL_ATUALIZAR_SENHA_E_DADOS, { uuid: item.uuid, senha: item.senha, ...item.dados })
      } else if (item.senha) {
        await t.none(SQL_ATUALIZAR_SENHA, { uuid: item.uuid, senha: item.senha })
      } else {
        await t.none(SQL_ATUALIZAR_DADOS, { uuid: item.uuid, ...item.dados })
      }
      atualizados += 1
    }

    for (const item of plano.criar) {
      await t.none(SQL_CRIAR, item)
      criados += 1
    }

    // A lista de quem fica sem senha e lida do BANCO, ja com a copia aplicada e
    // ainda dentro da transacao. E a lista de quem NAO CONSEGUE ENTRAR depois
    // desta migracao, e derivar da memoria seria confiar no plano justamente
    // onde ele precisa ser conferido.
    const semSenha = await t.any(SQL_SEM_SENHA)

    return { atualizados, criados, semSenha }
  })
}

// --- Execucao ----------------------------------------------------------------

const principal = async (argv = process.argv.slice(2)) => {
  const opcoes = parseArgumentos(argv)

  if (opcoes.ajuda) {
    imprimir(AJUDA.trim())
    return 0
  }

  requireDoServer('dotenv').config({
    path: path.join(RAIZ, 'server', 'config.env'),
    quiet: true
  })

  const conexoes = lerConexoes()

  const pgPromise = requireDoServer('pg-promise')
  const pgp = pgPromise()
  const bancoOrigem = pgp(conexoes.origem)
  const bancoDestino = pgp(conexoes.destino)

  try {
    const [origem, destino, postosDestino, postosOrigem] = await Promise.all([
      bancoOrigem.any(SQL_ORIGEM),
      bancoDestino.any(SQL_DESTINO),
      bancoDestino.any(SQL_POSTOS),
      bancoOrigem.any(SQL_POSTOS)
    ])

    imprimir(`origem: ${origem.length} usuario(s)`)
    imprimir(`destino: ${destino.length} usuario(s)`)

    // O enunciado diz que os dois bancos tem os mesmos 19 codigos de posto.
    // Conferir custa uma consulta, e um codigo a mais na origem viraria uma FK
    // estourada no meio da transacao, com --atualizar-dados ou --incluir-novos.
    const codigosDestino = new Set(postosDestino.map(p => Number(p.code)))
    const codigosOrigem = new Set(postosOrigem.map(p => Number(p.code)))
    const soNaOrigem = [...codigosOrigem].filter(c => !codigosDestino.has(c))
    if (soNaOrigem.length) {
      imprimir(
        `AVISO: dominio.tipo_posto_grad tem ${soNaOrigem.length} codigo(s) so na ` +
        `origem: ${soNaOrigem.join(', ')}. Quem os usa nao entra.`
      )
    } else {
      imprimir(
        `dominio.tipo_posto_grad: ${codigosDestino.size} codigos no destino, ` +
        'todos os da origem presentes.'
      )
    }
    imprimir('')

    const plano = montarPlano(origem, destino, {
      atualizarDados: opcoes.atualizarDados,
      incluirNovos: opcoes.incluirNovos,
      postosValidos: codigosDestino
    })

    if (plano.erros.length && opcoes.aplicar) {
      imprimir(formatarRelatorio(plano, opcoes, { aplicado: false }))
      imprimir('')
      imprimir('NADA FOI ESCRITO: resolva os erros acima e rode de novo.')
      return 1
    }

    if (!opcoes.aplicar) {
      imprimir(formatarRelatorio(plano, opcoes, { aplicado: false }))
      return 0
    }

    const resultado = await aplicarPlano(bancoDestino, plano)

    const semSenhaReal = resultado.semSenha.map(r => {
      const previsto = plano.semSenhaPrevisto.find(p => p.login === r.login)
      return { login: r.login, motivo: previsto ? previsto.motivo : 'ja estava sem senha' }
    })

    imprimir(
      formatarRelatorio(plano, opcoes, {
        aplicado: true,
        semSenhaReal,
        atualizados: resultado.atualizados,
        criados: resultado.criados
      })
    )

    if (semSenhaReal.length !== plano.semSenhaPrevisto.length) {
      imprimir('')
      imprimir(
        `AVISO: o ensaio previa ${plano.semSenhaPrevisto.length} pessoa(s) sem senha e o ` +
        `banco tem ${semSenhaReal.length}. Vale o numero do BANCO, que e o de cima. ` +
        'Alguem escreveu em dgeo.usuario entre a leitura e a gravacao.'
      )
    }

    return 0
  } finally {
    pgp.end()
  }
}

const ehPrincipal =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (ehPrincipal) {
  principal()
    .then(codigo => {
      process.exitCode = codigo
    })
    .catch(e => {
      // So a mensagem: o erro inteiro do driver traz a consulta e os parametros
      // dela, e um deles e o hash.
      process.stderr.write(`\nERRO: ${mascarar((e && e.message) || e)}\n`)
      process.exitCode = 1
    })
}

export { principal }
