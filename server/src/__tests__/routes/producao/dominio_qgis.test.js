'use strict'

// Os domínios do cadastro da produção e o catálogo do QGIS.
//
// SEM BANCO, de propósito: este arquivo tem de cair no pacote `rapido`, e o
// `jest.config.js` decide isso LENDO O FONTE à procura dos dois auxiliares que
// abrem conexão (o de semear dado e o que monta o app). Nenhum dos dois é
// carregado aqui, e o controlador também não: ele abre `../database` no
// primeiro require. O que se prova é o CONTRATO -- o Joi e a guarda declarada no
// fonte da rota --, que é justamente o que não precisa de PostgreSQL.
//
// E ATÉ A PROSA CONTA. Este comentário já derrubou o arquivo para o pacote de
// banco uma vez, por CITAR os dois nomes de auxiliar: a varredura do
// `jest.config.js` é textual e não distingue explicação de `require`. Ao
// escrever aqui, descreva-os, não os nomeie.

const fs = require('fs')
const path = require('path')

const { recusaPor, aceita } = require('../../helpers/joi')

const schema = require('../../../producao/dominio_qgis_schema')

const ROTA = path.resolve(__dirname, '..', '..', '..', 'producao', 'dominio_qgis_route.js')

// =============================================================================
// 1. O contrato de corpo (Joi)
// =============================================================================

describe('as chaves do corpo são as do SAP 2.3.5', () => {
  // O NOME DA CHAVE É O CONTRATO, e quem o consome é o SAP Gerente e o plugin
  // do QGIS, compilados fora deste repositório. Renomear qualquer uma delas não
  // dá erro de sintaxe e não aparece em teste de rota: aparece no deploy.
  const ESPERADAS = {
    grupoEstilos: 'grupo_estilos',
    grupoEstilosAtualizacao: 'grupo_estilos',
    grupoEstilosIds: 'grupo_estilos_ids',
    estilos: 'estilos',
    estilosAtualizacao: 'estilos',
    estilosIds: 'estilos_ids',
    regras: 'regras',
    regrasAtualizacao: 'regras',
    regrasIds: 'regras_ids',
    menus: 'menus',
    menusAtualizacao: 'menus',
    menusIds: 'menus_ids',
    modelos: 'modelos',
    modelosAtualizacao: 'modelos',
    modelosIds: 'modelos_ids',
    alias: 'alias',
    aliasAtualizacao: 'alias',
    aliasIds: 'alias_ids',
    temas: 'temas',
    temasAtualizacao: 'temas',
    temasIds: 'temas_ids',
    workflows: 'workflows',
    workflowsAtualizacao: 'workflows',
    workflowsIds: 'workflows_ids',
    gerenciadorFme: 'gerenciador_fme',
    gerenciadorFmeAtualizacao: 'gerenciador_fme',
    // NO SINGULAR, e não é engano: é o nome que o SAP usa desde sempre, e o
    // único fora do padrão `<coisa>_ids`.
    gerenciadorFmeIds: 'servidores_id'
  }

  it.each(Object.entries(ESPERADAS))(
    'models.%s carrega a chave %s',
    (modelo, chave) => {
      const descricao = schema[modelo].describe()
      expect(Object.keys(descricao.keys)).toEqual([chave])
    }
  )

  it('os nove catálogos têm os três modelos (criar, atualizar, ids)', () => {
    const catalogos = [
      'grupoEstilos', 'estilos', 'regras', 'menus', 'modelos',
      'alias', 'temas', 'workflows', 'gerenciadorFme'
    ]
    for (const catalogo of catalogos) {
      expect(typeof schema[catalogo].validate).toBe('function')
      expect(typeof schema[`${catalogo}Atualizacao`].validate).toBe('function')
      expect(typeof schema[`${catalogo}Ids`].validate).toBe('function')
    }
    expect(catalogos).toHaveLength(9)
  })
})

