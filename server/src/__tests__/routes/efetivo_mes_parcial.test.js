'use strict'

// O MÊS CORRENTE É PARCIAL, e até a 1.34.0 nada na resposta dizia isso.
//
// O QUE ESTAVA ERRADO. `dgeo.efetivo_periodo.data_fim` NULA é "sem previsão de
// saída", e é o caso comum: 25 das 27 passagens em produção. A grade de
// disponibilidade é o produto PESSOA x DIA do mês inteiro, então a passagem
// aberta cobre também os dias que ainda não aconteceram. Medido na produção em
// 07/08/2026: os 25 militares saíam com `dias_na_dgeo` = 31 de 31 e
// aproveitamento de 100%, num mês que tinha corrido 7 dias. O dashboard abria
// dizendo "87,8%" sobre 24 dias de futuro.
//
// POR QUE NÃO SE CORRIGIU `aproveitamento`. Ele é o número da subseção 6.1 do
// RPCMTec, que só se gera com o mês FECHADO, e aí as duas contas coincidem.
// Trocar a semântica dele mudaria o documento assinado para consertar a tela.
// Os campos `_decorrido` nasceram AO LADO, e é a tela que escolhe.
//
// O QUE ESTE ARQUIVO PROVA:
//   - mês fechado: as duas contas dão IGUAL (senão o campo novo não serviria)
//   - mês corrente: o decorrido para em hoje, e o do mês inteiro não
//   - mês futuro: o decorrido é NULO, e não zero
//   - `dias_perdidos` da pessoa fecha com a soma das causas dela, inclusive com
//     impedimentos sobrepostos passando de 100%
//   - a divergência mora sob /efetivo, e devolve posto e nome de guerra, sem
//     login nem nome completo

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')

const ALVO = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' // USER_UUID da semente

let app
let admin

beforeAll(async () => {
  app = await getApp()
  admin = generateAdminToken()
})

// TODO CASO COMECA SEM PASSAGEM NENHUMA. `dgeo.efetivo_periodo` tem EXCLUDE de
// sobreposicao por pessoa, e cada caso aqui lanca uma passagem para o MESMO
// militar da semente: sem zerar antes, o segundo insert leva 23P01. Quem trunca
// as duas tabelas e o `cleanTestData()`, e a regra mora la.
beforeEach(cleanTestData)

const hoje = new Date()
const ANO = hoje.getFullYear()
const MES = hoje.getMonth() + 1
const DIA = hoje.getDate()
const DIAS_DO_MES = new Date(ANO, MES, 0).getDate()

