'use strict'

// MICROCONTROLE: as 11 rotas, a guarda de cada uma, o contrato do corpo e o que
// acontece quando o banco da TELEMETRIA não está lá.
//
// RODA NO PACOTE `rapido`, e de propósito: nada aqui abre PostgreSQL. O
// `jest.config.js` decide o pacote LENDO O FONTE à procura dos auxiliares que
// abrem conexão, e este arquivo não usa nenhum.
//
// O QUE ELE PRENDE, e que nenhum teste funcional pegaria:
//
//   1. O RECORTE 5 e 6. Cinco rotas leem o banco PRINCIPAL e seis leem a
//      TELEMETRIA. É esse recorte que faz o serviço subir com a telemetria fora
//      do ar, e ele só existe enquanto ninguém puser um `db.microConn` nas
//      cinco. O caso abaixo prova que as cinco respondem com `db.microConn`
//      NULO.
//   2. O 503, e não 500. A telemetria é a única dependência OPCIONAL do sistema.
//      500 diria "este serviço quebrou" e mandaria abrir chamado contra o SAP
//      3.0, que é o lugar errado. E são DUAS frases: "não configurado" manda
//      configurar, "fora do ar" manda olhar o servidor.
//   3. A GUARDA ROTA A ROTA, com o SEGUNDO ARGUMENTO. O default de
//      `verifyPerfil` é 'acervo': uma rota daqui que o esquecesse cobraria
//      perfil no acervo, sem erro de sintaxe e sem nada na tela. A pasta é
//      `microcontrole` e o módulo é `producao`.
//   4. QUE `usuario_uuid` NÃO ESTÁ NO CORPO das duas rotas de escrita. Ele vem
//      do TOKEN, e aceitá-lo no corpo deixaria qualquer operador lançar
//      telemetria em nome de outro.

const { recusaPor, aceita } = require('../helpers/joi')

const microcontroleSchema = require('../../microcontrole/microcontrole_schema')

// O DUBLÊ DE `verifyPerfil` NÃO AUTORIZA NADA: ele carimba no middleware o par
// (nível, módulo) com que foi chamado, para o caso da guarda poder lê-lo do
// `router.stack`. Quem barra escrita continua sendo o `verifyPerfil` de verdade,
// que lê o banco a cada requisição.
jest.mock('../../login', () => ({
  verifyPerfil: (nivel, modulo) => {
    const guarda = (req, res, next) => next()
    guarda.perfilExigido = { nivel, modulo }
    return guarda
  }
}))

// O BANCO DA TELEMETRIA NÃO EXISTE NESTE TESTE, e é justamente o estado que
// interessa: `microConn: null` é o que uma instalação sem as chaves `MICRO_DB_*`
// tem em produção.
//
// O PREFIXO `mock` NÃO É ESTILO: a fábrica do `jest.mock` é içada para o topo do
// arquivo, e o Jest recusa referência a variável de fora do escopo dela --
// exceto quando o nome começa por `mock`, que é a permissão explícita dele para
// o dublê declarado à parte.
const mockConn = {
  any: jest.fn().mockResolvedValue([]),
  one: jest.fn(),
  none: jest.fn(),
  tx: jest.fn()
}

jest.mock('../../database', () => ({
  db: {
    conn: mockConn,
    microConn: null,
    pgp: { helpers: {}, as: {} }
  }
}))

const { db } = require('../../database')
const microcontroleCtrl = require('../../microcontrole/microcontrole_ctrl')
const microcontroleRoute = require('../../microcontrole/microcontrole_route')

const { httpCode } = require('../../utils')

// ---------------------------------------------------------------------------
// 1. AS 11 ROTAS, LIDAS DO ROUTER MONTADO
// ---------------------------------------------------------------------------

