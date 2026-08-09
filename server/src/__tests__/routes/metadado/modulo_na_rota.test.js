'use strict'

// GUARDA CONTRA A FALHA SILENCIOSA DA AUTORIZACAO, no modulo metadado.
//
// `verifyPerfil(minimo, modulo)` tem 'acervo' como DEFAULT. Uma rota daqui que
// chame `verifyPerfil('gerente')` sem o segundo argumento passa a cobrar perfil
// no ACERVO: ela nao quebra, nao loga nada, e responde 403 para quem deveria
// entrar ou 200 para quem nao deveria.
//
// A PASTA E O MODULO DIVERGEM AQUI, e e o segundo caso do sistema (o primeiro e
// `src/campo/`, que cobra `pit`). Os arquivos moram em `src/metadado/` e a
// guarda cobra `producao`: metadado nao e area a conceder, e sim o que a
// producao declara sobre o que ela entrega. Nao ha `dominio.modulo` para ele.
//
// POR QUE ESTE ARQUIVO, E NAO UMA LINHA EM `modulo_em_toda_rota.test.js`.
// Aquele e o teste compartilhado, e a onda da 3.0.0 tem SETE modulos novos
// entrando em paralelo: sete agentes acrescentando uma linha na mesma lista
// colidem. Quando a onda assentar, esta varredura pode ser dobrada la dentro --
// ela e a mesma, com a mesma limpeza de comentario.

const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..', '..', '..', 'metadado')

const MODULO_ESPERADO = 'producao'

// PISO, e nao contagem exata. Subir e normal (rota nova). CAIR quer dizer que
// uma rota perdeu a protecao, e ai o piso so se abaixa de proposito.
//
// SAO 51 ROTAS: 5 listas de dominio, 2 de organizacao, 4 por tabela nas onze
// tabelas com CRUD (44) e 4 de geracao de saida... o que daria 55. As onze
// tabelas incluem a `organizacao`, que so tem GET e PUT, e as cinco listas de
// dominio nao tem escrita nenhuma. A conta fechada e 51.
const PISO = 51

const arquivosDeRota = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? arquivosDeRota(path.join(dir, e.name))
      : e.name.endsWith('_route.js')
        ? [path.join(dir, e.name)]
        : []
  )

/**
 * Tira bloco e linha de comentario, para a varredura ver so codigo.
 *
 * O `\r` CAI PRIMEIRO, e nao e detalhe: com `core.autocrlf` ligado (o padrao do
 * Git no Windows) o fonte chega em CRLF, e o `.` do JavaScript nao casa `\r`. O
 * `//.*$` pararia antes do fim da linha, comentario nenhum seria apagado, e a
 * varredura reprovaria por causa da PROSA que descreve a armadilha -- so na
 * maquina de quem desenvolve no Windows.
 */
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

const arquivos = arquivosDeRota(RAIZ)

describe('Toda rota do metadado passa o módulo para o verifyPerfil', () => {
  it('encontra os arquivos de rota do módulo', () => {
    expect(arquivos.length).toBeGreaterThan(0)
  })

  it.each(arquivos.map(f => [path.relative(RAIZ, f), f]))('%s', (_nome, arquivo) => {
    const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
    const semModulo = []
    const moduloErrado = []

    for (const achado of fonte.matchAll(CHAMADA)) {
      const [trecho, , mod] = achado
      if (!mod) semModulo.push(trecho)
      else if (mod !== MODULO_ESPERADO) moduloErrado.push(trecho)
    }

    expect(semModulo).toEqual([])
    expect(moduloErrado).toEqual([])
  })

  it('o total de rotas protegidas por perfil não caiu sem aviso', () => {
    const total = arquivos.reduce((soma, arquivo) => {
      const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
      return soma + [...fonte.matchAll(CHAMADA)].length
    }, 0)

    expect(total).toBeGreaterThanOrEqual(PISO)
  })

  // CONTROLE NEGATIVO da limpeza de comentario. Sem ele, a varredura poderia
  // estar cega para tudo: um `semComentario` que apagasse o arquivo inteiro
  // deixaria os casos acima verdes por vacuidade.
  it('a limpeza de comentário não come código', () => {
    const fonte = [
      "// a irmã do acervo é `verifyPerfil('consulta')` SEM módulo",
      "router.get('/x', verifyPerfil('gerente', 'producao'), handler)",
      "/* verifyPerfil('gerente') num bloco */"
    ].join('\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('gerente', 'producao')"])
  })
})

describe('Não sobrou rota pública no metadado', () => {
  // NA ORIGEM HAVIA TRES CLASSES DE ROTA: as seis listas de dominio SEM guarda
  // nenhuma, o resto com `verifyAdmin`, e DUAS publicas de proposito
  // (`/json_edicao/produto/:uuid` e `/xml/produto/:uuid`), para uma ferramenta
  // buscar o arquivo pronto.
  //
  // Aqui nao ha rota anonima, e o corte e deliberado: o JSON de edicao expoe
  // servidor, porta e nome do banco de edicao (sem credenciais), e deixa-lo
  // aberto publicaria a topologia da producao para quem passasse.
  //
  // O TESTE CONTA `router.<verbo>(` E COMPARA COM O NUMERO DE GUARDAS. Toda
  // rota tem exatamente um `verifyPerfil`, entao os dois numeros batem; uma
  // rota sem guarda desequilibra a conta.
  it('há um verifyPerfil para cada rota declarada', () => {
    for (const arquivo of arquivos) {
      const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
      const rotas = [...fonte.matchAll(/router\.(get|post|put|delete|patch)\(/g)].length
      const guardas = [...fonte.matchAll(CHAMADA)].length
      expect(`${path.basename(arquivo)}: ${rotas} rota(s), ${guardas} guarda(s)`)
        .toBe(`${path.basename(arquivo)}: ${rotas} rota(s), ${rotas} guarda(s)`)
    }
  })
})
