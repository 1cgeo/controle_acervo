'use strict'

// O FLUXO da produção (linha de produção, fase, subfase, etapa e camadas), pelo
// que dá para provar SEM banco.
//
// ELE RODA NO PACOTE `rapido`, e a condição para isso é NÃO alcançar os dois
// ajudantes que abrem conexão. O `jest.config.js` decide o pacote de cada teste
// LENDO O FONTE à procura do nome deles, e a varredura é textual: ela não
// distingue um `require` de uma MENÇÃO em comentário. Escrever aqui o nome de
// qualquer um dos dois, ainda que só para dizer que não se usa, joga este
// arquivo inteiro no pacote de banco, onde ele passa a esperar PostgreSQL para
// provar regras de Joi que não tocam banco nenhum -- e some da rodada do dia a
// dia sem falhar, que é a pior forma de sumir. Custou uma execução em
// 2026-08-09. Por isso aqui só entram o schema (Joi puro) e a leitura do FONTE
// da rota como texto.
//
// O QUE ESTE ARQUIVO GUARDA, em uma frase cada:
//
//   1. A regra de TUDO OU NADA do apontamento, que espelha o CHECK
//      `propriedades_camada_apontamento_completo` do DDL.
//   2. A regra de a EXECUÇÃO ser sempre a etapa de ordem 1, que espelha o CHECK
//      `etapa_execucao_e_primeira`.
//   3. Que TODA rota do arquivo cobra `verifyPerfil` com 'producao' explícito.
//   4. Que a rota com parâmetro vem DEPOIS de todas as literais.

const fs = require('fs')
const path = require('path')

const { recusaPor, aceita } = require('../../helpers/joi')

const fluxoSchema = require('../../../producao/fluxo_schema')

const {
  TIPO_ETAPA,
  TIPO_RESTRICAO
} = require('../../../utils/domain_constants')

const ROTA = path.resolve(__dirname, '..', '..', '..', 'producao', 'fluxo_route.js')

// --- Peças reaproveitadas pelos casos ----------------------------------------

const camadaComum = extra => ({
  schema: 'edgv',
  camada: 'elemnat_trecho_drenagem_l',
  subfase: 'Vetorização',
  camada_incomum: false,
  camada_apontamento: false,
  ...extra
})

const camadaApontamento = extra => ({
  schema: 'edgv',
  camada: 'revisao_omissao_a',
  subfase: 'Vetorização',
  camada_incomum: false,
  camada_apontamento: true,
  atributo_situacao_correcao: 'situacao_correcao',
  atributo_justificativa_apontamento: 'justificativa_apontamento',
  ...extra
})

const linhaValida = extra => ({
  linha_producao: {
    nome: 'Carta Topográfica 1:25.000',
    nome_abrev: 'ct25',
    descricao: 'Da vetorização à disseminação',
    subtipo_produto_id: 2,
    fases: [
      {
        tipo_fase_id: 6,
        ordem: 1,
        subfases: [
          { nome: 'Vetorização', ordem: 1 },
          { nome: 'Generalização', ordem: 2 }
        ]
      },
      {
        tipo_fase_id: 4,
        ordem: 2,
        subfases: [{ nome: 'Edição', ordem: 1 }],
        pre_requisito_subfase: [
          {
            subfase_anterior: 'Vetorização',
            subfase_posterior: 'Edição',
            tipo_pre_requisito_id: 1
          }
        ]
      }
    ],
    propriedades_camadas: [camadaComum(), camadaApontamento()],
    ...extra
  }
})

// --- 1. A camada de apontamento é TUDO OU NADA -------------------------------

