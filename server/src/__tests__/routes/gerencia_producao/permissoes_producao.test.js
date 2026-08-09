'use strict'

// O SUBSISTEMA DE LOGIN TEMPORARIO, PROVADO SEM PostgreSQL NENHUM.
//
// POR QUE ELE NAO PODE ESPERAR O PACOTE DE BANCO. O que este subsistema faz
// acontece em DOIS bancos: o do SCA, que o pacote de banco tem, e um banco de
// EDICAO arbitrario, que nenhuma maquina de teste tem nem deve ter. As tres
// coisas que mais importam aqui sao justamente as que um banco de teste nao
// provaria melhor:
//
//   1. O DDL SAI PARAMETRIZADO. Nome de papel, de banco, de schema, de camada e
//      de COLUNA entram no `CREATE USER`, no `ALTER USER` e nos `GRANT`, e todos
//      vem de tabela. Um `${}` no lugar de um `$<x:name>` funciona perfeitamente
//      com nomes bem comportados e so aparece no dia em que alguem cadastrar uma
//      camada com aspas no nome.
//   2. A AUDITORIA CAI NA MESMA TRANSACAO DA ESCRITA. Falhar ao auditar tem de
//      derrubar a linha de `producao.login_temporario`, e nao deixa-la orfa.
//   3. NENHUMA SENHA APARECE EM LUGAR NENHUM alem do retorno. Nem em log, nem no
//      evento de auditoria, nem numa mensagem de erro.
//
// COMO ELE DUBLA. Uma unica funcao (`fabricar`) devolve um par de conexoes que
// GRAVAM tudo o que recebem depois de passar por `db.pgp.as.format` -- o mesmo
// caminho do driver de verdade, que e quem lanca em parametro que falta e quem
// quota os identificadores. O que fica de fora e so o servidor.
//
// ESTE ARQUIVO NAO ABRE CONEXAO e por isso cai no pacote `test:rapido`. Ele nao
// cita os ajudantes que abrem, nem em comentario: `jest.config.js` decide o
// pacote lendo o fonte, e a varredura dele nao distingue prosa de codigo.

const db = require('../../../database/db')
const conexaoAdmin = require('../../../database/conexao_admin')
const permissoes = require('../../../database/permissoes_producao')
const logger = require('../../../utils/logger')
const { AppError } = require('../../../utils')

const { TIPO_ETAPA } = require('../../../utils/domain_constants')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const CONTEXTO = { origem: 'web', rota: 'GET /api/distribuicao/verifica' }

// O ENDERECO E OSTENSIVAMENTE FALSO. `configuracao_producao` guarda
// 'servidor:porta/banco', e este repositorio e publico: o que se prova aqui e a
// FORMA que o codigo le, e nunca um valor de instalacao nenhuma.
const CONFIGURACAO = 'servidor_de_teste:5432/banco_de_teste'

// ---------------------------------------------------------------------------
// O duble
// ---------------------------------------------------------------------------

/**
 * As duas conexoes, cada uma guardando o texto JA FORMATADO do que recebeu.
 *
 * `respostas` mapeia um PEDACO do texto da consulta para o que ela devolve. O
 * criterio e o texto e nao a ordem, pela mesma razao do duble de
 * `consultas.test.js`: ordem quebra a cada linha nova no controlador.
 */
const fabricar = (respostas = {}) => {
  const registro = { sca: [], producao: [] }

  const conexao = onde => {
    const guardar = (query, values) => {
      const texto = db.pgp.as.format(query, values)
      registro[onde].push(texto)
      return texto
    }

    const responder = texto => {
      for (const [pedaco, valor] of Object.entries(respostas)) {
        if (texto.includes(pedaco)) return valor
      }
      return undefined
    }

    const conn = {
      any: async (q, v) => {
        const r = responder(guardar(q, v))
        return r === undefined ? [] : r
      },
      one: async (q, v) => {
        const r = responder(guardar(q, v))
        return r === undefined ? {} : r
      },
      oneOrNone: async (q, v) => {
        const r = responder(guardar(q, v))
        return r === undefined ? null : r
      },
      none: async (q, v) => {
        guardar(q, v)
        return null
      }
    }

    conn.tx = async cb => cb(conn)
    conn.task = async cb => cb(conn)

    return conn
  }

  return { registro, sca: conexao('sca'), producao: conexao('producao') }
}

let fabricado
let connOriginal
let noBancoOriginal
let logs