describe('grupo de estilos', () => {
  it('aceita uma leva de nomes', () => {
    const valor = aceita(
      schema.grupoEstilos.validate({ grupo_estilos: [{ nome: 'Restituição' }] })
    )
    expect(valor.grupo_estilos).toHaveLength(1)
  })

  it('recusa a lista VAZIA, que no SAP virava 500 no pgp.helpers.insert', () => {
    recusaPor(
      schema.grupoEstilos.validate({ grupo_estilos: [] }),
      'grupo_estilos',
      'array.min'
    )
  })

  it('recusa o corpo sem a chave', () => {
    recusaPor(schema.grupoEstilos.validate({}), 'grupo_estilos', 'any.required')
  })

  it('recusa a linha sem nome', () => {
    recusaPor(
      schema.grupoEstilos.validate({ grupo_estilos: [{}] }),
      ['grupo_estilos', 0, 'nome'],
      'any.required'
    )
  })

  it('recusa nome acima de 255, que é o VARCHAR da coluna', () => {
    recusaPor(
      schema.grupoEstilos.validate({ grupo_estilos: [{ nome: 'x'.repeat(256) }] }),
      ['grupo_estilos', 0, 'nome'],
      'string.max'
    )
  })

  it('a atualização exige o id', () => {
    recusaPor(
      schema.grupoEstilosAtualizacao.validate({ grupo_estilos: [{ nome: 'a' }] }),
      ['grupo_estilos', 0, 'id'],
      'any.required'
    )
  })

  it('a atualização recusa id em texto (o .strict() do SAP)', () => {
    recusaPor(
      schema.grupoEstilosAtualizacao.validate({
        grupo_estilos: [{ id: '3', nome: 'a' }]
      }),
      ['grupo_estilos', 0, 'id'],
      'number.base'
    )
  })

  it('a atualização recusa id zero, porque SERIAL começa em 1', () => {
    recusaPor(
      schema.grupoEstilosAtualizacao.validate({
        grupo_estilos: [{ id: 0, nome: 'a' }]
      }),
      ['grupo_estilos', 0, 'id'],
      'number.positive'
    )
  })

  it('a atualização recusa o mesmo id duas vezes, que é pedido ambíguo', () => {
    recusaPor(
      schema.grupoEstilosAtualizacao.validate({
        grupo_estilos: [{ id: 1, nome: 'a' }, { id: 1, nome: 'b' }]
      }),
      ['grupo_estilos', 1],
      'array.unique'
    )
  })

  it('a exclusão aceita a lista de ids', () => {
    aceita(schema.grupoEstilosIds.validate({ grupo_estilos_ids: [1, 2, 3] }))
  })

  it('a exclusão recusa id repetido', () => {
    recusaPor(
      schema.grupoEstilosIds.validate({ grupo_estilos_ids: [1, 1] }),
      ['grupo_estilos_ids', 1],
      'array.unique'
    )
  })

  it('a exclusão recusa a lista vazia', () => {
    recusaPor(
      schema.grupoEstilosIds.validate({ grupo_estilos_ids: [] }),
      'grupo_estilos_ids',
      'array.min'
    )
  })
})

describe('estilos', () => {
  const estiloValido = {
    f_table_schema: 'edgv',
    f_table_name: 'cobter_massa_dagua_a',
    f_geometry_column: 'geom',
    grupo_estilo_id: 1,
    styleqml: '<qgis></qgis>',
    stylesld: null,
    ui: null
  }

  it('aceita stylesld e ui nulos na CRIAÇÃO', () => {
    aceita(schema.estilos.validate({ estilos: [estiloValido] }))
  })

  // REGRESSÃO DA CORREÇÃO DA ORIGEM. No SAP, `estilosAtualizacao` exigia
  // `stylesld` como string: um estilo criado sem SLD (o caso comum, porque o
  // QGIS exporta QML) não podia mais ser editado pela mesma tela que o criou.
  it('aceita stylesld nulo TAMBÉM na atualização', () => {
    aceita(
      schema.estilosAtualizacao.validate({ estilos: [{ id: 7, ...estiloValido }] })
    )
  })

  it('recusa o estilo sem styleqml, que é o que o catálogo distribui', () => {
    const { styleqml, ...semQml } = estiloValido
    recusaPor(
      schema.estilos.validate({ estilos: [semQml] }),
      ['estilos', 0, 'styleqml'],
      'any.required'
    )
  })

  it('recusa grupo_estilo_id em texto', () => {
    recusaPor(
      schema.estilos.validate({ estilos: [{ ...estiloValido, grupo_estilo_id: '1' }] }),
      ['estilos', 0, 'grupo_estilo_id'],
      'number.base'
    )
  })

  it('recusa f_table_name acima de 255', () => {
    recusaPor(
      schema.estilos.validate({
        estilos: [{ ...estiloValido, f_table_name: 'x'.repeat(256) }]
      }),
      ['estilos', 0, 'f_table_name'],
      'string.max'
    )
  })

  it('recusa a chave desconhecida (o estilo do SAP tinha stylename, que é do GET)', () => {
    recusaPor(
      schema.estilos.validate({
        estilos: [{ ...estiloValido, stylename: 'Restituição' }]
      }),
      ['estilos', 0, 'stylename'],
      'object.unknown'
    )
  })
})