const rotasMontadas = () =>
  microcontroleRoute.stack
    .filter(camada => camada.route)
    .flatMap(camada => {
      const guarda = camada.route.stack
        .map(m => m.handle && m.handle.perfilExigido)
        .find(Boolean)

      return Object.keys(camada.route.methods).map(metodo => ({
        metodo: metodo.toUpperCase(),
        caminho: camada.route.path,
        guarda
      }))
    })

// O RECORTE, e ele é o contrato deste módulo. `banco` diz de onde a rota lê, e
// não é decoração: é o que decide se ela cai junto com a telemetria.
const ESPERADAS = [
  { metodo: 'GET', caminho: '/tipo_monitoramento', nivel: 'consulta', banco: 'principal' },
  { metodo: 'GET', caminho: '/tipo_operacao', nivel: 'consulta', banco: 'telemetria' },
  { metodo: 'POST', caminho: '/feicao', nivel: 'operador', banco: 'telemetria' },
  { metodo: 'POST', caminho: '/tela', nivel: 'operador', banco: 'telemetria' },
  { metodo: 'GET', caminho: '/feicao/resumo', nivel: 'consulta', banco: 'telemetria' },
  { metodo: 'GET', caminho: '/tela/cobertura', nivel: 'consulta', banco: 'telemetria' },
  { metodo: 'GET', caminho: '/tela/aproveitamento', nivel: 'consulta', banco: 'telemetria' },
  { metodo: 'GET', caminho: '/configuracao/perfil_monitoramento', nivel: 'consulta', banco: 'principal' },
  { metodo: 'DELETE', caminho: '/configuracao/perfil_monitoramento', nivel: 'gerente', banco: 'principal' },
  { metodo: 'POST', caminho: '/configuracao/perfil_monitoramento', nivel: 'gerente', banco: 'principal' },
  { metodo: 'PUT', caminho: '/configuracao/perfil_monitoramento', nivel: 'gerente', banco: 'principal' }
]

describe('microcontrole: as 11 rotas e a guarda de cada uma', () => {
  it('declara exatamente as 11 rotas, e nenhuma a mais', () => {
    const montadas = rotasMontadas().map(r => `${r.metodo} ${r.caminho}`).sort()
    const esperadas = ESPERADAS.map(r => `${r.metodo} ${r.caminho}`).sort()
    expect(montadas).toEqual(esperadas)
  })

  it.each(ESPERADAS.map(r => [`${r.metodo} ${r.caminho}`, r]))(
    '%s cobra o nível certo NO MÓDULO producao',
    (_nome, esperada) => {
      const rota = rotasMontadas().find(
        r => r.metodo === esperada.metodo && r.caminho === esperada.caminho
      )
      expect(rota).toBeDefined()
      // O SEGUNDO ARGUMENTO EXPLÍCITO. Sem ele o default 'acervo' entraria, e a
      // rota passaria a cobrar perfil no módulo errado, em silêncio.
      expect(rota.guarda).toEqual({ nivel: esperada.nivel, modulo: 'producao' })
    }
  )

  // O RECORTE MUDOU EM 2026-08-09, por decisão do chefe: no módulo `producao` o
  // VISUALIZADOR vê TUDO, e não é um operador rebaixado -- ele é quem acompanha
  // a produção de cima. As SEIS rotas de LEITURA baixaram de `gerente` para
  // `consulta` para acompanhar; as TRÊS de escrita do perfil de monitoramento
  // continuam em `gerente`.
  //
  // O QUE ISSO ALARGA, e está escrito aqui de propósito: a telemetria mede
  // rendimento de pessoa COM NOME. Quem tem consulta em `producao` passa a ver
  // isso da Divisão inteira. Reverter é trocar `consulta` por `gerente` nas seis
  // linhas acima e nas seis guardas do router.
  //
  // AS DUAS DE ESCRITA SÃO DE OPERADOR. Cobrar
  // gerente nas duas desligaria a medição de todo mundo que ela existe para
  // medir: quem lança é o PLUGIN, em nome de quem está com a atividade na mão.
  it('só POST /feicao e POST /tela são de operador', () => {
    const operador = rotasMontadas()
      .filter(r => r.guarda.nivel === 'operador')
      .map(r => `${r.metodo} ${r.caminho}`)
      .sort()
    expect(operador).toEqual(['POST /feicao', 'POST /tela'])
  })
})

