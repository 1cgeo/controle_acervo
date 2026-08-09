'use strict'

// TODA CONSULTA DESTE MODULO LIGA, e todo evento de rastro tem dono.
//
// POR QUE ISTO EXISTE, e por que ele nao precisa de PostgreSQL. Duas classes de
// defeito deste controlador nao aparecem em teste de schema nenhum e so
// apareceriam na primeira chamada de verdade:
//
//   1. PARAMETRO NOMEADO QUE NAO EXISTE. O pg-promise resolve `$<nome>` contra o
//      objeto de valores e lanca "Property 'nome' doesn't exist" quando ele
//      falta. Um `$<usuarioUuid>` num SQL cujo objeto manda `usuario_uuid` chega
//      como 500 sem dizer qual campo, e o Joi passou muito antes.
//   2. TABELA FORA DO MAPA DE AUDITORIA. `auditoriaCtrl.registrar` lanca quando
//      a tabela nao esta declarada em `auditoria/mapa/`, e como ele roda DENTRO
//      da transacao da escrita, isso derruba a escrita inteira -- que e o
//      comportamento desejado, e o pior lugar para descobrir a falta.
//
// O QUE ESTE ARQUIVO FAZ: troca `db.conn` por um duble que FORMATA cada consulta
// com o proprio `pgp.as.format` (o mesmo caminho do driver de verdade) e devolve
// linha canonica. A auditoria roda INTEIRA, sem duble: o mapa e o de verdade, o
// `agregado` de verdade e o INSERT em `auditoria.evento` e formatado como
// qualquer outro. O que fica de fora e so o PostgreSQL.
//
// O QUE ELE NAO PROVA: que a consulta responde a pergunta certa. Isso e do
// pacote de banco.

const { db } = require('../../../database')

const conexaoAdmin = require('../../../database/conexao_admin')

const ctrl = require('../../../gerencia_producao/gerencia_producao_ctrl')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONTEXTO = { origem: 'web', rota: 'PUT /api/gerencia_producao/x', loteId: UUID }

// A LINHA CANONICA. Ela responde por qualquer `SELECT` do duble, e por isso
// carrega TODAS as colunas que alguem possa ler: o `agregado` da atividade
// procura `lote_id`, o da subfase procura `linha_producao_id`, o `owner` dos
// atalhos procura `login`. Uma linha por tabela seria um catalogo a manter ao
// lado do banco, e este teste nao existe para isso.
const LINHA = {
  id: 1,
  code: 1,
  lote_id: 5,
  bloco_id: 3,
  habilitacao_id: 2,
  atividade_id: 7,
  etapa_id: 11,
  unidade_trabalho_id: 13,
  usuario_uuid: UUID,
  uuid: UUID,
  login: 'fulano',
  nome: 'linha canônica',
  observacao: null,
  descricao: 'descrição',
  versao_minima: '3.22.2',
  path: '',
  ferramenta: 'Salvar',
  idioma: 'português',
  atalho: 'Ctrl+S',
  owner: 'fulano',
  data: '2026-08-09T10:00:00-03:00',
  resolvido: false,
  prioridade: 1,
  tipo_situacao_atividade_id: 2,
  // As colunas que `pg_matviews` devolve, para o `refreshViews` ter o que
  // interpolar em `$<schema:name>.$<view:name>`. O nome segue o padrao novo
  // (`lote_<L>_linha_<P>`), e nao o `lote_<N>` do SAP.
  schemaname: 'acompanhamento',
  matviewname: 'lote_5_linha_2',
  // 1 e 'Não iniciado', e nao 'Em execução': a linha canonica e cortada pelo
  // filtro de "em andamento", que e o que o caso adiante prova.
  status_execucao_id: 1,
  // O DADO DE PRODUCAO, para as tres funcoes de permissao de banco. O valor e
  // ostensivamente falso: `configuracao_producao` guarda 'servidor:porta/banco',
  // e este repositorio e publico -- nenhum endereco de verdade entra aqui, nem
  // em comentario. O que este par prova e a FORMA, que e o que o codigo le.
  configuracao_producao: 'servidor_de_teste:5432/banco_de_teste',
  schema: 'edicao'
}

