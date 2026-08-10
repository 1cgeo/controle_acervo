'use strict'

// COPIAR CONFIGURACAO ENTRE LOTES DE LINHAS DE PRODUCAO DIFERENTES E RECUSADO.
//
// O DEFEITO QUE ISTO PRENDE. `POST /api/producao/configuracao/lote/copiar` leva
// as doze tabelas de perfil de um lote para outro, e cada linha delas e (alguma
// coisa, `subfase_id`, `lote_id`). O SAP 2.3.5 exigia que os dois lotes fossem da
// MESMA linha de producao; aqui a trava se perdeu na travessia, e o comentario do
// controlador prometia que a incompatibilidade viraria "erro de chave estrangeira
// na subfase". NAO VIRA: a copia leva `o.subfase_id` verbatim, o id continua
// existindo em `producao.subfase` e a chave estrangeira fica satisfeita. O
// resultado eram dezenas de perfis apontando subfases de outra linha, que sessao
// nenhuma do QGIS le, e a tela dizendo "copiado com sucesso".
//
// COMO A TRAVA VOLTOU. `acervo.lote` NAO tem linha de producao e nao vai ter (a
// decisao do chefe de 2026-08-09 reconheceu que um lote atravessa linhas). A
// linha de um lote e DERIVADA das etapas dele, e a cobranca e sobre o que vai ser
// copiado: toda subfase da configuracao da ORIGEM tem de pertencer a uma linha
// que o DESTINO executa.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const { db } = require('../../../database')

const ctrl = require('../../../producao/perfil_ctrl')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONTEXTO = {
  origem: 'web',
  rota: 'POST /api/producao/configuracao/lote/copiar',
  loteId: 2
}

const CORPO = extra => ({
  lote_id_origem: 1,
  lote_id_destino: 2,
  copiar_estilo: true,
  copiar_menu: true,
  copiar_regra: false,
  copiar_modelo: false,
  copiar_workflow: false,
  copiar_alias: false,
  copiar_linhagem: false,
  copiar_finalizacao: false,
  copiar_tema: false,
  copiar_fme: false,
  copiar_configuracao_qgis: false,
  copiar_monitoramento: false,
  ...extra
})

// AS SUBFASES QUE O DESTINO NAO EXECUTA, como a consulta da trava as devolve.
const ESTRANHAS = [
  { linha_producao: 'Carta Topográfica', subfase: 'Edição' },
  { linha_producao: 'Carta Topográfica', subfase: 'Validação' }
]

/**
 * O duble responde por TEXTO da consulta, e nao por ordem: ordem quebra a cada
 * linha nova no controlador.
 *
 *   `FROM acervo.lote`      a existencia dos dois lotes
 *   `AS copiada`            a trava: as subfases de linha estranha ao destino
 *   `producao.etapa AS e `  as linhas que o destino executa (so no caminho da
 *                           recusa, e so para escolher a frase)
 */
const fabricar = ({ estranhas = [], linhasDoDestino = [{ linha_producao_id: 2 }] } = {}) => {
  const consultas = []

  const any = async (query, values) => {
    const texto = db.pgp.as.format(query, values)
    consultas.push(texto)

    if (texto.includes('FROM acervo.lote')) return [{ id: 1 }, { id: 2 }]
    if (texto.includes('AS copiada')) return estranhas
    if (/producao\.etapa AS e\s/.test(texto)) return linhasDoDestino
    // O INSERT ... RETURNING * da copia: nenhuma linha copiada, para o rastro
    // nao entrar no caminho e o alvo do teste ficar sozinho.
    return []
  }

  const conn = {
    any,
    one: async (query, values) => {
      consultas.push(db.pgp.as.format(query, values))
      return {}
    },
    oneOrNone: async (query, values) => {
      consultas.push(db.pgp.as.format(query, values))
      return null
    },
    none: async (query, values) => {
      consultas.push(db.pgp.as.format(query, values))
      return null
    },
    tx: async cb => cb(conn),
    task: async cb => cb(conn)
  }

  return { consultas, conn }
}

let fabricado
let connOriginal