describe('regras, modelos e workflows: nome com teto de 255', () => {
  // As três colunas são VARCHAR(255) no `er/qgis.sql`. Sem o `.max()` aqui, o
  // 22001 do PostgreSQL chegaria como 500.
  const casos = [
    ['regras', 'regras', { nome: 'x'.repeat(256), regra: 'r' }],
    ['modelos', 'modelos', { nome: 'x'.repeat(256), descricao: 'd', model_xml: '<x/>' }],
    ['workflows', 'workflows', { nome: 'x'.repeat(256), descricao: 'd', workflow_json: '{}' }]
  ]

  it.each(casos)('%s recusa nome com 256 caracteres', (modelo, chave, linha) => {
    recusaPor(
      schema[modelo].validate({ [chave]: [linha] }),
      [chave, 0, 'nome'],
      'string.max'
    )
  })
})

describe('menus, temas e alias: nome SEM teto, porque a coluna é TEXT', () => {
  // O contrário do caso acima, e a diferença está no DDL: `qgis.qgis_menus.nome`,
  // `qgis.qgis_themes.nome` e `qgis.layer_alias.nome` são TEXT. Um `.max(255)`
  // aqui recusaria o que a coluna guardaria sem reclamar.
  const casos = [
    ['menus', 'menus', { nome: 'x'.repeat(500), definicao_menu: '<m/>' }],
    ['temas', 'temas', { nome: 'x'.repeat(500), definicao_tema: '<t/>' }],
    ['alias', 'alias', { nome: 'x'.repeat(500), definicao_alias: '{}' }]
  ]

  it.each(casos)('%s aceita nome com 500 caracteres', (modelo, chave, linha) => {
    aceita(schema[modelo].validate({ [chave]: [linha] }))
  })

  it.each(casos)('%s exige a definição', (modelo, chave, linha) => {
    const campo = Object.keys(linha).find(k => k !== 'nome')
    recusaPor(
      schema[modelo].validate({ [chave]: [{ nome: 'a' }] }),
      [chave, 0, campo],
      'any.required'
    )
  })
})

describe('gerenciador do FME', () => {
  it('aceita a lista de servidores', () => {
    aceita(
      schema.gerenciadorFme.validate({
        gerenciador_fme: [{ url: 'https://fme.exemplo/fmerest' }]
      })
    )
  })

  it('recusa o mesmo servidor duas vezes no MESMO pedido', () => {
    // A duplicata contra o que já está gravado quem pega é o UNIQUE da coluna,
    // traduzido no controlador. Esta aqui o Joi resolve sem ir ao banco.
    recusaPor(
      schema.gerenciadorFme.validate({
        gerenciador_fme: [
          { url: 'https://fme.exemplo/fmerest' },
          { url: 'https://fme.exemplo/fmerest' }
        ]
      }),
      ['gerenciador_fme', 1],
      'array.unique'
    )
  })

  it('recusa url acima de 255', () => {
    recusaPor(
      schema.gerenciadorFme.validate({
        gerenciador_fme: [{ url: 'x'.repeat(256) }]
      }),
      ['gerenciador_fme', 0, 'url'],
      'string.max'
    )
  })

  it('a exclusão só conhece servidores_id, no singular', () => {
    // O plural chega junto do singular de propósito: sozinho, ele falharia por
    // `any.required` do singular ausente, que é a MESMA recusa do caso seguinte
    // e não provaria que o plural é desconhecido.
    recusaPor(
      schema.gerenciadorFmeIds.validate({ servidores_id: [1], servidores_ids: [2] }),
      'servidores_ids',
      'object.unknown'
    )
  })

  it('a exclusão exige servidores_id', () => {
    recusaPor(
      schema.gerenciadorFmeIds.validate({}),
      'servidores_id',
      'any.required'
    )
  })
})