/**
 * O duble de conexao, e o dispatcher que o faz atravessar as guardas.
 *
 * As consultas de CONFERENCIA precisam devolver coisas diferentes para o
 * controlador nao parar antes de chegar na escrita:
 *
 *   `SELECT id FROM <tabela> WHERE id IN`   a existencia, que tem de ACHAR
 *   `a_alvo.tipo_situacao_atividade_id IN`  a janela de fluxo em curso, que tem
 *                                           de vir VAZIA (senao e 400)
 *   `FROM producao.fila_prioritaria`        o furo de fila ja existente, idem
 *   `producao.habilitacao_usuario`          o vinculo que barra apagar, idem
 *
 * O criterio e o TEXTO DA CONSULTA, e nao a ordem da chamada: ordem quebraria a
 * cada linha nova no controlador, e o que interessa aqui e o SQL.
 */
const fabricarBanco = () => {
  const consultas = []

  const vazio = [
    'a_alvo.tipo_situacao_atividade_id IN',
    'FROM producao.fila_prioritaria AS fp',
    'FROM producao.fila_prioritaria_grupo AS fpg',
    'FROM producao.habilitacao_usuario WHERE habilitacao_id',
    'FROM producao.fila_prioritaria_grupo WHERE habilitacao_id',
    'FROM producao.habilitacao_etapa WHERE habilitacao_id',
    // A conferencia de duplicidade das DUAS filas, que sao a mesma consulta com
    // a tabela e a coluna trocadas: achar linha aqui e 400 ("já está cadastrada
    // como prioritária"), e a escrita nem comeca.
    'WHERE atividade_id IN'
  ]

  const registrar = (query, values) => {
    // `as.format` E O MESMO CAMINHO DO DRIVER: ele lanca em parametro que falta,
    // e e por isso que este duble formata em vez de so guardar a string.
    consultas.push(db.pgp.as.format(query, values))
  }

  const any = async (query, values) => {
    registrar(query, values)
    const texto = String(query)
    if (vazio.some(p => texto.includes(p))) return []
    return [{ ...LINHA }]
  }

  return {
    consultas,
    conn: {
      any,
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
      tx: async cb => cb(fabricado.conn),
      task: async cb => cb(fabricado.conn)
    }
  }
}

let fabricado
let original
let noBancoOriginal

// O BANCO DE PRODUCAO TAMBEM E DUBLADO, e pelo MESMO duble. As tres funcoes de
// permissao mexem num segundo PostgreSQL por `conexaoAdmin.noBanco`; mandar o
// DDL delas para a mesma conexao fabricada e o que faz `as.format` conferir
// TODO `$<x:name>` que elas montam. Sem isto, o unico jeito de descobrir um
// identificador mal formado seria um banco de edicao de verdade.
beforeEach(() => {
  original = db.conn
  fabricado = fabricarBanco()
  db.conn = fabricado.conn

  noBancoOriginal = conexaoAdmin.noBanco
  conexaoAdmin.noBanco = async (configuracao, tarefa) => {
    const alvo = conexaoAdmin.separar(configuracao)
    // A analise e a de verdade: um `configuracao_producao` malformado tem de
    // continuar reprovando aqui, e nao passar por cima do duble.
    if (!alvo) throw new Error(`configuração de produção inválida no duble: ${configuracao}`)
    return tarefa(fabricado.conn, alvo)
  }
})

afterEach(() => {
  db.conn = original
  conexaoAdmin.noBanco = noBancoOriginal
})