// ---------------------------------------------------------------------------
// 2. O BANCO DA TELEMETRIA QUE NÃO ESTÁ LÁ
// ---------------------------------------------------------------------------

describe('microcontrole: sem o banco da telemetria', () => {
  beforeEach(() => {
    db.microConn = null
    mockConn.any.mockClear().mockResolvedValue([])
  })

  // AS CINCO DO BANCO PRINCIPAL RESPONDEM, e é o ponto inteiro do desenho: quem
  // quer LIGAR o monitoramento de um lote consegue fazer isso hoje, e as
  // amostras começam a entrar quando o outro banco voltar.
  it('as leituras do banco principal continuam respondendo', async () => {
    await expect(microcontroleCtrl.getTipoMonitoramento()).resolves.toEqual([])
    await expect(microcontroleCtrl.getPerfilMonitoramento()).resolves.toEqual([])
    expect(mockConn.any).toHaveBeenCalledTimes(2)
  })

  const SEIS_DA_TELEMETRIA = [
    ['getTipoOperacao', () => microcontroleCtrl.getTipoOperacao()],
    ['armazenaFeicao', () => microcontroleCtrl.armazenaFeicao(1, 'uuid', [])],
    ['armazenaTela', () => microcontroleCtrl.armazenaTela(1, 'uuid', [])],
    ['getResumoFeicao', () => microcontroleCtrl.getResumoFeicao(null, null, null)],
    ['getCoberturaTela', () => microcontroleCtrl.getCoberturaTela(null, null, null, null)],
    ['getAproveitamentoTela', () => microcontroleCtrl.getAproveitamentoTela('uuid', null, null)]
  ]

  // AS DUAS DE ESCRITA TAMBÉM, e elas provam algo a mais: o dublê de `pgp` deste
  // arquivo NÃO TEM `helpers.ColumnSet`. Se a montagem da consulta acontecesse
  // antes da conferência da conexão, elas estourariam com `TypeError` em vez de
  // responder 503 -- e o plugin jogaria fora o trabalho de formatar uma rajada
  // inteira toda vez que a telemetria estivesse fora do ar.
  it.each(SEIS_DA_TELEMETRIA)('%s responde 503, e não 500', async (_nome, chamar) => {
    await expect(chamar()).rejects.toMatchObject({
      statusCode: httpCode.ServiceUnavailable
    })
  })

  it('a frase de "não configurado" manda configurar, e não olhar o servidor', async () => {
    await expect(microcontroleCtrl.getTipoOperacao()).rejects.toThrow(
      /não está configurada nesta instalação/
    )
  })
})

describe('microcontrole: com o banco da telemetria fora do ar', () => {
  afterEach(() => {
    db.microConn = null
  })

  // O ERRO DE CONEXÃO VIRA 503 COM OUTRA FRASE. Distinguir os dois estados é o
  // que decide para onde quem lê vai: configurar as chaves, ou procurar quem
  // cuida do servidor.
  it('traduz o erro de conexão para 503, com a frase do servidor mudo', async () => {
    const recusa = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED'
    })
    db.microConn = { any: jest.fn().mockRejectedValue(recusa) }

    await expect(microcontroleCtrl.getTipoOperacao()).rejects.toMatchObject({
      statusCode: httpCode.ServiceUnavailable
    })
    await expect(microcontroleCtrl.getTipoOperacao()).rejects.toThrow(
      /não respondeu/
    )
  })

  // ERRO DE CONSULTA CONTINUA SENDO 500, e a distinção não é detalhe: coluna
  // inexistente é defeito NOSSO, e transformá-lo em 503 mandaria quem opera
  // reiniciar um servidor que está perfeitamente de pé.
  it('NÃO traduz erro de consulta: coluna inexistente continua sendo 500', async () => {
    const erroDeSintaxe = Object.assign(new Error('column "xpto" does not exist'), {
      code: '42703'
    })
    db.microConn = { any: jest.fn().mockRejectedValue(erroDeSintaxe) }

    await expect(microcontroleCtrl.getTipoOperacao()).rejects.toThrow(
      /column "xpto" does not exist/
    )
  })
})