beforeEach(() => {
  connOriginal = db.conn
  noBancoOriginal = conexaoAdmin.noBanco

  // TODO NIVEL DO LOGGER E CAPTURADO, e nao so o `info`: uma senha que vazasse
  // por `debug` ou por `error` vazaria do mesmo jeito para o arquivo.
  logs = []
  for (const nivel of ['info', 'warn', 'error', 'debug']) {
    jest.spyOn(logger, nivel).mockImplementation((...args) => {
      logs.push(JSON.stringify(args))
    })
  }
})

afterEach(() => {
  db.conn = connOriginal
  conexaoAdmin.noBanco = noBancoOriginal
  jest.restoreAllMocks()
})

const ligar = respostas => {
  fabricado = fabricar(respostas)
  db.conn = fabricado.sca
  conexaoAdmin.noBanco = async (configuracao, tarefa) => {
    const alvo = conexaoAdmin.separar(configuracao)
    if (!alvo) throw new AppError(conexaoAdmin.CONFIGURACAO_INVALIDA, 503)
    return tarefa(fabricado.producao, alvo)
  }
  return fabricado
}

// O dado de producao de uma atividade PostGIS COM CONTROLE DE PERMISSAO.
const DADO = {
  dado_producao_id: 9,
  configuracao_producao: CONFIGURACAO,
  usuario_uuid: UUID,
  login: 'fulano'
}

// Uma camada da subfase, no formato que `camadasDaAtividade` devolve.
const camada = (nome, extra = {}) => ({
  schema: 'edicao',
  nome_camada: nome,
  camada_apontamento: false,
  atributo_situacao_correcao: null,
  atributo_justificativa_apontamento: null,
  tipo_etapa_id: TIPO_ETAPA.EXECUCAO,
  dado_producao_id: 9,
  configuracao_producao: CONFIGURACAO,
  ...extra
})

// ---------------------------------------------------------------------------

describe('o nome do papel', () => {
  it('leva o prefixo do subsistema', () => {
    expect(permissoes.nomeDoPapel('fulano')).toBe(`${permissoes.PREFIXO_LOGIN}fulano`)
  })

  it('derruba acento e caractere que nao cabe num identificador', () => {
    expect(permissoes.nomeDoPapel('João D. Ávila')).toBe('sap_joao_d__avila')
  })

  // 63 E O TETO DO PostgreSQL, e passar dele nao da erro: o servidor TRUNCA em
  // silencio. Dois logins que so diferem depois do 63o caractere virariam o
  // MESMO papel, e duas pessoas dividiriam a credencial do banco de edicao.
  it('nao passa do teto de identificador do PostgreSQL', () => {
    const gigante = permissoes.nomeDoPapel('a'.repeat(200))
    expect(gigante).toHaveLength(63)
  })

  // Login que sobra vazio depois da limpeza nao pode virar o papel `sap_`, que
  // seria o MESMO para todo mundo nessa situacao.
  it('recusa login que nao sobra nada depois da limpeza', () => {
    expect(() => permissoes.nomeDoPapel('###')).toThrow(AppError)
    expect(() => permissoes.nomeDoPapel('')).toThrow(AppError)
  })
})

describe('a leitura de configuracao_producao', () => {
  it('separa servidor, porta e banco', () => {
    expect(conexaoAdmin.separar(CONFIGURACAO)).toEqual({
      servidor: 'servidor_de_teste',
      porta: '5432',
      banco: 'banco_de_teste'
    })
  })

  // Cadastro incompleto e erro de quem cadastrou, e nao 500: o `null` daqui vira
  // 503 com a frase que manda corrigir o dado de producao.
  it.each([
    ['vazio', ''],
    ['nulo', null],
    ['so o nome do banco', 'banco_de_teste'],
    ['sem porta', 'servidor_de_teste/banco_de_teste'],
    ['porta que nao e numero', 'servidor_de_teste:porta/banco_de_teste'],
    ['sem banco', 'servidor_de_teste:5432']
  ])('devolve nulo com %s', (_nome, valor) => {
    expect(conexaoAdmin.separar(valor)).toBeNull()
  })

  // O PAPEL E DO CLUSTER, e nao do banco: `CREATE USER` vale para todos os
  // bancos daquele servidor. Guardar a linha por banco daria duas senhas ao
  // MESMO papel no dia em que um lote tivesse dois bancos de edicao no mesmo
  // servidor.
  it('a chave da linha guardada e o servidor e a porta, sem o banco', () => {
    const alvo = conexaoAdmin.separar(CONFIGURACAO)
    expect(conexaoAdmin.chaveDoCluster(alvo)).toBe('servidor_de_teste:5432')
  })
})

