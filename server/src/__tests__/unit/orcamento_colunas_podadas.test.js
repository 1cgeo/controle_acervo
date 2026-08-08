'use strict'

// AS COLUNAS PODADAS DO ORÇAMENTO NÃO VOLTAM, e quem cobra isso é uma varredura
// do FONTE, mais o Joi vivo, mais os `er/*.sql`.
//
// Por que varredura: quinze colunas saíram de `orcamento` em 2026-08-08, por
// medição contra a produção. Elas voltam do jeito mais fácil que existe --
// alguém copia um SELECT antigo, ou o ColumnSet de um controller vizinho, e a
// coluna reaparece numa consulta que ninguém testa. O erro só aparece em
// produção, como 500 de "coluna não existe", e na tela de quem está trabalhando.
//
// O QUE ESTA VARREDURA NÃO É: uma proibição da PALAVRA. Três dos nomes podados
// continuam existindo, e legitimamente:
//
//   `valor_total`  sai na resposta da API, DERIVADO de quantidade x unitário, e
//                  o item do DFD ainda o aceita por eco (com `.strip()`);
//   `gnd`          é coluna de `dominio.natureza_despesa`, que FICA, e é de onde
//                  o item do PDR passa a lê-lo;
//   `data_modificacao` continua em `nota_credito`, `nota_empenho`, `licitacao` e
//                  `arquivo` -- ela saiu de TRÊS tabelas, e não do módulo.
//
// Por isso o que se proíbe é a REFERÊNCIA À COLUNA, qualificada pelo alias
// daquela tabela, e não o nome.
//
// Comentário sai antes da varredura, pela mesma razão do
// `routes/modulo_em_toda_rota.test.js`: prosa que descreve a poda não é a poda.

const fs = require('fs')
const path = require('path')

const { recusaPor, aceita } = require('../helpers/joi')

const SRC = path.resolve(__dirname, '..', '..')
const RAIZ = path.resolve(SRC, '..', '..')
const ER = path.join(RAIZ, 'er')

// Onde as colunas eram lidas antes da poda. `rpcmtec` está na lista por um
// motivo concreto: a subseção 4.1 lê `pdr_item` e a 4.4/4.5 leem `licitacao`, e
// as duas escrevem o SQL à mão. `auditoria` está porque o mapa cita coluna por
// coluna.
const PASTAS = ['orcamento', 'rpcmtec', 'auditoria']

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

// AS TRÊS FORMAS de uma coluna chegar ao banco neste projeto:
//
//   1. referência SQL, qualificada pelo alias ou pela tabela   d.justificativa
//   2. chave de ColumnSet do pg-promise                        { name: 'valor_total' }
//   3. campo do Joi, que é a porta de entrada do corpo         nup: Joi.string()
//
// A TERCEIRA É OPCIONAL POR COLUNA, e a exceção não é preguiça: `gnd` é campo
// Joi legítimo de `dominio.natureza_despesa` (o CRUD de ND do orçamento o
// escreve), e `valor_total` é campo Joi legítimo do item do DFD, declarado
// `Joi.any().strip()` para descartar o eco do diálogo. Proibir o nome nas duas
// reprovaria código correto; o que prende as duas é a referência SQL, que é por
// onde elas chegariam ao banco.
const referencias = ({ coluna, tabelas, joi }) => {
  const padroes = [
    new RegExp(`\\b(${tabelas.join('|')})\\.${coluna}\\b`, 'g'),
    new RegExp(`name:\\s*'${coluna}'`, 'g')
  ]
  if (joi) padroes.push(new RegExp(`\\b${coluna}\\s*:\\s*Joi\\.`, 'g'))
  return padroes
}