describe('propriedades de camada: o apontamento é tudo ou nada', () => {
  const schema = fluxoSchema.propriedadesCamadaNova

  it('aceita camada comum, sem nenhum dos dois atributos', () => {
    const valor = aceita(schema.validate(camadaComum()))
    expect(valor.camada_apontamento).toBe(false)
  })

  it('aceita camada de apontamento com os dois atributos', () => {
    const valor = aceita(schema.validate(camadaApontamento()))
    expect(valor.atributo_situacao_correcao).toBe('situacao_correcao')
    expect(valor.atributo_justificativa_apontamento).toBe(
      'justificativa_apontamento'
    )
  })

  it('recusa apontamento SEM o atributo de situação da correção', () => {
    const corpo = camadaApontamento()
    delete corpo.atributo_situacao_correcao

    recusaPor(
      schema.validate(corpo),
      'atributo_situacao_correcao',
      'any.required'
    )
  })

  it('recusa apontamento SEM o atributo de justificativa', () => {
    const corpo = camadaApontamento()
    delete corpo.atributo_justificativa_apontamento

    recusaPor(
      schema.validate(corpo),
      'atributo_justificativa_apontamento',
      'any.required'
    )
  })

  it('recusa camada COMUM com o atributo de situação da correção', () => {
    recusaPor(
      schema.validate(
        camadaComum({ atributo_situacao_correcao: 'situacao_correcao' })
      ),
      'atributo_situacao_correcao',
      'any.only'
    )
  })

  it('recusa camada COMUM com o atributo de justificativa', () => {
    recusaPor(
      schema.validate(
        camadaComum({
          atributo_justificativa_apontamento: 'justificativa_apontamento'
        })
      ),
      'atributo_justificativa_apontamento',
      'any.only'
    )
  })

  it('a mensagem dos quatro casos sai em português', () => {
    const corpo = camadaApontamento()
    delete corpo.atributo_situacao_correcao
    const { error } = schema.validate(corpo)

    expect(error.details[0].message).toContain('Camada de apontamento exige')
    // Sem uma palavra sequer da mensagem padrão do Joi.
    expect(error.details[0].message).not.toContain('is required')
  })

  // A DIVERGÊNCIA DELIBERADA EM RELAÇÃO AO SAP. Lá o `atributo_filtro_subfase`
  // era exigido junto do apontamento e PROIBIDO fora dele. O CHECK do banco não
  // o menciona: ele filtra a camada POR SUBFASE e serve à camada incomum tanto
  // quanto à de apontamento. Um Joi que o recusasse bloquearia um caso que o
  // banco aceita, sem nada no DDL para explicar por quê.
  it('deixa o atributo de filtro por subfase livre em camada comum', () => {
    const valor = aceita(
      schema.validate(camadaComum({ atributo_filtro_subfase: 'subfase' }))
    )
    expect(valor.atributo_filtro_subfase).toBe('subfase')
  })

  it('recusa camada sem declarar se é de apontamento', () => {
    const corpo = camadaComum()
    delete corpo.camada_apontamento

    recusaPor(schema.validate(corpo), 'camada_apontamento', 'any.required')
  })
})

// --- 2. A Execução é sempre a etapa de ordem 1 -------------------------------

describe('padrão de controle de qualidade: a Execução é a etapa de ordem 1', () => {
  const padroes = fluxoSchema.PADRAO_CONTROLE_QUALIDADE

  it('declara os três códigos de dominio.tipo_controle_qualidade', () => {
    expect(Object.keys(padroes).map(Number).sort()).toEqual([1, 2, 3])
  })

  // ESTE É O CASO QUE GUARDA O CHECK `etapa_execucao_e_primeira`. O controlador
  // grava `ordem = indice + 1`, então "Execução no índice 0" e "Execução com
  // ordem 1" são a mesma afirmação. Um padrão novo que pusesse a Revisão antes
  // reprovaria aqui, e não com um 23514 em produção.
  it.each(Object.keys(padroes).map(Number))(
    'no padrão %i a Execução é a primeira etapa',
    codigo => {
      expect(padroes[codigo].etapas[0]).toBe(TIPO_ETAPA.EXECUCAO)
    }
  )

  it('a Execução aparece UMA vez em cada padrão', () => {
    for (const codigo of Object.keys(padroes)) {
      const execucoes = padroes[codigo].etapas.filter(
        e => e === TIPO_ETAPA.EXECUCAO
      )
      expect(execucoes).toHaveLength(1)
    }
  })

  it('toda restrição aponta para índices que existem no próprio padrão', () => {
    for (const codigo of Object.keys(padroes)) {
      const { etapas, restricoes } = padroes[codigo]
      for (const r of restricoes) {
        expect(etapas[r.de]).toBeDefined()
        expect(etapas[r.para]).toBeDefined()
        // Anterior e posterior, nesta ordem: a restrição é dirigida.
        expect(r.de).toBeLessThan(r.para)
      }
    }
  })

  it('o padrão 1 é só a Execução, sem restrição nenhuma', () => {
    expect(padroes[1].etapas).toEqual([TIPO_ETAPA.EXECUCAO])
    expect(padroes[1].restricoes).toEqual([])
  })

  it('o padrão 2 é Execução e Revisão/Correção, com operadores distintos', () => {
    expect(padroes[2].etapas).toEqual([
      TIPO_ETAPA.EXECUCAO,
      TIPO_ETAPA.REVISAO_CORRECAO
    ])
    expect(padroes[2].restricoes).toEqual([
      { tipo: TIPO_RESTRICAO.OPERADORES_DISTINTOS, de: 0, para: 1 }
    ])
  })

  // Quem executou NÃO revisa (tipo 1) e quem executou É quem corrige (tipo 2).
  // As duas partem da mesma Execução, e é por isso que a restrição aponta
  // índice e não tipo de etapa.
  it('o padrão 3 separa a revisão da correção, com restrições opostas', () => {
    expect(padroes[3].etapas).toEqual([
      TIPO_ETAPA.EXECUCAO,
      TIPO_ETAPA.REVISAO,
      TIPO_ETAPA.CORRECAO
    ])
    expect(padroes[3].restricoes).toEqual([
      { tipo: TIPO_RESTRICAO.OPERADORES_DISTINTOS, de: 0, para: 1 },
      { tipo: TIPO_RESTRICAO.OPERADORES_IGUAIS, de: 0, para: 2 }
    ])
  })
})

