'use strict'

// PAUSAR TIRA O TRABALHO DA MAO, E TEM DE TIRAR O ACESSO JUNTO.
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE. Ate 2026-08-09 as operacoes da maquina de
// estado mexiam SO em `producao.atividade`: o gerente pausava a atividade de
// alguem justamente para tira-lo do trabalho, e a pessoa continuava com papel
// valido e escrita no banco de EDICAO. O SAP 2.3.5 nao tinha esse buraco --
// `gerencia_ctrl.js` chamava `resetPassword` em pausar, reiniciar e voltar.
//
// SAO TRES COISAS DE UMA VEZ, e nenhuma delas aparece num caso de sucesso:
//
//   1. A REVOGACAO ACONTECE, e com o par certo: a atividade encerrada e a pessoa
//      QUE A TINHA, e nao o gerente que clicou.
//   2. A FALHA DA REVOGACAO NAO DESFAZ A OPERACAO. A pausa esta gravada e
//      auditada; o que faltou foi fechar uma porta, e desfazer o ato do gerente
//      por causa de um servidor que nao e deste servico deixaria a folha rodando
//      na mao de quem ele quis tirar dela.
//   3. O HOST NAO VAZA. A mensagem do driver traz o endereco do banco de edicao,
//      e esta resposta vai para o cliente E para o log (`sendJsonAndLog` registra
//      o envelope). So `AppError` -- frase escrita por nos -- atravessa.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`: o `db.conn` e um
// duble que FORMATA cada consulta pelo caminho do driver de verdade, e o
// subsistema de permissao e substituido inteiro.

const { db } = require('../../../database')

const permissoes = require('../../../database/permissoes_producao')

const ctrl = require('../../../gerencia_producao/gerencia_producao_ctrl')

const { AppError, httpCode } = require('../../../utils')

const GERENTE = '3b241101-e2bb-4255-8caf-4136c566a962'
const OPERADOR = '16fd2706-8baf-433b-82eb-8c7fada847da'
const CONTEXTO = {
  origem: 'web',
  rota: 'POST /api/gerencia_producao/atividade/pausar',
  loteId: 5
}

// A LINHA CANONICA responde por qualquer SELECT do duble. `usuario_uuid` e o do
// OPERADOR, e nao o do gerente: e essa distincao que o primeiro caso mede.
const LINHA = {
  id: 7,
  code: 1,
  lote_id: 5,
  etapa_id: 11,
  unidade_trabalho_id: 13,
  usuario_uuid: OPERADOR,
  uuid: OPERADOR,
  login: 'fulano',
  nome: 'linha canônica',
  observacao: null,
  tipo_situacao_atividade_id: 2,
  disponivel: false,
  dificuldade: null,
  tempo_estimado_minutos: null,
  prioridade: 1
}

// As consultas de CONFERENCIA que precisam vir VAZIAS para a operacao chegar na
// escrita: a janela do fluxo em curso e as duas filas prioritarias. O criterio e
// o TEXTO, e nao a ordem da chamada.
const VAZIO = [
  'a_alvo.tipo_situacao_atividade_id IN',
  'FROM producao.fila_prioritaria AS fp',
  'FROM producao.fila_prioritaria_grupo AS fpg'
]

const fabricar = () => {
  const consultas = []

  const registrar = (query, values) => {
    // `as.format` E O MESMO CAMINHO DO DRIVER: ele lanca em parametro que falta.
    consultas.push(db.pgp.as.format(query, values))
  }

  const conn = {
    any: async (query, values) => {
      registrar(query, values)
      if (VAZIO.some(p => String(query).includes(p))) return []
      return [{ ...LINHA }]
    },
    one: async (query, values) => {
      registrar(query, values)
      return { ...LINHA }
    },
    oneOrNone: async (query, values) => {
      registrar(query, values)
      return { ...LINHA }
    },
    none: async (query, values) => {
      registrar(query, values)
      return null
    },
    tx: async cb => cb(conn),
    task: async cb => cb(conn)
  }

  return { consultas, conn }
}

let fabricado
let connOriginal
let revogarOriginal

beforeEach(() => {
  connOriginal = db.conn
  fabricado = fabricar()
  db.conn = fabricado.conn

  revogarOriginal = permissoes.revogarAcesso
})

afterEach(() => {
  db.conn = connOriginal
  permissoes.revogarAcesso = revogarOriginal
})

// O DUBLE DA REVOGACAO guarda o que recebeu e devolve o que o caso pedir.
const dublarRevogacao = resposta => {
  const chamadas = []
  permissoes.revogarAcesso = async pedido => {
    chamadas.push(pedido)
    if (typeof resposta === 'function') return resposta(pedido)
    return resposta
  }
  return chamadas
}

const REVOGOU = { login: 'sap_fulano', revogou: true }