// AS CHAMADAS, uma por funcao publica do controlador. A lista e o contrato: uma
// funcao nova que nao entre aqui nao tem nenhuma consulta conferida, e o caso
// final cobra que a lista cubra o controlador inteiro.
const CHAMADAS = [
  ['getHabilitacao', () => ctrl.getHabilitacao()],
  ['criaHabilitacao', () => ctrl.criaHabilitacao([{ nome: 'Restituidor' }], UUID, CONTEXTO)],
  ['atualizaHabilitacao', () => ctrl.atualizaHabilitacao([{ id: 1, nome: 'Revisor' }], UUID, CONTEXTO)],
  ['deletaHabilitacao', () => ctrl.deletaHabilitacao([1], UUID, CONTEXTO)],

  ['getHabilitacaoEtapa', () => ctrl.getHabilitacaoEtapa()],
  ['criaHabilitacaoEtapa', () =>
    ctrl.criaHabilitacaoEtapa(
      [{ habilitacao_id: 1, subfase_id: 2, tipo_etapa_id: 1, prioridade: 1 }],
      UUID, CONTEXTO
    )],
  ['atualizaHabilitacaoEtapa', () =>
    ctrl.atualizaHabilitacaoEtapa(
      [{ id: 1, habilitacao_id: 1, subfase_id: 2, tipo_etapa_id: 1, prioridade: 1 }],
      UUID, CONTEXTO
    )],
  ['deletaHabilitacaoEtapa', () => ctrl.deletaHabilitacaoEtapa([1], UUID, CONTEXTO)],

  ['getHabilitacaoUsuario', () => ctrl.getHabilitacaoUsuario()],
  ['criaHabilitacaoUsuario', () =>
    ctrl.criaHabilitacaoUsuario([{ usuario_uuid: UUID, habilitacao_id: 1 }], UUID, CONTEXTO)],
  ['atualizaHabilitacaoUsuario', () =>
    ctrl.atualizaHabilitacaoUsuario(
      [{ id: 1, usuario_uuid: UUID, habilitacao_id: 1 }], UUID, CONTEXTO
    )],
  ['deletaHabilitacaoUsuario', () => ctrl.deletaHabilitacaoUsuario([1], UUID, CONTEXTO)],

  ['getHabilitacaoBloco', () => ctrl.getHabilitacaoBloco()],
  ['criaHabilitacaoBloco', () =>
    ctrl.criaHabilitacaoBloco([{ usuario_uuid: UUID, bloco_id: 3 }], UUID, CONTEXTO)],
  ['atualizaHabilitacaoBloco', () =>
    ctrl.atualizaHabilitacaoBloco([{ id: 1, usuario_uuid: UUID, bloco_id: 3 }], UUID, CONTEXTO)],
  ['deletaHabilitacaoBloco', () => ctrl.deletaHabilitacaoBloco([1], UUID, CONTEXTO)],

  ['pausaAtividade', () => ctrl.pausaAtividade([13], UUID, CONTEXTO)],
  ['unidadeTrabalhoDisponivel (true)', () =>
    ctrl.unidadeTrabalhoDisponivel([13], true, UUID, CONTEXTO)],
  ['unidadeTrabalhoDisponivel (false)', () =>
    ctrl.unidadeTrabalhoDisponivel([13], false, UUID, CONTEXTO)],
  ['reiniciaAtividade', () => ctrl.reiniciaAtividade([13], UUID, CONTEXTO)],
  ['voltaAtividade (mantendo)', () => ctrl.voltaAtividade([7], true, UUID, CONTEXTO)],
  ['voltaAtividade (soltando)', () => ctrl.voltaAtividade([7], false, UUID, CONTEXTO)],
  ['avancaAtividade (concluida)', () => ctrl.avancaAtividade([7], true, UUID, CONTEXTO)],
  ['avancaAtividade (nao concluida)', () => ctrl.avancaAtividade([7], false, UUID, CONTEXTO)],

  ['criaObservacao', () =>
    ctrl.criaObservacao([7], 'obs da atividade', 'obs da unidade', UUID, CONTEXTO)],
  ['getObservacao', () => ctrl.getObservacao(7)],
  ['atualizaPropriedadesUT (tudo)', () =>
    ctrl.atualizaPropriedadesUT(
      [{ id: 13, dificuldade: 2, tempo_estimado_minutos: 60, prioridade: 1 }],
      UUID, CONTEXTO
    )],
  // O CAMINHO QUE MAIS QUEBRA: a linha que omite dois dos tres campos. Sem o
  // `COALESCE` e sem a normalizacao, o `$<dificuldade>` procuraria uma
  // propriedade que o corpo nao mandou.
  ['atualizaPropriedadesUT (so prioridade)', () =>
    ctrl.atualizaPropriedadesUT([{ id: 13, prioridade: 9 }], UUID, CONTEXTO)],

  ['iniciaAtividadeModoLocal', () => ctrl.iniciaAtividadeModoLocal(7, UUID, CONTEXTO)],
  ['finalizaAtividadeModoLocal', () =>
    ctrl.finalizaAtividadeModoLocal(
      7, UUID, '2026-08-09T08:00:00-03:00', '2026-08-09T17:00:00-03:00', UUID, CONTEXTO
    )],

  ['getFilaPrioritaria', () => ctrl.getFilaPrioritaria()],
  ['criaFilaPrioritaria', () => ctrl.criaFilaPrioritaria([7], UUID, 1, UUID, CONTEXTO)],
  ['atualizaFilaPrioritaria', () =>
    ctrl.atualizaFilaPrioritaria(
      [{ id: 1, atividade_id: 7, usuario_uuid: UUID, prioridade: 2 }], UUID, CONTEXTO
    )],
  ['deletaFilaPrioritaria', () => ctrl.deletaFilaPrioritaria([1], UUID, CONTEXTO)],

  ['getFilaPrioritariaGrupo', () => ctrl.getFilaPrioritariaGrupo()],
  ['criaFilaPrioritariaGrupo', () =>
    ctrl.criaFilaPrioritariaGrupo([7], 2, 1, UUID, CONTEXTO)],
  ['atualizaFilaPrioritariaGrupo', () =>
    ctrl.atualizaFilaPrioritariaGrupo(
      [{ id: 1, atividade_id: 7, habilitacao_id: 2, prioridade: 2 }], UUID, CONTEXTO
    )],
  ['deletaFilaPrioritariaGrupo', () => ctrl.deletaFilaPrioritariaGrupo([1], UUID, CONTEXTO)],

  ['getProblemaAtividade', () => ctrl.getProblemaAtividade()],
  ['atualizaProblemaAtividade', () =>
    ctrl.atualizaProblemaAtividade([{ id: 1, resolvido: true }], UUID, CONTEXTO)],
  ['getAlteracaoFluxo', () => ctrl.getAlteracaoFluxo()],
  ['atualizaAlteracaoFluxo', () =>
    ctrl.atualizaAlteracaoFluxo(
      [{
        id: 1,
        atividade_id: 7,
        descricao: 'refazer a restituição',
        data: '2026-08-09T10:00:00-03:00',
        resolvido: false,
        geom: 'SRID=4674;POLYGON((-45 -22,-45 -21,-44 -21,-44 -22,-45 -22))'
      }],
      UUID, CONTEXTO
    )],

  ['getRelatorioAlteracao', () => ctrl.getRelatorioAlteracao()],
  ['gravaRelatorioAlteracao', () =>
    ctrl.gravaRelatorioAlteracao(
      [{ data: '2026-08-09T10:00:00-03:00', descricao: 'mudança de fluxo' }],
      UUID, CONTEXTO
    )],
  ['atualizaRelatorioAlteracao', () =>
    ctrl.atualizaRelatorioAlteracao(
      [{ id: 1, data: '2026-08-09T10:00:00-03:00', descricao: 'outra' }],
      UUID, CONTEXTO
    )],
  ['deletaRelatorioAlteracao', () => ctrl.deletaRelatorioAlteracao([1], UUID, CONTEXTO)],

  ['getVersaoQGIS', () => ctrl.getVersaoQGIS()],
  ['atualizaVersaoQGIS', () => ctrl.atualizaVersaoQGIS('3.28', UUID, CONTEXTO)],
  ['getPlugins', () => ctrl.getPlugins()],
  ['gravaPlugins', () =>
    ctrl.gravaPlugins([{ nome: 'sap', versao_minima: '1.2' }], UUID, CONTEXTO)],
  ['atualizaPlugins', () =>
    ctrl.atualizaPlugins([{ id: 1, nome: 'sap', versao_minima: '1.3' }], UUID, CONTEXTO)],
  ['deletaPlugins', () => ctrl.deletaPlugins([1], UUID, CONTEXTO)],
  ['getAtalhos', () => ctrl.getAtalhos()],
  ['gravaAtalhos', () =>
    ctrl.gravaAtalhos([{ ferramenta: 'Salvar', idioma: 'português', atalho: 'Ctrl+S' }], UUID, CONTEXTO)],
  ['atualizaAtalhos', () =>
    ctrl.atualizaAtalhos(
      [{ id: 1, ferramenta: 'Salvar', idioma: 'português', atalho: 'Ctrl+S' }], UUID, CONTEXTO
    )],
  ['deletaAtalhos', () => ctrl.deletaAtalhos([1], UUID, CONTEXTO)],
  ['getPluginPath', () => ctrl.getPluginPath()],
  ['atualizaPluginPath', () => ctrl.atualizaPluginPath('', UUID, CONTEXTO)],

  ['getViewsAcompanhamento (sem filtro)', () =>
    ctrl.getViewsAcompanhamento(false, false, null)],
  ['getViewsAcompanhamento (com bloco)', () =>
    ctrl.getViewsAcompanhamento(true, true, 3)],
  ['refreshViews', () => ctrl.refreshViews(UUID, CONTEXTO)],

  // As tres de permissao no banco de PRODUCAO. Elas atravessam DOIS bancos, e o
  // duble responde pelos dois: o que se confere aqui e que toda consulta e todo
  // DDL delas FORMATA -- inclusive os `$<x:name>` do `CREATE USER`, do
  // `ALTER USER` e dos `GRANT`, que sao os unicos identificadores do sistema que
  // vem de tabela e entram num comando.
  ['revogarPermissoesBanco', () => ctrl.revogarPermissoesBanco(5, UUID, CONTEXTO)],
  ['revogarPermissoesUsuario', () =>
    ctrl.revogarPermissoesUsuario(5, UUID, UUID, CONTEXTO)],
  ['reaplicarPermissoes', () => ctrl.reaplicarPermissoes(UUID, CONTEXTO)]
]