describe('conceder acesso a uma atividade', () => {
  const respostasBase = {
    'FROM producao.atividade AS a': DADO,
    'FROM producao.login_temporario': null,
    'FROM pg_catalog.pg_roles': null
  }

  it('cria o papel quando ele ainda nao existe, e devolve a credencial', async () => {
    const f = ligar({
      ...respostasBase,
      'FROM producao.camada AS c': [camada('aquisicao_area_p')]
    })

    const info = await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(info.login).toBe('sap_fulano')
    expect(info.senha).toMatch(/^[0-9a-f]{40}$/)

    const ddl = f.registro.producao.join('\n')
    expect(ddl).toContain('CREATE USER "sap_fulano"')
    expect(ddl).not.toContain('ALTER USER "sap_fulano" WITH PASSWORD')
  })

  // A CREDENCIAL VALE POR CONSTRUCAO. A origem abria uma CONEXAO com a senha
  // guardada so para descobrir se ela ainda valia; aqui o `ALTER` acontece
  // sempre, o que garante o mesmo com uma linha de DDL e nenhuma conexao a mais.
  it('reimpoe a senha guardada quando o papel ja existe', async () => {
    const f = ligar({
      ...respostasBase,
      'FROM producao.login_temporario': { login: 'sap_fulano', senha: 'senha-guardada' },
      'FROM pg_catalog.pg_roles': { rolname: 'sap_fulano' },
      'FROM producao.camada AS c': [camada('aquisicao_area_p')]
    })

    const info = await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(info.senha).toBe('senha-guardada')

    const ddl = f.registro.producao.join('\n')
    expect(ddl).toContain('ALTER USER "sap_fulano" WITH PASSWORD')
    expect(ddl).not.toContain('CREATE USER')
  })

  // Papel apagado a mao no banco de edicao com a linha ainda aqui: reaproveitar
  // a senha guardada espalharia um segredo velho para um papel novo.
  it('gera senha nova quando a linha existe mas o papel sumiu', async () => {
    const f = ligar({
      ...respostasBase,
      'FROM producao.login_temporario': { login: 'sap_fulano', senha: 'senha-guardada' },
      'FROM pg_catalog.pg_roles': null,
      'FROM producao.camada AS c': [camada('aquisicao_area_p')]
    })

    const info = await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(info.senha).not.toBe('senha-guardada')
    expect(info.senha).toMatch(/^[0-9a-f]{40}$/)
    expect(f.registro.producao.join('\n')).toContain('CREATE USER "sap_fulano"')
  })

  // O `VALID UNTIL` SAI DO RELOGIO DO BANCO DE EDICAO. Com a data vinda daqui,
  // um relogio adiantado neste servidor encurtaria a validade e um atrasado a
  // esticaria, e o sintoma seria "o QGIS parou de abrir antes dos cinco dias",
  // num servidor que nem se olha.
  it('a validade sai do relogio do banco de producao, e nao deste servidor', async () => {
    const f = ligar({
      ...respostasBase,
      'FROM producao.camada AS c': [camada('aquisicao_area_p')],
      "|| ' day')::interval": { data: '2026-08-14T10:00:00-03:00' }
    })

    await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    const ddl = f.registro.producao.join('\n')
    expect(ddl).toContain("SELECT now() + (5 || ' day')::interval AS data")
    expect(ddl).toContain("VALID UNTIL '2026-08-14T10:00:00-03:00'")
    // E nao a data deste processo.
    expect(ddl).not.toContain(new Date().toISOString().slice(0, 10))
  })

  // O CASO QUE O TIPO 1 E O 3 PRODUZEM: nao ha permissao a conceder, e o nulo e
  // o que faz o campo `login_info` NAO IR no pacote. Um objeto vazio ali diria
  // "ha permissao, e ela e nenhuma".
  it('devolve nulo quando o dado de producao nao e PostGIS controlado', async () => {
    const f = ligar({ 'FROM producao.atividade AS a': null })

    const info = await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(info).toBeNull()
    // Nao chegou a tocar o outro banco.
    expect(f.registro.producao).toEqual([])
  })
})

