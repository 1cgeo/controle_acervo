'use strict'

// A FATIA DO TRABALHO do módulo `producao`: bloco, unidade de trabalho,
// atividade e dado de produção.
//
// ESTE ARQUIVO RODA NO PACOTE `rapido`, e isso é um requisito e não um acaso.
//
// O `jest.config.js` decide o pacote LENDO O FONTE: quem menciona os dois
// ajudantes que abrem conexão (os de nome "db" e "app", sob `__tests__`) cai no
// pacote de banco. NENHUM DOS DOIS É REQUERIDO AQUI, e nenhum deve ser -- nem
// citado em prosa, porque a varredura é de texto e não distingue comentário de
// código. O que se prova abaixo é o CONTRATO (o Joi vivo) e o FONTE das rotas, e
// nada disso precisa de PostgreSQL. Quem medir comportamento contra o banco
// escreve outro arquivo, e ele cairá no pacote `banco` sozinho.
//
// QUATRO COISAS SE PROVAM AQUI:
//
//   1. o schema Joi recusa pelo MOTIVO certo, e não só recusa
//   2. toda rota carrega `verifyPerfil(..., 'producao')` com o módulo EXPLÍCITO
//   3. o controlador não cita a chave de senha do banco em lugar nenhum
//   4. os 22 caminhos declarados são exatamente estes

const fs = require('fs')
const path = require('path')

const { recusaPor, aceita } = require('../../helpers/joi')

const schema = require('../../../producao/trabalho_schema')

const PRODUCAO = path.resolve(__dirname, '..', '..', '..', 'producao')
const FONTE_ROTA = fs.readFileSync(
  path.join(PRODUCAO, 'trabalho_route.js'),
  'utf8'
)
const FONTE_CTRL = fs.readFileSync(
  path.join(PRODUCAO, 'trabalho_ctrl.js'),
  'utf8'
)

// Tira bloco `/* */` e linha `//`, para a varredura ver só código. É a mesma
// limpeza de `routes/modulo_em_toda_rota.test.js`, e pelo mesmo motivo: a PROSA
// deste módulo descreve a armadilha do módulo default, e uma varredura crua
// reprovaria por causa de uma frase explicativa.
//
// O `\r` CAI PRIMEIRO, e não é detalhe: com `core.autocrlf` ligado (o padrão do
// Git no Windows) o fonte chega em CRLF, e o `.` do JavaScript não casa `\r`.
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const POLIGONO = 'SRID=4674;POLYGON((-43.2 -22.9, -43.1 -22.9, -43.1 -22.8, -43.2 -22.9))'
const OUTRO_POLIGONO = 'SRID=4674;POLYGON((-44.2 -23.9, -44.1 -23.9, -44.1 -23.8, -44.2 -23.9))'

const unidadeValida = (extra = {}) => ({
  nome: 'MI 2965-1-NE',
  epsg: '31983',
  observacao: '',
  geom: POLIGONO,
  dado_producao_id: 1,
  bloco_id: 2,
  prioridade: 1,
  ...extra
})

// ============================================================================
// 1. O SCHEMA
// ============================================================================