// ---------------------------------------------------------------------------
// 3. O CONTRATO DO CORPO
// ---------------------------------------------------------------------------

const feicaoValida = () => ({
  atividade_id: 12,
  dados: [
    {
      tipo_operacao_id: 1,
      quantidade: 4,
      comprimento: 120.5,
      vertices: 33,
      camada: 'edicao.via_deslocamento'
    }
  ]
})

describe('microcontrole_schema: a telemetria de feição', () => {
  it('aceita um envio bem formado', () => {
    expect(aceita(microcontroleSchema.feicao.validate(feicaoValida())).dados).toHaveLength(1)
  })

  // COMPRIMENTO E VÉRTICES SÓ NA INSERÇÃO. Apagar uma feição não tem comprimento
  // a medir, e alterar atributo não mexe na geometria: nas outras três operações
  // o controlador grava 0, pelo `def` do ColumnSet, e as colunas são NOT NULL.
  it('exige comprimento e vértices na INSERÇÃO', () => {
    const corpo = feicaoValida()
    delete corpo.dados[0].comprimento
    recusaPor(microcontroleSchema.feicao.validate(corpo), 'dados.0.comprimento', 'any.required')
  })

  it('dispensa comprimento e vértices na EXCLUSÃO', () => {
    aceita(microcontroleSchema.feicao.validate({
      atividade_id: 12,
      dados: [{ tipo_operacao_id: 2, quantidade: 1, camada: 'edicao.via_deslocamento' }]
    }))
  })

  // A AUTORIA VEM DO TOKEN, e nunca do corpo. É a única coisa que impede um
  // operador de lançar telemetria em nome de outro, e por isso a chave nem
  // existe no schema: o validador da rota é o ESTRITO, e chave desconhecida vira
  // 400 em vez de ser descartada em silêncio.
  it('recusa usuario_uuid no corpo: a autoria sai do token', () => {
    recusaPor(
      microcontroleSchema.feicao.validate({
        ...feicaoValida(),
        usuario_uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      }),
      'usuario_uuid',
      'object.unknown'
    )
  })

  it('recusa o envio vazio: rajada de nada é engano de quem chamou', () => {
    recusaPor(
      microcontroleSchema.feicao.validate({ atividade_id: 12, dados: [] }),
      'dados',
      'array.min'
    )
  })

  it('recusa o número que vem como texto, em vez de convertê-lo', () => {
    recusaPor(
      microcontroleSchema.feicao.validate({ ...feicaoValida(), atividade_id: '12' }),
      'atividade_id',
      'number.base'
    )
  })
})

describe('microcontrole_schema: a telemetria de tela', () => {
  const telaValida = () => ({
    atividade_id: 12,
    dados: [
      {
        data: '2026-08-09T10:00:00-03:00',
        x_min: -43.5, x_max: -43.4, y_min: -22.9, y_max: -22.8,
        zoom: 5000
      }
    ]
  })

  it('aceita um envio bem formado', () => {
    expect(aceita(microcontroleSchema.tela.validate(telaValida())).dados).toHaveLength(1)
  })

  // OS QUATRO CANTOS SÃO OBRIGATÓRIOS: o controlador monta a envelope com
  // `ST_MakeEnvelope`, e um canto faltando produziria uma geometria que o
  // Postgres recusa DEPOIS, com um erro que não diz o que houve.
  it.each(['x_min', 'x_max', 'y_min', 'y_max'])('exige %s', (canto) => {
    const corpo = telaValida()
    delete corpo.dados[0][canto]
    recusaPor(microcontroleSchema.tela.validate(corpo), `dados.0.${canto}`, 'any.required')
  })

  it('recusa usuario_uuid no corpo: a autoria sai do token', () => {
    recusaPor(
      microcontroleSchema.tela.validate({
        ...telaValida(),
        usuario_uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
      }),
      'usuario_uuid',
      'object.unknown'
    )
  })
})

