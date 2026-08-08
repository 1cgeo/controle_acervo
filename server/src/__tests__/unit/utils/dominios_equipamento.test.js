'use strict'

// PARIDADE entre `er/equipamento.sql` e `utils/domain_constants.js`.
//
// O PROBLEMA QUE ISTO RESOLVE. As cinco tabelas de domínio do módulo têm `code`
// FIXO, semeado pelo DDL, e o JavaScript repete esses códigos em cinco objetos.
// São duas cópias da mesma verdade em arquivos que ninguém abre juntos. Trocar
// um código no DDL sem trocá-lo aqui não quebra o boot, não quebra sintaxe e não
// deixa rastro: quebra o DADO -- uma descarga gravada como Cessão, um bem que a
// lista filtra por 'Indisponível' e devolve os afastados.
//
// A LEITURA É DO FONTE SQL, e não do banco: este teste é do pacote `rapido`, e
// exigir PostgreSQL para conferir dois números o faria rodar só antes do commit.
// É a mesma técnica de `routes/modulo_em_toda_rota.test.js`.
//
// A EXPECTATIVA É O DDL. Se um caso aqui falhar, o que se corrige é
// `domain_constants.js`, e nunca o número esperado.
//
// AS CHAVES TAMBÉM SE PROVAM, e não só os códigos: o nome da constante sai do
// `nome` da linha do domínio, normalizado ('Em manutenção' -> EM_MANUTENCAO).
// Sem isso, `{ DISPONIVEL: 2, AFASTADO: 1 }` passaria: o conjunto de códigos
// seria o mesmo e o significado, o inverso.

const fs = require('fs')
const path = require('path')

const constantes = require('../../../utils/domain_constants')

const DDL = path.resolve(
  __dirname, '..', '..', '..', '..', '..', 'er', 'equipamento.sql'
)

const fonte = () => fs.readFileSync(DDL, 'utf8').replace(/\r\n?/g, '\n')

/**
 * Parte uma tupla `6, 'VI'` em campos, respeitando a aspa simples.
 *
 * O `split(',')` cru bastaria hoje, porque nenhum nome do domínio tem vírgula.
 * Bastaria HOJE: 'Cessão, com ônus' entraria amanhã e partiria a tupla no meio
 * sem nada acusar, e o teste passaria a comparar lixo com lixo.
 *
 * @param {string} tupla
 * @returns {Array<string|number>}
 */
const campos = tupla => {
  const saida = []
  let atual = ''
  let dentroDeAspas = false

  for (let i = 0; i < tupla.length; i++) {
    const c = tupla[i]
    if (c === "'") {
      // Aspa dobrada dentro de string SQL: `'O''Brien'`.
      if (dentroDeAspas && tupla[i + 1] === "'") {
        atual += "'"
        i++
      } else {
        dentroDeAspas = !dentroDeAspas
      }
    } else if (c === ',' && !dentroDeAspas) {
      saida.push(atual.trim())
      atual = ''
    } else {
      atual += c
    }
  }
  saida.push(atual.trim())

  return saida.map(v => (/^-?\d+$/.test(v) ? Number(v) : v))
}

/**
 * As linhas semeadas de uma tabela de domínio do DDL.
 *
 * @param {string} tabela - o nome sem o schema
 * @returns {Array<Object>} uma linha por tupla, com as colunas do INSERT
 */
const linhasDoDdl = tabela => {
  const texto = fonte()
  const inicio = new RegExp(
    `INSERT INTO equipamento\\.${tabela}\\s*\\(([^)]*)\\)\\s*VALUES`, 'g'
  )
  const cabecalho = inicio.exec(texto)
  if (!cabecalho) {
    throw new Error(
      `er/equipamento.sql não tem INSERT para equipamento.${tabela}. ` +
      'O DDL mudou de forma, e este teste ficou cego: conserte a leitura.'
    )
  }

  const colunas = cabecalho[1].split(',').map(c => c.trim())
  const corpo = texto.slice(inicio.lastIndex, texto.indexOf(';', inicio.lastIndex))

  return [...corpo.matchAll(/\(([^)]*)\)/g)].map(t => {
    const valores = campos(t[1])
    const linha = {}
    colunas.forEach((coluna, i) => { linha[coluna] = valores[i] })
    return linha
  })
}

/**
 * O nome do domínio virado nome de constante: sem acento, maiúsculo, com `_` no
 * lugar do espaço. 'Em manutenção' -> EM_MANUTENCAO, 'Cia Lev' -> CIA_LEV.
 */