describe('schema do bloco', () => {
  it('aceita um bloco completo', () => {
    const valor = aceita(
      schema.blocoCriar.validate({
        blocos: [
          { nome: 'Bloco Sul', prioridade: 1, lote_id: 7, status_execucao_id: 2 }
        ]
      })
    )
    expect(valor.blocos[0].status_execucao_id).toBe(2)
  })

  it('exige o nome do bloco', () => {
    recusaPor(
      schema.blocoCriar.validate({
        blocos: [{ prioridade: 1, lote_id: 7, status_execucao_id: 2 }]
      }),
      'blocos.0.nome',
      'any.required'
    )
  })

  // O 6 NÃO EXISTE em `dominio.tipo_status_execucao`, que tem cinco códigos. Sem
  // o `valid()`, a recusa viria da chave estrangeira como 500.
  it('recusa status de execução fora do domínio', () => {
    recusaPor(
      schema.blocoCriar.validate({
        blocos: [
          { nome: 'Bloco Sul', prioridade: 1, lote_id: 7, status_execucao_id: 6 }
        ]
      }),
      'blocos.0.status_execucao_id',
      'any.only'
    )
  })

  it('recusa o campo status_id, que é o nome do SAP 2.3.5', () => {
    recusaPor(
      schema.blocoCriar.validate({
        blocos: [{ nome: 'Bloco Sul', prioridade: 1, lote_id: 7, status_id: 1 }]
      }),
      'blocos.0.status_execucao_id',
      'any.required'
    )
  })

  it('a atualização exige o id de cada bloco', () => {
    recusaPor(
      schema.blocoAtualizar.validate({
        blocos: [
          { nome: 'Bloco Sul', prioridade: 1, lote_id: 7, status_execucao_id: 2 }
        ]
      }),
      'blocos.0.id',
      'any.required'
    )
  })

  it('a atualização recusa o mesmo bloco duas vezes', () => {
    const bloco = {
      id: 3,
      nome: 'Bloco Sul',
      prioridade: 1,
      lote_id: 7,
      status_execucao_id: 2
    }
    recusaPor(
      schema.blocoAtualizar.validate({ blocos: [bloco, { ...bloco }] }),
      'blocos.1',
      'array.unique'
    )
  })

  it('a lista de ids não pode vir vazia', () => {
    recusaPor(
      schema.blocoIds.validate({ bloco_ids: [] }),
      'bloco_ids',
      'array.min'
    )
  })

  it('o filtro da listagem só aceita os dois valores declarados', () => {
    aceita(schema.blocoQuery.validate({ status: 'execucao' }))
    aceita(schema.blocoQuery.validate({ status: 'encerrado' }))
    // 'finalizado' era o valor do SAP 2.3.5, contra o `dominio.status` que não
    // atravessou.
    recusaPor(
      schema.blocoQuery.validate({ status: 'finalizado' }),
      'status',
      'any.only'
    )
  })
})

describe('schema da unidade de trabalho: a geometria', () => {
  const criar = unidade =>
    schema.unidadeTrabalhoCriar.validate({
      unidades_trabalho: [unidade],
      subfase_ids: [1],
      lote_id: 7
    })

  it('aceita um POLYGON em SRID 4674', () => {
    const valor = aceita(criar(unidadeValida()))
    expect(valor.unidades_trabalho[0].geom).toBe(POLIGONO)
  })

  it('recusa geometria sem o prefixo de SRID', () => {
    recusaPor(
      criar(unidadeValida({ geom: 'POLYGON((-43.2 -22.9, -43.1 -22.9, -43.1 -22.8, -43.2 -22.9))' })),
      'unidades_trabalho.0.geom',
      'geometria.formato'
    )
  })

  // O 4326 É O SRID DO SAP 2.3.5, e é justamente o engano que a travessia
  // produz: quem copia uma geometria de lá acerta o formato e erra a projeção.
  it('recusa o SRID 4326 do SAP 2.3.5', () => {
    recusaPor(
      criar(unidadeValida({ geom: POLIGONO.replace('4674', '4326') })),
      'unidades_trabalho.0.geom',
      'geometria.srid'
    )
  })

  it('recusa MULTIPOLYGON, que a coluna geom não aceita', () => {
    recusaPor(
      criar(
        unidadeValida({
          geom: 'SRID=4674;MULTIPOLYGON(((-43.2 -22.9, -43.1 -22.9, -43.1 -22.8, -43.2 -22.9)))'
        })
      ),
      'unidades_trabalho.0.geom',
      'geometria.tipo'
    )
  })

  it('exige a geometria', () => {
    const unidade = unidadeValida()
    delete unidade.geom
    recusaPor(criar(unidade), 'unidades_trabalho.0.geom', 'any.required')
  })
})

