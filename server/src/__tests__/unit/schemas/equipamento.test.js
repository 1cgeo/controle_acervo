'use strict'

// O JOI DO MÓDULO EQUIPAMENTO.
//
// Este módulo é um módulo de DATAS: são ONZE colunas DATE, e cada uma responde a
// uma pergunta que o Relatório DMT imprime ("desde quando esta máquina está
// parada", "quando ela volta"). Um dia trocado aqui não quebra nada e sai
// impresso.
//
// O par `.iso().raw()` é o que segura as duas metades do problema:
//
//   `.raw()`  devolve a STRING que entrou. Sem ele o Joi entrega um objeto Date
//             de meia-noite UTC, e a coluna DATE em UTC-3 grava o dia ANTERIOR.
//   `.iso()`  cobra o formato AAAA-MM-DD. Sem ele a string segue crua para o
//             Postgres, que lê '01/08/2026' como 8 de JANEIRO pelo DateStyle
//             MDY -- um dia trocado por outro MÊS, sem erro nenhum.
//
// O caso que separa as duas metades é justamente o '01/08/2026': uma data já em
// ISO passa com `.raw()` sozinho e não distingue nada.
//
// TODO CASO DE RECUSA PROVA O MOTIVO, pelo `recusaPor` de `helpers/joi.js`, e
// nunca só que houve recusa: um corpo quebrado em dois lugares reprova pelo
// campo errado e o teste segue verde para sempre.