// Os aliases com que cada tabela aparece nas consultas do projeto, mais o nome
// da própria tabela.
const PODADAS = [
  // orcamento.dfd
  { coluna: 'justificativa', tabelas: ['d', 'dfd'], joi: true },
  { coluna: 'grau_prioridade_id', tabelas: ['d', 'dfd'], joi: true },
  { coluna: 'data_prevista_conclusao', tabelas: ['d', 'dfd'], joi: true },
  { coluna: 'responsavel_cpf', tabelas: ['d', 'dfd'], joi: true },
  { coluna: 'vinculo_plano_gestao', tabelas: ['d', 'dfd'], joi: true },
  { coluna: 'valor_estimado', tabelas: ['d', 'dfd'], joi: true },
  // orcamento.dfd_item
  { coluna: 'valor_total', tabelas: ['dfd_item'], joi: false },
  // orcamento.pdr_item. O alias `i` é o do item nas duas tabelas podadas, e
  // `pi` é o do item do PDR dentro do RPCMTec.
  { coluna: 'gnd', tabelas: ['pi', 'pdr_item'], joi: false },
  // orcamento.licitacao
  { coluna: 'nup', tabelas: ['li', 'licitacao'], joi: true },
  { coluna: 'fornecedor', tabelas: ['li', 'licitacao'], joi: true },
  // orcamento.nota_credito
  { coluna: 'marcador', tabelas: ['nc', 'nota_credito'], joi: true },
  // O PAR DE CARIMBO, nas três tabelas em que ele saiu. `d` é o DFD e `i` é o
  // item (do DFD e do PDR). As outras quatro tabelas do módulo continuam com as
  // duas colunas, e por isso os aliases delas (`nc`, `ne`, `li`, `af`) NÃO
  // entram aqui: proibi-los reprovaria código correto.
  { coluna: 'data_modificacao', tabelas: ['d', 'i'], joi: false },
  { coluna: 'usuario_modificacao_uuid', tabelas: ['d', 'i'], joi: false }
]

const ARQUIVOS = PASTAS.flatMap(p => fontes(path.join(SRC, p)))

const varrer = alvo => {
  const achados = []
  for (const arquivo of ARQUIVOS) {
    const fonte = semComentario(fs.readFileSync(arquivo, 'utf8'))
    for (const padrao of referencias(alvo)) {
      for (const achado of fonte.matchAll(padrao)) {
        achados.push(`${path.relative(SRC, arquivo)}: ${achado[0].trim()}`)
      }
    }
  }
  return achados
}