describe('schema da unidade de trabalho: o epsg de cinco caracteres', () => {
  const criar = unidade =>
    schema.unidadeTrabalhoCriar.validate({
      unidades_trabalho: [unidade],
      subfase_ids: [1],
      lote_id: 7
    })

  it('aceita o código de cinco dígitos de uma UTM do SIRGAS 2000', () => {
    const valor = aceita(criar(unidadeValida({ epsg: '31983' })))
    expect(valor.unidades_trabalho[0].epsg).toBe('31983')
  })

  // A COLUNA É VARCHAR(5): o sexto caractere é truncamento ou erro de 500 no
  // banco, e aqui vira 400.
  it('recusa mais de cinco caracteres', () => {
    recusaPor(
      criar(unidadeValida({ epsg: '319830' })),
      'unidades_trabalho.0.epsg',
      'string.max'
    )
  })

  it('recusa o que não é o código numérico', () => {
    recusaPor(
      criar(unidadeValida({ epsg: 'UTM23' })),
      'unidades_trabalho.0.epsg',
      'string.pattern.base'
    )
  })

  // O SAP 2.3.5 ACEITAVA `''` AQUI, e a string vazia passa pelo NOT NULL do
  // banco: ela só falharia lá na frente, no QGIS.
  it('recusa a string vazia que o SAP 2.3.5 aceitava', () => {
    recusaPor(
      criar(unidadeValida({ epsg: '' })),
      'unidades_trabalho.0.epsg',
      'string.empty'
    )
  })

  it('exige o epsg', () => {
    const unidade = unidadeValida()
    delete unidade.epsg
    recusaPor(criar(unidade), 'unidades_trabalho.0.epsg', 'any.required')
  })
})

describe('schema da unidade de trabalho: os demais campos', () => {
  const criar = corpo => schema.unidadeTrabalhoCriar.validate(corpo)

  it('disponivel nasce FALSO, como o default do banco', () => {
    const valor = aceita(
      criar({
        unidades_trabalho: [unidadeValida()],
        subfase_ids: [1],
        lote_id: 7
      })
    )
    expect(valor.unidades_trabalho[0].disponivel).toBe(false)
    expect(valor.unidades_trabalho[0].dificuldade).toBe(0)
    expect(valor.unidades_trabalho[0].tempo_estimado_minutos).toBe(0)
  })

  // Espelha o CHECK `unidade_trabalho_dificuldade` do DDL.
  it('recusa dificuldade negativa', () => {
    recusaPor(
      criar({
        unidades_trabalho: [unidadeValida({ dificuldade: -1 })],
        subfase_ids: [1],
        lote_id: 7
      }),
      'unidades_trabalho.0.dificuldade',
      'number.min'
    )
  })

  it('exige o lote', () => {
    recusaPor(
      criar({ unidades_trabalho: [unidadeValida()], subfase_ids: [1] }),
      'lote_id',
      'any.required'
    )
  })

  it('exige ao menos uma subfase', () => {
    recusaPor(
      criar({
        unidades_trabalho: [unidadeValida()],
        subfase_ids: [],
        lote_id: 7
      }),
      'subfase_ids',
      'array.min'
    )
  })

  it('a consulta exige o lote', () => {
    recusaPor(
      schema.unidadeTrabalhoQuery.validate({}),
      'lote_id',
      'any.required'
    )
  })
})

describe('schema das três operações geométricas', () => {
  it('o reshape cobra o SRID na geometria nova', () => {
    recusaPor(
      schema.unidadeTrabalhoReshape.validate({
        unidade_trabalho_id: 5,
        reshape_geom: POLIGONO.replace('4674', '4326')
      }),
      'reshape_geom',
      'geometria.srid'
    )
  })

  it('o reshape aceita a geometria certa', () => {
    aceita(
      schema.unidadeTrabalhoReshape.validate({
        unidade_trabalho_id: 5,
        reshape_geom: POLIGONO
      })
    )
  })

  // CORTAR EM UMA PEÇA SÓ É NÃO CORTAR.
  it('o corte exige duas peças', () => {
    recusaPor(
      schema.unidadeTrabalhoCut.validate({
        unidade_trabalho_id: 5,
        cut_geoms: [POLIGONO]
      }),
      'cut_geoms',
      'array.min'
    )
  })

  it('o corte cobra o tipo em cada peça', () => {
    recusaPor(
      schema.unidadeTrabalhoCut.validate({
        unidade_trabalho_id: 5,
        cut_geoms: [POLIGONO, 'SRID=4674;LINESTRING(-43.2 -22.9, -43.1 -22.9)']
      }),
      'cut_geoms.1',
      'geometria.tipo'
    )
  })

  it('o corte aceita duas peças distintas', () => {
    aceita(
      schema.unidadeTrabalhoCut.validate({
        unidade_trabalho_id: 5,
        cut_geoms: [POLIGONO, OUTRO_POLIGONO]
      })
    )
  })

  // JUNTAR UMA É NÃO JUNTAR.
  it('a fusão exige duas unidades de trabalho', () => {
    recusaPor(
      schema.unidadeTrabalhoMerge.validate({
        unidade_trabalho_ids: [5],
        merge_geom: POLIGONO
      }),
      'unidade_trabalho_ids',
      'array.min'
    )
  })

  it('a fusão aceita duas unidades e a geometria fundida', () => {
    aceita(
      schema.unidadeTrabalhoMerge.validate({
        unidade_trabalho_ids: [5, 6],
        merge_geom: POLIGONO
      })
    )
  })
})

