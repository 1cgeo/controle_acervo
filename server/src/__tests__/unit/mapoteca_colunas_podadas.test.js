'use strict'

// AS COLUNAS PODADAS DO PEDIDO NÃO VOLTAM, e quem cobra isso é uma varredura do
// FONTE, e não um caso funcional.
//
// Por que varredura: `mapoteca.pedido.omds` e
// `mapoteca.produto_pedido.quantidade_fornecida` saíram em 2026-08-08 por
// medição (uma era constante -- 124 linhas, um valor distinto; a outra era igual
// à coluna vizinha em 1759 de 1759). Elas voltam do jeito mais fácil que existe:
// alguém copia uma consulta antiga, ou o ColumnSet de um controller vizinho, e a
// coluna reaparece numa query que ninguém testa. O erro só aparece em produção,
// como 500 de "coluna não existe", e na tela de quem estava trabalhando.
//
// O QUE ESTA VARREDURA NÃO É: uma proibição da PALAVRA. A aba META4_DETALHADA do
// RTM tem quinze colunas fixas, e duas delas se chamam 'OMDS' e 'Qnt Fornecida'.
// As duas continuam saindo -- a primeira como PARÂMETRO, com a sigla que
// `dgeo.instituicao` diz ser a desta instalação (ver o bloco OMDS de
// `relatorio_ctrl.js`; era literal até 2026-08-09), e a segunda pelo fragmento
// QTD_EFETIVA. Por isso o que se proíbe é a REFERÊNCIA À
// COLUNA (`p.omds`, `pp.quantidade_fornecida`, a chave do ColumnSet), e não o
// nome.
//
// Comentário sai antes da varredura, pela mesma razão do
// `routes/modulo_em_toda_rota.test.js`: prosa que descreve a poda não é a poda.

const fs = require('fs')
const path = require('path')

const SRC = path.resolve(__dirname, '..', '..')

// Onde as colunas eram lidas antes da poda. `pit/` está na lista por um motivo
// concreto: `pit_execucao_ctrl.js` escrevia o COALESCE à mão em vez de usar o
// fragmento, e teria derrubado a grade do PIT sem esta varredura acusar nada.
const PASTAS = ['mapoteca', 'pit', 'rpcmtec', 'integracao', 'auditoria']

const fontes = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? fontes(path.join(dir, e.name))
      : e.name.endsWith('.js')
        ? [path.join(dir, e.name)]
        : []
  )

const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    // Comentário de JavaScript e comentário de SQL: as consultas deste projeto
    // são template literals comentados por dentro com `--`.
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1').replace(/--.*$/, ''))
    .join('\n')

// AS TRÊS FORMAS de uma coluna chegar ao banco neste projeto, e são as três
// que se proíbem:
//
//   1. referência SQL, qualificada pelo alias ou pela tabela  p.omds, pedido.omds
//   2. chave de ColumnSet do pg-promise                       { name: 'omds' }
//   3. campo do Joi, que é a porta de entrada do corpo        omds: Joi.string()
//
// O QUE CONTINUA PERMITIDO, e por isso não entra nos padrões: a chave da linha
// de RELATÓRIO (`l.omds`, `omds: l.omds`), a coluna da planilha
// (`{ key: 'omds' }`) e o APELIDO de uma expressão SQL (`$<omds> AS omds`).
// Nenhum dos três toca coluna nenhuma; são o nome que a aba do RTM usa, e a aba
// tem quinze colunas fixas.
const referencias = (coluna, tabelas) => [
  new RegExp(`\\b(${tabelas.join('|')})\\.${coluna}\\b`, 'g'),
  new RegExp(`name:\\s*'${coluna}'`, 'g'),
  new RegExp(`\\b${coluna}\\s*:\\s*Joi\\.`, 'g')
]

// Os aliases com que cada tabela aparece nas consultas do projeto, mais o nome
// da própria tabela.
const PODADAS = [
  { coluna: 'omds', tabelas: ['p', 'ped', 'pedido'] },
  { coluna: 'quantidade_fornecida', tabelas: ['pp', 'produto_pedido'] }
]

const ARQUIVOS = PASTAS.flatMap(p => fontes(path.join(SRC, p)))

const varrer = (coluna, tabelas) => {
  const achados = []
  for (const arquivo of ARQUIVOS) {
    const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
    for (const padrao of referencias(coluna, tabelas)) {
      for (const achado of fonte.matchAll(padrao)) {
        achados.push(`${path.relative(SRC, arquivo)}: ${achado[0].trim()}`)
      }
    }
  }
  return achados
}

describe('as colunas podadas do pedido não voltam ao fonte', () => {
  it('a varredura realmente encontrou os arquivos do servidor', () => {
    // Controle negativo: uma lista vazia aprovaria qualquer coisa.
    expect(ARQUIVOS.length).toBeGreaterThan(20)
  })

  it.each(PODADAS.map(c => [c.coluna, c]))(
    'nenhuma referência de banco a %s',
    (_coluna, { coluna, tabelas }) => {
      expect(varrer(coluna, tabelas)).toEqual([])
    }
  )

  // O CONTROLE POSITIVO, e o caso que impede a varredura de virar decoração: as
  // mesmas regras aplicadas à coluna que FICOU têm de achar alguma coisa. Sem
  // isto, um erro de expressão regular aprovaria as duas podadas para sempre.
  //
  // E não é uma coluna qualquer: `tipo_midia_fornecida_id` é a gêmea de sufixo
  // da `quantidade_fornecida`, e ficou porque tem 25 divergências reais contra
  // as zero da outra.
  it('as mesmas regras ACHAM a gêmea que ficou (tipo_midia_fornecida_id)', () => {
    const achados = varrer('tipo_midia_fornecida_id', ['pp', 'produto_pedido'])
    // As três formas: a referência SQL, o ColumnSet e o campo do Joi.
    expect(achados.length).toBeGreaterThanOrEqual(3)
  })
})

describe('o DDL e a migração contam a mesma história', () => {
  const RAIZ = path.resolve(SRC, '..', '..')
  const ddl = fs.readFileSync(path.join(RAIZ, 'er', 'mapoteca.sql'), 'utf8')
  const ddlSemComentario = ddl
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(linha => linha.replace(/--.*$/, ''))
    .join('\n')

  it('er/mapoteca.sql não declara nenhuma das duas colunas', () => {
    expect(ddlSemComentario).not.toMatch(/\bomds\b/)
    expect(ddlSemComentario).not.toMatch(/\bquantidade_fornecida\b/)
  })

  // O `code` 1 sai da carga do domínio, e os outros seis ficam com os MESMOS
  // números: o buraco na numeração é a decisão, e fechá-lo reescreveria a
  // situação de 166 pedidos e mentiria sobre o que está em `auditoria.evento`.
  it('er/mapoteca.sql carrega as seis situações, começando no code 2', () => {
    const carga = ddl.match(
      /INSERT INTO mapoteca\.situacao_pedido[\s\S]*?;/
    )[0]
    const codes = [...carga.matchAll(/^\((\d+), '/gm)].map(m => Number(m[1]))
    expect(codes).toEqual([2, 3, 4, 5, 6, 7])
    expect(carga).toContain("(2, 'Pedido Recebido')")
  })

  it('o índice GIN das palavras-chave continua no DDL: é ele que serve o filtro', () => {
    expect(ddl).toMatch(
      /CREATE INDEX idx_pedido_palavras_chave ON mapoteca\.pedido USING GIN \(palavras_chave\)/
    )
  })
})