describe('corpo de POST /etapas/padrao', () => {
  const schema = fluxoSchema.etapasPadrao

  const corpo = extra => ({
    tipo_controle_qualidade_id: 3,
    fase_id: 7,
    lote_id: 42,
    ...extra
  })

  it('aceita os três códigos implementados', () => {
    for (const codigo of [1, 2, 3]) {
      aceita(schema.validate(corpo({ tipo_controle_qualidade_id: codigo })))
    }
  })

  // O `.valid()` sai da tabela de padrões: aceito e implementado são a MESMA
  // lista, e não duas que envelhecem em separado.
  it('recusa um código sem padrão implementado', () => {
    recusaPor(
      schema.validate(corpo({ tipo_controle_qualidade_id: 4 })),
      'tipo_controle_qualidade_id',
      'any.only'
    )
  })

  it('exige a fase e o lote', () => {
    const semFase = corpo()
    delete semFase.fase_id
    recusaPor(schema.validate(semFase), 'fase_id', 'any.required')

    const semLote = corpo()
    delete semLote.lote_id
    recusaPor(schema.validate(semLote), 'lote_id', 'any.required')
  })

  it('recusa lote_id zero antes de ir ao banco', () => {
    recusaPor(schema.validate(corpo({ lote_id: 0 })), 'lote_id', 'number.positive')
  })
})

// --- 3. A linha de produção inteira num corpo só -----------------------------