describe('o DDL da concessao', () => {
  const conceder = async (linhas, extras = {}) => {
    const f = ligar({
      'FROM producao.atividade AS a': DADO,
      'FROM producao.login_temporario': null,
      'FROM pg_catalog.pg_roles': null,
      'FROM producao.camada AS c': linhas,
      ...extras
    })
    await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })
    return f.registro.producao.join('\n')
  }

  it('todo identificador sai QUOTADO, e nenhum e concatenado', async () => {
    const ddl = await conceder([camada('aquisicao_area_p')])

    expect(ddl).toContain('GRANT CONNECT ON DATABASE "banco_de_teste" TO "sap_fulano";')
    expect(ddl).toContain('GRANT USAGE ON SCHEMA "edicao" TO "sap_fulano";')
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, DELETE, UPDATE ON "edicao"."aquisicao_area_p" TO "sap_fulano";'
    )
  })

  // O CASO QUE JUSTIFICA O `:name`. O nome vem de `producao.camada`, que uma
  // pessoa preenche numa tela: um `${}` no lugar do `$<x:name>` sairia como
  // `ON edicao.aspas"maldosa`, que e SQL quebrado -- ou pior, valido.
  it('nome de camada com aspas nao escapa do identificador', async () => {
    const ddl = await conceder([camada('aspas"maldosa')])

    expect(ddl).toContain('"edicao"."aspas""maldosa"')
    expect(ddl).not.toContain('.aspas"maldosa"')
  })

  it('o login nao entra cru nem quando o papel tem caractere estranho', async () => {
    const ddl = await conceder([camada('aquisicao_area_p')], {
      'FROM producao.atividade AS a': { ...DADO, login: 'a"b' }
    })

    // A limpeza ja teria trocado a aspa por `_`; o que se prova e que o DDL sai
    // pelo caminho do `:name` mesmo assim.
    expect(ddl).toContain('CREATE USER "sap_a_b"')
  })

  // A EXECUCAO NAO MEXE NA CAMADA DE APONTAMENTO: ela e o registro do que a
  // revisao achou de errado no trabalho dele.
  it('na Execucao a camada de apontamento fica de fora', async () => {
    const ddl = await conceder([
      camada('aquisicao_area_p'),
      camada('revisao_omissao_p', {
        camada_apontamento: true,
        atributo_situacao_correcao: 'situacao_correcao',
        atributo_justificativa_apontamento: 'justificativa'
      })
    ])

    expect(ddl).toContain('"edicao"."aquisicao_area_p"')
    expect(ddl).not.toContain('"edicao"."revisao_omissao_p"')
  })

  // A CORRECAO E A UNICA ETAPA COM PERMISSAO PARTIDA: edita o dado e apenas
  // RESPONDE no apontamento. UPDATE livre ali deixaria o corrigido apagar o
  // apontamento em vez de resolve-lo.
  it('na Correcao o apontamento recebe SELECT e UPDATE de duas colunas so', async () => {
    const ddl = await conceder([
      camada('aquisicao_area_p', { tipo_etapa_id: TIPO_ETAPA.CORRECAO }),
      camada('revisao_omissao_p', {
        tipo_etapa_id: TIPO_ETAPA.CORRECAO,
        camada_apontamento: true,
        atributo_situacao_correcao: 'situacao_correcao',
        atributo_justificativa_apontamento: 'justificativa'
      })
    ])

    expect(ddl).toContain('GRANT SELECT ON "edicao"."revisao_omissao_p" TO "sap_fulano";')
    expect(ddl).toContain(
      'GRANT UPDATE("justificativa", "situacao_correcao") ON "edicao"."revisao_omissao_p" TO "sap_fulano";'
    )
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, DELETE, UPDATE ON "edicao"."aquisicao_area_p" TO "sap_fulano";'
    )
    expect(ddl).not.toContain(
      'GRANT SELECT, INSERT, DELETE, UPDATE ON "edicao"."revisao_omissao_p"'
    )
  })

  // A revisao aponta, entao ela escreve nas DUAS.
  it('na Revisao as duas camadas recebem escrita', async () => {
    const ddl = await conceder([
      camada('aquisicao_area_p', { tipo_etapa_id: TIPO_ETAPA.REVISAO }),
      camada('revisao_omissao_p', {
        tipo_etapa_id: TIPO_ETAPA.REVISAO,
        camada_apontamento: true,
        atributo_situacao_correcao: 'situacao_correcao',
        atributo_justificativa_apontamento: 'justificativa'
      })
    ])

    expect(ddl).toContain(
      'GRANT SELECT, INSERT, DELETE, UPDATE ON "edicao"."aquisicao_area_p" TO "sap_fulano";'
    )
    expect(ddl).toContain(
      'GRANT SELECT, INSERT, DELETE, UPDATE ON "edicao"."revisao_omissao_p" TO "sap_fulano";'
    )
  })

  // `IN ()` E ERRO DE SINTAXE, e a origem nao conferia: uma subfase sem camada
  // comum numa etapa de Execucao derrubava a concessao inteira com uma mensagem
  // que falava de SQL, e nao de cadastro.
  it('lista de camadas vazia nao monta consulta de catalogo', async () => {
    const ddl = await conceder([
      camada('revisao_omissao_p', {
        camada_apontamento: true,
        atributo_situacao_correcao: 'situacao_correcao',
        atributo_justificativa_apontamento: 'justificativa'
      })
    ])

    expect(ddl).not.toContain('IN ()')
    // O que ainda tem de sair, porque nao depende da lista.
    expect(ddl).toContain('GRANT CONNECT ON DATABASE "banco_de_teste"')
  })
})

