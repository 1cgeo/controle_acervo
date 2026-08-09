'use strict'

// A GUARDA DE `/api/gerencia_producao`, provada lendo o FONTE.
//
// POR QUE VARREDURA DE TEXTO. `verifyPerfil(minimo, modulo)` tem 'acervo' como
// DEFAULT. Uma rota daqui que chamasse `verifyPerfil('gerente')` sem o segundo
// argumento passaria a cobrar perfil no ACERVO: nao quebra, nao loga nada, e
// responde 403 para o gerente da producao e 200 para o gerente do acervo. Nenhum
// teste funcional pega isso rota por rota, e a armadilha esta escrita no
// `CLAUDE.md` porque ja custou caro.
//
// O IRMAO DESTE ARQUIVO e `__tests__/routes/modulo_em_toda_rota.test.js`, que
// faz o mesmo para orcamento, mapoteca, equipamento e campo. Este mora em
// caminho proprio porque o core de producao entrou por sete modulos em paralelo,
// e sete agentes editando a mesma lista de pisos e a colisao garantida. Quando a
// onda assentar, os dois podem virar um.

const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..', '..', '..', 'gerencia_producao')

const arquivosDeRota = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e =>
      e.isDirectory()
        ? arquivosDeRota(path.join(dir, e.name))
        : e.name.endsWith('_route.js')
          ? [path.join(dir, e.name)]
          : []
    )