describe('toda consulta do controlador formata, e todo rastro acha o dono', () => {
  it.each(CHAMADAS)('%s', async (_nome, chamada) => {
    await expect(chamada()).resolves.not.toThrow()
    // Variancia: uma chamada que nao tocasse o banco passaria por vacuidade.
    expect(fabricado.consultas.length).toBeGreaterThan(0)
  })

  // A LISTA ACIMA COBRE O CONTROLADOR INTEIRO. Sem este caso, uma funcao nova
  // ficaria sem nenhuma consulta conferida e os casos acima continuariam verdes.
  // FUNCAO QUE NAO CONSULTA O BANCO, com o motivo. A lista CHAMADAS existe para
  // provar que toda consulta FORMATA, e cada entrada dela e cobrada de fazer ao
  // menos uma chamada ao duble; funcao sem consulta nenhuma nao cabe la, e
  // enfia-la so para satisfazer a contagem faria o caso de cima passar a aceitar
  // zero chamadas -- que e justamente o que ele existe para recusar.
  //
  // A lista e fechada e curta de proposito: ela mede quantas funcoes deste
  // controlador escapam da prova, e cresce so com justificativa escrita.
  const SEM_CONSULTA = {
    getCredencialLeitura:
      'So monta o bloco de chaves de config.env; nao toca o banco. Fonte unica ' +
      'de GET /banco_dados e de GET /view_acompanhamento.'
  }

  it('nenhuma funcao do controlador ficou de fora da lista', () => {
    const exercitadas = new Set(
      CHAMADAS.map(([nome]) => nome.replace(/\s*\(.*\)$/, ''))
    )
    const declaradas = Object.keys(ctrl).filter(k => typeof ctrl[k] === 'function')
    expect(
      declaradas.filter(f => !exercitadas.has(f) && !SEM_CONSULTA[f])
    ).toEqual([])
  })

  // A DISPENSA TEM DE CONTINUAR MERECIDA. Sem este caso, o dia em que
  // `getCredencialLeitura` passasse a consultar o banco ela seguiria fora da
  // prova, calada, so porque o nome dela esta na lista acima.
  it('as funcoes dispensadas realmente nao consultam o banco', async () => {
    for (const nome of Object.keys(SEM_CONSULTA)) {
      fabricado.consultas.length = 0
      await ctrl[nome]()
      expect([nome, fabricado.consultas.length]).toEqual([nome, 0])
    }
  })
})