describe('revogar o acesso de uma atividade', () => {
  const respostas = {
    'FROM producao.atividade AS a': DADO,
    'FROM producao.login_temporario': { login: 'sap_fulano', senha: 'senha-guardada' },
    'FROM pg_catalog.pg_roles': { rolname: 'sap_fulano' },
    revoke_query: { revoke_query: 'REVOKE ALL ON TABLE "edicao"."x" FROM "sap_fulano";' }
  }

  // SAO DOIS EFEITOS, e o segundo e o que fecha de fato: sem trocar a senha,
  // quem guardou a credencial do pacote continua CONECTANDO ao banco de edicao
  // depois de entregar o trabalho -- sem permissao em camada nenhuma, mas dentro.
  it('revoga E troca a senha do papel', async () => {
    const f = ligar(respostas)

    const r = await permissoes.revogarAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(r).toEqual({ login: 'sap_fulano', revogou: true })

    const ddl = f.registro.producao.join('\n')
    expect(ddl).toContain('ALTER USER "sap_fulano" WITH PASSWORD')
    expect(ddl).toContain('REVOKE ALL ON TABLE "edicao"."x" FROM "sap_fulano";')
  })

  // A SENHA NOVA NAO E A GUARDADA. Gravar de volta a mesma senha faria o
  // `ALTER` acima ser teatro.
  it('a senha gravada depois da revogacao e outra', async () => {
    const f = ligar(respostas)

    await permissoes.revogarAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    const insercao = f.registro.sca.find(t => t.includes('INSERT INTO producao.login_temporario'))
    expect(insercao).toBeDefined()
    expect(insercao).not.toContain('senha-guardada')
  })

  // O gerador nao achou privilegio nenhum: `revogou` e falso, e quem chama
  // distingue "revoguei" de "nao havia o que revogar".
  it('diz que nao revogou quando nao havia privilegio', async () => {
    ligar({ ...respostas, revoke_query: { revoke_query: null } })

    const r = await permissoes.revogarAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(r.revogou).toBe(false)
  })

  it('devolve nulo quando o dado de producao nao e PostGIS controlado', async () => {
    ligar({ 'FROM producao.atividade AS a': null })

    await expect(
      permissoes.revogarAcesso({ atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO })
    ).resolves.toBeNull()
  })
})