describe('pausar revoga o acesso ao banco de edição', () => {
  it('chama a revogação com a atividade encerrada e com quem a tinha', async () => {
    const chamadas = dublarRevogacao(REVOGOU)

    await ctrl.pausaAtividade([13], GERENTE, CONTEXTO)

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].atividadeId).toBe(LINHA.id)
    // A PESSOA E O OPERADOR e quem pediu e o GERENTE. Trocar os dois revogaria o
    // acesso de quem clicou, e deixaria em pe o de quem estava trabalhando.
    expect(chamadas[0].usuarioUuid).toBe(OPERADOR)
    expect(chamadas[0].quemPediu).toBe(GERENTE)
    expect(chamadas[0].contexto).toBe(CONTEXTO)
  })

  it('diz que fechou quando fechou', async () => {
    dublarRevogacao(REVOGOU)

    await expect(ctrl.pausaAtividade([13], GERENTE, CONTEXTO)).resolves.toEqual({
      revogacao: { ok: true, revogadas: 1 }
    })
  })

  // O DADO DE PRODUCAO QUE NAO E PostGIS CONTROLADO nao tem acesso a revogar, e
  // a resposta nao fala do que nao existe: o envelope sai como sempre saiu.
  it('não fala do que não existe quando não havia acesso', async () => {
    dublarRevogacao(null)

    await expect(ctrl.pausaAtividade([13], GERENTE, CONTEXTO)).resolves.toBeNull()
  })

  // A PAUSA FICA DE PE. Este e o caso que mais importa: a atividade encerrada e
  // a pausada nova ja estao gravadas e auditadas quando a revogacao roda.
  it('a falha da revogação não desfaz a pausa, e volta na resposta', async () => {
    dublarRevogacao(() => {
      throw new AppError(
        'O banco de produção não respondeu',
        httpCode.ServiceUnavailable
      )
    })

    const r = await ctrl.pausaAtividade([13], GERENTE, CONTEXTO)

    expect(r.revogacao.ok).toBe(false)
    expect(r.revogacao.falhas).toEqual([
      { atividade_id: LINHA.id, mensagem: 'O banco de produção não respondeu' }
    ])
    expect(r.revogacao.providencia).toContain('pausadas')
    expect(r.revogacao.providencia).toContain('gerente')

    // A ESCRITA ACONTECEU: a atividade em execução virou 'Não finalizada', uma
    // pausada nasceu no lugar e o rastro das duas caiu em `auditoria.evento`.
    const escritas = fabricado.consultas.filter(q =>
      q.includes('INSERT INTO producao.atividade')
    )
    expect(escritas.length).toBeGreaterThan(0)
    expect(
      fabricado.consultas.filter(q => q.includes('INSERT INTO auditoria.evento')).length
    ).toBeGreaterThan(0)
  })

  // A MENSAGEM DO DRIVER TRAZ O HOST (`getaddrinfo ENOTFOUND ...`), e o envelope
  // vai para o cliente E para o log. So `AppError` atravessa.
  it('erro que não é AppError não vaza o endereço do banco de edição', async () => {
    dublarRevogacao(() => {
      throw new Error('getaddrinfo ENOTFOUND servidor_de_teste')
    })

    const r = await ctrl.pausaAtividade([13], GERENTE, CONTEXTO)

    const mensagem = r.revogacao.falhas[0].mensagem
    expect(mensagem).not.toContain('servidor_de_teste')
    expect(mensagem).not.toContain('ENOTFOUND')
    expect(mensagem).toContain('banco de produção')
    // E nem por outro campo do envelope: o texto inteiro é conferido.
    expect(JSON.stringify(r)).not.toContain('ENOTFOUND')
  })
})

describe('as outras operações da máquina de estado', () => {
  // REINICIAR REVOGA COM MAIS RAZAO QUE PAUSAR: a nova atividade nasce SEM DONO
  // e 'Não iniciada', e a folha volta para a fila. Quem a tinha deixou de ter
  // vinculo com ela.
  it('reiniciar revoga', async () => {
    const chamadas = dublarRevogacao(REVOGOU)

    await ctrl.reiniciaAtividade([13], GERENTE, CONTEXTO)

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].usuarioUuid).toBe(OPERADOR)
  })

  it('voltar para a etapa anterior revoga', async () => {
    const chamadas = dublarRevogacao(REVOGOU)

    await ctrl.voltaAtividade([7], true, GERENTE, CONTEXTO)

    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].usuarioUuid).toBe(OPERADOR)
  })

  // `disponivel = false` PAUSA O QUE ESTAVA EM EXECUCAO, e fecha a porta pelo
  // mesmo motivo que a pausa pedida a mao.
  it('tornar a unidade de trabalho indisponível revoga', async () => {
    const chamadas = dublarRevogacao(REVOGOU)

    await ctrl.unidadeTrabalhoDisponivel([13], false, GERENTE, CONTEXTO)

    expect(chamadas).toHaveLength(1)
  })

  // E O OUTRO LADO: devolver a unidade a distribuicao nao tira nada da mao de
  // ninguem, e por isso nao revoga nada.
  it('tornar a unidade de trabalho disponível não revoga', async () => {
    const chamadas = dublarRevogacao(REVOGOU)

    await expect(
      ctrl.unidadeTrabalhoDisponivel([13], true, GERENTE, CONTEXTO)
    ).resolves.toBeNull()
    expect(chamadas).toHaveLength(0)
  })

  // AVANCAR E A UNICA QUE NAO REVOGA, e a ausencia e deliberada: as recusas dela
  // garantem que nada em execucao, pausado ou em fila entra na janela, e o
  // UPDATE so alcanca o que estava 'Não iniciada'. Atividade que ninguem
  // executou nao teve papel criado.
  it('avançar não revoga', async () => {
    const chamadas = dublarRevogacao(REVOGOU)

    await ctrl.avancaAtividade([7], true, GERENTE, CONTEXTO)

    expect(chamadas).toHaveLength(0)
  })
})