const doMes = (dia, ano = ANO, mes = MES) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`

const criarPassagem = (inicio, fim = null) =>
  conn.none(
    `INSERT INTO dgeo.efetivo_periodo
       (usuario_uuid, data_inicio, data_fim, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $1)`,
    [ALVO, inicio, fim]
  )

const criarImpedimento = (descricao, percentual, inicio, fim = null) =>
  conn.none(
    `INSERT INTO dgeo.impedimento
       (usuario_uuid, descricao, percentual, data_inicio, data_fim, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $4, $5, $1)`,
    [ALVO, descricao, percentual, inicio, fim]
  )

const buscarMes = async (ano, mes) => {
  const res = await request(app)
    .get(`/api/efetivo/mes?ano=${ano}&mes=${mes}`)
    .set('Authorization', admin)
  expect(res.status).toBe(200)
  return res.body.dados
}

const soma = (lista, campo) =>
  lista.reduce((t, x) => t + Number(x[campo]), 0)

describe('efetivo do mês: o decorrido e o mês inteiro', () => {
  // MÊS FECHADO É O CONTROLE. Sem ele, um `aproveitamento_decorrido` que
  // simplesmente copiasse `aproveitamento` passaria em todos os outros casos.
  test('num mês FECHADO as duas contas dão igual', async () => {
    // Um mês inteiro do ano passado: já aconteceu por completo.
    await criarPassagem(doMes(1, ANO - 1, 3), doMes(31, ANO - 1, 3))

    const [pessoa] = await buscarMes(ANO - 1, 3)

    expect(pessoa.dias_do_mes).toBe(31)
    expect(pessoa.dias_decorridos).toBe(31)
    expect(pessoa.dias_na_dgeo).toBe(31)
    expect(pessoa.dias_na_dgeo_decorridos).toBe(31)
    expect(Number(pessoa.aproveitamento_decorrido)).toBe(Number(pessoa.aproveitamento))
  })

  // O CASO QUE DEU ORIGEM A TUDO: passagem aberta no mês corrente.
  test('no mês CORRENTE o decorrido para em hoje, e o do mês inteiro não', async () => {
    await criarPassagem(doMes(1))

    const [pessoa] = await buscarMes(ANO, MES)

    // O do mês inteiro conta os dias que ainda não aconteceram, DE PROPÓSITO: é
    // ele que a 6.1 lê quando o mês fecha.
    expect(pessoa.dias_do_mes).toBe(DIAS_DO_MES)
    expect(pessoa.dias_na_dgeo).toBe(DIAS_DO_MES)

    // O decorrido para em hoje.
    expect(pessoa.dias_decorridos).toBe(DIA)
    expect(pessoa.dias_na_dgeo_decorridos).toBe(DIA)
  })

  // NÃO DEU PARA MEDIR e MEDIU ZERO são coisas diferentes. Um mês inteiramente
  // no futuro não tem aproveitamento nenhum; devolver 0 afirmaria que a Divisão
  // não rendeu nada, que é a afirmação oposta.
  test('num mês FUTURO o decorrido é NULO, e não zero', async () => {
    await criarPassagem(doMes(1, ANO - 1, 1))

    const [pessoa] = await buscarMes(ANO + 1, 6)

    expect(pessoa.dias_decorridos).toBe(0)
    expect(pessoa.dias_na_dgeo_decorridos).toBe(0)
    expect(pessoa.aproveitamento_decorrido).toBeNull()
    // O do mês inteiro continua projetando, que é o que a passagem aberta diz.
    expect(pessoa.dias_na_dgeo).toBe(30)
  })
})

describe('efetivo do mês: o custo em dias-militar', () => {
  // A CONTA POR PESSOA E A CONTA POR CAUSA TÊM DE FECHAR. Elas saem de dois
  // caminhos diferentes na consulta (uma agrega a disponibilidade do dia, a
  // outra rateia entre os impedimentos daquele dia), e o dashboard soma a
  // segunda para desenhar "por causa". Se elas divergissem, o gráfico diria um
  // total e o cartão ao lado diria outro.
  test('o dia perdido da pessoa fecha com a soma das causas dela', async () => {
    await criarPassagem(doMes(1, ANO - 1, 3), doMes(31, ANO - 1, 3))
    await criarImpedimento('Chefia de seção', 20, doMes(1, ANO - 1, 3), doMes(31, ANO - 1, 3))
    await criarImpedimento('Curso', 50, doMes(1, ANO - 1, 3), doMes(10, ANO - 1, 3))

    const [pessoa] = await buscarMes(ANO - 1, 3)

    // 31 dias a 20% (6,2) mais 10 dias a 50% (5,0).
    expect(Number(pessoa.dias_perdidos)).toBeCloseTo(11.2, 2)
    expect(soma(pessoa.impedimentos, 'dias_perdidos')).toBeCloseTo(11.2, 2)
  })

  // O TRUNCAMENTO EM 100% É O QUE TORNA O RATEIO NECESSÁRIO. A leitura já
  // impedia disponibilidade negativa (LTSP integral mais chefia somam 150%),
  // mas as causas somadas cruas dariam 1,5 dia perdido num dia de 1. O rateio
  // proporcional devolve a cada causa a fatia dela DENTRO do dia.
  test('impedimentos que somam mais de 100% não inventam dia perdido', async () => {
    await criarPassagem(doMes(1, ANO - 1, 4), doMes(30, ANO - 1, 4))
    await criarImpedimento('LTSP', 100, doMes(1, ANO - 1, 4), doMes(30, ANO - 1, 4))
    await criarImpedimento('Chefia de seção', 50, doMes(1, ANO - 1, 4), doMes(30, ANO - 1, 4))

    const [pessoa] = await buscarMes(ANO - 1, 4)

    // 30 dias presentes, e nenhum rendeu: 30 dias perdidos, e não 45.
    expect(Number(pessoa.aproveitamento)).toBe(0)
    expect(Number(pessoa.dias_perdidos)).toBeCloseTo(30, 2)
    expect(soma(pessoa.impedimentos, 'dias_perdidos')).toBeCloseTo(30, 2)

    // E cada causa leva a fatia dela: 100/150 e 50/150 de 30 dias.
    const porCausa = Object.fromEntries(
      pessoa.impedimentos.map(i => [i.descricao, Number(i.dias_perdidos)])
    )
    expect(porCausa.LTSP).toBeCloseTo(20, 2)
    expect(porCausa['Chefia de seção']).toBeCloseTo(10, 2)
  })

  // Impedimento que cruza o mês mas cujos dias ainda não chegaram existe e não
  // custou nada. ZERO é a resposta certa, e não a ausência da linha: quem lê a
  // tela precisa ver que o afastamento está lançado.
  test('impedimento inteiramente no futuro aparece com zero', async () => {
    await criarPassagem(doMes(1, ANO - 1, 1))
    await criarImpedimento('Curso marcado', 100, doMes(1, ANO + 1, 6), doMes(30, ANO + 1, 6))

    const [pessoa] = await buscarMes(ANO + 1, 6)

    expect(pessoa.impedimentos).toHaveLength(1)
    expect(Number(pessoa.impedimentos[0].dias_perdidos)).toBe(0)
    expect(Number(pessoa.dias_perdidos)).toBe(0)
  })
})

describe('divergência entre cadastro e efetivo', () => {
  const buscarDivergencias = async (ano, mes) => {
    const res = await request(app)
      .get(`/api/efetivo/divergencias?ano=${ano}&mes=${mes}`)
      .set('Authorization', admin)
    expect(res.status).toBe(200)
    return res.body.dados
  }

  test('aponta a conta ativa sem passagem, e some quando a passagem entra', async () => {
    // A semente tem duas contas ativas, e nenhuma delas tem passagem.
    const antes = await buscarDivergencias(ANO, MES)
    const alvoAntes = antes.filter(d => d.usuario_uuid === ALVO)
    expect(alvoAntes).toHaveLength(1)

    // CONTROLE NEGATIVO: lançada a passagem, a linha sai. Sem ele, uma consulta
    // que devolvesse todo mundo passaria no caso de cima.
    await criarPassagem(doMes(1))
    const depois = await buscarDivergencias(ANO, MES)
    expect(depois.filter(d => d.usuario_uuid === ALVO)).toHaveLength(0)
  })

  // DADO DE PESSOAL QUE TRAFEGA SEM USO É VAZAMENTO À ESPERA DE UM LOG. A tela
  // desenha posto abreviado e nome de guerra, e é só isso que sai. Era esta a
  // razão de a conta não poder continuar sendo feita sobre `GET /usuarios`, que
  // devolve login, flag de administrador e o perfil em cada módulo.
  test('devolve só o que a tela desenha', async () => {
    const [linha] = await buscarDivergencias(ANO, MES)

    expect(Object.keys(linha).sort()).toEqual(['nome_guerra', 'posto_abrev', 'usuario_uuid'])
  })
})
