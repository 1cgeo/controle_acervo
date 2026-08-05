'use strict'

// VARREDURA DA RASTREABILIDADE DO MODULO ORCAMENTO.
//
// Este arquivo e a TROCA por nao usar gatilho de banco. A insercao do evento
// mora no backend, porque o gatilho nao conhece o usuario da sessao HTTP (o
// Postgres ve so a conexao do pool). O preco dessa escolha e a rota nova que
// esquece de auditar, e quem cobra o preco e uma varredura como esta, no molde
// de `routes/mapoteca_auditoria.test.js`.
//
// O QUE ELA COBRA, em tres camadas:
//
//   1. Toda rota de escrita do modulo esta declarada como COBERTA (ou fora do
//      escopo COM MOTIVO). A lista de rotas sai do router de VERDADE, entao a
//      rota nova de amanha cai aqui.
//   2. Todo handler de escrita repassa `req.usuarioUuid` E `req.contexto` ao
//      controller. Este e o defeito mais provavel do modulo: a funcao de
//      escrita deixa de receber o autor embora `req.usuarioUuid` exista na
//      rota, e um evento com autor nulo nao quebra nada, so responde
//      "migração" na tela, que e mentira.
//   3. Todo controller de escrita importa o `auditoria_ctrl` e registra as tres
//      operacoes que ele executa.
//
// O QUE ELA NAO COBRA, de proposito: atomicidade. No `helpers/orcamento/mockDb`
// a "transacao" e o proprio objeto de conexao (`conn.tx = cb => cb(conn)`), e um
// `registrar` colocado fora da transacao passaria em tudo o que e mockado. Quem
// prova que o rollback derruba o evento junto e
// `__tests__/integration/orcamento.test.js`, contra banco de verdade.

const fs = require('fs')
const path = require('path')

const mockDb = require('../../helpers/orcamento/mockDb').createMockDb()
jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../../login', () => require('../../helpers/orcamento/mockLogin'))

const orcamento = require('../../../orcamento')

const RAIZ = path.resolve(__dirname, '..', '..', '..', 'orcamento')

const METODOS_DE_ESCRITA = ['post', 'put', 'patch', 'delete']

// Os prefixos sao os de `routes.js`. Estao repetidos aqui de proposito: a chave
// que a varredura monta tem de ser a URL que a pessoa chama, e nao o caminho
// relativo dentro do router, senao 'POST /' apareceria nove vezes.
const MONTAGENS = [
  ['/orcamento/dominio', orcamento.dominioRoute],
  ['/orcamento/configuracao', orcamento.configuracaoRoute],
  ['/orcamento/dfd', orcamento.dfdRoute],
  ['/orcamento/pdr', orcamento.pdrRoute],
  ['/orcamento/notas_credito', orcamento.notaCreditoRoute],
  ['/orcamento/notas_empenho', orcamento.notaEmpenhoRoute],
  ['/orcamento/liquidacoes', orcamento.liquidacaoRoute],
  ['/orcamento/recebimentos', orcamento.recebimentoRoute],
  ['/orcamento/licitacoes', orcamento.licitacaoRoute],
  ['/orcamento/rpnp', orcamento.rpnpRoute],
  ['/orcamento/dashboard', orcamento.dashboardRoute],
  ['/orcamento/arquivo', orcamento.arquivoRoute]
]

