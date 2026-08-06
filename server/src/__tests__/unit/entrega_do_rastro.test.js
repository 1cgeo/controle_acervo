'use strict'

// A ENTREGA do rastro, e não a gravação dele.
//
// POR QUE ESTE ARQUIVO EXISTE. Registrar o evento não é entregar o histórico.
// O rastro de escrita pode estar fechado no servidor e mesmo assim a maior
// parte dos agregados sair como texto morto na tela, sem painel na própria
// ficha e sem destino na varredura.
//
// Nada acusava isso, porque nenhum teste olhava para o lado do cliente:
// agregado novo nascia órfão e ninguém percebia.
//
// O QUE ESTE TESTE COBRA, para cada agregado do mapa de auditoria:
//
//   1. existe painel (`criarHistorico`) em alguma tela do cliente, OU o
//      agregado está na lista de exceção ABAIXO, com o motivo escrito;
//   2. existe entrada no mapa `DESTINO` da varredura, para o evento levar a
//      algum lugar.
//
// É teste ESTÁTICO: ele lê o código do cliente com `fs`. Não sobe navegador e
// não roda o cliente. O que ele protege é a existência da ligação, não o
// desenho dela.

const fs = require('fs')
const path = require('path')

const { mapa } = require('../../auditoria/mapa')

const RAIZ_CLIENTE = path.join(__dirname, '..', '..', '..', '..', 'client', 'src', 'js')
const VARREDURA = path.join(RAIZ_CLIENTE, 'pages', 'rastreabilidade', 'index.js')

// Agregados que NÃO precisam de painel, com o motivo. Lista curta de propósito:
// ela é a medida de quanto ainda falta, e cresce só com justificativa.
const SEM_PAINEL_JUSTIFICADO = {
  // `acervo.mv_produto`: a manutenção é o refresh das views materializadas, um
  // ato do sistema sobre si mesmo. Não há ficha de "uma manutenção" para
  // alguém abrir; o registro existe para a varredura responder "quando as
  // views foram atualizadas pela última vez".
  manutencao: 'Operação do sistema sobre si mesmo, sem ficha própria',
  // `orcamento.configuracao` e os domínios editáveis do orçamento vivem numa
  // tela de configuração que é uma lista de campos, e não uma ficha por
  // registro. O histórico deles se lê pela varredura, filtrando por entidade.
  dominio: 'Tabela de domínio editável, sem ficha por registro'
}

// DÍVIDA DECLARADA, que é coisa diferente de exceção: aqui o painel FALTA, e há
// plano com data para ele. Misturar as duas listas faria a dívida virar exceção
// com o tempo, que é como a lacuna volta.
//
// Cada entrada aponta onde o plano está escrito.
//
// ESTÁ VAZIA. Entrada aqui é lacuna de CLASSE C: agregado que registra evento
// e não tem tela nenhuma.
const PENDENTE_COM_PLANO = {}

/** Todo arquivo .js do cliente, menos teste. */
const arquivosDoCliente = () => {
  const achados = []
  const andar = dir => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome)
      if (fs.statSync(p).isDirectory()) andar(p)
      else if (nome.endsWith('.js') && !nome.endsWith('.test.js')) achados.push(p)
    }
  }
  andar(RAIZ_CLIENTE)
  return achados
}

