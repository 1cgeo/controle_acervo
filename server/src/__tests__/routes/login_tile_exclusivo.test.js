'use strict'

// A PORTA LARGA NAO PODE VAZAR PARA O RESTO DO SISTEMA.
//
// `verifyLoginTile` e a UNICA guarda do SCA que aceita o token na QUERY STRING
// (`?token=`). Ela existe porque o QGIS e o MapLibre pedem camada MVT por uma
// URL que eles mesmos montam, dentro de um renderizador que nao deixa
// acrescentar cabecalho HTTP: sem ela, ou a camada de tiles fica publica, ou ela
// nao existe.
//
// O PRECO E REAL, e nao e pequeno: token em query string entra no log de acesso
// do servidor web, no historico do navegador, no `Referer` de toda requisicao
// que a pagina disparar em seguida e em qualquer proxy do caminho. O SAP 2.3.5
// pagava esse preco em TODAS as rotas, porque o `verifyLogin` de la le
// `req.headers.authorization || req.query.token` e e a guarda de tudo. Aqui o
// preco fica so onde nao ha escolha.
//
// E E ISSO QUE ESTE ARQUIVO GUARDA. Sem ele, o proximo `require` distraido leva
// a porta larga para uma rota de escrita, e nada acusa: a rota continua
// funcionando, com token de cabecalho, para todo mundo que a testar.
//
// COMO AUTORIZAR UMA ROTA DE TILE NOVA: acrescente o caminho dela em
// `TILES_AUTORIZADOS`, abaixo. A lista e curta de proposito.

const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', '..')

// Os arquivos de rota que podem usar a guarda larga, por caminho relativo a
// `server/src`. E UM SO, e a lista existe para o segundo custar uma linha aqui e
// uma conversa: quem a acrescentar tem de dizer que aquilo e mesmo tile.
const TILES_AUTORIZADOS = [
  'acompanhamento_producao/acompanhamento_producao_route.js'
]

// E dentro do arquivo autorizado a guarda so vale em rota de TILE de verdade. O
// `.pbf` e o formato do Mapbox Vector Tile, e e por ele que se reconhece uma.
const CAMINHO_DE_TILE = /\.pbf'/

const arquivosDeRota = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? arquivosDeRota(path.join(dir, e.name))
      : e.name.endsWith('_route.js')
        ? [path.join(dir, e.name)]
        : []
  )

// Prosa que DESCREVE a armadilha nao e a armadilha: varios arquivos de rota
// explicam em comentario o que a guarda larga faz e por que nao a usam.
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const relativo = arquivo => path.relative(SRC, arquivo).replace(/\\/g, '/')

describe('verifyLoginTile so vale nas rotas de tile', () => {
  const arquivos = arquivosDeRota(SRC).filter(f => !relativo(f).startsWith('__tests__'))

  it('encontra os arquivos de rota do servidor', () => {
    expect(arquivos.length).toBeGreaterThan(10)
  })

  it('nenhum arquivo de rota fora da lista a usa', () => {
    const usam = arquivos
      .filter(f => /verifyLoginTile/.test(semComentario(fs.readFileSync(f, 'utf8'))))
      .map(relativo)
      .filter(f => !TILES_AUTORIZADOS.includes(f))

    expect(usam).toEqual([])
  })

  // A lista autoriza o ARQUIVO, e o arquivo tem dezenas de rotas. Sem esta
  // metade, autorizar um arquivo por causa de uma tile abriria a porta para
  // todas as outras rotas dele -- que e o caminho mais provavel de o vazamento
  // acontecer, porque ninguem precisaria mexer na lista.
  it.each(TILES_AUTORIZADOS)('em %s a guarda larga so aparece em rota .pbf', arquivo => {
    const fonte = semComentario(fs.readFileSync(path.join(SRC, arquivo), 'utf8'))

    // `router.get('/caminho', ...guardas...` ate a primeira quebra de bloco.
    const declaracoes = [...fonte.matchAll(
      /router\.(?:get|post|put|delete)\(\s*('[^']+')\s*,([\s\S]*?)\n\)/g
    )]

    const comGuardaLarga = declaracoes
      .filter(d => /verifyLoginTile/.test(d[2]))
      .map(d => d[1])

    expect(comGuardaLarga.length).toBeGreaterThan(0)
    expect(comGuardaLarga.filter(caminho => !CAMINHO_DE_TILE.test(caminho))).toEqual([])
  })

  // O outro lado da mesma regra: NENHUMA outra guarda pode ler `req.query.token`
  // por conta propria. Sem esta metade, alguem contornaria a lista acima
  // copiando as tres linhas para dentro do `verify_login.js`, e o teste de cima
  // continuaria verde.
  it('so verify_login_tile.js le o token da query string', () => {
    const guardas = fs
      .readdirSync(path.join(SRC, 'login'))
      .filter(f => f.endsWith('.js'))

    const leemDaQuery = guardas.filter(f => {
      const fonte = semComentario(fs.readFileSync(path.join(SRC, 'login', f), 'utf8'))
      return /req\.query(\.token|\[['"]token['"]\])/.test(fonte)
    })

    expect(leemDaQuery).toEqual(['verify_login_tile.js'])
  })

  // E o `verifyLogin` normal continua tirando o TOKEN so do cabecalho: ele
  // guarda as cinco rotas da propria conta (sessao, perfil e senha), e senha nao
  // se troca por uma URL que fica no historico do navegador.
  //
  // Ele LE `req.query.usuario_uuid`, e isso e outra coisa: e a trava que impede
  // mandar o uuid de outra pessoa, e nao uma credencial.
  it('verify_login.js tira o token SO do cabecalho authorization', () => {
    const fonte = semComentario(
      fs.readFileSync(path.join(SRC, 'login', 'verify_login.js'), 'utf8')
    )
    expect(fonte).toMatch(/req\.headers\.authorization/)
    expect(fonte).not.toMatch(/req\.query\.token/)
    expect(fonte).not.toMatch(/req\.query\[['"]token['"]\]/)
  })
})
