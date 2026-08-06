'use strict'

// As duas rotas de manutencao que o CLI nao conhecia.
//
// O acervo_client ja expunha as duas; o CLI, que e a ferramenta de manutencao
// SEM navegador, nao as tinha na registry. Uma sondagem das 84 operacoes em
// 06/08/2026 mediu essa como a unica lacuna do CLI contra o server/.
//
// O teste le a ROTA REAL do server/ (metodo, guard de acesso e ponto de
// montagem) e cobra que a registry case com ela. Nao ha caminho copiado a mao
// aqui: um caminho errado na registry reprova, e a rota que sair do server/
// reprova tambem, em vez de o teste passar sozinho.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { RECURSOS, RAIZ_SERVER, obterOperacao } = require('../lib/recursos')
const esquema = require('../lib/schema')
const { executar, formatar } = require('../comandos/api')

// O guard da rota no server/ e o `acesso` da registry falam a mesma coisa com
// nomes diferentes. Este e o unico ponto de traducao.
const GUARD = { verifyAdmin: 'admin' }

/** Le a declaracao da rota no arquivo de rota do server/. */
function declaracaoDeRota (arquivoRota, rota) {
  const texto = fs.readFileSync(path.join(RAIZ_SERVER, arquivoRota), 'utf8')
  const re = new RegExp(
    `router\\.(get|post|put|delete)\\(\\s*['"]${rota}['"]\\s*,\\s*(\\w+)`
  )
  const m = texto.match(re)
  return m ? { metodo: m[1].toUpperCase(), guard: m[2] } : null
}

/** Onde o routes.js monta o roteador daquele modulo (ex.: arquivo -> /arquivo). */
function montagemDe (moduloDir) {
  const texto = fs.readFileSync(path.join(RAIZ_SERVER, 'routes.js'), 'utf8')
  const imp = texto.match(
    new RegExp(`\\{\\s*(\\w+Route)\\s*\\}\\s*=\\s*require\\("\\./${moduloDir}"\\)`)
  )
  if (!imp) return null
  // O marcador `path-ok` da linha abaixo: o `\\.use\\(` dela e a regex que le o
  // `router.use(...)` do routes.js, e nao um caminho de rede. O guard
  // anti-vazamento le os dois iguais, e sem o marcador ele aborta o commit.
  const uso = texto.match(new RegExp(`router\\.use\\("([^"]+)",\\s*${imp[1]}\\)`)) // path-ok
  return uso ? uso[1] : null
}

const MANUTENCAO = [
  {
    recurso: 'acervo',
    acao: 'limpar-downloads-expirados',
    moduloDir: 'acervo',
    arquivoRota: 'acervo/acervo_route.js',
    rota: '/cleanup-expired-downloads',
    // A forma exata da resposta do controller, medida em 06/08/2026:
    // acervo_ctrl.cleanupExpiredDownloads devolve { fechados } e mais nada.
    resposta: { fechados: 3 }
  },
  {
    recurso: 'arquivo',
    acao: 'limpar-uploads-expirados',
    moduloDir: 'arquivo',
    arquivoRota: 'arquivo/arquivo_route.js',
    rota: '/cleanup-expired-uploads',
    // arquivo_ctrl.cleanupExpiredUploads devolve { fechadas, apagadas }, os dois
    // numeros vindos de SELECT ... FROM acervo.cleanup_expired_uploads().
    resposta: { fechadas: 2, apagadas: 5 }
  }
]