/**
 * Tira bloco e linha de comentario, para a varredura ver so codigo.
 *
 * O `\r` CAI PRIMEIRO. Com `core.autocrlf` ligado (o padrao do Git no Windows) o
 * fonte chega em CRLF e o `.` do JavaScript nao casa `\r`: o `//.*$` pararia
 * antes do fim da linha, comentario nenhum seria apagado, e a varredura
 * reprovaria por causa da PROSA que descreve a armadilha. E o mesmo remedio de
 * `modulo_em_toda_rota.test.js`, e a mesma regressao.
 */
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z_]+)'\s*)?\)/g
const DECLARACAO = /router\.(get|post|put|delete|patch)\(/g

const arquivos = arquivosDeRota(RAIZ)
const fontes = arquivos.map(a => [
  path.relative(RAIZ, a),
  semComentario(fs.readFileSync(a, 'utf8'))
])

describe('a guarda de /api/gerencia_producao', () => {
  it('encontra os arquivos de rota do modulo', () => {
    expect(arquivos.length).toBeGreaterThan(0)
  })

  it.each(fontes)('%s: todo verifyPerfil passa o modulo producao', (_nome, fonte) => {
    const semModulo = []
    const moduloErrado = []

    for (const achado of fonte.matchAll(CHAMADA)) {
      const [trecho, , modulo] = achado
      if (!modulo) semModulo.push(trecho)
      else if (modulo !== 'producao') moduloErrado.push(trecho)
    }

    expect(semModulo).toEqual([])
    expect(moduloErrado).toEqual([])
  })

  // A REGUA ACORDADA PARA ESTA LEVA: as 67 rotas da origem eram `verifyAdmin` do
  // SAP, e `verifyAdmin` de la vira GERENTE no modulo `producao` daqui. Nao ha
  // rota de leitura em `consulta` porque nao ha leitura inocente neste modulo --
  // `/view_acompanhamento` devolve a credencial de banco e `/fila_prioritaria`
  // mostra quem furou a fila de quem. Se um dia uma leitura descer para
  // `consulta`, esta linha e onde a decisao se registra.
  it.each(fontes)('%s: o piso de toda rota e gerente', (_nome, fonte) => {
    const niveis = [...fonte.matchAll(CHAMADA)].map(a => a[1])
    expect([...new Set(niveis)]).toEqual(['gerente'])
  })

  // TODA ROTA TEM GUARDA, e nao so as que alguem lembrou de proteger. Sem esta
  // conferencia, uma rota nova sem `verifyPerfil` nenhum passaria por todos os
  // casos acima -- eles so olham as chamadas que EXISTEM.
  it.each(fontes)('%s: ha uma guarda para cada rota declarada', (_nome, fonte) => {
    const rotas = [...fonte.matchAll(DECLARACAO)].length
    const guardas = [...fonte.matchAll(CHAMADA)].length
    expect(guardas).toBe(rotas)
  })

  // PISO, e nao contagem exata. Subir e normal (rota nova). CAIR quer dizer que
  // uma rota perdeu a protecao, e ai o piso so se abaixa de proposito.
  //
  // O PISO SUBIU DE 56 PARA 59 quando as tres rotas de permissao de banco
  // entraram (`PUT /atividades/permissoes` e as duas de `/banco_dados`). As que
  // faltam da origem estao nomeadas, com a razao de cada uma, no cabecalho de
  // `gerencia_producao_route.js`.
  //
  // ESTE CASO JA ACHOU UM DEFEITO DE VERDADE, e nao um de contagem: ao entrarem
  // os primeiros blocos de swagger naquele arquivo, uma barra-asterisco escrita
  // em PROSA (o caminho `/banco_dados` com asterisco no fim) passou a abrir um
  // bloco de comentario para a limpeza abaixo, que se fechou no primeiro `*/` de
  // verdade e engoliu as rotas do meio. O total caiu de 57 para 3, e nenhum
  // outro caso deste arquivo acusou nada -- os outros so olham as chamadas que
  // SOBREVIVERAM a limpeza. Este e o unico que mede a AUSENCIA.
  it('o total de rotas protegidas por perfil nao caiu sem aviso', () => {
    const total = fontes.reduce(
      (soma, [, fonte]) => soma + [...fonte.matchAll(CHAMADA)].length,
      0
    )
    expect(total).toBeGreaterThanOrEqual(59)
  })
})

// CONTROLE NEGATIVO da limpeza de comentario. Sem ele, a varredura poderia estar
// cega para tudo: um `semComentario` que apagasse o arquivo inteiro deixaria
// todos os casos acima verdes por vacuidade.
describe('a limpeza de comentario nao come codigo', () => {
  it('apaga a chamada citada em comentario e mantem a chamada de verdade', () => {
    const fonte = [
      "// a irma do acervo e `verifyPerfil('consulta')` SEM modulo",
      "router.get('/x', verifyPerfil('gerente', 'producao'), handler)",
      "/* verifyPerfil('operador') num bloco */"
    ].join('\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('gerente', 'producao')"])
  })

  it('apaga comentario tambem quando a linha termina em CRLF', () => {
    const fonte = [
      "// prosa citando `verifyPerfil('consulta')` sem modulo",
      "router.put('/x', verifyPerfil('gerente', 'producao'), handler)"
    ].join('\r\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('gerente', 'producao')"])
  })

  it('nao confunde o // de uma URL com comentario', () => {
    const fonte = "const u = 'http://exemplo/x'\nverifyPerfil('gerente', 'producao')"
    expect([...semComentario(fonte).matchAll(CHAMADA)]).toHaveLength(1)
  })
})

// O MODULO PRECISA EXISTIR NO MAPA, senao nada disto sobe: `verifyPerfil` recusa
// modulo desconhecido no CARREGAMENTO do arquivo de rota, e o servidor inteiro
// morre no boot. O code 7 e o de `dominio.modulo`, e quem prova que os dois
// lados batem e `routes/orcamento/verify_perfil.test.js`.
describe('o modulo producao esta no mapa do verifyPerfil', () => {
  const verifyPerfil = require('../../../login/verify_perfil')

  it('producao e o code 7', () => {
    expect(verifyPerfil.MODULO).toHaveProperty('producao', 7)
  })

  it('montar a rota com modulo producao nao lanca', () => {
    expect(() => verifyPerfil('gerente', 'producao')).not.toThrow()
  })
})
