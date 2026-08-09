'use strict'

// AS 23 ROTAS DE ACOMPANHAMENTO, LIDAS DO FONTE.
//
// POR QUE VARREDURA DE TEXTO, e nao um app de verdade: este arquivo mede o que
// esta ESCRITO na declaracao da rota -- a ordem, a guarda e o metodo -- e essas
// tres coisas nao aparecem numa resposta HTTP. Uma rota literal declarada depois
// de uma rota com parametro responde 400 em vez de 200, e um teste funcional so a
// pegaria se alguem tivesse lembrado de escrever o caso exato. Aqui a regra vale
// para a rota nova de amanha, que ninguem lembrou de testar.
//
// E POR QUE NAO DEPENDE DO BANCO: este arquivo nao abre conexao, entao cai no
// pacote `test:rapido`. Quem decide isso e `jest.config.js`, que LE O FONTE de
// cada teste e procura o `require` dos dois ajudantes que abrem conexao -- por
// isso o nome deles nao se escreve aqui nem em comentario: a varredura nao
// distingue prosa de codigo, e citar um deles mandaria este arquivo para o
// pacote lento, onde ele esperaria por um PostgreSQL que nao usa. O
// comportamento contra o banco e outro assunto e outro pacote.

const fs = require('fs')
const path = require('path')

const ROTA = path.resolve(
  __dirname, '..', '..', '..', 'acompanhamento_producao',
  'acompanhamento_producao_route.js'
)

/**
 * Tira bloco e linha de comentario, para a varredura ver so codigo.
 *
 * O `\r` CAI PRIMEIRO, e nao e detalhe: com `core.autocrlf` ligado (o padrao do
 * Git no Windows) o fonte chega em CRLF, e o `.` do JavaScript nao casa `\r` --
 * o `//.*$` pararia antes do fim da linha e comentario nenhum seria apagado. E o
 * mesmo remedio de `routes/modulo_em_toda_rota.test.js`, e ele ja custou uma
 * depuracao la.
 */
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const FONTE = semComentario(fs.readFileSync(ROTA, 'utf8'))

const DECLARACAO = /router\.(get|post|put|delete|patch)\(\s*'([^']+)'/g

const declaradas = [...FONTE.matchAll(DECLARACAO)].map(m => ({
  metodo: m[1],
  caminho: m[2]
}))

// A ORDEM ESPERADA E O CONTRATO, e nao uma lista de conferencia: quem mover uma
// linha deste arquivo tem de mover a de la, e no caminho descobre por que a
// ordem era aquela.
const ESPERADAS = [
  // Os dois seletores vem primeiro: rota literal antes de rota com parametro.
  // Eles nasceram com as telas, porque nem `/api/projetos/lote` (cobra o
  // ACERVO) nem `/api/producao/lote/:id/subfases` (cobra gerente) servem a um
  // filtro de tela de consulta.
  '/lotes',
  '/lotes/:lote/subfases',
  '/informacoes/:lote/:subfase',
  '/informacoes/:lote',
  '/grade_acompanhamento',
  '/atividade_subfase',
  '/atividade_usuario',
  '/situacao_subfase',
  '/resumo_usuario',
  '/atividades_em_execucao',
  '/ultimas_atividades_finalizadas',
  '/ultimos_login',
  '/usuarios_sem_perfil',
  '/dashboard/quantidade/:ano',
  '/dashboard/finalizadas/:ano',
  '/dashboard/execucao',
  '/pit/subfase/:ano',
  '/pit/:ano',
  '/mapa/:nome',
  '/projetos',
  '/projeto/:id/informacao_anual/:ano',
  '/projeto/:id/informacao_detalhada',
  '/projeto/:id/informacao_detalhada/:ano',
  '/dados_site_acompanhamento',
  '/linha_producao/:id/:z/:x/:y.pbf'
]

describe('o conjunto de rotas', () => {
  it('a leitura do fonte funcionou', () => {
    // Rede contra o falso verde: com a varredura devolvendo vazio, os casos
    // abaixo passariam sem cobrar nada.
    expect(declaradas.length).toBeGreaterThan(20)
  })

  it('sao as 25 rotas, nesta ordem', () => {
    expect(declaradas.map(d => d.caminho)).toEqual(ESPERADAS)
  })

  it('TODAS sao GET, porque o modulo so le', () => {
    // Escrita de producao mora em `/api/distribuicao` e em `/api/producao`, e
    // exclusao em `/api/perigo`. Um POST aqui seria escrita sem `db.conn.tx()` e
    // sem `auditoriaCtrl.registrar` -- este arquivo nao tem nenhum dos dois, de
    // proposito, e o dia em que precisar de um e o dia de rever isto.
    expect(declaradas.filter(d => d.metodo !== 'get')).toEqual([])
  })
})