describe('schema das atividades', () => {
  it('aceita o par de listas', () => {
    aceita(
      schema.atividadesCriar.validate({
        unidade_trabalho_ids: [1, 2],
        etapa_ids: [10]
      })
    )
  })

  it('exige ao menos uma etapa', () => {
    recusaPor(
      schema.atividadesCriar.validate({
        unidade_trabalho_ids: [1],
        etapa_ids: []
      }),
      'etapa_ids',
      'array.min'
    )
  })

  it('a carga do lote inteiro exige as três bandeiras', () => {
    recusaPor(
      schema.todasAtividades.validate({
        lote_id: 7,
        atividades_revisao: true,
        atividades_revisao_correcao: false
      }),
      'atividades_revisao_final',
      'any.required'
    )
  })

  // `.strict()`: a string 'true' NÃO vira booleano. Numa rota que decide se
  // milhares de atividades nascem, a coerção silenciosa é a pior das ajudas.
  it('a carga do lote inteiro não converte a string "true"', () => {
    recusaPor(
      schema.todasAtividades.validate({
        lote_id: 7,
        atividades_revisao: 'true',
        atividades_revisao_correcao: false,
        atividades_revisao_final: false
      }),
      'atividades_revisao',
      'boolean.base'
    )
  })

  it('a exclusão exige ao menos uma atividade', () => {
    recusaPor(
      schema.atividadesIds.validate({ atividades_ids: [] }),
      'atividades_ids',
      'array.min'
    )
  })
})

describe('schema do dado de produção', () => {
  it('exige o nome do banco quando o tipo é PostGIS', () => {
    recusaPor(
      schema.dadoProducaoCriar.validate({
        dado_producao: [{ tipo_dado_producao_id: 2 }]
      }),
      'dado_producao.0.configuracao_producao',
      'any.required'
    )
  })

  it('recusa o nome do banco vazio quando o tipo é PostGIS', () => {
    recusaPor(
      schema.dadoProducaoCriar.validate({
        dado_producao: [
          { tipo_dado_producao_id: 3, configuracao_producao: '' }
        ]
      }),
      'dado_producao.0.configuracao_producao',
      'string.empty'
    )
  })

  // O TIPO 1 ('Não controlado') É DADO QUE O SISTEMA APENAS APONTA, sem banco
  // nenhum, e a coluna do DDL é anulável por causa dele.
  it('dispensa o nome do banco quando o tipo não é PostGIS', () => {
    aceita(
      schema.dadoProducaoCriar.validate({
        dado_producao: [{ tipo_dado_producao_id: 1 }]
      })
    )
  })

  it('recusa tipo fora do domínio', () => {
    recusaPor(
      schema.dadoProducaoCriar.validate({
        dado_producao: [
          { tipo_dado_producao_id: 9, configuracao_producao: 'bdgex' }
        ]
      }),
      'dado_producao.0.tipo_dado_producao_id',
      'any.only'
    )
  })

  it('a atualização exige o id', () => {
    recusaPor(
      schema.dadoProducaoAtualizar.validate({
        dado_producao: [
          { tipo_dado_producao_id: 2, configuracao_producao: 'bdgex' }
        ]
      }),
      'dado_producao.0.id',
      'any.required'
    )
  })
})

// ============================================================================
// 2. O MÓDULO EXPLÍCITO EM TODA ROTA
// ============================================================================