// As 36 rotas de escrita do modulo, TODAS auditadas, sem excecao: todas as
// tabelas daqui carregam valor financeiro, e este e o modulo em que "qual era o
// valor antes" e a pergunta mais provavel.
const COBERTAS = new Set([
  'PUT /orcamento/configuracao',

  'POST /orcamento/dfd',
  'PUT /orcamento/dfd/:id',
  'DELETE /orcamento/dfd/:id',

  'POST /orcamento/pdr',
  'PUT /orcamento/pdr/:id',
  'DELETE /orcamento/pdr/:id',

  'POST /orcamento/notas_credito',
  'PUT /orcamento/notas_credito/:id',
  'DELETE /orcamento/notas_credito/:id',

  'POST /orcamento/notas_empenho',
  'PUT /orcamento/notas_empenho/:id',
  'DELETE /orcamento/notas_empenho/:id',

  'POST /orcamento/liquidacoes',
  'PUT /orcamento/liquidacoes/:id',
  'DELETE /orcamento/liquidacoes/:id',

  'POST /orcamento/recebimentos',
  'PUT /orcamento/recebimentos/:id',
  'DELETE /orcamento/recebimentos/:id',

  'POST /orcamento/licitacoes',
  'PUT /orcamento/licitacoes/:id',
  'DELETE /orcamento/licitacoes/:id',

  'POST /orcamento/rpnp',
  'PUT /orcamento/rpnp/:id',
  'DELETE /orcamento/rpnp/:id',

  'POST /orcamento/arquivo',
  'DELETE /orcamento/arquivo/:id',

  // As nove de dominio. Sao tabelas de DOMINIO com CRUD por tela, e mudar um
  // codigo de ND reclassifica NC e NE ja lancadas: a alteracao de maior alcance
  // do modulo, e a que menos rastro tinha.
  'POST /orcamento/dominio/natureza_despesa',
  'PUT /orcamento/dominio/natureza_despesa/:code',
  'DELETE /orcamento/dominio/natureza_despesa/:code',
  'POST /orcamento/dominio/plano_interno',
  'PUT /orcamento/dominio/plano_interno/:code',
  'DELETE /orcamento/dominio/plano_interno/:code',
  'POST /orcamento/dominio/ug',
  'PUT /orcamento/dominio/ug/:code',
  'DELETE /orcamento/dominio/ug/:code'
])

// Vazio hoje, e o formato importa: quem acrescentar uma rota aqui tem de dizer
// por que ela nao audita. Lista sem motivo vira gaveta.
const FORA_DO_ESCOPO = new Map([])

const rotasDeEscrita = () => {
  const chaves = []
  for (const [prefixo, router] of MONTAGENS) {
    expect(Array.isArray(router && router.stack)).toBe(true)
    for (const camada of router.stack) {
      if (!camada.route) continue
      for (const metodo of METODOS_DE_ESCRITA) {
        if (camada.route.methods[metodo]) {
          const caminho = camada.route.path === '/' ? '' : camada.route.path
          chaves.push(`${metodo.toUpperCase()} ${prefixo}${caminho}`)
        }
      }
    }
  }
  return chaves
}

const arquivosDeRota = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? arquivosDeRota(path.join(dir, e.name))
      : e.name.endsWith('_route.js')
        ? [path.join(dir, e.name)]
        : []
  )

const arquivosDeControlador = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? arquivosDeControlador(path.join(dir, e.name))
      : e.name.endsWith('_ctrl.js')
        ? [path.join(dir, e.name)]
        : []
  )