describe('a revogacao de uma pessoa pela gerencia', () => {
  // A LINHA PODE NAO EXISTIR e o papel continuar la: a pessoa recebeu acesso
  // pela versao anterior do sistema, ou alguem apagou a linha a mao. Responder
  // "nada a revogar" ali seria a revogacao que nao revoga.
  it('deriva o papel do login quando nao ha linha guardada', async () => {
    const f = ligar({
      'FROM producao.dado_producao': { id: 9, configuracao_producao: CONFIGURACAO },
      'FROM producao.login_temporario': null,
      'FROM dgeo.usuario WHERE uuid': { login: 'fulano' },
      'FROM pg_catalog.pg_roles': { rolname: 'sap_fulano' },
      revoke_query: { revoke_query: 'REVOKE CONNECT ON DATABASE "banco_de_teste" FROM "sap_fulano";' }
    })

    const r = await permissoes.revogarUsuarioDoBanco({
      dadoProducaoId: 9, usuarioUuid: UUID, quemPediu: UUID, contexto: CONTEXTO
    })

    expect(r).toEqual({
      login: 'sap_fulano', papel_existia: true, revogou: true, senha_trocada: true
    })
    expect(f.registro.producao.join('\n')).toContain('REVOKE CONNECT ON DATABASE')
  })

  it('nao inventa papel quando ele nao existe no banco de producao', async () => {
    const f = ligar({
      'FROM producao.dado_producao': { id: 9, configuracao_producao: CONFIGURACAO },
      'FROM producao.login_temporario': null,
      'FROM dgeo.usuario WHERE uuid': { login: 'fulano' },
      'FROM pg_catalog.pg_roles': null
    })

    const r = await permissoes.revogarUsuarioDoBanco({
      dadoProducaoId: 9, usuarioUuid: UUID, quemPediu: UUID, contexto: CONTEXTO
    })

    expect(r.papel_existia).toBe(false)
    expect(f.registro.producao.join('\n')).not.toContain('CREATE USER')
  })

  it('recusa dado de producao que nao e PostGIS controlado', async () => {
    ligar({ 'FROM producao.dado_producao': null })

    await expect(
      permissoes.revogarUsuarioDoBanco({
        dadoProducaoId: 9, usuarioUuid: UUID, quemPediu: UUID, contexto: CONTEXTO
      })
    ).rejects.toThrow(AppError)
  })
})

describe('a revogacao em massa', () => {
  // A DIVERGENCIA QUE MAIS IMPORTA em relacao a origem: la o lote saia sem
  // filtro de beneficiario, e uma rota de web revogava tudo de TODO papel do
  // banco de edicao -- inclusive do papel da aplicacao que escreve nele.
  it('so alcanca os papeis com o prefixo do subsistema', async () => {
    // A ORDEM DAS CHAVES IMPORTA: o gerador em massa TAMBEM le `pg_roles` (foi o
    // que consertou o papel que so tinha CONNECT), entao a resposta do gerador
    // tem de casar primeiro. E o proprio duble provando que os dois caminhos
    // batem na mesma tabela.
    const f = ligar({
      'WITH temporarios AS': { revoke_query: 'REVOKE ALL ON SCHEMA "edicao" FROM "sap_fulano";' },
      'FROM producao.dado_producao': { id: 9, configuracao_producao: CONFIGURACAO },
      'FROM pg_catalog.pg_roles': [{ rolname: 'sap_fulano' }, { rolname: 'sap_beltrano' }]
    })

    const r = await permissoes.revogarTodosDoBanco({
      dadoProducaoId: 9, quemPediu: UUID, contexto: CONTEXTO
    })

    expect(r).toEqual({ papeis: 2, revogou: true })

    const gerador = f.registro.producao.find(t => t.includes('WITH temporarios AS'))
    expect(gerador).toBeDefined()
    expect(gerador).toContain(`= '${permissoes.PREFIXO_LOGIN}'`)
  })
})

describe('a reaplicacao das permissoes em execucao', () => {
  // A SENHA NAO MUDA, e e a unica operacao do subsistema em que ela nao muda:
  // trocar aqui derrubaria a proxima reconexao de todo mundo que esta
  // trabalhando, para consertar o cadastro de uma subfase.
  it('revoga e reconcede sem trocar a senha de ninguem', async () => {
    const f = ligar({
      'WHERE a.tipo_situacao_atividade_id': [{
        atividade_id: 7,
        usuario_uuid: UUID,
        dado_producao_id: 9,
        configuracao_producao: CONFIGURACAO,
        login: 'fulano'
      }],
      'FROM producao.login_temporario': { login: 'sap_fulano', senha: 'senha-guardada' },
      'FROM pg_catalog.pg_roles': { rolname: 'sap_fulano' },
      'FROM producao.camada AS c': [camada('aquisicao_area_p')],
      revoke_query: { revoke_query: 'REVOKE ALL ON TABLE "edicao"."x" FROM "sap_fulano";' }
    })

    const r = await permissoes.reaplicarEmExecucao({ quemPediu: UUID, contexto: CONTEXTO })

    expect(r).toEqual({ atividades: 1, reaplicadas: 1, falhas: [] })

    const ddl = f.registro.producao.join('\n')
    expect(ddl).toContain('REVOKE ALL ON TABLE')
    expect(ddl).toContain('GRANT SELECT, INSERT, DELETE, UPDATE ON "edicao"."aquisicao_area_p"')
    expect(ddl).not.toContain('WITH PASSWORD')
  })

  // UMA ATIVIDADE QUE FALHA NAO DERRUBA AS OUTRAS: sao N bancos de edicao, e um
  // deles fora do ar nao pode impedir a reaplicacao nos demais.
  it('a atividade sem papel entra nas falhas e as outras seguem', async () => {
    ligar({
      'WHERE a.tipo_situacao_atividade_id': [{
        atividade_id: 7,
        usuario_uuid: UUID,
        dado_producao_id: 9,
        configuracao_producao: CONFIGURACAO,
        login: 'fulano'
      }],
      'FROM producao.login_temporario': null,
      'FROM pg_catalog.pg_roles': null
    })

    const r = await permissoes.reaplicarEmExecucao({ quemPediu: UUID, contexto: CONTEXTO })

    expect(r.reaplicadas).toBe(0)
    expect(r.falhas).toEqual([
      { atividade_id: 7, razao: 'papel não existe no banco de produção' }
    ])
  })
})

