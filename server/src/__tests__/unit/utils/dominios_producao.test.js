'use strict'

// PARIDADE entre `er/dominio.sql` e `utils/domain_constants.js` para o core de
// produção e para `dominio.subtipo_produto`.
//
// O PROBLEMA QUE ISTO RESOLVE é o mesmo de `dominios_equipamento.test.js`, e
// aqui ele é maior: são treze domínios e oitenta e três códigos copiados à mão
// do DDL para o JavaScript. `SUBTIPO_PRODUTO` sozinho passou de cinco para
// trinta códigos em 2026-08-09, quando a escolha do template de XML do metadado
// precisou de sete que estavam fora. Copiar trinta números errando um não quebra
// o boot, não quebra sintaxe e não deixa rastro: quebra o DADO, mandando a carta
// ortoimagem para o template do CDGV.
//
// A LEITURA É DO FONTE SQL, e não do banco: este teste é do pacote `rapido`, e
// exigir PostgreSQL para conferir números o faria rodar só antes do commit.
//
// A EXPECTATIVA É O DDL. Se um caso aqui falhar, o que se corrige é
// `domain_constants.js`, e nunca o número esperado.
//
// SÓ OS CÓDIGOS SE PROVAM, e não a ligação entre nome e código, ao contrário do
// teste do equipamento. A diferença é que ali o nome da constante SAI do `nome`
// da linha do domínio, e aqui não sai: 'Conjunto de dados geoespaciais vetoriais
// - ET-EDGV 2.1.3' virou `CDGV_ET_EDGV_213`, e 'Controle de qualidade sem falso
// positivo' virou `QUALIDADE_SEM_FALSO_POSITIVO`. Derivar isso exigiria um
// dicionário de abreviações, que seria uma terceira cópia da mesma verdade. O
// que este teste pega é o código a mais, o código a menos, o repetido e o
// digitado errado, que são as quatro maneiras de errar uma cópia de trinta
// números.

const fs = require('fs')
const path = require('path')

const constantes = require('../../../utils/domain_constants')

const DDL = path.resolve(
  __dirname, '..', '..', '..', '..', '..', 'er', 'dominio.sql'
)

const fonte = () => fs.readFileSync(DDL, 'utf8').replace(/\r\n?/g, '\n')

/**
 * Os `code` que o DDL semeia numa tabela de domínio, na ordem do INSERT.
 *
 * SÓ O PRIMEIRO CAMPO DA TUPLA É LIDO, e é por isso que vírgula dentro de nome
 * não atrapalha: 'Grande quantidade de objetos na unidade de trabalho, necessita
 * ser dividida' é um `nome` do `tipo_problema_atividade`, e um `split(',')` cru
 * partiria a tupla no meio. O `cor` do `tipo_fase` ('252,141,89') traria o mesmo
 * problema pelo outro lado.
 */
const codesDoDdl = tabela => {
  const texto = fonte()
  const cabecalho = new RegExp(
    `INSERT INTO dominio\\.${tabela}\\s*\\([^)]*\\)\\s*VALUES`
  )
  const inicio = texto.search(cabecalho)
  if (inicio === -1) throw new Error(`INSERT de dominio.${tabela} não achado`)

  const fim = texto.indexOf(';', inicio)
  const bloco = texto.slice(inicio, fim)

  const codes = []
  // `(` seguido de número e vírgula: é o começo de tupla, e nunca o meio de um
  // texto entre aspas, porque ali o número vem depois da aspa.
  const tupla = /\(\s*(\d+)\s*,/g
  let casamento
  while ((casamento = tupla.exec(bloco)) !== null) {
    codes.push(Number(casamento[1]))
  }
  return codes
}

// A tabela de domínio de cada constante deste arquivo. É o mapa que o teste
// prova, e escrevê-lo aqui é o que permite provar TODOS de uma vez: constante
// nova do core que esqueça de entrar não fica coberta, e por isso ela entra
// junto com a linha na tabela abaixo.
const PARES = [
  ['SUBTIPO_PRODUTO', 'subtipo_produto'],
  ['TIPO_FASE', 'tipo_fase'],
  ['TIPO_PRE_REQUISITO', 'tipo_pre_requisito'],
  ['TIPO_ETAPA', 'tipo_etapa'],
  ['TIPO_EXIBICAO', 'tipo_exibicao'],
  ['TIPO_RESTRICAO', 'tipo_restricao'],
  ['TIPO_INSUMO', 'tipo_insumo'],
  ['TIPO_DADO_PRODUCAO', 'tipo_dado_producao'],
  ['SITUACAO_ATIVIDADE', 'tipo_situacao_atividade'],
  ['TIPO_CONFIGURACAO', 'tipo_configuracao'],
  ['TIPO_PERFIL_DIFICULDADE', 'tipo_perfil_dificuldade'],
  ['TIPO_PROBLEMA_ATIVIDADE', 'tipo_problema_atividade'],
  ['TIPO_ROTINA', 'tipo_rotina']
]

describe('os domínios do core de produção batem entre o DDL e o domain_constants', () => {
  test.each(PARES)('%s espelha dominio.%s inteiro', (nome, tabela) => {
    const doDdl = codesDoDdl(tabela)
    const daConstante = Object.values(constantes[nome])

    // `sort` numérico dos dois lados: a ordem das chaves de um objeto não é
    // contrato, e o que se prova é o CONJUNTO.
    const ordena = lista => [...lista].sort((a, b) => a - b)

    expect(ordena(daConstante)).toEqual(ordena(doDdl))
  })

  test.each(PARES)('%s não repete código', nome => {
    const valores = Object.values(constantes[nome])
    expect(new Set(valores).size).toBe(valores.length)
  })
})

// AS TRÊS TABELAS QUE FICAM DE FORA, e a ausência é a regra escrita em
// `domain_constants.js`: `tipo_controle_qualidade`,
// `tipo_criacao_unidade_trabalho` e `tipo_estrategia_associacao` são ARGUMENTO
// de rotina de criação em massa, nenhuma coluna do schema `producao` aponta para
// elas e nenhum SQL compara código delas com literal. Constante que ninguém lê é
// catálogo para desatualizar.
//
// O CASO ABAIXO GUARDA A DECISÃO, e não o gosto de quem escreveu: quem trouxer
// uma delas para o catálogo tem de apagar esta linha, e apagá-la é o momento em
// que se lê o porquê.
describe('os domínios que são argumento de rotina ficam fora do catálogo', () => {
  test.each([
    'TIPO_CONTROLE_QUALIDADE',
    'TIPO_CRIACAO_UNIDADE_TRABALHO',
    'TIPO_ESTRATEGIA_ASSOCIACAO'
  ])('%s não existe em domain_constants', nome => {
    expect(constantes[nome]).toBeUndefined()
  })
})