describe('corpo de POST /linha_producao', () => {
  const schema = fluxoSchema.linhaProducao

  it('aceita a linha completa, com fases, subfases, pré-requisito e camadas', () => {
    const valor = aceita(schema.validate(linhaValida()))
    expect(valor.linha_producao.fases).toHaveLength(2)
    expect(valor.linha_producao.propriedades_camadas).toHaveLength(2)
  })

  it('exige nome, nome abreviado e subtipo de produto', () => {
    for (const campo of ['nome', 'nome_abrev', 'subtipo_produto_id']) {
      const corpo = linhaValida()
      delete corpo.linha_producao[campo]
      recusaPor(schema.validate(corpo), `linha_producao.${campo}`, 'any.required')
    }
  })

  it('recusa chave desconhecida no corpo', () => {
    const corpo = linhaValida()
    corpo.linha_producao.tipo_produto_id = 2

    recusaPor(
      schema.validate(corpo),
      'linha_producao.tipo_produto_id',
      'object.unknown'
    )
  })

  it('recusa duas fases com a mesma ordem', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[1].ordem = 1

    recusaPor(schema.validate(corpo), 'linha_producao.fases.1', 'array.unique')
  })

  it('recusa duas subfases com o mesmo nome na mesma fase', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[0].subfases[1].nome = 'Vetorização'

    recusaPor(
      schema.validate(corpo),
      'linha_producao.fases.0.subfases.1',
      'array.unique'
    )
  })

  // O BURACO DO MAPA `nome -> id` DO SAP, fechado antes da transação abrir. Lá
  // a subfase repetida em OUTRA fase sobrescrevia a entrada do mapa, e o
  // pré-requisito ia parar na subfase errada, sem erro nenhum.
  it('recusa a mesma subfase declarada em duas fases diferentes', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[1].subfases[0].nome = 'Vetorização'

    recusaPor(schema.validate(corpo), 'linha_producao', 'fluxo.subfaseRepetida')
  })

  it('a mensagem da subfase repetida cita o nome repetido', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[1].subfases[0].nome = 'Vetorização'

    const { error } = schema.validate(corpo)
    expect(error.details[0].message).toContain('Vetorização')
  })

  it('recusa pré-requisito que cita subfase não declarada', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[1].pre_requisito_subfase[0].subfase_anterior =
      'Restituição'

    recusaPor(schema.validate(corpo), 'linha_producao', 'fluxo.subfaseDesconhecida')
  })

  it('recusa propriedade de camada que cita subfase não declarada', () => {
    const corpo = linhaValida()
    corpo.linha_producao.propriedades_camadas[0].subfase = 'Restituição'

    recusaPor(schema.validate(corpo), 'linha_producao', 'fluxo.subfaseDesconhecida')
  })

  it('recusa subfase que é pré-requisito de si mesma', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[1].pre_requisito_subfase[0].subfase_posterior =
      'Vetorização'
    corpo.linha_producao.fases[1].pre_requisito_subfase[0].subfase_anterior =
      'Vetorização'

    recusaPor(
      schema.validate(corpo),
      'linha_producao',
      'fluxo.preRequisitoDeSiMesma'
    )
  })

  it('recusa a mesma camada duas vezes na mesma subfase', () => {
    const corpo = linhaValida()
    corpo.linha_producao.propriedades_camadas = [camadaComum(), camadaComum()]

    recusaPor(
      schema.validate(corpo),
      'linha_producao.propriedades_camadas.1',
      'array.unique'
    )
  })

  // A REGRA DO APONTAMENTO VALE DENTRO DA LINHA DE PRODUÇÃO, e não só quando o
  // schema de propriedade é validado sozinho: é por este caminho que ela chega
  // ao banco.
  it('cobra o apontamento completo dentro do corpo da linha de produção', () => {
    const corpo = linhaValida()
    delete corpo.linha_producao.propriedades_camadas[1]
      .atributo_justificativa_apontamento

    recusaPor(
      schema.validate(corpo),
      'linha_producao.propriedades_camadas.1.atributo_justificativa_apontamento',
      'any.required'
    )
  })

  it('recusa linha de produção sem nenhuma fase', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases = []

    recusaPor(schema.validate(corpo), 'linha_producao.fases', 'array.min')
  })

  it('recusa fase sem nenhuma subfase', () => {
    const corpo = linhaValida()
    corpo.linha_producao.fases[0].subfases = []

    recusaPor(
      schema.validate(corpo),
      'linha_producao.fases.0.subfases',
      'array.min'
    )
  })
})

describe('corpo de PUT /linha_producao', () => {
  const schema = fluxoSchema.linhaProducaoAtualizacao

  it('aceita a lista de aposentadorias', () => {
    aceita(
      schema.validate({
        linhas_producao: [
          { id: 1, disponivel: false },
          { id: 2, disponivel: true }
        ]
      })
    )
  })

  it('recusa o mesmo id duas vezes', () => {
    recusaPor(
      schema.validate({
        linhas_producao: [
          { id: 1, disponivel: false },
          { id: 1, disponivel: true }
        ]
      }),
      'linhas_producao.1',
      'array.unique'
    )
  })

  // SÓ `disponivel` MUDA: renomear a linha ou trocar o subtipo mudaria o
  // significado das fases e etapas já gravadas.
  it('recusa qualquer campo além de id e disponivel', () => {
    recusaPor(
      schema.validate({
        linhas_producao: [{ id: 1, disponivel: false, nome: 'outro nome' }]
      }),
      'linhas_producao.0.nome',
      'object.unknown'
    )
  })

  it('recusa lista vazia', () => {
    recusaPor(
      schema.validate({ linhas_producao: [] }),
      'linhas_producao',
      'array.min'
    )
  })
})

// --- 4. Camadas --------------------------------------------------------------

