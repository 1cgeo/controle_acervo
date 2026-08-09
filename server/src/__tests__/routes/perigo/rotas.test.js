'use strict'

// AS 11 ROTAS DA ZONA DE PERIGO, LIDAS DO FONTE.
//
// Eram 13 ate 2026-08-09: `/produtos_sem_unidade_trabalho` e `/lote_sem_produto`
// deixaram de existir por decisao do chefe, porque a premissa delas morreu na
// travessia do SAP 2.3.5 -- aqui produto e `acervo.versao` e lote e `acervo.lote`,
// e os dois existem sem producao nenhuma. A lista abaixo e CONTRATO: quem as
// trouxer de volta encontra este arquivo vermelho.
//
// Aqui a varredura de texto vale mais do que em qualquer outro modulo: o que ela
// mede -- que TODA rota tem guarda, que a guarda cobra o modulo certo, e que as
// TRES que varrem exigem confirmacao -- e exatamente o que, faltando, nao produz
// erro nenhum. Uma rota destrutiva que perdesse o `verifyPerfil` responderia 200
// para qualquer um com token, e nenhum teste funcional a pegaria sem alguem ter
// escrito o caso exato.
//
// Este arquivo nao abre conexao, entao cai no pacote `test:rapido`. O nome dos
// ajudantes que abrem conexao NAO se escreve aqui, nem em comentario:
// `jest.config.js` decide o pacote lendo o fonte, e a varredura dele nao
// distingue prosa de codigo.

const fs = require('fs')
const path = require('path')

const perigoSchema = require('../../../perigo/perigo_schema')

const ROTA = path.resolve(__dirname, '..', '..', '..', 'perigo', 'perigo_route.js')
const CTRL = path.resolve(__dirname, '..', '..', '..', 'perigo', 'perigo_ctrl.js')

// O `\r` cai primeiro: em CRLF o `//.*$` pararia antes do fim da linha e
// comentario nenhum seria apagado. Mesmo remedio de
// `routes/modulo_em_toda_rota.test.js`.
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const FONTE = semComentario(fs.readFileSync(ROTA, 'utf8'))
const FONTE_CTRL = semComentario(fs.readFileSync(CTRL, 'utf8'))

// Cada bloco de `router.<metodo>('<caminho>', ... )`, ate o proximo `router.`.
// E o pedaco de fonte que descreve UMA rota: e nele que se procura a guarda e o
// schema dela.
const blocos = () => {
  const inicios = [...FONTE.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)]
  return inicios.map((m, i) => ({
    metodo: m[1],
    caminho: m[2],
    corpo: FONTE.slice(m.index, i + 1 < inicios.length ? inicios[i + 1].index : undefined)
  }))
}

const ROTAS = blocos()

const ESPERADAS = [
  ['get', '/propriedades_camada'],
  ['post', '/propriedades_camada'],
  ['put', '/propriedades_camada'],
  ['delete', '/propriedades_camada'],
  ['get', '/insumo'],
  ['post', '/insumo'],
  ['put', '/insumo'],
  ['delete', '/insumo'],
  ['delete', '/log'],
  ['delete', '/ut_sem_atividade'],
  ['delete', '/atividades/usuario/:uuid']
]

// AS TRES QUE VARREM: elas apagam sem receber a lista do que apagar. E por isso
// que exigem confirmacao, e por isso que esta lista existe -- ela e o que separa
// "apaga o que eu escolhi" de "apaga o que sobrar".
const VARREM = [
  '/log',
  '/ut_sem_atividade',
  '/atividades/usuario/:uuid'
]