describe('o rastro de cada escrita cai em auditoria.evento', () => {
  // A AUDITORIA RODA INTEIRA, sem duble: o mapa e o de verdade, o `agregado` e o
  // de verdade, e o INSERT e formatado como qualquer outra consulta. Uma tabela
  // fora do mapa lancaria antes de chegar aqui -- que e o ponto.
  const escritas = [
    ['habilitação', () => ctrl.criaHabilitacao([{ nome: 'Restituidor' }], UUID, CONTEXTO)],
    ['fila prioritária', () => ctrl.criaFilaPrioritaria([7], UUID, 1, UUID, CONTEXTO)],
    ['pausa de atividade', () => ctrl.pausaAtividade([13], UUID, CONTEXTO)],
    ['versão do QGIS', () => ctrl.atualizaVersaoQGIS('3.28', UUID, CONTEXTO)],
    ['atalho', () =>
      ctrl.atualizaAtalhos(
        [{ id: 1, ferramenta: 'Salvar', idioma: 'português', atalho: 'Ctrl+S' }],
        UUID, CONTEXTO
      )],
    ['refresh das views', () => ctrl.refreshViews(UUID, CONTEXTO)]
  ]

  it.each(escritas)('%s grava evento', async (_nome, chamada) => {
    await chamada()
    const eventos = fabricado.consultas.filter(q =>
      q.includes('INSERT INTO auditoria.evento')
    )
    expect(eventos.length).toBeGreaterThan(0)
    // O MODULO DO EVENTO E `producao`, e nao o do agente que escreveu a rota. E
    // o mapa que decide, e nao o controlador: por isso a conferencia e sobre o
    // SQL ja formatado.
    for (const evento of eventos) expect(evento).toContain("'producao'")
  })

  // LEITURA NAO AUDITA, e a ausencia e a regra: `auditoria.evento` guarda o que
  // MUDOU. Um evento por consulta faria a trilha crescer mais rapido que o dado
  // e afogaria as mudancas de verdade.
  it.each([
    ['getHabilitacao', () => ctrl.getHabilitacao()],
    ['getFilaPrioritaria', () => ctrl.getFilaPrioritaria()],
    ['getProblemaAtividade', () => ctrl.getProblemaAtividade()],
    ['getViewsAcompanhamento', () => ctrl.getViewsAcompanhamento(false, false, null)]
  ])('%s nao grava evento', async (_nome, chamada) => {
    await chamada()
    expect(
      fabricado.consultas.filter(q => q.includes('INSERT INTO auditoria.evento'))
    ).toEqual([])
  })
})