describe('corpos das rotas de camada', () => {
  it('aceita a criação em massa', () => {
    aceita(
      fluxoSchema.camadas.validate({
        camadas: [
          { schema: 'edgv', nome: 'elemnat_trecho_drenagem_l' },
          { schema: 'edgv', nome: 'infra_via_deslocamento_l' }
        ]
      })
    )
  })

  it('recusa o mesmo par (schema, nome) duas vezes na criação', () => {
    recusaPor(
      fluxoSchema.camadas.validate({
        camadas: [
          { schema: 'edgv', nome: 'elemnat_trecho_drenagem_l' },
          { schema: 'edgv', nome: 'elemnat_trecho_drenagem_l' }
        ]
      }),
      'camadas.1',
      'array.unique'
    )
  })

  it('a atualização exige o id de cada camada', () => {
    recusaPor(
      fluxoSchema.camadasAtualizacao.validate({
        camadas: [{ schema: 'edgv', nome: 'x' }]
      }),
      'camadas.0.id',
      'any.required'
    )
  })

  it('a exclusão recusa lista vazia', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: [] }),
      'camadas_ids',
      'array.min'
    )
  })

  it('a exclusão recusa id repetido', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: [3, 3] }),
      'camadas_ids.1',
      'array.unique'
    )
  })
})

// --- 5. Consultas ------------------------------------------------------------

describe('consultas das rotas de leitura', () => {
  it('o filtro de status aceita apenas ativo e inativo', () => {
    aceita(fluxoSchema.ativoQuery.validate({ status: 'ativo' }))
    aceita(fluxoSchema.ativoQuery.validate({}))
    recusaPor(
      fluxoSchema.ativoQuery.validate({ status: 'disponivel' }),
      'status',
      'any.only'
    )
  })

  it('subfase_ids é uma lista de números separados por vírgula', () => {
    const valor = aceita(
      fluxoSchema.subfasesLoteQuery.validate({ subfase_ids: '3,7,9' })
    )
    expect(valor.subfase_ids).toBe('3,7,9')
  })

  it('a geometria é opt-in, e o padrão é não trazê-la', () => {
    const valor = aceita(fluxoSchema.subfasesLoteQuery.validate({}))
    expect(valor.incluir_geom).toBe(false)
  })

  it('recusa subfase_ids com separador errado', () => {
    recusaPor(
      fluxoSchema.subfasesLoteQuery.validate({ subfase_ids: '3;7' }),
      'subfase_ids',
      'string.pattern.base'
    )
  })

  it('o lote_id da rota é inteiro positivo', () => {
    aceita(fluxoSchema.loteIdParams.validate({ lote_id: 42 }))
    recusaPor(
      fluxoSchema.loteIdParams.validate({ lote_id: 0 }),
      'lote_id',
      'number.positive'
    )
  })
})

// --- 6. A guarda de TODA rota, lida do FONTE ---------------------------------

/**
 * Tira bloco e linha de comentário, para a varredura ver só código.
 *
 * Mesma limpeza de `__tests__/routes/modulo_em_toda_rota.test.js`, e pelo mesmo
 * motivo: prosa que descreve a armadilha não é a armadilha. O `\r` cai PRIMEIRO
 * porque com `core.autocrlf` ligado o fonte chega em CRLF e o `.` do JavaScript
 * não casa `\r` -- sem isso, nenhum comentário seria apagado, só em Windows.
 */
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const fonteDaRota = () => semComentario(fs.readFileSync(ROTA, 'utf8'))

const CHAMADA_PERFIL = /verifyPerfil\(\s*'([a-z]+)'\s*(?:,\s*'([a-z]+)'\s*)?\)/g
const DECLARACAO = /router\.(get|post|put|delete)\(\s*'([^']+)'/g