// ---------------------------------------------------------------------------
// O RASTRO
// ---------------------------------------------------------------------------

describe('a auditoria do ato', () => {
  const respostas = {
    'FROM producao.atividade AS a': DADO,
    'FROM producao.login_temporario': null,
    'FROM pg_catalog.pg_roles': null,
    'FROM producao.camada AS c': [camada('aquisicao_area_p')]
  }

  const evento = registro =>
    registro.sca.find(t => t.includes('INSERT INTO auditoria.evento'))

  it('grava o evento e a linha na MESMA transacao', async () => {
    const f = ligar(respostas)

    await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    const textos = f.registro.sca
    const iLinha = textos.findIndex(t => t.includes('INSERT INTO producao.login_temporario'))
    const iEvento = textos.findIndex(t => t.includes('INSERT INTO auditoria.evento'))

    expect(iLinha).toBeGreaterThanOrEqual(0)
    expect(iEvento).toBeGreaterThan(iLinha)
  })

  // FALHAR AO AUDITAR DERRUBA A ESCRITA, e e deliberado: trilha que se perde em
  // silencio e pior do que trilha nenhuma, porque quem a le acredita nela. Aqui
  // isso se prova pela PROPAGACAO -- a excecao do evento sobe pela funcao
  // inteira, e nao e engolida.
  it('a falha do evento derruba a chamada inteira', async () => {
    const f = ligar(respostas)

    const noneOriginal = f.sca.none
    f.sca.none = async (q, v) => {
      if (String(q).includes('INSERT INTO auditoria.evento')) {
        throw new Error('auditoria indisponível')
      }
      return noneOriginal(q, v)
    }

    await expect(
      permissoes.garantirAcesso({ atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO })
    ).rejects.toThrow('auditoria indisponível')
  })

  it('o evento diz quem, para quem e para qual atividade', async () => {
    const f = ligar(respostas)

    await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    const texto = evento(f.registro)
    expect(texto).toContain('producao.acesso_banco_producao')
    expect(texto).toContain('Concessão')
    expect(texto).toContain('sap_fulano')
    expect(texto).toContain(UUID)
    expect(texto).toContain('"atividade_id":7')
  })

  // O ENDERECO NAO ENTRA NA TRILHA. `dado_producao_id` e o ponteiro, e quem tem
  // acesso ao banco resolve o endereco por ele. A trilha e append-only: um
  // endereco gravado ali nao sai mais.
  it('o evento nao guarda o endereco do banco de producao', async () => {
    const f = ligar(respostas)

    await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    const texto = evento(f.registro)
    expect(texto).toContain('"dado_producao_id":9')
    expect(texto).not.toContain('servidor_de_teste')
    expect(texto).not.toContain('banco_de_teste')
  })
})

// ---------------------------------------------------------------------------
// O SEGREDO
// ---------------------------------------------------------------------------