// Antes de cobrar a registry, prove que a fonte primaria existe. Sem isto o
// resto do arquivo viraria um teste que nao pode falhar no dia em que a rota
// sair do server/: ele so compararia registry com registry.
for (const alvo of MANUTENCAO) {
  test(`a rota ${alvo.rota} existe no server/ e e de administrador`, () => {
    const decl = declaracaoDeRota(alvo.arquivoRota, alvo.rota)
    assert.ok(decl, `${alvo.arquivoRota} nao declara ${alvo.rota}`)
    assert.strictEqual(decl.metodo, 'POST')
    assert.strictEqual(GUARD[decl.guard], 'admin', `guard inesperado: ${decl.guard}`)
  })

  test(`a registry conhece ${alvo.recurso} ${alvo.acao}`, () => {
    const { operacao } = obterOperacao(alvo.recurso, alvo.acao)
    const decl = declaracaoDeRota(alvo.arquivoRota, alvo.rota)
    const montagem = montagemDe(alvo.moduloDir)

    assert.ok(montagem, `routes.js nao monta o roteador de ${alvo.moduloDir}`)
    assert.strictEqual(operacao.metodo, decl.metodo)
    assert.strictEqual(operacao.caminho, montagem + alvo.rota)
    assert.strictEqual(operacao.acesso, GUARD[decl.guard])
  })

  test(`${alvo.acao} imprime os contadores, e nao so a mensagem do servidor`, () => {
    // A resposta e um OBJETO de contadores. Com envelope `mensagem` o CLI
    // devolveria a prosa do servidor e o numero medido se perderia: e o numero
    // que diz o que a operacao fez.
    const { operacao } = obterOperacao(alvo.recurso, alvo.acao)
    const texto = formatar(
      { message: 'concluido', dados: alvo.resposta },
      operacao,
      { formato: 'tsv' },
      []
    )
    for (const [campo, valor] of Object.entries(alvo.resposta)) {
      assert.ok(texto.includes(campo), `sumiu o contador ${campo}: ${texto}`)
      assert.ok(texto.includes(String(valor)), `sumiu o valor de ${campo}: ${texto}`)
    }
  })
}

// REGRESSAO da separacao de 06/08/2026. A limpeza de ENVIO pegava carona na
// rota de DOWNLOAD, e quem a procurasse pelo nome nao a achava.
test('a limpeza de envio mora no recurso arquivo, e nao no acervo', () => {
  const { operacao } = obterOperacao('arquivo', 'limpar-uploads-expirados')
  assert.ok(operacao.caminho.startsWith('/arquivo/'))

  for (const [acao, op] of Object.entries(RECURSOS.acervo.operacoes)) {
    assert.ok(
      !op.caminho.includes('cleanup-expired-uploads'),
      `acervo ${acao} ainda aponta a limpeza de envio`
    )
  }
})

// A operacao de limpeza nao leva corpo nem :param, entao o --confirmar nao tem
// identificador de onde sair: exigi-lo travaria a operacao para sempre. O aviso
// de destrutiva e o guardrail que sobra, e ele tem de aparecer ANTES do envio.
test('limpar-uploads-expirados avisa que APAGA, ja no --dry-run', async () => {
  const r = await executar(
    { _: ['arquivo', 'limpar-uploads-expirados'], flags: { 'dry-run': true } },
    null
  )
  const avisos = r.avisos.join(' ')

  assert.ok(/destrutiva/i.test(avisos), `sem aviso de destrutiva: ${avisos}`)
  assert.ok(avisos.includes('APAGA'), 'o aviso nao diz que apaga')
  assert.ok(avisos.includes('30 dias'), 'o aviso nao diz o prazo do apagar')
  assert.ok(r.texto.includes('POST /api/arquivo/cleanup-expired-uploads'))
})

test('o aviso de destrutiva tambem sai no contrato do `acervo schema`', () => {
  const texto = esquema.contrato('arquivo', RECURSOS.arquivo)
  assert.ok(
    texto.includes('operacao destrutiva:'),
    'o contrato imprime `pesado` e `confirmar`, mas engoliria `destrutivo`'
  )
  assert.ok(texto.includes('limpar-uploads-expirados'))
})

// O download expirado so muda de status: nada e apagado, e a distincao entre as
// duas limpezas tem de continuar visivel para quem le a registry.
test('a limpeza de download nao promete apagar nada', () => {
  const { operacao } = obterOperacao('acervo', 'limpar-downloads-expirados')
  assert.ok(operacao.destrutivo, 'mudar status sem volta tambem precisa de aviso')
  assert.ok(
    !/APAGA/.test(operacao.destrutivo),
    'esta rota so faz UPDATE de status; prometer apagar seria mentir'
  )
})