// As entidades que o cliente pede a `criarHistorico`, em qualquer tela.
const entidadesComPainel = () => {
  const achadas = new Set()
  for (const p of arquivosDoCliente()) {
    const s = fs.readFileSync(p, 'utf8')
    if (!s.includes('criarHistorico({')) continue
    for (const m of s.matchAll(/criarHistorico\(\{[^}]*?entidade:\s*'([a-z_]+)'/gs)) {
      achadas.add(m[1])
    }
  }
  return achadas
}

// As chaves 'modulo:entidade' do mapa DESTINO da varredura.
const destinosDaVarredura = () => {
  const s = fs.readFileSync(VARREDURA, 'utf8')
  const bloco = s.slice(s.indexOf('const DESTINO = {'), s.indexOf('};', s.indexOf('const DESTINO = {')))
  return new Set([...bloco.matchAll(/'([a-z_]+:[a-z_]+)':/g)].map(m => m[1]))
}

// Os agregados declarados no mapa de auditoria: 'modulo:entidade'.
const agregados = () => {
  const achados = new Map()
  for (const [tabela, entrada] of Object.entries(mapa)) {
    if (!entrada || typeof entrada !== 'object' || !entrada.modulo) continue
    // `entidade` é função em uma tabela só (orcamento.arquivo, que pertence a
    // um de três donos). Ela não define agregado próprio.
    if (typeof entrada.entidade !== 'string') continue
    const chave = `${entrada.modulo}:${entrada.entidade}`
    if (!achados.has(chave)) achados.set(chave, [])
    achados.get(chave).push(tabela)
  }
  return achados
}

describe('A entrega do rastro', () => {
  // REDE CONTRA O FALSO VERDE, e ela cobre as TRÊS leituras.
  //
  // As três varrem texto: o mapa, os arquivos do cliente e o bloco `DESTINO`.
  // Qualquer uma devolvendo vazio deixa os casos abaixo verdes sem cobrar nada,
  // e a mais frágil é a do `DESTINO`, que recorta por `indexOf`: renomeada a
  // constante, o recorte vira string vazia e "todo destino aponta um agregado
  // que existe" passa com zero destinos.
  test('as três varreduras acham alguma coisa', () => {
    expect(agregados().size).toBeGreaterThanOrEqual(20)
    expect(entidadesComPainel().size).toBeGreaterThanOrEqual(8)
    expect(destinosDaVarredura().size).toBeGreaterThanOrEqual(20)
  })

  test('todo agregado tem painel de histórico numa tela, ou exceção justificada', () => {
    const comPainel = entidadesComPainel()
    const orfaos = []

    for (const [chave, tabelas] of agregados()) {
      const entidade = chave.split(':')[1]
      if (comPainel.has(entidade)) continue
      if (SEM_PAINEL_JUSTIFICADO[entidade]) continue
      if (PENDENTE_COM_PLANO[entidade]) continue
      orfaos.push(`${chave} (${tabelas.join(', ')})`)
    }

    // Para consertar: chame `criarHistorico` na ficha do agregado, ou
    // acrescente-o a SEM_PAINEL_JUSTIFICADO com o motivo escrito.
    expect(orfaos).toEqual([])
  })

  test('todo agregado tem destino na varredura de rastreabilidade', () => {
    const destinos = destinosDaVarredura()
    const semDestino = []

    for (const [chave] of agregados()) {
      if (!destinos.has(chave)) semDestino.push(chave)
    }

    // Sem destino, a coluna "Onde" da varredura escreve "produto #170" como
    // texto morto: a pessoa vê que algo mudou e não chega lá.
    expect(semDestino).toEqual([])
  })

  test('todo destino da varredura aponta um agregado que existe', () => {
    // O caminho inverso, e ele pegou um defeito real: o mapa apontava
    // 'orcamento:dfd' para `#/orcamento/dfd/:id`, rota que nunca existiu.
    const chaves = new Set(agregados().keys())
    const inventados = [...destinosDaVarredura()].filter(d => !chaves.has(d))

    expect(inventados).toEqual([])
  })

  // AS DUAS LISTAS, num caso só. Elas são a medida do que falta, e o que se
  // guarda é que nenhuma das duas cresça em silêncio.
  //
  // O conjunto das exceções vai por IGUALDADE, e não por um teto: teto deixa
  // acrescentar sem ninguém olhar até bater no número, que é justamente como a
  // exceção vira regra. Entrada nova aqui derruba o caso e obriga a decisão.
  test('as listas de exceção e de dívida não crescem sem decisão', () => {
    expect(Object.keys(SEM_PAINEL_JUSTIFICADO).sort())
      .toEqual(['dominio', 'manutencao'])

    for (const motivo of Object.values(SEM_PAINEL_JUSTIFICADO)) {
      expect(motivo.length).toBeGreaterThan(20)
    }

    // A dívida está zerada. Entrada aqui é agregado que registra evento e não
    // tem tela nenhuma, e tem de vir com o plano por escrito.
    expect(Object.keys(PENDENTE_COM_PLANO)).toEqual([])
    for (const plano of Object.values(PENDENTE_COM_PLANO)) {
      expect(plano).toMatch(/01-Projects/)
    }
  })
})