// Um bloco por chamada de `router.<metodo>(`, do inicio dela ate a proxima.
const blocosDeRota = fonte => {
  const inicios = []
  const re = /router\.(get|post|put|patch|delete)\(/g
  let achado
  while ((achado = re.exec(fonte)) !== null) {
    inicios.push({ metodo: achado[1], pos: achado.index })
  }
  return inicios.map((inicio, i) => ({
    metodo: inicio.metodo,
    texto: fonte.slice(inicio.pos, i + 1 < inicios.length ? inicios[i + 1].pos : fonte.length)
  }))
}

describe('Rastreabilidade do orcamento - varredura das rotas de escrita', () => {
  it('toda rota de escrita do modulo esta coberta', () => {
    const encontradas = rotasDeEscrita()

    // Rede contra o falso verde: se o formato do router mudar e a extracao
    // devolver lista vazia, o teste passaria sem cobrar nada.
    expect(encontradas.length).toBeGreaterThanOrEqual(COBERTAS.size)

    const descobertas = encontradas.filter(
      r => !COBERTAS.has(r) && !FORA_DO_ESCOPO.has(r)
    )

    // Rota nova sem auditoria cai AQUI. Para consertar: audite a rota e
    // acrescente a chave em COBERTAS, ou justifique em FORA_DO_ESCOPO.
    expect(descobertas).toEqual([])

    // O caminho inverso: chave em COBERTAS que nao existe mais no router.
    const orfas = [...COBERTAS].filter(r => !encontradas.includes(r))
    expect(orfas).toEqual([])
  })

  // PISO, e nao contagem exata. Subir e normal (rota nova); cair quer dizer que
  // uma rota de escrita sumiu, e ai o piso so se abaixa de proposito.
  it('o total de rotas de escrita nao caiu sem aviso', () => {
    expect(rotasDeEscrita().length).toBeGreaterThanOrEqual(36)
  })
})

describe('Rastreabilidade do orcamento - o autor e o contexto chegam ao controller', () => {
  const arquivos = arquivosDeRota(RAIZ)

  it('encontra os arquivos de rota do modulo', () => {
    expect(arquivos.length).toBeGreaterThan(0)
  })

  it.each(arquivos.map(f => [path.relative(RAIZ, f), f]))(
    '%s',
    (nome, arquivo) => {
      const fonte = fs.readFileSync(arquivo, 'utf8')

      const semAutor = []
      const semContexto = []

      for (const bloco of blocosDeRota(fonte)) {
        if (!METODOS_DE_ESCRITA.includes(bloco.metodo)) continue

        // `req.usuarioUuid` sem `req.contexto` e o caso perigoso, porque o
        // evento nasce com origem 'web' por default e rota nula: parece certo.
        if (!bloco.texto.includes('req.usuarioUuid')) {
          semAutor.push(bloco.texto.split('\n').slice(0, 2).join(' ').trim())
        }
        if (!bloco.texto.includes('req.contexto')) {
          semContexto.push(bloco.texto.split('\n').slice(0, 2).join(' ').trim())
        }
      }

      expect(semAutor).toEqual([])
      expect(semContexto).toEqual([])
    }
  )
})

describe('Rastreabilidade do orcamento - os controllers registram', () => {
  // O dashboard e 100% leitura; os demais controllers do modulo escrevem.
  const SOMENTE_LEITURA = new Set(['dashboard/dashboard_ctrl.js'])

  const arquivos = arquivosDeControlador(RAIZ).filter(
    f => !SOMENTE_LEITURA.has(path.relative(RAIZ, f).split(path.sep).join('/'))
  )

  it.each(arquivos.map(f => [path.relative(RAIZ, f), f]))(
    '%s importa o auditoria_ctrl e registra',
    (nome, arquivo) => {
      const fonte = fs.readFileSync(arquivo, 'utf8')

      expect(fonte).toContain("require('../../auditoria/auditoria_ctrl')")
      expect(fonte).toContain('auditoriaCtrl.registrar(')
    }
  )

  // Toda escrita abre transacao. Nao e so pela auditoria: uma exclusao que faca
  // quatro comandos em quatro conexoes deixa estado parcial se falhar no meio,
  // ou se outra requisicao entrar entre a checagem e o DELETE.
  it.each(arquivos.map(f => [path.relative(RAIZ, f), f]))(
    '%s nao escreve fora de transacao',
    (nome, arquivo) => {
      const fonte = fs.readFileSync(arquivo, 'utf8')

      // `db.conn.<metodo>(` com SQL de escrita e escrita SEM transacao: dentro
      // do `tx` o objeto e `t`, e nunca `db.conn`. O `\s*` antes do ponto cobre
      // a quebra de linha do encadeamento (`db.conn\n  .one(`), que e como o
      // modulo escreve quando ha um `.catch(tratarFk)` no fim.
      const foraDeTransacao = []
      const re = /db\.conn\s*\.\s*(one|oneOrNone|none|any|result)\(\s*[`'"]\s*(INSERT|UPDATE|DELETE)\b/gi
      let achado
      while ((achado = re.exec(fonte)) !== null) {
        foraDeTransacao.push(achado[0].replace(/\s+/g, ' ').trim())
      }

      expect(foraDeTransacao).toEqual([])
    }
  )
})