describe('as colunas podadas do orçamento não voltam ao fonte', () => {
  it('a varredura realmente encontrou os arquivos do servidor', () => {
    // Controle negativo: uma lista vazia aprovaria qualquer coisa.
    expect(ARQUIVOS.length).toBeGreaterThan(20)
  })

  it.each(PODADAS.map(c => [c.coluna, c]))(
    'nenhuma referência de banco a %s',
    (_coluna, alvo) => {
      expect(varrer(alvo)).toEqual([])
    }
  )

  // O CONTROLE POSITIVO, e o caso que impede a varredura de virar decoração: as
  // mesmas regras aplicadas à coluna que FICOU têm de achar alguma coisa.
  //
  // E não é uma coluna qualquer: `numero_pregao` é a gêmea de `nup`. As duas
  // nasceram na MESMA migração, em 2026-08-04, com a mesma justificativa e as
  // mesmas 0 de 11 linhas. O chefe manteve uma e removeu a outra, e o critério
  // não foi o dado: foi que um identificador basta.
  it('as mesmas regras ACHAM a gêmea que ficou (licitacao.numero_pregao)', () => {
    const achados = varrer({
      coluna: 'numero_pregao', tabelas: ['li', 'licitacao'], joi: true
    })
    // As três formas de citação, ao menos: o SELECT, o INSERT/UPDATE e o Joi.
    expect(achados.length).toBeGreaterThanOrEqual(3)
  })

  // O SEGUNDO CONTROLE POSITIVO, e ele guarda a metade que mais se erra: o
  // carimbo saiu de TRÊS tabelas, e não do módulo. Se alguém "arrumar" o resto
  // por simetria, a nota de crédito perde o registro de quando foi editada.
  it('as mesmas regras ACHAM o carimbo que ficou (nota_credito.data_modificacao)', () => {
    const achados = varrer({
      coluna: 'data_modificacao', tabelas: ['nc', 'nota_credito'], joi: false
    })
    expect(achados.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------

/**
 * As colunas de cada tabela, lidas dos `er/*.sql`. Análise rasa, como a de
 * `__tests__/auditoria/mapa.test.js`: pega o bloco entre `CREATE TABLE x(` e o
 * `);` e dele o primeiro identificador de cada linha.
 *
 * POR TABELA, e não por arquivo inteiro: `data_modificacao` continua existindo
 * em quatro tabelas do módulo, então um `not.toMatch` sobre o arquivo diria o
 * contrário do que esta poda fez.
 */
const colunasDe = (arquivo, tabela) => {
  const sql = fs.readFileSync(path.join(ER, arquivo), 'utf8').replace(/\r\n?/g, '\n')
  const re = new RegExp(`CREATE TABLE ${tabela}\\s*\\(([\\s\\S]*?)\\n\\)\\s*;`, 'i')
  const bloco = sql.match(re)
  if (!bloco) return null
  return new Set(
    bloco[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('--'))
      .map(l => (l.match(/^([a-z_][a-z0-9_]*)\s/) || [])[1])
      .filter(Boolean)
  )
}

describe('o DDL conta a mesma história', () => {
  const PODA_POR_TABELA = [
    ['orcamento.dfd', [
      'justificativa', 'grau_prioridade_id', 'data_prevista_conclusao',
      'responsavel_cpf', 'vinculo_plano_gestao', 'valor_estimado',
      'data_modificacao', 'usuario_modificacao_uuid'
    ]],
    ['orcamento.dfd_item', ['valor_total', 'data_modificacao', 'usuario_modificacao_uuid']],
    ['orcamento.pdr_item', ['gnd', 'data_modificacao', 'usuario_modificacao_uuid']],
    ['orcamento.licitacao', ['nup', 'fornecedor']],
    ['orcamento.nota_credito', ['marcador']]
  ]

  it('a leitura do er/orcamento.sql funcionou', () => {
    // Rede contra o falso verde: se o extrator devolver vazio, todo `not.toContain`
    // abaixo passaria sem cobrar nada.
    const dfd = colunasDe('orcamento.sql', 'orcamento.dfd')
    expect(dfd).not.toBeNull()
    expect(dfd.has('numero')).toBe(true)
    expect(dfd.has('area_requisitante')).toBe(true)
  })

  it.each(PODA_POR_TABELA)('%s não declara mais as colunas podadas', (tabela, podadas) => {
    const colunas = colunasDe('orcamento.sql', tabela)
    expect([...podadas].filter(c => colunas.has(c))).toEqual([])
  })

  // O que FICOU, e cada linha tem um motivo diferente de estar aqui.
  it('as colunas que o chefe MANTEVE continuam no DDL', () => {
    const licitacao = colunasDe('orcamento.sql', 'orcamento.licitacao')
    // A gêmea do NUP, e a decisão foi manter UM identificador.
    expect(licitacao.has('numero_pregao')).toBe(true)
    expect(licitacao.has('data_homologacao')).toBe(true)
    // O texto livre que narra a fase: tirá-lo esvaziaria 10 de 11 linhas do
    // relatório assinado, porque a 4.4/4.5 lê COALESCE(fase.nome, fase_atual).
    expect(licitacao.has('fase_atual')).toBe(true)
    expect(licitacao.has('om_gestora')).toBe(true)

    const dfd = colunasDe('orcamento.sql', 'orcamento.dfd')
    // A única constante do DFD que ficou, e ficou pelo motivo oposto ao que
    // parece: é o único campo que diz DE QUEM é a demanda.
    expect(dfd.has('area_requisitante')).toBe(true)

    const pdrItem = colunasDe('orcamento.sql', 'orcamento.pdr_item')
    // O único elo entre o orçamento e o PIT.
    expect(pdrItem.has('meta_pit_id')).toBe(true)

    const dfdItem = colunasDe('orcamento.sql', 'orcamento.dfd_item')
    // A fonte do total derivado: sem as duas não há o que calcular.
    expect(dfdItem.has('quantidade')).toBe(true)
    expect(dfdItem.has('valor_unitario')).toBe(true)

    // Estas SAEM na 4.6 do RPCMTec, e por isso não são candidatas apesar de
    // parecerem: `prazo_entrega` é a terceira coluna da tabela assinada e
    // `ano_referencia` decide em qual RPCMTec o item aparece.
    const recebimento = colunasDe('orcamento.sql', 'orcamento.recebimento_material')
    expect(recebimento.has('prazo_entrega')).toBe(true)
    expect(recebimento.has('ano_referencia')).toBe(true)

    // O carimbo saiu de TRÊS tabelas, e não do módulo.
    for (const t of ['orcamento.nota_credito', 'orcamento.nota_empenho',
      'orcamento.licitacao', 'orcamento.arquivo']) {
      expect(colunasDe('orcamento.sql', t).has('data_modificacao')).toBe(true)
    }
  })

  it('dominio.grau_prioridade saiu do er/dominio.sql, e a carga dela também', () => {
    expect(colunasDe('dominio.sql', 'dominio.grau_prioridade')).toBeNull()
    const dominio = fs.readFileSync(path.join(ER, 'dominio.sql'), 'utf8')
    expect(dominio).not.toMatch(/INSERT INTO dominio\.grau_prioridade/)
  })

  // O CONSERTO, e é a metade da migração que vale mais que a poda inteira: as
  // duas colunas existiam desde 2026-08-07 e nenhuma linha do servidor as
  // escrevia. Anuláveis, elas deixavam `uniq_nota_empenho_chave_siafi` inerte,
  // porque NULL não colide com NULL num índice único.
  it('nota_empenho.ug e .gestao são NOT NULL no DDL', () => {
    const sql = fs.readFileSync(path.join(ER, 'orcamento.sql'), 'utf8')
    const bloco = sql.match(/CREATE TABLE orcamento\.nota_empenho\s*\(([\s\S]*?)\n\)\s*;/)[1]
    expect(bloco).toMatch(/^\s*ug VARCHAR\(10\) NOT NULL,/m)
    expect(bloco).toMatch(/^\s*gestao VARCHAR\(5\) NOT NULL,/m)
    expect(sql).toMatch(/CREATE UNIQUE INDEX uniq_nota_empenho_chave_siafi/)
  })
})

describe('a versão e o piso andam juntos', () => {
  const versao = fs.readFileSync(path.join(ER, 'versao.sql'), 'utf8')
  const config = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8')

  // NÃO É IGUALDADE, e a diferença importa: `er/versao.sql` é a INSTALAÇÃO NOVA,
  // e carimba a última versão que existe, não a desta migração. Outra migração
  // do mesmo dia pode empurrá-la adiante sem que esta poda mude. O que não pode
  // acontecer é o carimbo ficar ATRÁS de 1.43.0: aí a instalação nova nasceria
  // sem as colunas podadas e mentindo que é anterior à poda, e o piso a
  // recusaria no boot.
  it('er/versao.sql carimba 1.43.0 ou mais', () => {
    const [, atual] = versao.match(/\(1, '(\d+\.\d+\.\d+)'\)/)
    const numero = v => v.split('.').map(Number)
    const [a, b, c] = numero(atual)
    const [x, y, z] = numero('1.43.0')
    expect(a * 1e6 + b * 1e3 + c).toBeGreaterThanOrEqual(x * 1e6 + y * 1e3 + z)
  })

  // O PISO SOBE, e por REMOÇÃO. A regra do projeto é que remover só não sobe o
  // piso quando o código nunca leu o que saiu, e aqui ele lia todas: um servidor
  // 1.42.0 contra um banco 1.43.0 quebra na abertura de quatro telas, e em toda
  // gravação de nota de empenho.
  it('MIN_DATABASE_VERSION subiu para 1.43.0 ou mais', () => {
    const [, piso] = config.match(/const MIN_DATABASE_VERSION = '(\d+\.\d+\.\d+)'/)
    const chave = v => {
      const [a, b, c] = v.split('.').map(Number)
      return a * 1e6 + b * 1e3 + c
    }
    expect(chave(piso)).toBeGreaterThanOrEqual(chave('1.43.0'))
  })

  it('a migração existe e registra que REVERTE a decisão de 2026-08-04', () => {
    const arquivo = path.join(RAIZ, 'migrations', '2026-08-08_poda_do_orcamento.sql')
    expect(fs.existsSync(arquivo)).toBe(true)
    const sql = fs.readFileSync(arquivo, 'utf8')
    // A frase que impede a próxima pessoa de "consertar" a remoção do NUP.
    expect(sql).toMatch(/REVERTE/)
    expect(sql).toMatch(/2026-08-04_licitacao_campos_fase_e_anexo\.sql/)
    expect(sql).toMatch(/UPDATE public\.versao SET nome = '1\.43\.0'/)
  })
})

// ---------------------------------------------------------------------------

describe('o Joi vivo recusa os campos podados', () => {
  const dfdSchema = require('../../orcamento/dfd/dfd_schema')
  const pdrSchema = require('../../orcamento/pdr/pdr_schema')
  const ncSchema = require('../../orcamento/nota_credito/nota_credito_schema')
  const licSchema = require('../../orcamento/licitacao/licitacao_schema')
  const neSchema = require('../../orcamento/nota_empenho/nota_empenho_schema')

  const dfd = { numero: 'DFD-1', ano: 2026, objeto: 'Aquisicao' }
  const pdr = { ano: 2026, cod_nd: '339030' }
  const nc = { numero: 'NC-1', ano: 2026, cod_nd: '339030', valor_nc: 100, classificacao_id: 1 }
  const lic = { ano: 2026, tipo_id: 1, objeto: 'Pregao' }
  const ne = { numero: 'NE-1', ano: 2026, nota_credito_id: 1, valor_empenhado: 10 }

  it.each([
    ['justificativa', 'texto'],
    ['grau_prioridade_id', 1],
    ['data_prevista_conclusao', '2026-12-31'],
    ['responsavel_cpf', '00000000000'],
    ['vinculo_plano_gestao', 'Plano'],
    ['valor_estimado', 1000]
  ])('DFD: %s vira recusa por chave desconhecida', (campo, valor) => {
    recusaPor(dfdSchema.criar.validate({ ...dfd, [campo]: valor }), campo, 'object.unknown')
    recusaPor(dfdSchema.atualizar.validate({ ...dfd, [campo]: valor }), campo, 'object.unknown')
  })

  it('PDR: gnd vira recusa por chave desconhecida', () => {
    recusaPor(pdrSchema.criar.validate({ ...pdr, gnd: 3 }), 'gnd', 'object.unknown')
  })

  it('NC: marcador vira recusa por chave desconhecida', () => {
    recusaPor(ncSchema.criar.validate({ ...nc, marcador: 'RECOLH' }), 'marcador', 'object.unknown')
  })

  it.each(['nup', 'fornecedor'])(
    'Licitação: %s vira recusa por chave desconhecida', campo => {
      recusaPor(licSchema.criar.validate({ ...lic, [campo]: 'x' }), campo, 'object.unknown')
    }
  )

  // O OUTRO LADO da chave do SIAFI: elas são DERIVADAS, e não digitadas. Um
  // campo de formulário permitiria afirmar uma UG que o crédito desmente, e o
  // índice único passaria a proteger a mentira.
  it.each(['ug', 'gestao'])(
    'NE: %s não é campo do corpo, porque o servidor a deriva', campo => {
      recusaPor(neSchema.criar.validate({ ...ne, [campo]: '167382' }), campo, 'object.unknown')
    }
  )

  // A ÚNICA TOLERÂNCIA, e ela é nomeada: o total do item chega por ECO do GET,
  // e não por digitação. Recusá-lo travaria a edição de todo DFD que já tem
  // item, porque o diálogo devolve o item inteiro.
  it('item do DFD: valor_total é DESCARTADO, e não recusado nem gravado', () => {
    const valor = aceita(dfdSchema.criar.validate({
      ...dfd,
      itens: [{
        tipo_item_id: 1, descricao: 'Papel', quantidade: 2, valor_unitario: 50,
        valor_total: 999999
      }]
    }))
    expect(valor.itens[0]).not.toHaveProperty('valor_total')
    expect(valor.itens[0].quantidade).toBe(2)
    expect(valor.itens[0].valor_unitario).toBe(50)
  })
})

// ---------------------------------------------------------------------------

describe('o cabeçalho da 4.1 diz o que a consulta faz', () => {
  const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

  // `BLOCOS` já é a lista PLANA das subseções, na ordem do documento.
  const subsecao41 = estrutura.bloco('4.1')

  it('a 4.1 existe e é do orçamento', () => {
    // Rede contra o falso verde: um `find` que devolve undefined derrubaria os
    // testes abaixo por outro motivo.
    expect(subsecao41).toBeDefined()
    expect(subsecao41.modulo).toBe('orcamento')
  })

  // O cabeçalho dizia "Valor previsto (Prioridade 1)" e a consulta soma TODO
  // `pdr_item.valor_autorizado` do ano, sem filtro de prioridade nenhum -- a
  // prioridade nem sequer existia em `pdr_item`, morava em `dfd` e estava
  // preenchida em 1 linha de 8. O documento ASSINADO afirmava um recorte que a
  // consulta nunca fez. Decisão do chefe em 2026-08-08: muda o cabeçalho.
  it('a coluna 2 se chama "Valor previsto", sem recorte de prioridade', () => {
    expect(subsecao41.cabecalhos[1]).toBe('Valor previsto')
    expect(subsecao41.cabecalhos.join(' | ')).not.toMatch(/Prioridade/i)
  })

  // A GRADE NÃO MUDA: as larguras são as do modelo da Divisão, e a tabela tem
  // de continuar colável na subseção de mesmo número sem ninguém reformatar.
  it('a grade continua a do modelo, com uma largura por cabeçalho', () => {
    expect(subsecao41.grade).toEqual([1388, 2151, 1388, 1638, 1638, 1638])
    expect(subsecao41.grade).toHaveLength(subsecao41.cabecalhos.length)
  })

  // A consulta que alimenta a coluna continua sem filtro de prioridade, e é
  // isso que o cabeçalho novo afirma. Se alguém puser o filtro de volta, o
  // cabeçalho tem de voltar junto.
  it('a consulta da 4.1 não filtra por prioridade nenhuma', () => {
    const ctrl = fs.readFileSync(path.join(SRC, 'rpcmtec', 'rpcmtec_ctrl.js'), 'utf8')
    expect(semComentario(ctrl)).not.toMatch(/grau_prioridade/)
  })
})
