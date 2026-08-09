'use strict'

// O CONTRATO DA FATIA DE INSUMOS DO MÓDULO PRODUÇÃO, sem banco.
//
// São três coisas, e as três são de leitura de fonte ou de Joi vivo:
//
//   1. o SCHEMA, provando o MOTIVO de cada recusa (`recusaPor`), e em especial o
//      `geom` ANULÁVEL -- insumo NÃO ESPACIAL é caso legítimo, não campo
//      esquecido -- e o `epsg` de cinco caracteres;
//   2. o SEGUNDO ARGUMENTO de todo `verifyPerfil`, que é a armadilha do
//      `CLAUDE.md`: o default é 'acervo', e esquecê-lo faz a rota cobrar perfil
//      no módulo errado sem erro visível;
//   3. os DOZE caminhos e o piso de perfil de cada um, com
//      `GET /unidade_trabalho/insumos` em `operador` e as outras onze em
//      `gerente`.
//
// SEM OS DOIS AJUDANTES QUE ABREM CONEXÃO, de propósito: o `jest.config.js`
// decide o pacote LENDO o fonte à procura deles, e este arquivo tem de rodar no
// `test:rapido`. E o nome deles não pode ser escrito nem em COMENTÁRIO: a
// varredura é de texto, não de `require`, e a primeira versão desta prosa jogou
// o arquivo inteiro para o pacote de banco por citá-los.

const fs = require('fs')
const path = require('path')

const { recusaPor, aceita } = require('../../helpers/joi')

const insumoSchema = require('../../../producao/insumo_schema')
const { TIPO_INSUMO } = require('../../../utils/domain_constants')

const ROTA = path.resolve(__dirname, '..', '..', '..', 'producao', 'insumo_route.js')

// --- Fixturas ---------------------------------------------------------------
//
// NENHUM VALOR DE CAMINHO REAL AQUI. `insumo.caminho` e
// `insumo_unidade_trabalho.caminho_padrao` são pastas de rede da instalação, e
// este repositório é público: as fixturas são nomes obviamente fictícios, sem
// forma de caminho de máquina.
const CAMINHO_FICTICIO = 'insumo_ficticio_de_teste'
const CAMINHO_PADRAO_FICTICIO = 'pasta_ficticia_de_teste'

const POLIGONO = 'SRID=4674;POLYGON((0 0,0 1,1 1,1 0,0 0))'

const insumoValido = (extra = {}) => ({
  nome: 'Imagem fictícia 001',
  caminho: CAMINHO_FICTICIO,
  epsg: '31983',
  geom: POLIGONO,
  ...extra
})

describe('Schema do grupo de insumo', () => {
  it('aceita a criação e aplica o default de `disponivel`', () => {
    const valor = aceita(
      insumoSchema.grupoInsumoCriar.validate({
        grupo_insumos: [{ nome: 'Cobertura fictícia 2026' }]
      })
    )
    // O DDL nasce TRUE: grupo novo já serve para associar.
    expect(valor.grupo_insumos[0].disponivel).toBe(true)
  })

  it('recusa o grupo sem nome', () => {
    recusaPor(
      insumoSchema.grupoInsumoCriar.validate({ grupo_insumos: [{ disponivel: true }] }),
      ['grupo_insumos', 0, 'nome'],
      'any.required'
    )
  })

  it('recusa o nome acima dos 255 caracteres da coluna', () => {
    recusaPor(
      insumoSchema.grupoInsumoCriar.validate({
        grupo_insumos: [{ nome: 'g'.repeat(256) }]
      }),
      ['grupo_insumos', 0, 'nome'],
      'string.max'
    )
  })

  it('recusa a lista vazia: pedido sem alvo', () => {
    recusaPor(
      insumoSchema.grupoInsumoCriar.validate({ grupo_insumos: [] }),
      'grupo_insumos',
      'array.min'
    )
  })

  it('recusa a atualização sem id', () => {
    recusaPor(
      insumoSchema.grupoInsumoAtualizar.validate({
        grupo_insumos: [{ nome: 'Cobertura fictícia', disponivel: true }]
      }),
      ['grupo_insumos', 0, 'id'],
      'any.required'
    )
  })

  it('recusa o mesmo id duas vezes na atualização', () => {
    recusaPor(
      insumoSchema.grupoInsumoAtualizar.validate({
        grupo_insumos: [
          { id: 3, nome: 'A', disponivel: true },
          { id: 3, nome: 'B', disponivel: false }
        ]
      }),
      ['grupo_insumos', 1],
      'array.unique'
    )
  })

  it('recusa o id zero na exclusão: SERIAL começa em 1', () => {
    recusaPor(
      insumoSchema.grupoInsumoIds.validate({ grupo_insumos_ids: [0] }),
      ['grupo_insumos_ids', 0],
      'number.positive'
    )
  })

  it('recusa o id repetido na exclusão', () => {
    recusaPor(
      insumoSchema.grupoInsumoIds.validate({ grupo_insumos_ids: [7, 7] }),
      ['grupo_insumos_ids', 1],
      'array.unique'
    )
  })

  it('o filtro de disponibilidade tem TRÊS estados, e o ausente é "todos"', () => {
    expect(aceita(insumoSchema.grupoInsumoQuery.validate({}))).toEqual({})
    // Query chega como texto, e o Joi converte.
    expect(aceita(insumoSchema.grupoInsumoQuery.validate({ disponivel: 'false' })))
      .toEqual({ disponivel: false })
  })
})