describe('a ordem que morde', () => {
  const posicao = caminho => declaradas.findIndex(d => d.caminho === caminho)

  it('/pit/subfase/:ano vem ANTES de /pit/:ano', () => {
    // Hoje as duas nao disputam nada (dois segmentos contra tres). Basta alguem
    // acrescentar um `/pit/:ano/:algo` para `subfase` virar um ano, e a falha
    // seria um 400 do Joi dizendo que "subfase" nao e numero, num caminho em que
    // ninguem escreveu ano nenhum.
    expect(posicao('/pit/subfase/:ano')).toBeLessThan(posicao('/pit/:ano'))
  })

  it('/informacoes/:lote/:subfase vem ANTES de /informacoes/:lote', () => {
    expect(posicao('/informacoes/:lote/:subfase'))
      .toBeLessThan(posicao('/informacoes/:lote'))
  })

  it('/projeto/:id/informacao_detalhada vem ANTES da versao com ano', () => {
    expect(posicao('/projeto/:id/informacao_detalhada'))
      .toBeLessThan(posicao('/projeto/:id/informacao_detalhada/:ano'))
  })
})

describe('a guarda de cada rota', () => {
  // A ARMADILHA QUE ISTO FECHA e a do CLAUDE.md: o default de
  // `verifyPerfil(minimo, modulo)` e 'acervo'. Uma rota daqui que esquecesse o
  // segundo argumento passaria a cobrar perfil no ACERVO, sem erro de sintaxe,
  // sem teste vermelho e sem nada na tela.
  const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g
  const chamadas = [...FONTE.matchAll(CHAMADA)]

  it('nenhuma chamada de verifyPerfil omite o modulo', () => {
    expect(chamadas.filter(c => !c[2]).map(c => c[0])).toEqual([])
  })

  it('toda chamada cobra o modulo producao', () => {
    expect(chamadas.filter(c => c[2] !== 'producao').map(c => c[0])).toEqual([])
  })

  it('sao 24 rotas por perfil: as 25 menos a de tile', () => {
    // A tile e a unica sem `verifyPerfil`, e o caso seguinte diz por que.
    expect(chamadas).toHaveLength(ESPERADAS.length - 1)
  })

  it('as tres rotas gerenciais cobram gerente, e o resto cobra consulta', () => {
    // A regua da casa (2026-08-08): `consulta` LE as telas do modulo, `gerente`
    // responde pela area. As tres de gerente nao falam do trabalho, e sim de
    // QUEM trabalha (o ultimo login, quem esta sem habilitacao) e do que a
    // Divisao publica para fora (o pacote do site).
    const GERENTE = [
      '/ultimos_login', '/usuarios_sem_perfil', '/dados_site_acompanhamento'
    ]

    const niveis = chamadas.map(c => c[1])
    expect(niveis.filter(n => n === 'gerente')).toHaveLength(GERENTE.length)
    expect(niveis.filter(n => n === 'consulta'))
      .toHaveLength(ESPERADAS.length - 1 - GERENTE.length)
  })
})

describe('a rota de tile', () => {
  // ELA E A UNICA DO SISTEMA QUE NAO PASSA POR CABECALHO DE AUTORIZACAO, e a
  // razao e do cliente: o QGIS e o MapLibre pedem tile por URL crua, dentro de um
  // renderizador que nao deixa acrescentar cabecalho HTTP.
  const trecho = FONTE.slice(FONTE.indexOf("'/linha_producao/"))

  it('usa verifyLoginTile', () => {
    expect(trecho).toContain('verifyLoginTile')
  })

  it('NAO encadeia verifyPerfil depois dele', () => {
    // `verifyPerfil` le `req.headers.authorization`, que numa requisicao de tile
    // nao existe: encadea-lo devolveria 401 a todo pedido de tile, que e
    // exatamente o problema que `verifyLoginTile` existe para resolver.
    expect(trecho).not.toContain('verifyPerfil')
  })

  it('verifyLoginTile aparece em UMA rota so deste modulo', () => {
    // Token em query string entra no log de acesso, no historico do navegador e
    // no `Referer`. O preco fica na rota que nao tem escolha, e nao no modulo.
    const usos = [...FONTE.matchAll(/verifyLoginTile/g)]
    // Duas ocorrencias: a do `require` e a da rota.
    expect(usos).toHaveLength(2)
  })
})