const comoConstante = nome =>
  String(nome)
    .normalize('NFD')
    // A faixa dos diacríticos combinantes vai ESCAPADA, e não como caractere
    // literal: escrita literal ela some no primeiro editor que normalize o
    // arquivo, e a normalização passa a não tirar acento nenhum, calada.
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** O objeto `{CHAVE: code}` que o DDL de uma tabela descreve. */
const constanteDoDdl = tabela => {
  const mapa = {}
  for (const linha of linhasDoDdl(tabela)) {
    mapa[comoConstante(linha.nome)] = linha.code
  }
  return mapa
}

// A tabela do DDL e a constante que a espelha. `tipo_equipamento` NÃO está aqui,
// e a ausência é a regra: ela é CADASTRO, com `id SERIAL` e tela de CRUD, e id de
// cadastro nunca vira constante.
const PARES = [
  ['classe_suprimento', 'CLASSE_SUPRIMENTO'],
  ['secao_detentora', 'SECAO_DETENTORA'],
  ['situacao', 'SITUACAO_EQUIPAMENTO'],
  ['situacao_transferencia', 'SITUACAO_TRANSFERENCIA'],
  ['tipo_transferencia', 'TIPO_TRANSFERENCIA']
]

describe('os domínios do equipamento batem entre o DDL e o domain_constants', () => {
  test.each(PARES)(
    'equipamento.%s é igual a %s',
    (tabela, nomeDaConstante) => {
      expect(constantes[nomeDaConstante]).toEqual(constanteDoDdl(tabela))
    }
  )

  // CONTROLE. Sem ele, um `linhasDoDdl` que devolvesse lista vazia faria os
  // cinco casos acima compararem `{}` com `{}` -- e, pior, faria isso em
  // silêncio no dia em que o formato do DDL mudasse.
  //
  // As contagens são as de HOJE, e não uma folga: baixá-las para caber numa
  // remoção futura é o mesmo que desligar o controle.
  test('a leitura do DDL não devolve mapa vazio', () => {
    const contagem = Object.fromEntries(
      PARES.map(([tabela]) => [tabela, linhasDoDdl(tabela).length])
    )

    expect(contagem).toEqual({
      classe_suprimento: 2,
      secao_detentora: 2,
      situacao: 5,
      situacao_transferencia: 4,
      tipo_transferencia: 3
    })

    // Três âncoras escolhidas a dedo, para o caso acima não poder passar com um
    // parser que contasse parênteses e não lesse valor nenhum.
    expect(constanteDoDdl('classe_suprimento').VI).toBe(6)
    expect(constanteDoDdl('situacao').BAIXADO).toBe(5)
    expect(constanteDoDdl('tipo_transferencia').DESCARGA).toBe(3)
  })

  test('a leitura falha alto quando a tabela não existe no DDL', () => {
    // O controle do controle: um `linhasDoDdl` tolerante devolveria `[]` para
    // qualquer nome, e o caso acima viraria enfeite.
    expect(() => linhasDoDdl('tabela_que_nao_existe')).toThrow(/não tem INSERT/)
  })
})

// A ESCADA DA SITUAÇÃO DEPENDE DISTO, e por isso tem caso próprio.
//
// `equipamento.situacao_em(dia)` escolhe o degrau pelo `max(precedencia)` e
// depois traduz esse máximo de volta em `code` com
// `WHERE s.precedencia = max(x.precedencia)`. Duas situações com a MESMA
// precedência fariam aquele subselect devolver duas linhas, e a função morreria
// em tempo de execução -- ou, se alguém "consertasse" com um LIMIT 1, passaria a
// escolher o degrau ao acaso.
//
// O banco já cobra por `UNIQUE`, e este caso cobra do DDL antes de qualquer
// instalação: um `UNIQUE` removido numa migração não acusaria nada aqui, mas um
// INSERT com precedência repetida acusa.
describe('a escada da situação do equipamento', () => {
  const situacoes = () => linhasDoDdl('situacao')

  test('todo code tem precedência distinta', () => {
    const precedencias = situacoes().map(s => s.precedencia)

    expect(precedencias).toHaveLength(5)
    expect(new Set(precedencias).size).toBe(precedencias.length)
  })

  test('a ordem dos degraus é a do documento, do mais baixo ao mais alto', () => {
    // O QUE ESTE CASO GUARDA não é a numeração (10, 20, ...), é a ORDEM: o
    // Baixado tem de vencer o Indisponível, que vence a manutenção, que vence o
    // afastamento. Trocar dois números aqui inverteria a regra central do módulo
    // sem que nenhuma outra asserção percebesse.
    const porPrecedencia = situacoes()
      .slice()
      .sort((a, b) => a.precedencia - b.precedencia)
      .map(s => s.nome)

    expect(porPrecedencia).toEqual([
      'Disponível', 'Afastado', 'Em manutenção', 'Indisponível', 'Baixado'
    ])
  })
})
