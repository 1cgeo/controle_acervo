'use strict'

// Guarda contra a falha SILENCIOSA da autorizacao por modulo.
//
// `verifyPerfil(minimo, modulo)` tem o modulo 'acervo' como DEFAULT. Uma rota do
// orcamento ou da mapoteca que chame `verifyPerfil('operador')` sem o segundo
// argumento passa a cobrar perfil no ACERVO. Ela nao quebra, nao loga nada, e
// responde 403 para quem deveria entrar ou 200 para quem nao deveria. Nenhum
// teste funcional pega isso rota por rota.
//
// Este teste le o FONTE das rotas e exige o modulo explicito em toda chamada.
// E varredura de texto de proposito: cobre a rota que ninguem lembrou de
// testar, e a rota nova de amanha.
//
// O modulo ACERVO fica de fora, e isso e deliberado: la o default e o valor
// certo, e cobrar o argumento explicito custaria 110 edicoes sem mudar
// comportamento nenhum. O risco mora nos OUTROS modulos, que sao estes.
//
// COMENTARIO SAI ANTES DA VARREDURA. `mapoteca_route.js` documenta a rota gemea
// do acervo citando `verifyPerfil('consulta')` sem modulo, e uma varredura crua
// reprovaria por causa de uma frase explicativa. Prosa que descreve a armadilha
// nao e a armadilha.

const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', '..')

// Piso, e nao contagem exata. Subir e normal (rota nova). CAIR quer dizer que
// uma rota perdeu a protecao, e ai o piso so se abaixa de proposito.
//
// O piso do orcamento ja foi abaixado uma vez com razao: a meta do PIT e o
// RPCMTec sairam do modulo e viraram rotas de plataforma, com verifyLogin ou
// verifyAdmin no lugar do verifyPerfil. Quem prova a guarda delas e
// routes/pit_route.test.js e routes/rpcmtec.test.js.
const MODULOS = [
  { nome: 'orcamento', piso: 55 },
  { nome: 'mapoteca', piso: 80 },
  // EQUIPAMENTO entrou em 2026-08-08, no dia em que o módulo nasceu, e não
  // meses depois: era esta a armadilha do CLAUDE.md ("em producao e em efetivo,
  // ninguem cobra por voce"), e um módulo novo que ficasse de fora daqui a
  // herdaria inteira. São 28 rotas, todas com o segundo argumento explícito.
  { nome: 'equipamento', piso: 28 },
  // CAMPO entrou em 2026-08-08, no dia em que o schema nasceu, e a PASTA nao se
  // chama como o MODULO: os arquivos estao em `src/campo/`, e a autorizacao
  // cobra `pit` -- campo e o trabalho que o PIT promete, e nao uma area
  // propria a conceder, entao `dominio.modulo` continua com seis linhas.
  //
  // ELE E O PRIMEIRO A COBRIR `pit`, e por isso vale mais que os outros
  // tres. O CLAUDE.md avisa ha tempos que "em producao e em efetivo, ninguem
  // cobra por voce": esta linha e o comeco do fim daquele aviso.
  { nome: 'campo', modulo: 'pit', piso: 16 }
]

const arquivosDeRota = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? arquivosDeRota(path.join(dir, e.name))
      : e.name.endsWith('_route.js')
        ? [path.join(dir, e.name)]
        : []
  )

/**
 * Tira bloco `/* *\/` e linha `//`, para a varredura ver so codigo.
 *
 * O `\r` CAI PRIMEIRO, e nao e detalhe: com `core.autocrlf` ligado (o padrao do
 * Git no Windows) o fonte chega em CRLF, e o `.` do JavaScript nao casa `\r`.
 * O `//.*$` parava antes do fim da linha, comentario nenhum era apagado, e a
 * varredura reprovava por causa da PROSA que descreve a armadilha -- so na
 * maquina de quem desenvolve no Windows.
 */
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

// verifyPerfil('nivel', 'modulo') em uma linha so, que e como o projeto escreve
const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

describe.each(MODULOS.map(m => [m.nome, m]))(
  'Toda rota do modulo %s passa o modulo para o verifyPerfil',
  (nome, modulo) => {
    // A PASTA e o MODULO podem divergir, e `campo` e o caso: os arquivos moram
    // em `src/campo/` e a guarda cobra `pit`. Onde nao ha `modulo`
    // declarado, os dois sao o mesmo -- que e o caso dos outros tres.
    const esperado = modulo.modulo || nome
    const raiz = path.join(SRC, nome)
    const arquivos = arquivosDeRota(raiz)

    it('encontra os arquivos de rota do modulo', () => {
      expect(arquivos.length).toBeGreaterThan(0)
    })

    it.each(arquivos.map(f => [path.relative(raiz, f), f]))(
      '%s',
      (_nome, arquivo) => {
        const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
        const semModulo = []
        const moduloErrado = []

        for (const achado of fonte.matchAll(CHAMADA)) {
          const [trecho, , mod] = achado
          if (!mod) semModulo.push(trecho)
          else if (mod !== esperado) moduloErrado.push(trecho)
        }

        expect(semModulo).toEqual([])
        expect(moduloErrado).toEqual([])
      }
    )

    it('o total de rotas protegidas por perfil nao caiu sem aviso', () => {
      const total = arquivos.reduce((soma, arquivo) => {
        const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
        return soma + [...fonte.matchAll(CHAMADA)].length
      }, 0)

      expect(total).toBeGreaterThanOrEqual(modulo.piso)
    })
  }
)

// CONTROLE NEGATIVO da limpeza de comentario. Sem ele, a varredura poderia
// estar cega para tudo (um `semComentario` que apagasse o arquivo inteiro
// deixaria os casos acima verdes por vacuidade).
describe('a limpeza de comentario nao come codigo', () => {
  it('apaga a chamada citada em comentario e mantem a chamada de verdade', () => {
    const fonte = [
      "// a irma do acervo e `verifyPerfil('consulta')` SEM modulo",
      "router.get('/x', verifyPerfil('operador', 'mapoteca'), handler)",
      "/* verifyPerfil('gerente') num bloco */"
    ].join('\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('operador', 'mapoteca')"])
  })

  it('nao confunde o // de uma URL com comentario', () => {
    const fonte = "const u = 'http://exemplo/x'\nverifyPerfil('consulta', 'mapoteca')"
    expect([...semComentario(fonte).matchAll(CHAMADA)]).toHaveLength(1)
  })

  // REGRESSAO: em CRLF a limpeza nao apagava nada, e a varredura reprovava a
  // prosa. So aparecia em maquina Windows com `core.autocrlf` ligado.
  it('apaga comentario tambem quando a linha termina em CRLF', () => {
    const fonte = [
      "// a irma do acervo e `verifyPerfil('consulta')` SEM modulo",
      "router.get('/x', verifyPerfil('operador', 'mapoteca'), handler)"
    ].join('\r\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('operador', 'mapoteca')"])
  })
})