describe('o conjunto de rotas', () => {
  it('a leitura do fonte funcionou', () => {
    expect(ROTAS.length).toBeGreaterThan(8)
  })

  it('sao as 11 rotas, nesta ordem', () => {
    expect(ROTAS.map(r => [r.metodo, r.caminho])).toEqual(ESPERADAS)
  })

  it('as duas rotas de 2026-08-09 NAO voltaram', () => {
    // A varredura por "versao sem unidade de trabalho" ou "lote sem versao"
    // selecionaria o acervo INTEIRO, e o `DELETE` dela seria a perda total. Rota
    // cuja premissa morreu nao vira rota mais cuidadosa, vira rota que nao
    // existe. `FONTE` ja vem sem comentario, entao a explicacao que ficou no
    // lugar delas nao conta aqui.
    expect(FONTE).not.toContain('produtos_sem_unidade_trabalho')
    expect(FONTE).not.toContain('lote_sem_produto')
  })

  it('a rota com parametro vem por ULTIMO', () => {
    // A regra da casa: rota literal antes de rota com parametro. Aqui nenhuma
    // disputa caminho com outra, mas a ordem e o que a proxima rota vai imitar.
    const comParametro = ROTAS.map((r, i) => (r.caminho.includes(':') ? i : -1))
      .filter(i => i >= 0)
    expect(comParametro).toEqual([ROTAS.length - 1])
  })
})

describe('a guarda de cada rota', () => {
  // A ARMADILHA DO CLAUDE.md: o default de `verifyPerfil(minimo, modulo)` e
  // 'acervo'. Uma rota daqui que o esquecesse deixaria o gerente do ACERVO --
  // que nao responde por producao nenhuma -- apagar unidade de trabalho.
  const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/

  it.each(ROTAS.map(r => [`${r.metodo.toUpperCase()} ${r.caminho}`, r]))(
    '%s cobra gerente no modulo producao',
    (_nome, rota) => {
      const achado = rota.corpo.match(CHAMADA)
      expect(achado).not.toBeNull()
      expect(achado[1]).toBe('gerente')
      expect(achado[2]).toBe('producao')
    }
  )

  it('sao 11 chamadas de verifyPerfil, uma por rota', () => {
    const todas = [...FONTE.matchAll(new RegExp(CHAMADA.source, 'g'))]
    expect(todas).toHaveLength(ESPERADAS.length)
  })

  it('NENHUMA rota usa verifyLoginTile', () => {
    // Token em query string entra no log de acesso e no historico do navegador.
    // Na zona de perigo isso seria uma URL que apaga producao, guardada pelo
    // navegador de quem a chamou.
    expect(FONTE).not.toContain('verifyLoginTile')
  })

  it('o validador e o ESTRITO', () => {
    // Numa rota que apaga, a chave descartada em silencio e o pior caso: quem
    // escreveu `insumo_id` no lugar de `insumo_ids` receberia "campo
    // obrigatorio faltando", e nao a pista de que digitou o nome errado.
    expect(FONTE).toContain("require('../utils/schema_validation_estrito')")
  })
})