// A ARMADILHA QUE ISTO GUARDA é a do CLAUDE.md: o default de
// `verifyPerfil(minimo, modulo)` é 'acervo'. Uma rota daqui que esquecesse o
// segundo argumento passaria a cobrar perfil no ACERVO -- sem erro de sintaxe,
// sem teste vermelho e sem nada na tela.
//
// `routes/modulo_em_toda_rota.test.js` varre `orcamento`, `mapoteca`,
// `equipamento` e `campo`, e `producao` AINDA NÃO ESTÁ na lista dele (aquele
// arquivo é do dono do módulo). Até que esteja, quem cobra esta fatia é este
// bloco.
const CHAMADA_PERFIL = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

describe('toda rota do trabalho passa o módulo para o verifyPerfil', () => {
  const chamadas = [...semComentario(FONTE_ROTA).matchAll(CHAMADA_PERFIL)]

  it('encontra as 22 chamadas de verifyPerfil', () => {
    expect(chamadas).toHaveLength(22)
  })

  it('nenhuma chamada omite o módulo, e nenhuma cita outro', () => {
    const semModulo = []
    const moduloErrado = []

    for (const [trecho, , modulo] of chamadas) {
      if (!modulo) semModulo.push(trecho)
      else if (modulo !== 'producao') moduloErrado.push(trecho)
    }

    expect(semModulo).toEqual([])
    expect(moduloErrado).toEqual([])
  })

  // O PISO DE PERFIL É UM SÓ NESTA FATIA: as 22 rotas são `verifyAdmin` no SAP
  // 2.3.5, e a tradução para o SCA é `gerente` do módulo `producao`. Elas
  // desenham a GRADE de trabalho, e quem responde pela área é o gerente.
  it('todas cobram o piso gerente', () => {
    const niveis = [...new Set(chamadas.map(c => c[1]))]
    expect(niveis).toEqual(['gerente'])
  })

  // CONTROLE NEGATIVO da limpeza de comentário: sem ele, um `semComentario` que
  // apagasse o arquivo inteiro deixaria os casos acima verdes por vacuidade.
  it('a limpeza de comentário não come código', () => {
    const fonte = [
      "// a irmã do acervo é `verifyPerfil('consulta')` SEM módulo",
      "router.get('/x', verifyPerfil('gerente', 'producao'), handler)",
      "/* verifyPerfil('operador') num bloco */"
    ].join('\r\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA_PERFIL)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('gerente', 'producao')"])
  })
})

// ============================================================================
// 3. A SENHA DO BANCO DE PRODUÇÃO NÃO SAI POR ROTA
// ============================================================================

// `GET /login` DEVOLVE APENAS O LOGIN. No SAP 2.3.5 a rota irmã devolve o par
// inteiro do `config` -- a credencial com que o cliente manda o QGIS abrir a
// conexão do banco de produção. Aqui a segunda metade foi cortada, e o corte é
// deliberado: o CLAUDE.md diz "Senha nunca em claro, e nunca de volta por
// rota", e mesmo que aquela frase tenha sido escrita sobre `dgeo.usuario.senha`
// (hash bcrypt, que é outra coisa), devolver o segredo de uma conta de banco por
// rota é mudança de postura e não detalhe de implementação.
//
// RESTAURAR O PAR É DECISÃO DO CHEFE, e decisão se registra em
// `docs/decisoes.md`. Este caso é o que faz a restauração passar por lá: quem a
// fizer sem decidir encontra o teste vermelho.
describe('a chave de senha do banco de produção não aparece no controlador', () => {
  it('o fonte de trabalho_ctrl.js não cita DB_PASSWORD', () => {
    // A busca é no fonte CRU, e não no fonte sem comentário: nem em prosa a
    // chave deve estar, porque o próximo a ler copiaria dali.
    expect(FONTE_CTRL).not.toMatch(/DB_PASSWORD/)
  })

  it('o fonte de trabalho_route.js também não a cita', () => {
    expect(FONTE_ROTA).not.toMatch(/DB_PASSWORD/)
  })

  it('o controlador lê do config apenas a chave de login', () => {
    const chaves = [...FONTE_CTRL.matchAll(/config\.([A-Z_]+)/g)].map(m => m[1])
    expect([...new Set(chaves)]).toEqual(['DB_USER'])
  })
})

// ============================================================================
// 4. OS 22 CAMINHOS DECLARADOS
// ============================================================================

// A LISTA É O CONTRATO DA FATIA, e a ORDEM dentro dela é o contrato do Express.
//
// O Express casa na ORDEM DE DECLARAÇÃO. Nenhuma rota daqui tem parâmetro de
// caminho hoje, mas `/unidade_trabalho` e `/atividades` são exatamente os
// prefixos que ganhariam um `/:id` amanhã: no dia em que isso acontecer,
// `/unidade_trabalho/bloco` cairia em `/unidade_trabalho/:id` se viesse depois.
// Por isso as de dois segmentos são declaradas antes, e por isso este teste
// prende a ORDEM e não só o conjunto.
const ROTAS_ESPERADAS = [
  ['get', '/bloco'],
  ['post', '/bloco'],
  ['put', '/bloco'],
  ['delete', '/bloco'],
  ['put', '/unidade_trabalho/bloco'],
  ['delete', '/unidade_trabalho/atividades'],
  ['post', '/unidade_trabalho/copiar'],
  ['put', '/unidade_trabalho/reshape'],
  ['put', '/unidade_trabalho/cut'],
  ['put', '/unidade_trabalho/merge'],
  ['get', '/unidade_trabalho'],
  ['post', '/unidade_trabalho'],
  ['delete', '/unidade_trabalho'],
  ['post', '/atividades/todas'],
  ['post', '/atividades'],
  ['delete', '/atividades'],
  ['get', '/dado_producao'],
  ['post', '/dado_producao'],
  ['put', '/dado_producao'],
  ['delete', '/dado_producao'],
  ['get', '/banco_dados'],
  ['get', '/login']
]

const DECLARACAO = /router\.(get|post|put|delete)\(\s*'([^']+)'/g