// =============================================================================
// 2. A guarda, lida do FONTE da rota
// =============================================================================
//
// No espírito de `__tests__/routes/modulo_em_toda_rota.test.js`: o default de
// `verifyPerfil(minimo, modulo)` é 'acervo', e uma rota daqui que esquecesse o
// segundo argumento passaria a cobrar perfil no ACERVO -- sem erro de sintaxe,
// sem teste funcional vermelho e sem nada na tela.
//
// AQUI A CONTAGEM É EXATA, e não um piso como lá. Esta fatia é uma tradução
// FECHADA de 49 rotas do `projeto_route.js` do SAP 2.3.5: rota a mais é rota que
// não veio de lá, e rota a menos é rota que sumiu na tradução.

/**
 * Tira bloco e linha de comentário, para a varredura ver só código.
 *
 * O `\r` cai PRIMEIRO: com `core.autocrlf` ligado (o padrão do Git no Windows) o
 * fonte chega em CRLF, o `.` do JavaScript não casa `\r`, e o `//.*$` pararia
 * antes do fim da linha sem apagar comentário nenhum. Mesma armadilha, e mesmo
 * remédio, do teste de módulo em toda rota.
 */
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

// router.<metodo>('<caminho>', verifyPerfil('<nivel>', '<modulo>')
const DECLARACAO =
  /router\.(get|post|put|delete)\(\s*'([^']+)',\s*verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

// Toda chamada de verifyPerfil, esteja ela onde estiver na declaração.
const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

const fonteDaRota = () => semComentario(fs.readFileSync(ROTA, 'utf8'))

const declaracoes = () =>
  [...fonteDaRota().matchAll(DECLARACAO)].map(a => ({
    metodo: a[1].toUpperCase(),
    caminho: a[2],
    nivel: a[3],
    modulo: a[4]
  }))