describe('a senha do papel efemero', () => {
  const respostas = {
    'FROM producao.atividade AS a': DADO,
    'FROM producao.login_temporario': null,
    'FROM pg_catalog.pg_roles': null,
    'FROM producao.camada AS c': [camada('aquisicao_area_p')]
  }

  // ELA SAI EM DOIS LUGARES E EM MAIS NENHUM: no retorno da funcao (que e o
  // contrato do plugin) e no `INSERT` da linha (que e onde ela e guardada para o
  // proximo pedido). Nem no evento de auditoria, nem em log.
  it('nao aparece em log nenhum', async () => {
    const f = ligar(respostas)

    const info = await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    expect(info.senha).toHaveLength(40)
    expect(logs.join('\n')).not.toContain(info.senha)
    // Variancia: se o logger nunca fosse chamado, o caso passaria por vacuidade
    // e continuaria passando no dia em que alguem registrasse a senha.
    logger.info('sonda', { valor: info.senha })
    expect(logs.join('\n')).toContain(info.senha)
  })

  it('nao aparece no evento de auditoria', async () => {
    const f = ligar(respostas)

    const info = await permissoes.garantirAcesso({
      atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
    })

    const texto = f.registro.sca.find(t => t.includes('INSERT INTO auditoria.evento'))
    expect(texto).not.toContain(info.senha)
  })

  it('e do crypto, e nao derivada do login nem repetida', async () => {
    const senhas = new Set()

    for (let i = 0; i < 5; i += 1) {
      ligar(respostas)
      const info = await permissoes.garantirAcesso({
        atividadeId: 7, usuarioUuid: UUID, contexto: CONTEXTO
      })
      expect(info.senha).not.toContain('fulano')
      expect(info.senha).not.toContain(UUID)
      senhas.add(info.senha)
    }

    expect(senhas.size).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// O BANCO DE PRODUCAO FORA DO AR
// ---------------------------------------------------------------------------

describe('quando o banco de producao nao responde', () => {
  // O ERRO DO DRIVER TRAZ O HOST (`getaddrinfo ENOTFOUND ...`), e o `errorTrace`
  // de um AppError vai para o LOG e para o corpo da resposta em tudo que nao e
  // 500. Por isso `noBanco` NAO repassa a causa: e o unico lugar do sistema em
  // que se descarta o erro de origem de proposito.
  it('a frase nao traz o endereco nem a causa crua', async () => {
    process.env.PRODUCAO_DB_ADMIN_USER = 'papel-de-teste'
    process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'

    const erro = Object.assign(new Error('getaddrinfo ENOTFOUND servidor_de_teste'), {
      code: 'ENOTFOUND'
    })

    try {
      await conexaoAdmin.noBanco(CONFIGURACAO, async () => { throw erro })
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect(e.statusCode).toBe(503)
      expect(e.message).not.toContain('servidor_de_teste')
      expect(e.message).not.toContain('ENOTFOUND')
      // A causa e DESCARTADA, e nao guardada: `errorTrace` alimenta o log.
      expect(e.errorTrace).toBeNull()
    } finally {
      delete process.env.PRODUCAO_DB_ADMIN_USER
      delete process.env.PRODUCAO_DB_ADMIN_PASSWORD
    }
  })

  // ERRO QUE NAO E DE CONEXAO SOBE INTEIRO: sintaxe de DDL errada e defeito
  // nosso, e virar 503 mandaria procurar o servidor do outro lado por um bug
  // daqui.
  it('erro que nao e de conexao sobe como veio', async () => {
    process.env.PRODUCAO_DB_ADMIN_USER = 'papel-de-teste'
    process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'

    const erro = Object.assign(new Error('syntax error at or near'), { code: '42601' })

    await expect(
      conexaoAdmin.noBanco(CONFIGURACAO, async () => { throw erro })
    ).rejects.toBe(erro)

    delete process.env.PRODUCAO_DB_ADMIN_USER
    delete process.env.PRODUCAO_DB_ADMIN_PASSWORD
  })

  // SEM AS CHAVES O SUBSISTEMA FICA DESLIGADO, e nao quebrado: 503 com a frase
  // que manda configurar, e o resto do sistema inteiro.
  it('sem as chaves de ambiente a resposta manda configurar, e nao 500', async () => {
    delete process.env.PRODUCAO_DB_ADMIN_USER
    delete process.env.PRODUCAO_DB_ADMIN_PASSWORD

    expect(conexaoAdmin.configurado()).toBe(false)

    await expect(
      conexaoAdmin.noBanco(CONFIGURACAO, async () => 'nunca chega aqui')
    ).rejects.toMatchObject({ statusCode: 503, message: conexaoAdmin.SEM_CHAVES })
  })

  // Chave presente e EM BRANCO e o estado de quem editou o arquivo a mao. Ela
  // conta como ausente, e nao como usuario de nome vazio.
  it('chave em branco conta como ausente', () => {
    process.env.PRODUCAO_DB_ADMIN_USER = '   '
    process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'

    expect(conexaoAdmin.configurado()).toBe(false)

    delete process.env.PRODUCAO_DB_ADMIN_USER
    delete process.env.PRODUCAO_DB_ADMIN_PASSWORD
  })
})