describe('os 22 caminhos do trabalho', () => {
  const declaradas = [...semComentario(FONTE_ROTA).matchAll(DECLARACAO)].map(
    m => [m[1], m[2]]
  )

  it('são exatamente 22', () => {
    expect(declaradas).toHaveLength(22)
  })

  it('são estes, nesta ordem', () => {
    expect(declaradas).toEqual(ROTAS_ESPERADAS)
  })

  it('a rota de dois segmentos vem antes da de um segmento homônimo', () => {
    const posicao = alvo =>
      declaradas.findIndex(([, caminho]) => caminho === alvo)

    const unidadeTrabalho = posicao('/unidade_trabalho')
    for (const caminho of [
      '/unidade_trabalho/bloco',
      '/unidade_trabalho/atividades',
      '/unidade_trabalho/copiar',
      '/unidade_trabalho/reshape',
      '/unidade_trabalho/cut',
      '/unidade_trabalho/merge'
    ]) {
      expect(posicao(caminho)).toBeLessThan(unidadeTrabalho)
    }

    expect(posicao('/atividades/todas')).toBeLessThan(posicao('/atividades'))
  })

  // NENHUMA PORTA DE ESCRITA para os dois caches espaciais. Eles são mantidos
  // pelo gatilho `a_relacionamento_unidade_trabalho` de `er/producao.sql`, e
  // abrir uma faz o cache deixar de bater com a geometria no primeiro uso --
  // exatamente como `mapoteca.estoque_material` faz com o livro de movimento.
  it('o controlador não escreve nos caches de relacionamento', () => {
    const escrita = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+producao\.relacionamento_(ut|versao)/i
    expect(FONTE_CTRL).not.toMatch(escrita)
  })

  // O `disableTriggers` DO SAP 2.3.5 NÃO EXISTE AQUI, e não deve reaparecer:
  // desligar gatilho para escrever mais rápido é o que obrigava aquele servidor
  // a recalcular o cache à mão depois.
  it('o controlador não desliga gatilho nenhum', () => {
    // A VARREDURA É NO CÓDIGO, e não na prosa: o cabeçalho do controlador
    // EXPLICA por que o ajudante do SAP 2.3.5 não existe aqui, e citar o nome
    // dele para dizer isso é o oposto de reintroduzi-lo.
    expect(semComentario(FONTE_CTRL)).not.toMatch(
      /disableTriggers|DISABLE\s+TRIGGER/i
    )
  })
})