describe('toda rota do fluxo cobra o perfil no módulo producao', () => {
  // ESTE ARQUIVO NÃO É VARRIDO POR `modulo_em_toda_rota.test.js`: a lista
  // MODULOS de lá não tem 'producao' (o módulo nasceu sem rota). Enquanto ela
  // não o tiver, esta é a única guarda contra a falha silenciosa da autorização
  // por módulo -- `verifyPerfil` tem 'acervo' como default, e uma rota daqui que
  // esquecesse o segundo argumento passaria a cobrar perfil no ACERVO, sem erro
  // de sintaxe e sem nada na tela.
  it('nenhuma chamada de verifyPerfil fica sem o segundo argumento', () => {
    const semModulo = []
    const moduloErrado = []

    for (const achado of fonteDaRota().matchAll(CHAMADA_PERFIL)) {
      const [trecho, , modulo] = achado
      if (!modulo) semModulo.push(trecho)
      else if (modulo !== 'producao') moduloErrado.push(trecho)
    }

    expect(semModulo).toEqual([])
    expect(moduloErrado).toEqual([])
  })

  it('há uma chamada de verifyPerfil para cada rota declarada', () => {
    const fonte = fonteDaRota()
    const rotas = [...fonte.matchAll(DECLARACAO)]
    const guardas = [...fonte.matchAll(CHAMADA_PERFIL)]

    expect(rotas.length).toBe(14)
    expect(guardas.length).toBe(rotas.length)
  })

  // A TRADUÇÃO DAS GUARDAS DO SAP: lá o `projeto_route.js` tinha
  // `router.use(verifyLogin)` no topo e todas estas rotas acrescentavam
  // `verifyAdmin`. Aqui o equivalente honesto é gerente do módulo, nas catorze.
  it('as catorze são de gerente, inclusive as de leitura', () => {
    const niveis = [...fonteDaRota().matchAll(CHAMADA_PERFIL)].map(a => a[1])

    expect(niveis).toHaveLength(14)
    expect([...new Set(niveis)]).toEqual(['gerente'])
  })

  // CONTROLE NEGATIVO da limpeza de comentário: sem ele, um `semComentario` que
  // apagasse o arquivo inteiro deixaria os casos acima verdes por vacuidade.
  it('a limpeza de comentário não come código', () => {
    const fonte = [
      "// citação: verifyPerfil('consulta') SEM módulo",
      "router.get('/x', verifyPerfil('gerente', 'producao'), handler)"
    ].join('\n')

    const achados = [...semComentario(fonte).matchAll(CHAMADA_PERFIL)].map(a => a[0])
    expect(achados).toEqual(["verifyPerfil('gerente', 'producao')"])
  })
})

// --- 7. Rota literal antes de rota com parâmetro -----------------------------

describe('a ordem de declaração das rotas', () => {
  const declaracoes = () => {
    const fonte = fonteDaRota()
    return [...fonte.matchAll(DECLARACAO)].map(a => ({
      metodo: a[1],
      caminho: a[2],
      indice: a.index
    }))
  }

  // O Express casa na ORDEM DE DECLARAÇÃO. `/lote/pendentes` acrescentado no fim
  // deste arquivo cairia em `/lote/:lote_id/subfases` e morreria no Joi de
  // `loteIdParams` com um 400 dizendo que "pendentes" não é número -- e o
  // defeito ficaria no arquivo que NÃO foi editado.
  it('a única rota com parâmetro vem depois de todas as literais', () => {
    const rotas = declaracoes()
    const comParametro = rotas.filter(r => r.caminho.includes(':'))
    const literais = rotas.filter(r => !r.caminho.includes(':'))

    expect(comParametro.map(r => r.caminho)).toEqual(['/lote/:lote_id/subfases'])
    expect(literais.length).toBe(13)

    const ultimaLiteral = Math.max(...literais.map(r => r.indice))
    expect(comParametro[0].indice).toBeGreaterThan(ultimaLiteral)
  })

  it('a rota com parâmetro é a última declaração do arquivo', () => {
    const rotas = declaracoes()
    expect(rotas[rotas.length - 1].caminho).toBe('/lote/:lote_id/subfases')
  })

  it('entrega exatamente as catorze rotas combinadas', () => {
    const rotas = declaracoes().map(r => `${r.metodo.toUpperCase()} ${r.caminho}`)

    expect(rotas.sort()).toEqual(
      [
        'GET /linha_producao',
        'POST /linha_producao',
        'PUT /linha_producao',
        'GET /fases',
        'GET /subfases',
        'GET /todas_subfases',
        'GET /etapas',
        'POST /etapas/padrao',
        'GET /configuracao/camadas',
        'GET /configuracao/camadas/linha_producao',
        'POST /configuracao/camadas',
        'PUT /configuracao/camadas',
        'DELETE /configuracao/camadas',
        'GET /lote/:lote_id/subfases'
      ].sort()
    )
  })
})