const dublar = opcoes => {
  fabricado = fabricar(opcoes)
  db.conn = fabricado.conn
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

const copiou = () =>
  fabricado.consultas.filter(q => q.includes('INSERT INTO producao.perfil_'))

describe('a trava da linha de produção na cópia entre lotes', () => {
  it('recusa quando a configuração aponta subfase de linha que o destino não executa', async () => {
    dublar({ estranhas: ESTRANHAS })

    const erro = await ctrl
      .copiarConfiguracaoLote(CORPO(), UUID, CONTEXTO)
      .then(() => null, e => e)

    expect(erro).not.toBeNull()
    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('linha de produção')
    expect(erro.message).toContain('Edição')
    expect(erro.message).toContain('Carta Topográfica')
  })

  // A RECUSA E ANTES DE QUALQUER INSERT, e nao um ROLLBACK depois: com a
  // conferencia no meio do laco, metade dos grupos ja teria sido escrita e a
  // transacao seria a unica coisa entre o lote de destino e a sujeira.
  it('não copia linha nenhuma quando recusa', async () => {
    dublar({ estranhas: ESTRANHAS })

    await expect(ctrl.copiarConfiguracaoLote(CORPO(), UUID, CONTEXTO)).rejects.toThrow()

    expect(copiou()).toEqual([])
  })

  // O DESTINO SEM ETAPA NENHUMA pede outra providencia, e por isso tem frase
  // propria: nao ha "outra linha de produção", ha cadastro que falta.
  it('diz o que fazer quando o destino não tem etapa cadastrada', async () => {
    dublar({ estranhas: ESTRANHAS, linhasDoDestino: [] })

    const erro = await ctrl
      .copiarConfiguracaoLote(CORPO(), UUID, CONTEXTO)
      .then(() => null, e => e)

    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('etapa')
    expect(erro.message).toContain('Cadastre as etapas')
  })

  // A LISTA DO ERRO E CURTA, e o resto vira contagem: sessenta subfases numa
  // caixa de mensagem nao dizem nada a mais que as cinco primeiras.
  it('resume a lista de subfases quando ela é longa', async () => {
    const muitas = Array.from({ length: 8 }, (_v, i) => ({
      linha_producao: 'Carta Topográfica',
      subfase: `Subfase ${i + 1}`
    }))
    dublar({ estranhas: muitas })

    const erro = await ctrl
      .copiarConfiguracaoLote(CORPO(), UUID, CONTEXTO)
      .then(() => null, e => e)

    expect(erro.message).toContain('Subfase 5')
    expect(erro.message).not.toContain('Subfase 6')
    expect(erro.message).toContain('e mais 3')
  })

  it('copia quando o destino executa a linha de produção da configuração', async () => {
    dublar({ estranhas: [] })

    const r = await ctrl.copiarConfiguracaoLote(CORPO(), UUID, CONTEXTO)

    expect(r.copiado).toEqual({ copiar_estilo: 0, copiar_menu: 0 })
    expect(r.nao_copiado).toEqual([])
    // A TRAVA FOI CONSULTADA, e a copia so aconteceu depois dela.
    expect(fabricado.consultas.some(q => q.includes('AS copiada'))).toBe(true)
  })

  // NENHUM INTERRUPTOR MARCADO NAO GRAVA LINHA NENHUMA, e por isso nao ha o que
  // cobrar: consultar a trava ali seria montar um UNION de zero tabelas, que e
  // erro de sintaxe.
  it('não consulta a trava quando nenhum grupo foi marcado', async () => {
    dublar({ estranhas: ESTRANHAS })

    const r = await ctrl.copiarConfiguracaoLote(
      CORPO({ copiar_estilo: false, copiar_menu: false }),
      UUID,
      CONTEXTO
    )

    expect(r.copiado).toEqual({})
    expect(fabricado.consultas.some(q => q.includes('AS copiada'))).toBe(false)
  })

  // AS DUAS CONFERENCIAS ANTIGAS CONTINUAM, e a trava nao passa na frente delas.
  it('continua recusando o mesmo lote nos dois lados', async () => {
    dublar({ estranhas: [] })

    const erro = await ctrl
      .copiarConfiguracaoLote(
        CORPO({ lote_id_destino: 1 }),
        UUID,
        CONTEXTO
      )
      .then(() => null, e => e)

    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('o mesmo')
  })
})