describe('Schema do insumo', () => {
  it('aceita a carga com tipo e grupo do lote inteiro', () => {
    aceita(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido()],
        tipo_insumo_id: TIPO_INSUMO.ARQUIVO_ABERTO_VIA_REDE,
        grupo_insumo_id: 4
      })
    )
  })

  // O CASO QUE PROVA O DESENHO: `producao.insumo.geom` é ANULÁVEL, e a ausência
  // é uma afirmação. Insumo NÃO ESPACIAL (uma tabela, um serviço, um documento)
  // não tem recorte e vale para toda a área -- não é campo esquecido. No SAP a
  // geometria era obrigatória na criação, e este caso teria sido recusado lá.
  it('ACEITA o insumo não espacial, com geom nula, na CRIAÇÃO', () => {
    const valor = aceita(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido({ geom: null, epsg: null })],
        tipo_insumo_id: TIPO_INSUMO.SERVICO_WMS,
        grupo_insumo_id: 4
      })
    )
    expect(valor.insumos[0].geom).toBeNull()
  })

  it('ACEITA a string vazia em geom, que é o que o formulário manda', () => {
    aceita(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido({ geom: '' })],
        tipo_insumo_id: TIPO_INSUMO.BANCO_POSTGIS,
        grupo_insumo_id: 4
      })
    )
  })

  it('recusa MULTIPOLYGON: a coluna é geometry(POLYGON, 4674)', () => {
    recusaPor(
      insumoSchema.insumoCriar.validate({
        insumos: [
          insumoValido({ geom: 'SRID=4674;MULTIPOLYGON(((0 0,0 1,1 1,1 0,0 0)))' })
        ],
        tipo_insumo_id: TIPO_INSUMO.ARQUIVO_COPIA_VIA_REDE,
        grupo_insumo_id: 4
      }),
      ['insumos', 0, 'geom'],
      'string.pattern.base'
    )
  })

  it('recusa o SRID 4326 do SAP: aqui a geometria de controle é 4674', () => {
    recusaPor(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido({ geom: 'SRID=4326;POLYGON((0 0,0 1,1 1,1 0,0 0))' })],
        tipo_insumo_id: TIPO_INSUMO.ARQUIVO_COPIA_VIA_REDE,
        grupo_insumo_id: 4
      }),
      ['insumos', 0, 'geom'],
      'string.pattern.base'
    )
  })

  // `epsg VARCHAR(5)`, e ele NÃO é o SRID da coluna `geom` (que é sempre 4674):
  // é a projeção em que a EDIÇÃO acontece.
  it('aceita o epsg de cinco caracteres e recusa o de seis', () => {
    aceita(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido({ epsg: '31983' })],
        tipo_insumo_id: TIPO_INSUMO.ARQUIVO_COPIA_VIA_REDE,
        grupo_insumo_id: 4
      })
    )

    recusaPor(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido({ epsg: '319830' })],
        tipo_insumo_id: TIPO_INSUMO.ARQUIVO_COPIA_VIA_REDE,
        grupo_insumo_id: 4
      }),
      ['insumos', 0, 'epsg'],
      'string.max'
    )
  })

  it('recusa o insumo sem caminho: a coluna é NOT NULL', () => {
    const semCaminho = insumoValido()
    delete semCaminho.caminho

    recusaPor(
      insumoSchema.insumoCriar.validate({
        insumos: [semCaminho],
        tipo_insumo_id: TIPO_INSUMO.ARQUIVO_COPIA_VIA_REDE,
        grupo_insumo_id: 4
      }),
      ['insumos', 0, 'caminho'],
      'any.required'
    )
  })

  // O code fora do domínio é recusado AQUI, com 400. Recusado só pela chave
  // estrangeira, ele chegaria como 500.
  it('recusa o tipo de insumo que não existe em dominio.tipo_insumo', () => {
    recusaPor(
      insumoSchema.insumoCriar.validate({
        insumos: [insumoValido()],
        tipo_insumo_id: 99,
        grupo_insumo_id: 4
      }),
      'tipo_insumo_id',
      'any.only'
    )
  })

  it('recusa a atualização sem id', () => {
    recusaPor(
      insumoSchema.insumoAtualizar.validate({
        insumos: [
          insumoValido({
            tipo_insumo_id: TIPO_INSUMO.URL,
            grupo_insumo_id: 4
          })
        ]
      }),
      ['insumos', 0, 'id'],
      'any.required'
    )
  })

  it('na atualização, tipo e grupo são de CADA linha, e são obrigatórios', () => {
    recusaPor(
      insumoSchema.insumoAtualizar.validate({
        insumos: [insumoValido({ id: 12, grupo_insumo_id: 4 })]
      }),
      ['insumos', 0, 'tipo_insumo_id'],
      'any.required'
    )
  })

  it('recusa o mesmo insumo duas vezes na atualização', () => {
    const linha = insumoValido({
      id: 12,
      tipo_insumo_id: TIPO_INSUMO.XYZ_TILES,
      grupo_insumo_id: 4
    })
    recusaPor(
      insumoSchema.insumoAtualizar.validate({ insumos: [linha, { ...linha }] }),
      ['insumos', 1],
      'array.unique'
    )
  })

  it('recusa a exclusão sem nenhum id', () => {
    recusaPor(
      insumoSchema.insumoIds.validate({ insumo_ids: [] }),
      'insumo_ids',
      'array.min'
    )
  })
})

