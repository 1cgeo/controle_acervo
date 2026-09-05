'use strict'

// A ORIGEM DO RASTRO: de qual PORTA a mudanca entrou.
//
// REGRESSAO QUE ESTE ARQUIVO FECHA. O mapa `ORIGEM_POR_CLIENTE` conhecia so os
// tres nomes anteriores a renomeacao de 2026-08-09 ('sca_web', 'sca_qgis',
// 'sca_cli'), enquanto o Joi do login passou a aceitar 'sap_web', 'sap_fp' e
// 'sap_fg'. O fallback gravava o nome CRU do cliente, entao o mesmo trabalho
// pela mesma porta entrava no rastro com dois rotulos ('qgis' pelo plugin
// antigo, 'sap_fp' pelo novo). O combo da tela de rastreabilidade sai de um
// `SELECT DISTINCT origem`: ela ofereceria as duas, e filtrar por uma esconderia
// metade dos eventos -- sem erro nenhum.
//
// Nao toca o banco: `montarContexto` e uma funcao pura sobre `req` e o payload.

const { montarContexto, ORIGEM_POR_CLIENTE } = require('../../../login/contexto')
const loginSchema = require('../../../login/login_schema')

// A lista de clientes aceitos NAO e copiada: sai do `.valid()` do proprio schema,
// pela mesma razao que o `acervo_cli` a le de la. Copiar aqui faria o teste
// passar no dia em que o schema ganhasse um cliente novo sem mapa de origem.
const clientesAceitos = () => {
  const descricao = loginSchema.login.describe()
  const permitidos = (descricao.keys.cliente && descricao.keys.cliente.allow) || []
  return permitidos.filter(v => typeof v === 'string')
}

const requisicao = (over = {}) => ({
  method: 'POST',
  baseUrl: '/api/produtos',
  path: '/versao',
  route: { path: '/versao' },
  ...over
})

describe('ORIGEM_POR_CLIENTE cobre TODO cliente que o login aceita', () => {
  it('nenhum cliente do Joi fica sem porta declarada', () => {
    const semMapa = clientesAceitos().filter(c => !(c in ORIGEM_POR_CLIENTE))

    expect(semMapa).toEqual([])
  })

  it('a porta e uma das tres, e nunca o nome do cliente', () => {
    // web, qgis e cli. `sistema` existe como origem, mas nao SAI DAQUI: quem a
    // grava e o `registrarOperacao`, e nao login nenhum -- por isso ela nao
    // entra na assercao. Um valor fora daqui quer dizer que o nome cru vazou.
    for (const [cliente, origem] of Object.entries(ORIGEM_POR_CLIENTE)) {
      expect(['web', 'qgis', 'cli']).toContain(origem)
      expect(origem).not.toBe(cliente)
    }
  })
})

describe('montarContexto', () => {
  it.each([
    ['sca_web', 'web'],
    ['sap_web', 'web'],
    ['sca_qgis', 'qgis'],
    ['sap_fp', 'qgis'],
    ['sap_fg', 'qgis']
  ])('%s entra no rastro como %s', (cliente, esperado) => {
    const req = requisicao()
    montarContexto(req, { uuid: 'u', cliente })

    expect(req.contexto.origem).toBe(esperado)
  })

  it('os DOIS plugins do QGIS caem na MESMA origem', () => {
    // A pergunta da coluna e "por qual porta", e nao "qual dos dois plugins".
    const operador = requisicao()
    const gerente = requisicao()
    montarContexto(operador, { cliente: 'sap_fp' })
    montarContexto(gerente, { cliente: 'sap_fg' })

    expect(operador.contexto.origem).toBe(gerente.contexto.origem)
  })

  it('token sem `cliente` vira desconhecido, e nao um palpite', () => {
    const req = requisicao()
    montarContexto(req, { uuid: 'u' })

    expect(req.contexto.origem).toBe('desconhecido')
  })

  it('a rota e o PADRAO da rota, e nao a URL com os ids dentro', () => {
    const req = requisicao({ method: 'PUT', baseUrl: '/api/mapoteca', route: { path: '/pedido/:id' } })
    montarContexto(req, { cliente: 'sap_web' })

    expect(req.contexto.rota).toBe('PUT /api/mapoteca/pedido/:id')
  })

  it('o lote e UM por requisicao, e duas requisicoes nao o compartilham', () => {
    const primeira = requisicao()
    const segunda = requisicao()
    montarContexto(primeira, { cliente: 'sap_web' })
    montarContexto(segunda, { cliente: 'sap_web' })

    expect(primeira.contexto.loteId).toEqual(expect.any(String))
    expect(primeira.contexto.loteId).not.toBe(segunda.contexto.loteId)
  })
})