describe('a confirmação das três que varrem', () => {
  const rotaDe = caminho => ROTAS.find(r => r.caminho === caminho && r.metodo === 'delete')

  it.each(VARREM)('%s valida um schema de corpo', caminho => {
    expect(rotaDe(caminho).corpo).toMatch(/schemaValidation\(\{[\s\S]*?body:/)
  })

  it.each(VARREM)('%s recebe um schema de confirmacao declarado', caminho => {
    // O schema citado tem de ser um dos dois de confirmacao, ou o da rota com
    // alvo. Um `body:` apontando outra coisa passaria no caso acima.
    const CONFIRMACAO = /perigoSchema\.(limpaLogBody|utSemAtividadeBody|limpaAtividadesBody)/
    expect(rotaDe(caminho).corpo).toMatch(CONFIRMACAO)
  })

  it('a rota com alvo confere que a confirmacao REPETE o uuid', () => {
    // `Joi.ref` nao alcanca `req.params` a partir do `body`: os dois sao
    // validados separadamente. Por isso a conferencia mora na rota, e este caso
    // e o que impede alguem de "simplificar" removendo-a.
    const rota = rotaDe('/atividades/usuario/:uuid')
    expect(rota.corpo).toContain('req.params.uuid')
    expect(rota.corpo).toContain('req.body.confirmar')
    expect(rota.corpo).toContain('AppError')
  })

  it('as duas que nao tem alvo usam schemas DIFERENTES entre si', () => {
    const usados = VARREM
      .filter(c => c !== '/atividades/usuario/:uuid')
      .map(c => rotaDe(c).corpo.match(/perigoSchema\.(\w+Body)/)[1])

    expect(new Set(usados).size).toBe(usados.length)
  })

  it('os tokens do schema batem com o numero de rotas sem alvo', () => {
    expect(Object.keys(perigoSchema.TOKEN)).toHaveLength(2)
  })
})

describe('a escrita e transacionada e auditada', () => {
  it('toda escrita do controlador abre db.conn.tx', () => {
    // A regra da casa: escrita que muda dado vive em `db.conn.tx()`. Aqui ela
    // nao e opcional -- e exatamente onde o rastro importa.
    const escritas = [...FONTE_CTRL.matchAll(/^controller\.(\w+) = async/gm)]
      .map(m => m[1])
      .filter(nome => !nome.startsWith('get'))

    expect(escritas.length).toBeGreaterThan(0)

    for (const nome of escritas) {
      const inicio = FONTE_CTRL.indexOf(`controller.${nome} = async`)
      const proximo = FONTE_CTRL.indexOf('\ncontroller.', inicio + 1)
      const corpo = FONTE_CTRL.slice(inicio, proximo === -1 ? undefined : proximo)

      expect(`${nome}: ${corpo.includes('db.conn.tx')}`).toBe(`${nome}: true`)
      expect(`${nome}: ${corpo.includes('auditoriaCtrl.registrar')}`)
        .toBe(`${nome}: true`)
    }
  })

  it('NENHUMA leitura do controlador abre transacao a toa', () => {
    const leituras = ['getPropriedadesCamada', 'getInsumo']
    for (const nome of leituras) {
      const inicio = FONTE_CTRL.indexOf(`controller.${nome} = async`)
      const proximo = FONTE_CTRL.indexOf('\ncontroller.', inicio + 1)
      const corpo = FONTE_CTRL.slice(inicio, proximo === -1 ? undefined : proximo)

      expect(`${nome}: ${corpo.includes('db.conn.tx')}`).toBe(`${nome}: false`)
    }
  })
})

describe('a fronteira do schema producao', () => {
  // A DECISAO DE 2026-08-09: nenhuma rota deste modulo alcanca o schema `acervo`.
  // As duas que o fariam sairam, porque "versao sem unidade de trabalho" e "lote
  // sem versao" sao o estado NORMAL de milhares de linhas -- o core de producao
  // nasceu vazio, e o criterio herdado do SAP selecionaria o acervo inteiro.
  //
  // Estes casos sao uma AMARRA, e nao uma medicao de comportamento: eles existem
  // para que quem "corrigir" o modulo trazendo o DELETE da origem encontre uma
  // falha com o porque escrito, em vez de descobrir pelo efeito.

  it('o controlador nao apaga de acervo.versao', () => {
    expect(FONTE_CTRL).not.toMatch(/DELETE\s+FROM\s+acervo\.versao/i)
  })

  it('o controlador nao apaga de acervo.lote nem de acervo.produto', () => {
    expect(FONTE_CTRL).not.toMatch(/DELETE\s+FROM\s+acervo\.lote/i)
    expect(FONTE_CTRL).not.toMatch(/DELETE\s+FROM\s+acervo\.produto/i)
  })

  it('o controlador nao escreve em acervo nenhum, nem por UPDATE', () => {
    // O `DELETE` nao e a unica porta: um `UPDATE acervo.versao SET ...` teria o
    // mesmo alcance e passaria pelos casos acima.
    expect(FONTE_CTRL).not.toMatch(/(INSERT\s+INTO|UPDATE)\s+acervo\./i)
  })

  it('os cinco DELETE do controlador citam tabela de producao', () => {
    // Sao CINCO desde 2026-08-09, e a conta e verificavel:
    // `propriedades_camada`, `insumo_unidade_trabalho` e `insumo` do CRUD de
    // insumo, mais `insumo_unidade_trabalho` e `unidade_trabalho` da varredura
    // de unidade sem atividade. Eram doze quando as duas rotas removidas
    // existiam.
    const alvos = [...FONTE_CTRL.matchAll(/DELETE\s+FROM\s+([a-z_]+)\.([a-z_]+)/gi)]
      .map(m => m[1].toLowerCase())

    expect(alvos).toHaveLength(5)
    expect([...new Set(alvos)]).toEqual(['producao'])
  })
})