describe('microcontrole_schema: o perfil de monitoramento', () => {
  const perfilValido = () => ({
    subfase_id: 7,
    lote_id: 12,
    tipo_monitoramento_id: 1
  })

  it('aceita um POST bem formado', () => {
    expect(
      aceita(microcontroleSchema.perfilMonitoramento.validate({
        perfis_monitoramento: [perfilValido()]
      })).perfis_monitoramento
    ).toHaveLength(1)
  })

  it('exige lote_id: o perfil é sempre de uma subfase DE UM LOTE', () => {
    const { lote_id: _ignorado, ...semLote } = perfilValido()
    recusaPor(
      microcontroleSchema.perfilMonitoramento.validate({ perfis_monitoramento: [semLote] }),
      'perfis_monitoramento.0.lote_id',
      'any.required'
    )
  })

  it('o PUT exige o id de cada linha', () => {
    recusaPor(
      microcontroleSchema.perfilMonitoramentoAtualizacao.validate({
        perfis_monitoramento: [perfilValido()]
      }),
      'perfis_monitoramento.0.id',
      'any.required'
    )
  })

  // O DELETE RECEBE OS IDS NO CORPO, e não no caminho: é o contrato do SAP
  // Gerente, que apaga em massa. O `.unique()` existe porque o mesmo id duas
  // vezes faria a segunda passada não achar a linha e responder 404 sobre algo
  // que acabou de ser apagado com sucesso.
  it('o DELETE recusa o mesmo id duas vezes no mesmo corpo', () => {
    recusaPor(
      microcontroleSchema.perfilMonitoramentoIds.validate({
        perfis_monitoramento_ids: [3, 3]
      }),
      'perfis_monitoramento_ids.1',
      'array.unique'
    )
  })
})

describe('microcontrole_schema: os filtros das leituras agregadas', () => {
  // SEM `.strict()` NOS NÚMEROS DE QUERY, ao contrário do corpo. `req.query`
  // chega SEMPRE como string: com `.strict()` o Joi recusaria a coerção e todo
  // filtro numérico responderia 400.
  it('aceita o lote como texto, porque req.query é sempre texto', () => {
    expect(aceita(microcontroleSchema.resumoFeicaoQuery.validate({ lote_id: '12' })).lote_id)
      .toBe(12)
  })

  it('aceita filtro vazio: sem lote e sem período o servidor usa 30 dias', () => {
    aceita(microcontroleSchema.resumoFeicaoQuery.validate({}))
  })

  // O UUID, e não um id inteiro: a identidade da casa é `dgeo.usuario.uuid`, e é
  // ele que a telemetria grava -- sem chave estrangeira entre bancos, o TIPO é a
  // única coisa que impede gravar o identificador errado.
  it('o aproveitamento EXIGE o operador, e como UUID', () => {
    recusaPor(
      microcontroleSchema.aproveitamentoTelaQuery.validate({}),
      'usuario_uuid',
      'any.required'
    )
    recusaPor(
      microcontroleSchema.aproveitamentoTelaQuery.validate({ usuario_uuid: '42' }),
      'usuario_uuid',
      'string.guid'
    )
  })

  it('a cobertura aceita o operador, e não o exige', () => {
    aceita(microcontroleSchema.coberturaTelaQuery.validate({}))
    aceita(microcontroleSchema.coberturaTelaQuery.validate({
      usuario_uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'
    }))
  })
})
