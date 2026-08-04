'use strict'

// A ENTREGA do rastro, e não a gravação dele.
//
// POR QUE ESTE ARQUIVO EXISTE. Em 2026-08-04 uma revisão do sistema mediu que o
// rastro de ESCRITA estava fechado (das 123 funções de controller que escrevem,
// duas não auditam e as duas estão certas), e que o problema era outro: dos 23
// agregados, apenas 8 tinham painel de histórico na própria ficha, e o mapa de
// destino da varredura cobria TRÊS. Os outros 20 saíam como texto morto, e um
// dos três (o DFD) apontava rota que não existe.
//
// Registrar o evento não é entregar o histórico. Nada acusava isso, porque
// nenhum teste olhava para o lado do cliente: agregado novo nascia órfão e
// ninguém percebia. Foi o que aconteceu com os 20.
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
  configuracao: 'Tela de campos, sem ficha por registro',
  dominio: 'Tabela de domínio editável, sem ficha por registro'
}

// DÍVIDA DECLARADA, que é coisa diferente de exceção: aqui o painel FALTA, e há
// plano com data para ele. Misturar as duas listas faria a dívida virar exceção
// com o tempo, que é como a lacuna volta.
//
// Cada entrada aponta onde o plano está escrito.
const PENDENTE_COM_PLANO = {
  // A revisão do PIT nasceu em 2026-08-04 e não tem tela nenhuma: nem lista de
  // revisões do ano, nem diff de uma contra a anterior, nem publicar, nem
  // anexar o assinado. É a única lacuna de CLASSE C do sistema.
  exercicio: 'Fase 4 de chefe_dgeo 01-Projects/rastreabilidade-completa'
}

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
  test('o mapa de auditoria expõe agregados legíveis', () => {
    // Rede contra o falso verde: se a leitura do mapa mudar de forma e devolver
    // vazio, os testes abaixo passariam sem cobrar nada.
    expect(agregados().size).toBeGreaterThanOrEqual(20)
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

  test('a dívida declarada é pequena, e cada entrada aponta o plano', () => {
    // Ela é o que ainda falta, com endereço. Entrada sem plano escrito é
    // lacuna disfarçada de decisão.
    expect(Object.keys(PENDENTE_COM_PLANO).length).toBeLessThanOrEqual(3)
    for (const plano of Object.values(PENDENTE_COM_PLANO)) {
      expect(plano).toMatch(/01-Projects/)
    }
  })

  test('a lista de exceção é pequena, e cada uma tem motivo escrito', () => {
    // Ela é a medida do que falta. Crescer sem justificativa é como a lacuna
    // volta.
    expect(Object.keys(SEM_PAINEL_JUSTIFICADO).length).toBeLessThanOrEqual(5)
    for (const [entidade, motivo] of Object.entries(SEM_PAINEL_JUSTIFICADO)) {
      expect(typeof motivo).toBe('string')
      expect(motivo.length).toBeGreaterThan(20)
      expect(entidade).toMatch(/^[a-z_]+$/)
    }
  })
})