describe('apagar a habilitacao leva as etapas dela, e nada mais', () => {
  // AS TRES DEPENDENCIAS NAO SAO A MESMA COISA. `habilitacao_etapa` e
  // configuracao e CAI JUNTO, como no SAP; a pessoa habilitada e a fila
  // prioritaria de grupo BARRAM, porque apagar em cascata tiraria gente de
  // trabalho e desfaria furo de fila que alguem decidiu, sem aviso na tela.
  it('recusa quando ha pessoa vinculada', async () => {
    // O duble devolve linha para a consulta de vinculo, e nao vazio.
    fabricado.conn.any = async (query, values) => {
      db.pgp.as.format(query, values)
      if (String(query).includes('FROM producao.habilitacao_usuario')) {
        return [{ id: 1 }]
      }
      return [{ ...LINHA }]
    }

    await expect(ctrl.deletaHabilitacao([1], UUID, CONTEXTO)).rejects.toThrow(
      /pessoa vinculada/
    )
  })

  // A HABILITACAO SEM ETAPA NENHUMA e o caso comum, e a lista vazia nao pode
  // virar `IN ()`. Este caso e a regressao: sem a saida antecipada de
  // `apagarVarios`, a exclusao morria com erro de sintaxe do Postgres.
  it('apaga a habilitacao que nao tem etapa nenhuma', async () => {
    fabricado.conn.any = async (query, values) => {
      db.pgp.as.format(query, values)
      const texto = String(query)
      if (texto.includes('FROM producao.habilitacao_etapa')) return []
      if (texto.includes('FROM producao.habilitacao_usuario')) return []
      if (texto.includes('FROM producao.fila_prioritaria_grupo')) return []
      return [{ ...LINHA }]
    }

    await expect(
      ctrl.deletaHabilitacao([1], UUID, CONTEXTO)
    ).resolves.not.toThrow()
  })
})