const equipamentoSchema = require('../../../equipamento/equipamento_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

// --- Corpos mínimos válidos, um por schema ----------------------------------
//
// MÍNIMOS de propósito: só o que é `required`. Assim, o caso que troca UM campo
// mede aquele campo, e não a soma de tudo o que sobrou preenchido.

const CORPOS = {
  equipamento: () => ({
    nr_patrimonio: '104820700014462',
    classe_id: 6,
    tipo_id: 1,
    modelo: 'TOPCON CTS-3007',
    secao_detentora_id: 1
  }),
  indisponibilidade: () => ({
    equipamento_id: 1,
    data_inicio: '2026-05-11',
    motivo: 'Erro de firmware'
  }),
  afastamento: () => ({
    equipamento_id: 1,
    om: '3º BPE',
    motivo: 'Apoio a levantamento',
    data_inicio: '2026-04-09'
  }),
  manutencao: () => ({
    equipamento_id: 1,
    data_inicio: '2026-05-11'
  }),
  transferencia: () => ({
    equipamento_id: 1,
    tipo_id: 3,
    situacao_id: 1
  }),
  tipo: () => ({ nome: 'Estação Total' })
}

const corpo = (entidade, extra = {}) => ({ ...CORPOS[entidade](), ...extra })

// ---------------------------------------------------------------------------
// AS ONZE COLUNAS DATE
// ---------------------------------------------------------------------------

// A LISTA É ESCRITA À MÃO, e não derivada do schema: derivá-la faria o teste
// concordar com a remoção de um `.iso()`. Cada linha é [schema, campo], e são
// ONZE, que é o número de colunas DATE do DDL:
//
//   equipamento          data_entrada_carga
//   indisponibilidade    data_inicio, data_fim, previsao_retorno
//   afastamento          data_inicio, previsao_termino, data_fim
//   manutencao           data_inicio, data_fim
//   transferencia        data_solicitacao, data_transferencia
const COLUNAS_DATE = [
  ['equipamentoCriar', 'equipamento', 'data_entrada_carga'],
  ['indisponibilidadeCriar', 'indisponibilidade', 'data_inicio'],
  ['indisponibilidadeCriar', 'indisponibilidade', 'data_fim'],
  ['indisponibilidadeCriar', 'indisponibilidade', 'previsao_retorno'],
  ['afastamentoCriar', 'afastamento', 'data_inicio'],
  ['afastamentoCriar', 'afastamento', 'previsao_termino'],
  ['afastamentoCriar', 'afastamento', 'data_fim'],
  ['manutencaoCriar', 'manutencao', 'data_inicio'],
  ['manutencaoCriar', 'manutencao', 'data_fim'],
  ['transferenciaCriar', 'transferencia', 'data_solicitacao'],
  ['transferenciaCriar', 'transferencia', 'data_transferencia']
]

describe('as onze colunas DATE do módulo são dia de calendário', () => {
  // VARIÂNCIA da lista: se alguém apagar linhas daqui, o `it.each` abaixo passa
  // a provar menos e ninguém vê. O número está no DDL e não muda sozinho.
  it('a lista cobre as onze colunas DATE do DDL', () => {
    expect(COLUNAS_DATE).toHaveLength(11)
  })

  it.each(COLUNAS_DATE)(
    '%s.%s devolve a string ISO que entrou, e não um Date',
    (schema, entidade, campo) => {
      // '2026-05-11' porque é a data real da parada do plotter na planilha da
      // Seção, e porque em UTC-3 o Date de meia-noite UTC dela vira o dia 10.
      const value = aceita(
        equipamentoSchema[schema].validate(corpo(entidade, { [campo]: '2026-05-11' }))
      )

      expect(value[campo]).toBe('2026-05-11')
      expect(value[campo]).not.toBeInstanceOf(Date)
    }
  )

  it.each(COLUNAS_DATE)(
    '%s.%s recusa a data fora do formato ISO',
    (schema, entidade, campo) => {
      // O caso do `.iso()`. '01/08/2026' é 1º de agosto para quem digita e 8 de
      // janeiro para o Postgres, e sem esta recusa os dois conviveriam.
      recusaPor(
        equipamentoSchema[schema].validate(corpo(entidade, { [campo]: '01/08/2026' })),
        campo,
        'date.format'
      )
    }
  )

  it.each(COLUNAS_DATE)(
    '%s.%s recusa texto que não é data',
    (schema, entidade, campo) => {
      recusaPor(
        equipamentoSchema[schema].validate(
          corpo(entidade, { [campo]: 'quinta-feira' })
        ),
        campo,
        'date.format'
      )
    }
  )
})

// ---------------------------------------------------------------------------
// data_fim >= data_inicio
// ---------------------------------------------------------------------------

// O schema espelha os CHECK `*_fim_apos_inicio` do DDL, e a duplicação é
// deliberada: o banco é a última palavra, e o Joi é o que devolve uma frase em
// português em vez de 'violates check constraint'.
const COM_INTERVALO = [
  ['indisponibilidadeCriar', 'indisponibilidade'],
  ['indisponibilidadeAtualizar', 'indisponibilidade'],
  ['afastamentoCriar', 'afastamento'],
  ['afastamentoAtualizar', 'afastamento'],
  ['manutencaoCriar', 'manutencao'],
  ['manutencaoAtualizar', 'manutencao']
]

describe('data_fim não pode ser anterior a data_inicio', () => {
  it.each(COM_INTERVALO)('%s recusa o fim antes do início', (schema, entidade) => {
    const resultado = equipamentoSchema[schema].validate(
      corpo(entidade, { data_inicio: '2026-05-11', data_fim: '2026-05-10' })
    )

    recusaPor(resultado, 'data_fim', 'date.min')
    // A MENSAGEM EM PORTUGUÊS é parte do contrato: a do Joi diria 'must be
    // greater than or equal to "ref:data_inicio"', e é ela que a tela mostra
    // para quem acabou de digitar.
    expect(resultado.error.details[0].message).toBe(
      'A data de fim deve ser igual ou posterior à data de início'
    )
  })

  it.each(COM_INTERVALO)('%s aceita fim igual ao início', (schema, entidade) => {
    // Um dia só de parada é um dia de parada, e não um erro de digitação: o
    // CHECK do DDL é `>=`, e o Joi tem de concordar com ele.
    const value = aceita(
      equipamentoSchema[schema].validate(
        corpo(entidade, { data_inicio: '2026-05-11', data_fim: '2026-05-11' })
      )
    )
    expect(value.data_fim).toBe('2026-05-11')
  })

  it.each(COM_INTERVALO)('%s aceita fim nulo, que é o lançamento aberto', (
    schema, entidade
  ) => {
    // AS 12 INDISPONIBILIDADES DE PRODUÇÃO SÃO TODAS ASSIM. O `.allow(null)` vem
    // depois do `.min()` justamente por isto: nulo não se compara com data
    // nenhuma.
    const value = aceita(
      equipamentoSchema[schema].validate(corpo(entidade, { data_fim: null }))
    )
    expect(value.data_fim).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// O que é obrigatório, e onde
// ---------------------------------------------------------------------------

describe('o dono do lançamento', () => {
  const CRIAR = [
    ['indisponibilidadeCriar', 'indisponibilidade'],
    ['afastamentoCriar', 'afastamento'],
    ['manutencaoCriar', 'manutencao'],
    ['transferenciaCriar', 'transferencia']
  ]

  const ATUALIZAR = [
    ['indisponibilidadeAtualizar', 'indisponibilidade'],
    ['afastamentoAtualizar', 'afastamento'],
    ['manutencaoAtualizar', 'manutencao'],
    ['transferenciaAtualizar', 'transferencia']
  ]

  it.each(CRIAR)('%s exige equipamento_id', (schema, entidade) => {
    const semDono = corpo(entidade)
    delete semDono.equipamento_id

    recusaPor(
      equipamentoSchema[schema].validate(semDono),
      'equipamento_id',
      'any.required'
    )
  })

  it.each(ATUALIZAR)('%s dispensa equipamento_id', (schema, entidade) => {
    // O formulário da FICHA edita um lançamento sem reafirmar de quem ele é, e o
    // UPDATE preserva o dono por COALESCE. Cobrar o campo aqui obrigaria a tela
    // a reenviar um dado que ela não pergunta.
    const semDono = corpo(entidade)
    delete semDono.equipamento_id

    const value = aceita(equipamentoSchema[schema].validate(semDono))
    expect(value.equipamento_id).toBeUndefined()
  })

  it.each([...CRIAR, ...ATUALIZAR])(
    '%s recusa equipamento_id zero',
    (schema, entidade) => {
      // BIGSERIAL começa em 1: um `0` é erro de quem chamou, e não um 404 depois
      // de ir ao banco.
      recusaPor(
        equipamentoSchema[schema].validate(corpo(entidade, { equipamento_id: 0 })),
        'equipamento_id',
        'number.positive'
      )
    }
  )
})

describe('o bem', () => {
  const OBRIGATORIOS = [
    'nr_patrimonio', 'classe_id', 'tipo_id', 'modelo', 'secao_detentora_id'
  ]

  it.each(OBRIGATORIOS)('equipamentoCriar exige %s', (campo) => {
    const sem = corpo('equipamento')
    delete sem[campo]

    recusaPor(equipamentoSchema.equipamentoCriar.validate(sem), campo, 'any.required')
  })

  it('apara o espaço do número de patrimônio', () => {
    // 17 das 105 células de patrimônio da planilha da Seção são TEXTO, e algumas
    // terminam em '\n'. O número é a UNIQUE da tabela: espaço sobrando faria dois
    // cadastros do mesmo bem conviverem sem o banco reclamar.
    const value = aceita(
      equipamentoSchema.equipamentoCriar.validate(
        corpo('equipamento', { nr_patrimonio: '  104820700014462\n' })
      )
    )
    expect(value.nr_patrimonio).toBe('104820700014462')
  })

  it('recusa número de patrimônio acima de 30 caracteres', () => {
    recusaPor(
      equipamentoSchema.equipamentoCriar.validate(
        corpo('equipamento', { nr_patrimonio: '1'.repeat(31) })
      ),
      'nr_patrimonio',
      'string.max'
    )
  })

  it('nasce ativo quando ninguém diz o contrário', () => {
    const value = aceita(
      equipamentoSchema.equipamentoCriar.validate(corpo('equipamento'))
    )
    expect(value.ativo).toBe(true)
  })

  it('aceita vida útil nula, que quer dizer "vale a do tipo"', () => {
    // NULO NÃO É ZERO. A lista resolve por COALESCE e devolve `vida_util_herdada`
    // dizendo de onde o número veio.
    const value = aceita(
      equipamentoSchema.equipamentoCriar.validate(
        corpo('equipamento', { vida_util_meses: null })
      )
    )
    expect(value.vida_util_meses).toBeNull()
  })

  it('recusa vida útil zero', () => {
    recusaPor(
      equipamentoSchema.equipamentoCriar.validate(
        corpo('equipamento', { vida_util_meses: 0 })
      ),
      'vida_util_meses',
      'number.positive'
    )
  })

  it('nasce com o patrimônio CONFERIDO quando ninguém diz o contrário', () => {
    // O caso normal é o número certo, e o campo tem `default(false)` justamente
    // para cliente antigo (que não conhece a coluna) continuar cadastrando bem
    // válido. `false` e não `undefined`: a coluna do banco é NOT NULL.
    const value = aceita(
      equipamentoSchema.equipamentoCriar.validate(corpo('equipamento'))
    )
    expect(value.patrimonio_pendente).toBe(false)
  })

  it.each(['equipamentoCriar', 'equipamentoAtualizar'])(
    '%s aceita marcar o patrimônio como por conferir',
    (nome) => {
      // A marca existe porque a fonte erra: no Relatório DMT de 2026-08-03 duas
      // linhas declaram o mesmo patrimônio, e são dois bens diferentes.
      const value = aceita(
        equipamentoSchema[nome].validate(
          corpo('equipamento', { patrimonio_pendente: true })
        )
      )
      expect(value.patrimonio_pendente).toBe(true)
    }
  )

  it('recusa patrimonio_pendente que não seja booleano', () => {
    // 'talvez' não é um terceiro estado: a pergunta ("este número está por
    // conferir?") só tem duas respostas, e a coluna é NOT NULL.
    recusaPor(
      equipamentoSchema.equipamentoCriar.validate(
        corpo('equipamento', { patrimonio_pendente: 'talvez' })
      ),
      'patrimonio_pendente',
      'boolean.base'
    )
  })
})

describe('a manutenção e o dinheiro', () => {
  const VALORES = ['valor', 'valor_orcado', 'valor_pdr']

  it.each(VALORES)('%s recusa zero, espelhando o CHECK do DDL', (campo) => {
    // Manutenção de graça não se lança com valor 0: lança-se SEM valor. O CHECK
    // do DDL é `> 0`, e o Joi diz a mesma coisa antes de a linha sair da tela.
    recusaPor(
      equipamentoSchema.manutencaoCriar.validate(corpo('manutencao', { [campo]: 0 })),
      campo,
      'number.positive'
    )
  })

  it.each(VALORES)('%s recusa negativo', (campo) => {
    recusaPor(
      equipamentoSchema.manutencaoCriar.validate(
        corpo('manutencao', { [campo]: -600 })
      ),
      campo,
      'number.positive'
    )
  })

  it.each(VALORES)('%s aceita nulo', (campo) => {
    const value = aceita(
      equipamentoSchema.manutencaoCriar.validate(corpo('manutencao', { [campo]: null }))
    )
    expect(value[campo]).toBeNull()
  })

  it('aceita os 600,00 da única manutenção real da planilha', () => {
    const value = aceita(
      equipamentoSchema.manutencaoCriar.validate(
        corpo('manutencao', {
          valor_orcado: 600, valor_pdr: 600, certame: 'Contrata+Brasil'
        })
      )
    )
    expect(value.valor_orcado).toBe(600)
    expect(value.valor_pdr).toBe(600)
  })
})

describe('a transferência', () => {
  it.each([['tipo_id'], ['situacao_id']])('exige %s', (campo) => {
    const sem = corpo('transferencia')
    delete sem[campo]

    recusaPor(equipamentoSchema.transferenciaCriar.validate(sem), campo, 'any.required')
  })

  it('as duas perguntas do SIAFI nascem respondidas com "não"', () => {
    // As duas colunas são NOT NULL com default FALSE: 'já foi transferido no
    // SIAFI?' não tem terceiro estado, e um `undefined` chegando ao INSERT
    // derrubaria a escrita.
    const value = aceita(
      equipamentoSchema.transferenciaCriar.validate(corpo('transferencia'))
    )
    expect(value.transferido_siafi).toBe(false)
    expect(value.apropriado_siafi).toBe(false)
  })
})

describe('o tipo de equipamento', () => {
  it('exige o nome', () => {
    recusaPor(equipamentoSchema.tipoCriar.validate({}), 'nome', 'any.required')
  })

  it('nasce ativo', () => {
    const value = aceita(equipamentoSchema.tipoCriar.validate(corpo('tipo')))
    expect(value.ativo).toBe(true)
  })

  it('recusa vida útil zero', () => {
    recusaPor(
      equipamentoSchema.tipoCriar.validate(corpo('tipo', { vida_util_meses: 0 })),
      'vida_util_meses',
      'number.positive'
    )
  })
})

describe('o id de rota', () => {
  it('aceita o inteiro positivo', () => {
    const value = aceita(equipamentoSchema.idParams.validate({ id: 42 }))
    expect(value.id).toBe(42)
  })

  it.each([['0', 0], ['negativo', -3]])('recusa o id %s', (_nome, id) => {
    recusaPor(equipamentoSchema.idParams.validate({ id }), 'id', 'number.positive')
  })

  it('recusa o id que não é número', () => {
    // É o que separa `GET /tipo` de `GET /:id` quando a ordem das rotas quebra:
    // a rota literal declarada depois cairia aqui, e o 400 diria que 'tipo' não
    // é número. A ordem certa está em `routes/equipamento.test.js`.
    recusaPor(equipamentoSchema.idParams.validate({ id: 'tipo' }), 'id', 'number.base')
  })
})

describe('os filtros da lista', () => {
  it('aceita a lista sem filtro nenhum', () => {
    expect(aceita(equipamentoSchema.listarQuery.validate({}))).toEqual({})
  })

  it('lê o "true" da query string como booleano', () => {
    // A query string entrega STRING, sempre. Sem a conversão do Joi, o
    // `$<ativo>` iria ao Postgres como texto e o `e.ativo = 'true'` estouraria.
    const value = aceita(equipamentoSchema.listarQuery.validate({ ativo: 'true' }))
    expect(value.ativo).toBe(true)
  })

  it('recusa filtro desconhecido', () => {
    recusaPor(
      equipamentoSchema.listarQuery.validate({ situacao: 4 }),
      'situacao',
      'object.unknown'
    )
  })

  it('a lista solta lê aberta=true', () => {
    const value = aceita(
      equipamentoSchema.historicoQuery.validate({ equipamento_id: 3, aberta: 'true' })
    )
    expect(value).toEqual({ equipamento_id: 3, aberta: true })
  })
})
