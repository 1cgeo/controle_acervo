'use strict'

// Guarda contra a falha SILENCIOSA da fusao: verifyPerfil tem o modulo 'acervo'
// como default, entao uma rota do orcamento que chame verifyPerfil('operador')
// sem o segundo argumento passa a cobrar perfil no ACERVO. Ela nao quebra, nao
// loga nada e ainda responde 403 para quem deveria entrar, ou 200 para quem
// nao deveria. Nenhum teste funcional pega isso rota por rota.
//
// Este teste le o FONTE das rotas do modulo e exige o modulo explicito em toda
// chamada. E varredura de texto de proposito: cobre inclusive a rota que
// ninguem lembrou de testar, e a rota nova de amanha.

const fs = require('fs')
const path = require('path')

const RAIZ = path.resolve(__dirname, '..', '..', '..', 'orcamento')

const arquivosDeRota = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? arquivosDeRota(path.join(dir, e.name))
      : e.name.endsWith('_route.js')
        ? [path.join(dir, e.name)]
        : []
  )

// verifyPerfil('nivel', 'modulo') em uma linha so, que e como o projeto escreve
const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

describe('Toda rota do orcamento passa o modulo para o verifyPerfil', () => {
  const arquivos = arquivosDeRota(RAIZ)

  it('encontra os arquivos de rota do modulo', () => {
    expect(arquivos.length).toBeGreaterThan(0)
  })

  it.each(arquivos.map(f => [path.relative(RAIZ, f), f]))(
    '%s',
    (_nome, arquivo) => {
      const fonte = fs.readFileSync(arquivo, 'utf8')
      const semModulo = []
      const moduloErrado = []

      for (const achado of fonte.matchAll(CHAMADA)) {
        const [trecho, , modulo] = achado
        if (!modulo) semModulo.push(trecho)
        else if (modulo !== 'orcamento') moduloErrado.push(trecho)
      }

      expect(semModulo).toEqual([])
      expect(moduloErrado).toEqual([])
    }
  )

  it('o total de rotas protegidas por perfil nao caiu sem aviso', () => {
    const total = arquivos.reduce((soma, arquivo) => {
      const fonte = fs.readFileSync(arquivo, 'utf8')
      return soma + [...fonte.matchAll(CHAMADA)].length
    }, 0)

    // 67 chamadas na fusao de 2026-07-27, 62 desde 2026-07-31. A queda de 5 foi
    // DE PROPOSITO: a meta do PIT saiu do modulo e virou rota de plataforma
    // (/api/metas), levando junto as suas 5 rotas. Ela nao ficou desprotegida:
    // troca verifyPerfil por verifyLogin na leitura e verifyAdmin na escrita, e
    // o teste disso mora em routes/pit_route.test.js.
    //
    // Subir e normal (rota nova); cair quer dizer que uma rota perdeu a
    // protecao, e ai o numero tem que ser revisto de proposito, nao por acidente.
    expect(total).toBeGreaterThanOrEqual(62)
  })
})