describe('Schema da associação com a unidade de trabalho', () => {
  it('exige a unidade de trabalho na leitura', () => {
    recusaPor(
      insumoSchema.unidadeTrabalhoInsumoQuery.validate({}),
      'unidade_trabalho_id',
      'any.required'
    )
  })

  it('aceita a associação por estratégia', () => {
    aceita(
      insumoSchema.associaInsumos.validate({
        unidade_trabalho_ids: [10, 11, 12],
        grupo_insumo_id: 4,
        estrategia_id: 3,
        caminho_padrao: CAMINHO_PADRAO_FICTICIO
      })
    )
  })

  it('aceita o caminho padrão vazio, que vira nulo no controlador', () => {
    aceita(
      insumoSchema.associaInsumos.validate({
        unidade_trabalho_ids: [10],
        grupo_insumo_id: 4,
        estrategia_id: 5,
        caminho_padrao: ''
      })
    )
  })

  it('recusa o caminho padrão acima dos 255 caracteres da coluna', () => {
    recusaPor(
      insumoSchema.associaInsumos.validate({
        unidade_trabalho_ids: [10],
        grupo_insumo_id: 4,
        estrategia_id: 1,
        caminho_padrao: 'c'.repeat(256)
      }),
      'caminho_padrao',
      'string.max'
    )
  })

  it('recusa a associação sem estratégia', () => {
    recusaPor(
      insumoSchema.associaInsumos.validate({
        unidade_trabalho_ids: [10],
        grupo_insumo_id: 4
      }),
      'estrategia_id',
      'any.required'
    )
  })

  it('recusa a associação sem nenhuma unidade de trabalho', () => {
    recusaPor(
      insumoSchema.associaInsumos.validate({
        unidade_trabalho_ids: [],
        grupo_insumo_id: 4,
        estrategia_id: 1
      }),
      'unidade_trabalho_ids',
      'array.min'
    )
  })

  // O RECORTE DO BLOCO SÃO DUAS CONDIÇÕES, e as subfases não são opcionais: um
  // bloco tem unidades de trabalho de várias subfases, e associar o insumo de
  // restituição às unidades de edição entregaria dado que ninguém pediu.
  it('recusa a associação de bloco sem as subfases', () => {
    recusaPor(
      insumoSchema.associaInsumosBloco.validate({
        bloco_id: 3,
        grupo_insumo_id: 4,
        estrategia_id: 1
      }),
      'subfase_ids',
      'any.required'
    )
  })

  it('recusa a exclusão de associação sem o grupo de insumo', () => {
    recusaPor(
      insumoSchema.deletaInsumosAssociados.validate({
        unidade_trabalho_ids: [10]
      }),
      'grupo_insumo_id',
      'any.required'
    )
  })
})

