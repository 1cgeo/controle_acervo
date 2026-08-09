'use strict'

// `login_info`: O CAMPO QUE TEM TRES ESTADOS, E NAO DOIS.
//
// O QUE ELE E. Quando o dado de producao da atividade e PostGIS COM CONTROLE DE
// PERMISSAO (`dominio.tipo_dado_producao` code 2), o servidor cria no banco de
// EDICAO um papel efemero para aquela pessoa e entrega aqui a credencial, junto
// do pacote. E o que faz o QGIS abrir o dado -- e so o dado dela.
//
// POR QUE ESTE ARQUIVO EXISTE. O contrato do campo nao e "vem ou nao vem": sao
// TRES estados, e confundir dois deles e um defeito que nenhum caso de sucesso
// pega:
//
//   AUSENTE            nao ha permissao a conceder (tipos 1 e 3). O cliente nao
//                      tem o que fazer.
//   { login, senha }   o acesso foi concedido.
//   { erro }           HA permissao a conceder e NAO foi possivel concede-la. O
//                      campo aparece justamente para a ausencia nao ser lida
//                      como o primeiro caso.
//
// E O OUTRO LADO: O BANCO DE PRODUCAO FORA DO AR NAO DERRUBA A TELA. O pacote
// traz camadas, estilos, menus, temas, modelos, regras, insumos, linhagem e
// atalhos, e nada disso depende do outro banco. Deixar a excecao subir faria a
// tela inteira morrer com a mensagem do banco de edicao -- a armadilha do
// `CLAUDE.md` que mordeu tres vezes em 2026-08-08.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const distribuicaoCtrl = require('../../../distribuicao/distribuicao_ctrl')
const permissoes = require('../../../database/permissoes_producao')
const { AppError, httpCode } = require('../../../utils')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONTEXTO = { origem: 'web', rota: 'GET /api/distribuicao/verifica' }

// O pacote e montado por `dadosProducao`, que fala com o banco. Aqui o alvo e a
// COSTURA -- o que `getDadosAtividade` faz com o que o subsistema devolve --
// entao o pacote e dublado inteiro.
const PACOTE = { atividade: { id: 7, nome: 'Aquisição - Execução - 13' } }

let garantirOriginal
let pacoteOriginal

beforeEach(() => {
  garantirOriginal = permissoes.garantirAcesso
  pacoteOriginal = distribuicaoCtrl.getDadosAtividade
})

afterEach(() => {
  permissoes.garantirAcesso = garantirOriginal
  distribuicaoCtrl.getDadosAtividade = pacoteOriginal
  jest.restoreAllMocks()
})

// `getDadosAtividade` chama uma funcao interna do modulo, que nao da para
// substituir de fora; o que se dubla e o subsistema de permissao e o `db.conn`
// por tras do pacote. Para isolar so a costura, o pacote vem de um duble do
// modulo de banco.
const montar = async garantir => {
  const db = require('../../../database/db')
  const original = db.conn

  db.conn = {
    task: async cb => cb({
      oneOrNone: async () => ({
        usuario_uuid: UUID,
        login: 'fulano',
        nome_guerra: 'Fulano',
        epsg: '31982',
        tipo_fase_id: 1,
        unidade_trabalho_id: 13,
        subfase_id: 2,
        lote_id: 5,
        tipo_etapa_id: 1,
        subfase_nome: 'Aquisição',
        etapa_nome: 'Execução',
        ut_id: 13,
        configuracao_producao: 'servidor_de_teste:5432/banco_de_teste',
        tipo_dado_producao_id: 2
      }),
      any: async () => [],
      one: async () => ({})
    })
  }

  permissoes.garantirAcesso = garantir

  try {
    return await distribuicaoCtrl.getDadosAtividade(7, UUID, CONTEXTO)
  } finally {
    db.conn = original
  }
}