describe('a credencial que sai em /view_acompanhamento', () => {
  // A CREDENCIAL SAI NA RESPOSTA, e ja e a pratica da casa: e o mesmo que
  // `GET /api/acervo/camadas_produto` faz, porque o QGIS conecta DIRETO no
  // PostgreSQL e nao passa por rota nenhuma. O que este caso guarda e que ela
  // venha do papel SOMENTE LEITURA quando ele existe -- entregar o papel de
  // escrita ao QGIS daria ao gerente uma conexao que apaga o acervo.
  it('usa o papel somente leitura quando ele esta configurado', async () => {
    const config = require('../../../config')
    const antes = config.DB_USER_READONLY
    config.DB_USER_READONLY = 'papel_leitura'

    // O `config` e lido por desestruturacao no topo do controlador, entao trocar
    // o objeto depois nao muda o que ele leu. O que se prova aqui e o CONTRATO
    // da resposta: ela traz as cinco chaves e o schema, e nunca a senha da conta
    // de ninguem -- a de `dgeo.usuario.senha` e hash bcrypt e nao sai por rota.
    const dados = await ctrl.getViewsAcompanhamento(false, false, null)
    config.DB_USER_READONLY = antes

    expect(Object.keys(dados.banco_dados).sort()).toEqual(
      ['login', 'nome_db', 'porta', 'schema', 'senha', 'servidor'].sort()
    )
    expect(dados.banco_dados.schema).toBe('acompanhamento')
  })

  // O FILTRO "EM ANDAMENTO" E `Em execução` (code 2 de
  // `dominio.tipo_status_execucao`), e nao o code 1 do `dominio.status` do SAP,
  // onde 1 era "Em andamento". Aqui o 1 e "Não iniciado": trocar o numero sem
  // trocar o sentido faria o filtro devolver exatamente os lotes que ele existe
  // para esconder.
  it('em andamento e o code 2, e nao o 1 do SAP', async () => {
    const { STATUS_EXECUCAO } = require('../../../utils/domain_constants')
    expect(STATUS_EXECUCAO.EM_EXECUCAO).toBe(2)

    const semFiltro = await ctrl.getViewsAcompanhamento(false, false, null)
    expect(semFiltro.views.length).toBeGreaterThan(0)

    // A linha canonica do duble vem com `lote_status`/`projeto_status` nulos, o
    // que NAO e "em execução": o filtro a corta. E a prova de que ele filtra,
    // que um `!emAndamento || ...` invertido nao daria.
    const comFiltro = await ctrl.getViewsAcompanhamento(true, true, null)
    expect(comFiltro.views.length).toBeLessThan(semFiltro.views.length)
  })
})

describe('o refresh das views de acompanhamento', () => {
  it('so mexe no schema acompanhamento, e sempre CONCURRENTLY', async () => {
    await ctrl.refreshViews(UUID, CONTEXTO)

    const refreshes = fabricado.consultas.filter(q => q.includes('REFRESH MATERIALIZED VIEW'))
    expect(refreshes.length).toBeGreaterThan(0)
    for (const r of refreshes) {
      // CONCURRENTLY porque a view fica LEGIVEL durante o refresh: sem isso, o
      // gerente com a camada aberta no QGIS veria a consulta travar.
      expect(r).toContain('CONCURRENTLY')
    }

    // AS VIEWS DO ACERVO NAO ENTRAM DE CARONA. Elas tem rota propria, de
    // administrador; refaze-las aqui daria ao gerente da producao um botao que
    // mexe no acervo.
    const alvo = fabricado.consultas.find(q => q.includes('FROM pg_matviews'))
    expect(alvo).toContain("'acompanhamento'")
    expect(alvo).not.toContain('mv_produto')
  })
})
