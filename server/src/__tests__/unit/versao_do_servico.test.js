'use strict'

// A VERSÃO DO SERVIÇO NÃO PODE FICAR PARA TRÁS DO BANCO.
//
// POR QUE ESTE ARQUIVO EXISTE. `VERSION`, de `server/src/config.js`, sai em
// `version` de toda resposta da API e na linha de boot. Ela ficou em 1.38.0
// enquanto o banco chegou a 1.50.0 -- doze versões -- e ninguém percebeu por um
// motivo simples: nada a ligava a nada. Não havia teste, não havia guarda, e
// quem lê a resposta da API não tem como saber que aquele número mentia.
//
// A REGRA É `>=`, E NÃO `===`, de propósito. Um release que só mexe em código
// move o serviço e NÃO move o banco, e exigir igualdade obrigaria a inventar uma
// migração vazia a cada correção de tela. O que não pode acontecer é o
// contrário: o banco andar e o serviço ficar.
//
// A FONTE É `er/versao.sql`, e não `MIN_DATABASE_VERSION`. Aquele arquivo é o
// que uma INSTALAÇÃO NOVA carimba, e o serviço que a instala é, por
// construção, ao menos tão novo quanto ela. O piso é outra coisa: ele pode
// ficar deliberadamente para trás quando uma migração só remove.

const fs = require('fs')
const path = require('path')
const semver = require('semver')

const { VERSION, MIN_DATABASE_VERSION } = require('../../config')

const versaoDoEr = () => {
  const ddl = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', '..', 'er', 'versao.sql'),
    'utf8'
  )
  const achado = ddl.match(/INSERT INTO public\.versao \(code, nome\) VALUES\s*\(\s*1\s*,\s*'([^']+)'\s*\)/)
  // A variância primeiro: um regex que deixasse de casar devolveria `null` e
  // faria as asserções abaixo passarem por vacuidade.
  expect(achado).not.toBeNull()
  return achado[1]
}

describe('a versão do serviço acompanha a do banco', () => {
  it('`er/versao.sql` declara uma versão semver legível', () => {
    expect(semver.valid(versaoDoEr())).not.toBeNull()
  })

  it('VERSION e MIN_DATABASE_VERSION são semver', () => {
    expect(semver.valid(VERSION)).not.toBeNull()
    expect(semver.valid(MIN_DATABASE_VERSION)).not.toBeNull()
  })

  // ESTE É O CASO QUE PEGA A DEFASAGEM. Com VERSION em 1.38.0 e o `er/` em
  // 1.50.0, ele reprova e diz exatamente o que fazer.
  it('VERSION não fica abaixo do que `er/versao.sql` carimba', () => {
    const doEr = versaoDoEr()
    expect(
      `VERSION=${VERSION} (er/versao.sql=${doEr})`
    ).toBe(
      semver.gte(VERSION, doEr)
        ? `VERSION=${VERSION} (er/versao.sql=${doEr})`
        : `VERSION precisa ser >= ${doEr}: suba a constante em server/src/config.js`
    )
  })

  // O PISO NUNCA PASSA A VERSÃO DA INSTALAÇÃO NOVA. Se passasse, uma instalação
  // recém-criada pelo `create_config.js` não subiria o próprio serviço.
  it('MIN_DATABASE_VERSION não passa o que `er/versao.sql` carimba', () => {
    const doEr = versaoDoEr()
    expect(
      `piso=${MIN_DATABASE_VERSION} (er/versao.sql=${doEr})`
    ).toBe(
      semver.lte(MIN_DATABASE_VERSION, doEr)
        ? `piso=${MIN_DATABASE_VERSION} (er/versao.sql=${doEr})`
        : `o piso ${MIN_DATABASE_VERSION} passa o er/versao.sql: instalação nova não subiria`
    )
  })
})
