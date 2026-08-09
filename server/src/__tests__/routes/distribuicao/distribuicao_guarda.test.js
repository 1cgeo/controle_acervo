'use strict'

// A GUARDA DAS OITO ROTAS DE `/api/distribuicao`, lida do FONTE.
//
// `__tests__/routes/modulo_em_toda_rota.test.js` ja varre `orcamento`,
// `mapoteca`, `equipamento` e `campo` cobrando o segundo argumento do
// `verifyPerfil`. Este arquivo faz o mesmo para a distribuicao e cobra mais uma
// coisa que aquele nao cobra: que TODA rota tenha guarda. Um `router.get` sem
// middleware nenhum nao aparece na varredura de `verifyPerfil` -- ele some, e
// esse era o estado de `/plugin_path` no SAP 2.3.5, que respondia sem token.
//
// E varredura de texto de proposito: ela cobre a rota que ninguem lembrou de
// testar, e a rota nova de amanha.

const fs = require('fs')
const path = require('path')

const ROTA = path.resolve(
  __dirname, '..', '..', '..', 'distribuicao', 'distribuicao_route.js'
)

// Mesma limpeza de `modulo_em_toda_rota.test.js`, e pelo mesmo motivo: o
// cabecalho deste arquivo de rota CITA `verifyLogin` para explicar o que o SAP
// fazia, e uma varredura crua reprovaria por causa da prosa. O `\r` cai primeiro
// porque com `core.autocrlf` ligado o fonte chega em CRLF e o `.` do JavaScript
// nao casa `\r`.
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const fonte = semComentario(fs.readFileSync(ROTA, 'utf8'))

// `router.get('/verifica',` -> ['get', '/verifica']
const DECLARACAO = /router\.(get|post|put|delete)\(\s*'([^']+)'\s*,([\s\S]*?)\n\)/g

const declaradas = [...fonte.matchAll(DECLARACAO)].map(m => ({
  metodo: m[1],
  caminho: m[2],
  corpo: m[3]
}))

// AS OITO, pelo nome. A lista e explicita para a rota que sumir aparecer aqui, e
// nao so no piso de contagem.
const AS_OITO = [
  ['get', '/verifica'],
  ['post', '/inicia'],
  ['post', '/finaliza'],
  ['post', '/problema_atividade'],
  ['post', '/finalizacao_incorreta'],
  ['post', '/metadados_edicao'],
  ['get', '/tipo_problema'],
  ['get', '/plugin_path']
]

describe('As oito rotas de /api/distribuicao', () => {
  it('estao todas declaradas, e nao ha nenhuma a mais', () => {
    expect(declaradas.map(d => [d.metodo, d.caminho]).sort())
      .toEqual([...AS_OITO].sort())
  })

  // O default de `verifyPerfil` e 'acervo'. Uma rota daqui que esquecesse o
  // segundo argumento passaria a cobrar perfil no ACERVO: sem erro de sintaxe,
  // sem teste vermelho e sem nada na tela.
  it.each(AS_OITO)(
    '%s %s cobra verifyPerfil com o modulo producao EXPLICITO',
    (metodo, caminho) => {
      const rota = declaradas.find(d => d.metodo === metodo && d.caminho === caminho)
      expect(rota).toBeDefined()
      expect(rota.corpo).toMatch(/verifyPerfil\(\s*'operador'\s*,\s*'producao'\s*\)/)
    }
  )

  // O SAP deixava `/plugin_path` sem guarda nenhuma, e ela devolve uma pasta de
  // rede da instalacao. Uma rota sem middleware nao aparece na varredura de
  // `verifyPerfil` acima: ela simplesmente nao esta la.
  it('nenhuma rota fica sem guarda', () => {
    const semGuarda = declaradas
      .filter(d => !/verifyPerfil\(/.test(d.corpo))
      .map(d => `${d.metodo.toUpperCase()} ${d.caminho}`)

    expect(semGuarda).toEqual([])
  })

  // A porta larga do token na query string existe para as camadas MVT, e nao ha
  // tile nenhum aqui.
  it('nenhuma rota usa a guarda de tile', () => {
    expect(fonte).not.toMatch(/verifyLoginTile/)
  })

  // O corpo de toda rota que ESCREVE passa pelo Joi antes do controller. Sem
  // isso, `atividade_id` chegaria como texto ao SQL.
  it.each([
    ['post', '/finaliza'],
    ['post', '/problema_atividade'],
    ['post', '/finalizacao_incorreta'],
    ['post', '/metadados_edicao']
  ])('%s %s valida o corpo com o Joi', (metodo, caminho) => {
    const rota = declaradas.find(d => d.metodo === metodo && d.caminho === caminho)
    expect(rota.corpo).toMatch(/schemaValidation\(\{\s*body:/)
  })
})