// --- A leitura do fonte da rota ---------------------------------------------

// Tira bloco `/* *\/` e linha `//`, para a varredura ver só código. É a mesma
// limpeza de `routes/modulo_em_toda_rota.test.js`, e pelo mesmo motivo: o
// cabeçalho deste módulo DESCREVE a armadilha citando `verifyPerfil` em prosa, e
// uma varredura crua reprovaria por causa da frase explicativa.
//
// O `\r` cai PRIMEIRO: com `core.autocrlf` ligado o fonte chega em CRLF, e o `.`
// do JavaScript não casa `\r`.
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const fonteLimpo = () => semComentario(fs.readFileSync(ROTA, 'utf8'))

const CHAMADA = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g

// `router.<metodo>('<caminho>', verifyPerfil('<nivel>', '<modulo>')`, que é como
// este arquivo escreve toda rota.
const DECLARACAO =
  /router\.(get|post|put|delete)\(\s*'([^']+)',\s*verifyPerfil\(\s*'([a-z]+)'\s*,\s*'([a-z]+)'\s*\)/g

describe('Toda rota da fatia passa o módulo para o verifyPerfil', () => {
  it('nenhuma chamada fica sem o segundo argumento, e nenhuma cobra outro módulo', () => {
    const semModulo = []
    const moduloErrado = []

    for (const achado of fonteLimpo().matchAll(CHAMADA)) {
      const [trecho, , modulo] = achado
      if (!modulo) semModulo.push(trecho)
      else if (modulo !== 'producao') moduloErrado.push(trecho)
    }

    expect(semModulo).toEqual([])
    expect(moduloErrado).toEqual([])
  })

  // CONTROLE NEGATIVO da limpeza de comentário: sem ele, um `semComentario` que
  // apagasse o arquivo inteiro deixaria o caso acima verde por vacuidade.
  it('a limpeza de comentário não come código', () => {
    expect([...fonteLimpo().matchAll(CHAMADA)]).toHaveLength(12)
  })
})

describe('Os doze caminhos da fatia de insumos, e o piso de perfil de cada um', () => {
  // O CONTRATO, e a tradução das guardas do SAP 2.3.5 está no cabeçalho da rota:
  // `verifyAdmin` virou `gerente`, e a única rota que lá tinha só o
  // `router.use(verifyLogin)` virou `operador`.
  const ESPERADO = [
    ['get', '/grupo_insumo', 'gerente'],
    ['post', '/grupo_insumo', 'gerente'],
    ['put', '/grupo_insumo', 'gerente'],
    ['delete', '/grupo_insumo', 'gerente'],
    ['get', '/insumo', 'gerente'],
    ['post', '/insumo', 'gerente'],
    ['put', '/insumo', 'gerente'],
    ['delete', '/insumo', 'gerente'],
    // A ÚNICA DE `operador` DA FATIA. Ela responde "com que dado eu trabalho
    // nesta unidade", que é pergunta de quem executa.
    ['get', '/unidade_trabalho/insumos', 'operador'],
    ['post', '/unidade_trabalho/insumos', 'gerente'],
    ['post', '/bloco/insumos', 'gerente'],
    ['delete', '/unidade_trabalho/insumos', 'gerente']
  ]

  const declaradas = () =>
    [...fonteLimpo().matchAll(DECLARACAO)].map(a => [a[1], a[2], a[3]])

  it('são exatamente estas doze, com estes pisos', () => {
    expect(declaradas().sort()).toEqual([...ESPERADO].sort())
  })

  it('GET /unidade_trabalho/insumos é a ÚNICA de operador', () => {
    const deOperador = declaradas().filter(([, , nivel]) => nivel === 'operador')
    expect(deOperador).toEqual([['get', '/unidade_trabalho/insumos', 'operador']])
  })

  it('as outras ONZE são de gerente', () => {
    const deGerente = declaradas().filter(([, , nivel]) => nivel === 'gerente')
    expect(deGerente).toHaveLength(11)
  })

  it('nenhuma rota fica em consulta: escrever e carregar insumo é ato de gerente', () => {
    expect(declaradas().filter(([, , nivel]) => nivel === 'consulta')).toEqual([])
  })
})