describe('toda rota cobra perfil no módulo producao', () => {
  it('nenhuma chamada de verifyPerfil fica sem o segundo argumento', () => {
    const semModulo = []
    const moduloErrado = []

    for (const achado of fonteDaRota().matchAll(CHAMADA)) {
      const [trecho, , modulo] = achado
      if (!modulo) semModulo.push(trecho)
      else if (modulo !== 'producao') moduloErrado.push(trecho)
    }

    expect(semModulo).toEqual([])
    expect(moduloErrado).toEqual([])
  })

  it('toda declaração de rota tem o verifyPerfil colado nela', () => {
    // Se uma rota tivesse a guarda em outra posição (ou não a tivesse), o
    // `DECLARACAO` não a casaria e as duas contagens divergiriam.
    const totalDeclaracoes = [...fonteDaRota().matchAll(/router\.(?:get|post|put|delete)\(/g)].length
    expect(declaracoes()).toHaveLength(totalDeclaracoes)
  })

  it('toda chamada de verifyPerfil pertence a uma declaração de rota', () => {
    const chamadas = [...fonteDaRota().matchAll(CHAMADA)].length
    expect(chamadas).toBe(declaracoes().length)
  })
})

describe('as 49 rotas da fatia, e nem uma a mais', () => {
  // ONZE DOMÍNIOS EM `operador`: no SAP elas tinham só o `router.use(verifyLogin)`
  // do topo. São as listas que quem LANÇA precisa para montar um formulário de
  // fluxo de produção.
  const DOMINIOS_OPERADOR = [
    '/status',
    '/tipo_rotina',
    '/tipo_criacao_unidade_trabalho',
    '/tipo_controle_qualidade',
    '/tipo_fase',
    '/tipo_pre_requisito',
    '/tipo_etapa',
    '/tipo_exibicao',
    '/tipo_restricao',
    '/tipo_insumo',
    '/tipo_dado_producao'
  ]

  // NOVE CATÁLOGOS, quatro rotas cada: no SAP as 36 tinham `verifyAdmin`.
  const CATALOGOS = [
    '/grupo_estilos',
    '/regras',
    '/menus',
    '/estilos',
    '/modelos',
    '/alias',
    '/temas',
    '/workflow',
    '/configuracao/gerenciador_fme'
  ]

  // As duas que no SAP eram de administrador e aqui ficam em `gerente`.
  const DOMINIOS_GERENTE = ['/tipo_estrategia_associacao', '/tipo_perfil_dificuldade']

  it('são exatamente 49', () => {
    expect(declaracoes()).toHaveLength(49)
  })

  it('11 domínios + 36 do catálogo + 2 de gerente fecham as 49', () => {
    expect(
      DOMINIOS_OPERADOR.length + CATALOGOS.length * 4 + DOMINIOS_GERENTE.length
    ).toBe(49)
  })

  it('os onze domínios do fluxo são GET de operador', () => {
    const operador = declaracoes().filter(r => r.nivel === 'operador')
    expect(operador.map(r => r.caminho).sort()).toEqual([...DOMINIOS_OPERADOR].sort())
    expect(operador.every(r => r.metodo === 'GET')).toBe(true)
  })

  it('cada catálogo do QGIS tem os quatro verbos, todos de gerente', () => {
    const porCaminho = {}
    for (const rota of declaracoes()) {
      if (!porCaminho[rota.caminho]) porCaminho[rota.caminho] = []
      porCaminho[rota.caminho].push(`${rota.metodo}:${rota.nivel}`)
    }

    for (const caminho of CATALOGOS) {
      expect(porCaminho[caminho].sort()).toEqual(
        ['DELETE:gerente', 'GET:gerente', 'POST:gerente', 'PUT:gerente']
      )
    }
  })

  it('as duas listas que eram de administrador no SAP ficam em gerente', () => {
    const rotas = declaracoes().filter(r => DOMINIOS_GERENTE.includes(r.caminho))
    expect(rotas).toHaveLength(2)
    expect(rotas.every(r => r.metodo === 'GET' && r.nivel === 'gerente')).toBe(true)
  })

  it('não há nível fora de operador e gerente (consulta não abre esta fatia)', () => {
    const niveis = [...new Set(declaracoes().map(r => r.nivel))].sort()
    expect(niveis).toEqual(['gerente', 'operador'])
  })

  it('GET /tipo_produto NÃO atravessou: quem responde é o subtipo, em gerencia', () => {
    expect(declaracoes().some(r => r.caminho === '/tipo_produto')).toBe(false)
  })
})

// CONTROLE NEGATIVO da limpeza de comentário. Sem ele, uma `semComentario` que
// apagasse o arquivo inteiro deixaria os casos acima verdes por vacuidade.
describe('a limpeza de comentário não come código', () => {
  it('apaga a chamada citada em comentário e mantém a de verdade', () => {
    const fonte = [
      "// a tradução é `verifyPerfil('gerente', 'producao')`",
      "router.get('/x', verifyPerfil('operador', 'producao'), handler)",
      "/* verifyPerfil('consulta') num bloco */"
    ].join('\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('operador', 'producao')"])
  })

  it('não confunde o // de uma URL com comentário', () => {
    const fonte = "const u = 'https://exemplo/x'\nverifyPerfil('gerente', 'producao')"
    expect([...semComentario(fonte).matchAll(CHAMADA)]).toHaveLength(1)
  })

  it('o fonte da rota sobrevive à limpeza', () => {
    expect(fonteDaRota()).toContain('module.exports = router')
  })
})
