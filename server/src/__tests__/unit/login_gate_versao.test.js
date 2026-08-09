'use strict'

// O GATE DE VERSAO do login: o cliente atrasado nao entra.
//
// O plugin do QGIS ESCREVE no banco pelas rotas de `/api/distribuicao`, e o
// contrato delas muda de versao para versao. Plugin velho grava atividade com
// contrato velho, e o estrago nao aparece no dia: aparece semanas depois, numa
// contagem de producao que nao fecha. Barrar no login e o unico momento em que
// ainda da para dizer "atualize" antes de o dado entrar.
//
// BANCO MOCKADO e `semver` DE VERDADE: o que este arquivo prova e a COMPARACAO
// de versao, e mockar o semver provaria a consulta.

const mockT = {
  oneOrNone: jest.fn(),
  any: jest.fn(),
  none: jest.fn()
}

const mockDb = {
  conn: {
    tx: jest.fn(fn => fn(mockT)),
    task: jest.fn(fn => fn(mockT)),
    oneOrNone: jest.fn()
  }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

// serialize-error e ESM-only e entra por import() dinamico; num teste unitario
// esse import pode resolver DEPOIS do teardown e derrubar o processo.
jest.mock('../../utils/serialize_error_loader', () => ({
  serialize: error => ({ message: error.message, stack: error.stack }),
  ready: Promise.resolve()
}))

const bcrypt = require('bcryptjs')
const ctrl = require('../../login/login_ctrl')

const { verificaQGIS, verificaPlugins, versaoAtende } = ctrl._gateDeVersao

beforeEach(() => jest.clearAllMocks())

// ---------------------------------------------------------------------------

describe('versaoAtende: a comparacao que decide', () => {
  it('aceita a versao igual ao minimo, e nao so a maior', () => {
    expect(versaoAtende('3.22.2', '3.22.2')).toBe(true)
  })

  it('aceita a versao maior', () => {
    expect(versaoAtende('3.28.0', '3.22.2')).toBe(true)
  })

  it('recusa a versao menor', () => {
    expect(versaoAtende('3.16.9', '3.22.2')).toBe(false)
  })

  // O QGIS reporta a versao com o nome da release colado ('3.22.2-Białowieża'),
  // e `1.5` sem o terceiro numero nao e semver valido. `semver.coerce` limpa os
  // dois, e e por isso que ele esta aqui em vez de um `split('.')`.
  it.each([
    ['3.22.2-Białowieża', '3.22.2'],
    ['3.28', '3.22.2'],
    ['v3.30.1', '3.22.2']
  ])('entende "%s" como versao', (informada, minima) => {
    expect(versaoAtende(informada, minima)).toBe(true)
  })

  // O SAP NAO TRATAVA ISTO: `semver.coerce` devolve null para o que nao
  // consegue ler, e `semver.gte` com null LANCA. Uma string estranha vinda do
  // cliente derrubava o login com 500 em vez de recusa-lo com 400. Aqui o
  // ilegivel conta como ATRASADO, que e o lado seguro: quem nao sabe dizer a
  // propria versao nao prova estar em dia.
  it.each([undefined, null, '', 'nenhuma', 'versao-de-teste'])(
    'trata a versao ilegivel (%p) como atrasada, e nao estoura',
    informada => {
      expect(() => versaoAtende(informada, '3.22.2')).not.toThrow()
      expect(versaoAtende(informada, '3.22.2')).toBe(false)
    }
  )

  // Sem minimo legivel nao ha o que cobrar: a coluna `versao_minima` e anulavel
  // nas duas tabelas.
  it.each([undefined, null, ''])('sem minimo (%p) nao cobra nada', minima => {
    expect(versaoAtende('1.0.0', minima)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('verificaQGIS', () => {
  it('deixa passar quem esta na versao minima', async () => {
    mockT.oneOrNone.mockResolvedValue({ versao_minima: '3.22.2' })
    await expect(verificaQGIS(mockT, '3.22.2')).resolves.toBeUndefined()
  })

  it('recusa quem esta atras, e a mensagem diz QUAL versao e precisa', async () => {
    mockT.oneOrNone.mockResolvedValue({ versao_minima: '3.22.2' })
    await expect(verificaQGIS(mockT, '3.10.0')).rejects.toThrow(
      'Versão incorreta do QGIS. A seguinte versão é necessária: 3.22.2'
    )
  })

  // Instalacao nova nasce sem a linha. Recusar todo mundo ate o administrador
  // cadastrar o minimo trancaria o sistema no primeiro dia.
  it('tabela vazia nao barra ninguem', async () => {
    mockT.oneOrNone.mockResolvedValue(null)
    await expect(verificaQGIS(mockT, undefined)).resolves.toBeUndefined()
  })

  // As tabelas do QGIS sairam de `dgeo` na travessia, porque no SCA `dgeo` e
  // GENTE: configuracao de ferramenta nao e gente.
  it('le qgis.versao_qgis, e nao a dgeo.versao_qgis do SAP', async () => {
    mockT.oneOrNone.mockResolvedValue({ versao_minima: '3.22.2' })
    await verificaQGIS(mockT, '3.22.2')

    expect(mockT.oneOrNone).toHaveBeenCalledWith(
      expect.stringContaining('qgis.versao_qgis')
    )
    expect(mockT.oneOrNone).not.toHaveBeenCalledWith(
      expect.stringContaining('dgeo.versao_qgis')
    )
  })
})

// ---------------------------------------------------------------------------

describe('verificaPlugins', () => {
  const EXIGIDOS = [
    { nome: 'sap', versao_minima: '2.3.0' },
    { nome: 'DSGTools', versao_minima: '4.5.0' }
  ]

  it('deixa passar quem tem os dois, na versao', async () => {
    mockT.any.mockResolvedValue(EXIGIDOS)
    await expect(
      verificaPlugins(mockT, [
        { nome: 'sap', versao: '2.3.0' },
        { nome: 'DSGTools', versao: '4.9.1' }
      ])
    ).resolves.toBeUndefined()
  })

  it('recusa quem tem um deles atrasado', async () => {
    mockT.any.mockResolvedValue(EXIGIDOS)
    await expect(
      verificaPlugins(mockT, [
        { nome: 'sap', versao: '2.2.0' },
        { nome: 'DSGTools', versao: '4.9.1' }
      ])
    ).rejects.toThrow(/Plugins desatualizados/)
  })

  // A LISTA CHEGA COM OS PLUGINS HABILITADOS: o QGIS nao reporta o plugin
  // instalado e DESLIGADO. Para o servidor, desligado e ausente e a mesma coisa
  // -- o cliente nao tem o que precisa --, e por isso a mensagem cita os tres
  // estados.
  it('plugin ausente (desinstalado ou desabilitado) e recusado', async () => {
    mockT.any.mockResolvedValue(EXIGIDOS)
    await expect(
      verificaPlugins(mockT, [{ nome: 'sap', versao: '2.3.0' }])
    ).rejects.toThrow(/não instalados ou desabilitados/)
  })

  it('lista vazia e recusada quando ha plugin exigido', async () => {
    mockT.any.mockResolvedValue(EXIGIDOS)
    await expect(verificaPlugins(mockT, [])).rejects.toThrow(/Plugins desatualizados/)
  })

  // A mensagem lista TODOS os exigidos, e nao so o que faltou: quem esta com
  // dois plugins atrasados descobriria um por vez, e cada descoberta custa um
  // ciclo de atualizar e tentar de novo.
  it('a mensagem lista todos os exigidos, com a versao de cada um', async () => {
    mockT.any.mockResolvedValue(EXIGIDOS)

    await expect(verificaPlugins(mockT, [])).rejects.toThrow(/sap - Versão: 2\.3\.0/)
    await expect(verificaPlugins(mockT, [])).rejects.toThrow(/DSGTools - Versão: 4\.5\.0/)
  })

  it('tabela vazia nao barra ninguem', async () => {
    mockT.any.mockResolvedValue([])
    await expect(verificaPlugins(mockT, undefined)).resolves.toBeUndefined()
  })

  // `qgis.plugin.versao_minima` e anulavel. Linha sem minimo exige PRESENCA e
  // nada mais -- e o SAP estourava 500 nesse caso, porque passava null direto
  // para o semver.
  it('plugin exigido sem versao minima cobra so a presenca', async () => {
    mockT.any.mockResolvedValue([{ nome: 'sap', versao_minima: null }])

    await expect(
      verificaPlugins(mockT, [{ nome: 'sap', versao: '0.0.1' }])
    ).resolves.toBeUndefined()

    await expect(verificaPlugins(mockT, [])).rejects.toThrow(/Plugins desatualizados/)
  })

  it('le qgis.plugin, e nao a dgeo.plugin do SAP', async () => {
    mockT.any.mockResolvedValue([])
    await verificaPlugins(mockT, [])

    expect(mockT.any).toHaveBeenCalledWith(expect.stringContaining('qgis.plugin'))
    expect(mockT.any).not.toHaveBeenCalledWith(expect.stringContaining('dgeo.plugin'))
  })
})

// ---------------------------------------------------------------------------
// O gate DENTRO do login, que e onde a regra de quem-vale mora
// ---------------------------------------------------------------------------

describe('O gate vale SO para o sap_fp', () => {
  const SENHA = 'senha-de-verdade'
  let HASH

  const MODULOS = [{ code: 7, nome: 'Produção', nome_abrev: 'producao' }]

  beforeAll(async () => {
    // Custo 4, e nao o 10 de producao: aqui o que se prova nao e o bcrypt.
    HASH = await bcrypt.hash(SENHA, 4)
  })

  // A transacao do login chama, em ordem: o usuario (oneOrNone), o gate (o QGIS
  // por oneOrNone e os plugins por any), os perfis (any), os modulos (any) e o
  // historico (none).
  const prepararBanco = ({ qgisMinimo, pluginsExigidos }) => {
    mockT.oneOrNone.mockReset()
    mockT.any.mockReset()
    mockT.none.mockReset()

    mockT.oneOrNone
      .mockResolvedValueOnce({ id: 7, uuid: 'uuid-7', administrador: false, senha: HASH })
      .mockResolvedValueOnce(qgisMinimo)

    mockT.any
      .mockResolvedValueOnce(pluginsExigidos)
      .mockResolvedValueOnce([{ modulo: 'producao', perfil_id: 2 }])
      .mockResolvedValueOnce(MODULOS)

    mockT.none.mockResolvedValue(undefined)
  }

  it('sap_fp com QGIS atrasado e recusado', async () => {
    prepararBanco({ qgisMinimo: { versao_minima: '3.22.2' }, pluginsExigidos: [] })

    await expect(
      ctrl.login('fulano', SENHA, 'sap_fp', [{ nome: 'sap', versao: '2.3.0' }], '3.10.0')
    ).rejects.toThrow('Versão incorreta do QGIS')
  })

  // SAP GERENTE PASSA DIRETO, e e deliberado -- era assim no SAP 2.3.5. O
  // 'sap_fp' e a PONTA DA PRODUCAO: e ele que executa a atividade e grava o
  // dado. O 'sap_fg' publica o catalogo do QGIS e distribui trabalho, e trava-lo
  // pela versao do plugin trancaria do lado de fora justamente quem PUBLICA a
  // versao nova.
  it('sap_fg com o MESMO QGIS atrasado entra', async () => {
    // Sem a ida ao gate, a segunda resposta de oneOrNone nao e consumida e o
    // primeiro `any` ja e o dos perfis.
    mockT.oneOrNone.mockReset()
    mockT.any.mockReset()
    mockT.none.mockReset()

    mockT.oneOrNone.mockResolvedValue({
      id: 7, uuid: 'uuid-7', administrador: false, senha: HASH
    })
    mockT.any
      .mockResolvedValueOnce([{ modulo: 'producao', perfil_id: 2 }])
      .mockResolvedValueOnce(MODULOS)
    mockT.none.mockResolvedValue(undefined)

    const dados = await ctrl.login(
      'fulano', SENHA, 'sap_fg', [{ nome: 'sap', versao: '0.0.1' }], '3.10.0'
    )

    expect(dados.token).toBeDefined()
    expect(dados.perfis).toEqual({ producao: 2 })
  })

  it('sap_fp em dia entra e o acesso e gravado com o cliente certo', async () => {
    prepararBanco({
      qgisMinimo: { versao_minima: '3.22.2' },
      pluginsExigidos: [{ nome: 'sap', versao_minima: '2.3.0' }]
    })

    const dados = await ctrl.login(
      'fulano', SENHA, 'sap_fp', [{ nome: 'sap', versao: '2.3.1' }], '3.28.0'
    )

    expect(dados.token).toBeDefined()
    expect(mockT.none).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO dgeo.login'),
      expect.objectContaining({ id: 7, cliente: 'sap_fp' })
    )
  })

  // O gate vem DEPOIS da senha, e a ordem e a do SAP: conferi-lo antes contaria
  // ao mundo qual e o QGIS minimo da Divisao e quais plugins ela exige, sem que
  // ninguem precisasse de conta.
  it('senha errada e recusada ANTES de o gate ler o banco', async () => {
    prepararBanco({ qgisMinimo: { versao_minima: '3.22.2' }, pluginsExigidos: [] })

    await expect(
      ctrl.login('fulano', 'errada', 'sap_fp', [], '1.0.0')
    ).rejects.toThrow('Usuário ou senha inválida')

    // So a busca do usuario. O minimo do QGIS nao chegou a ser lido.
    expect(mockT.oneOrNone).toHaveBeenCalledTimes(1)
    expect(mockT.any).not.toHaveBeenCalled()
  })

  it('sap_web entra sem passar pelo gate', async () => {
    mockT.oneOrNone.mockReset()
    mockT.any.mockReset()
    mockT.none.mockReset()

    mockT.oneOrNone.mockResolvedValue({
      id: 7, uuid: 'uuid-7', administrador: false, senha: HASH
    })
    mockT.any.mockResolvedValueOnce([]).mockResolvedValueOnce(MODULOS)
    mockT.none.mockResolvedValue(undefined)

    const dados = await ctrl.login('fulano', SENHA, 'sap_web')

    expect(dados.token).toBeDefined()
    expect(mockT.any).not.toHaveBeenCalledWith(expect.stringContaining('qgis.plugin'))
  })
})