describe('login_info no pacote da atividade', () => {
  it('vem com login e senha quando o acesso foi concedido', async () => {
    const pacote = await montar(async () => ({ login: 'sap_fulano', senha: 'x'.repeat(40) }))

    expect(pacote.login_info).toEqual({ login: 'sap_fulano', senha: 'x'.repeat(40) })
  })

  // O ESTADO QUE JUSTIFICA O CAMPO NAO SER NULO. Um `login_info: {}` ou
  // `login_info: null` faria o cliente concluir que nao ha permissao a conceder,
  // que e outra coisa.
  it('NAO vem quando nao ha permissao a conceder', async () => {
    const pacote = await montar(async () => null)

    expect('login_info' in pacote).toBe(false)
  })

  // O TERCEIRO ESTADO, e a resposta a "e se o banco de producao estiver fora do
  // ar". O pacote inteiro continua saindo; a falha fica na secao dela.
  it('vem com erro, e o pacote sobrevive, quando o banco de producao nao responde', async () => {
    const pacote = await montar(async () => {
      throw new AppError('O banco de produção não respondeu', httpCode.ServiceUnavailable)
    })

    expect(pacote.login_info).toEqual({ erro: 'O banco de produção não respondeu' })
    // O resto do pacote nao foi tocado.
    expect(pacote.atividade.id).toBe(7)
    expect(pacote.atividade.camadas).toBeDefined()
  })

  // A MENSAGEM DO DRIVER TRAZ O HOST (`getaddrinfo ENOTFOUND ...`), e esta
  // resposta vai para o cliente E para o log. So `AppError` -- que e frase
  // escrita por nos -- atravessa; qualquer outro erro vira frase generica.
  it('erro que nao e AppError nao vaza a mensagem crua', async () => {
    const pacote = await montar(async () => {
      throw new Error('getaddrinfo ENOTFOUND servidor_de_teste')
    })

    expect(pacote.login_info.erro).not.toContain('servidor_de_teste')
    expect(pacote.login_info.erro).not.toContain('ENOTFOUND')
    expect(pacote.login_info.erro).toContain('banco de produção')
  })

  // SEM `usuarioUuid` NAO HA A QUEM ENTREGAR. O campo nao vai, e o subsistema
  // nem e chamado: e o que impede este caminho de virar um jeito de pedir acesso
  // a folha alheia.
  it('nao chama o subsistema quando nao ha pessoa', async () => {
    let chamou = false
    const db = require('../../../database/db')
    const original = db.conn
    db.conn = {
      task: async cb => cb({
        oneOrNone: async () => ({
          usuario_uuid: UUID, tipo_fase_id: 1, unidade_trabalho_id: 13,
          subfase_id: 2, lote_id: 5, tipo_etapa_id: 1,
          subfase_nome: 'Aquisição', etapa_nome: 'Execução', ut_id: 13
        }),
        any: async () => [],
        one: async () => ({})
      })
    }
    permissoes.garantirAcesso = async () => { chamou = true; return null }

    try {
      const pacote = await distribuicaoCtrl.getDadosAtividade(7)
      expect('login_info' in pacote).toBe(false)
      expect(chamou).toBe(false)
    } finally {
      db.conn = original
    }
  })
})

describe('o fechamento do acesso na entrega', () => {
  // ENTREGOU O TRABALHO, PERDEU O DADO. E o envelope diz se a porta fechou
  // mesmo: uma revogacao que falha calada e o pior defeito possivel aqui, porque
  // quem le a resposta acredita nela.
  const fechar = async revogar => {
    const db = require('../../../database/db')
    const original = db.conn
    const revogarOriginal = permissoes.revogarAcesso

    // A linha canonica responde por `lerAntes`/`lerDepois` da auditoria: sem ela
    // o `escritaAuditada` estoura com 404 antes de chegar ao fechamento, que e o
    // que este bloco mede.
    const LINHA = {
      id: 7,
      etapa_id: 11,
      unidade_trabalho_id: 13,
      usuario_uuid: UUID,
      lote_id: 5,
      tipo_situacao_atividade_id: 4,
      observacao: null
    }

    db.conn = {
      tx: async cb => cb({
        any: async () => [],
        one: async () => ({ ...LINHA }),
        none: async () => null,
        oneOrNone: async () => ({ ...LINHA }),
        result: async () => ({ rowCount: 1 })
      })
    }
    permissoes.revogarAcesso = revogar

    try {
      return await distribuicaoCtrl.finaliza(
        UUID, 7, false, null, null, null, null, CONTEXTO
      )
    } finally {
      db.conn = original
      permissoes.revogarAcesso = revogarOriginal
    }
  }

  it('nao fala do que nao existe quando nao havia acesso', async () => {
    await expect(fechar(async () => null)).resolves.toBeNull()
  })

  it('diz que fechou quando fechou', async () => {
    await expect(fechar(async () => ({ login: 'sap_fulano', revogou: true })))
      .resolves.toEqual({ revogacao: { ok: true } })
  })

  // A ATIVIDADE FICA FINALIZADA, e a resposta diz que a porta continua aberta e
  // quem a fecha. Derrubar a finalizacao prenderia o operador numa folha que ele
  // ja terminou, por causa de um servidor que nao e deste servico.
  it('a falha da revogacao volta na resposta, e a atividade fica finalizada', async () => {
    const r = await fechar(async () => {
      throw new AppError('O banco de produção não respondeu', httpCode.ServiceUnavailable)
    })

    expect(r.revogacao.ok).toBe(false)
    expect(r.revogacao.mensagem).toBe('O banco de produção não respondeu')
    expect(r.revogacao.providencia).toContain('finalizada')
    expect(r.revogacao.providencia).toContain('gerente')
  })

  it('erro que nao e AppError nao vaza a mensagem crua', async () => {
    const r = await fechar(async () => {
      throw new Error('getaddrinfo ENOTFOUND servidor_de_teste')
    })

    expect(r.revogacao.mensagem).not.toContain('servidor_de_teste')
    expect(r.revogacao.mensagem).not.toContain('ENOTFOUND')
  })
})
