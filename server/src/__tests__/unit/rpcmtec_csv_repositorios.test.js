'use strict'

// O CSV do github_dashboard virando as linhas da subseção 5.1.
//
// O QUE ESTE ARQUIVO GUARDA, em ordem de importância:
//
//   1. o RESUMO SOBREVIVE À REIMPORTAÇÃO. Ele é a única coluna da 5.1 escrita
//      por pessoa, e não existe em lugar nenhum mais. Uma importação que o
//      zerasse destruiria trabalho, e destruiria calada;
//   2. o repositório que sumiu do CSV SAI da tabela, e sai NOMEADO. Mantê-lo
//      faria o documento assinado afirmar commits de um mês que o painel não
//      conta mais;
//   3. o importador RECUSA o que não entendeu, com a frase que ensina o
//      conserto, em vez de gravar metade do arquivo.
//
// O CSV real vem de `dashboard_cli/lib/saida.js` (função `csvConsolidado`) e do
// botão "Dados Consolidados" da tela (`ConsolidatedDataExport.jsx`). Os dois
// escrevem o MESMO formato, e é ele que está nas amostras abaixo: cabeçalho
// acentuado, militares unidos por ponto e vírgula, sem aspas.

const csv = require('../../rpcmtec/rpcmtec_csv_repositorios')

// A amostra fiel ao gerador, com o cabeçalho que o painel escreve.
const CSV_PAINEL = [
  'Repositório,Número de commits,Efetivo',
  'controle_acervo,42,Cap Fulano;Maj Beltrano',
  'DsgTools,17,Ten Sicrano',
  'ferramentas_edicao,3,Cap Fulano'
].join('\n')

const repos = texto => csv.analisar(texto).repositorios

const recusa = texto => {
  expect(() => csv.analisar(texto)).toThrow(csv.ErroCsv)
  try {
    csv.analisar(texto)
  } catch (e) {
    return e.message
  }
  throw new Error('não recusou')
}

describe('analisar: o CSV que o painel entrega', () => {
  test('lê as três colunas, na ordem do arquivo', () => {
    const lidos = repos(CSV_PAINEL)

    expect(lidos).toEqual([
      { repo: 'controle_acervo', commits: '42', efetivo: 'Cap Fulano;Maj Beltrano' },
      { repo: 'DsgTools', commits: '17', efetivo: 'Ten Sicrano' },
      { repo: 'ferramentas_edicao', commits: '3', efetivo: 'Cap Fulano' }
    ])
    expect(csv.analisar(CSV_PAINEL).avisos).toEqual([])
  })

  test('o ponto e vírgula do efetivo NÃO separa coluna', () => {
    // O gerador une os militares por ponto e vírgula justamente para não
    // precisar de aspas. Tratá-lo como separador partiria o efetivo ao meio.
    const [primeiro] = repos(CSV_PAINEL)
    expect(primeiro.efetivo).toBe('Cap Fulano;Maj Beltrano')
    expect(primeiro.efetivo.split(';')).toHaveLength(2)
  })

  test('aceita o cabeçalho da TABELA, com "no período"', () => {
    // O painel escreve "Número de commits" e a 5.1 escreve "Número de commits
    // no período". Exigir igualdade recusaria o arquivo do próprio sistema.
    const texto = CSV_PAINEL.replace(
      'Número de commits', 'Número de commits no período'
    )
    expect(repos(texto)).toEqual(repos(CSV_PAINEL))
  })

  test('aceita o cabeçalho SEM acento', () => {
    const texto = CSV_PAINEL.replace(
      'Repositório,Número de commits,Efetivo', 'Repositorio,Numero de commits,Efetivo'
    )
    expect(repos(texto)).toEqual(repos(CSV_PAINEL))
  })

  test('aceita espaço sobrando no cabeçalho e nas células', () => {
    const texto = [
      ' Repositório , Número de commits ,  Efetivo ',
      '  controle_acervo , 42 , Cap Fulano;Maj Beltrano '
    ].join('\n')

    expect(repos(texto)).toEqual([
      { repo: 'controle_acervo', commits: '42', efetivo: 'Cap Fulano;Maj Beltrano' }
    ])
  })

  test('a ordem das colunas não importa: o mapa é por NOME', () => {
    const texto = [
      'Efetivo,Repositório,Número de commits',
      'Cap Fulano;Maj Beltrano,controle_acervo,42'
    ].join('\n')

    expect(repos(texto)).toEqual([
      { repo: 'controle_acervo', commits: '42', efetivo: 'Cap Fulano;Maj Beltrano' }
    ])
  })
})

describe('analisar: a sujeira que se limpa sem avisar', () => {
  test('CRLF do Windows', () => {
    expect(repos(CSV_PAINEL.replace(/\n/g, '\r\n'))).toEqual(repos(CSV_PAINEL))
  })

  test('BOM do Excel no começo do arquivo', () => {
    // Sem tratar o BOM, o primeiro rótulo vira "﻿Repositório" e o arquivo
    // inteiro é recusado por "cabeçalho não reconhecido".
    expect(repos(`﻿${CSV_PAINEL}`)).toEqual(repos(CSV_PAINEL))
  })

  test('linha em branco no fim, no meio e no começo', () => {
    const texto = `\n${CSV_PAINEL.replace('DsgTools', '\nDsgTools')}\n\n`
    expect(repos(texto)).toEqual(repos(CSV_PAINEL))
  })

  test('o número da linha nas mensagens é o do ARQUIVO, e não o da lista limpa', () => {
    // A pessoa procura o erro no editor dela, onde a linha em branco conta.
    const texto = [
      'Repositório,Número de commits,Efetivo',
      '',
      'controle_acervo,muitos,Cap Fulano'
    ].join('\n')

    expect(recusa(texto)).toContain('linha 3')
  })
})

describe('analisar: o que ele RECUSA, e a frase que ensina o conserto', () => {
  test('CSV vazio', () => {
    const m = recusa('')
    expect(m).toContain('vazio')
    expect(m).toContain('dashboard_cli')
    expect(recusa('   \n \r\n ')).toContain('vazio')
  })

  test('só o cabeçalho: manda usar "Sem ocorrência no mês"', () => {
    // Aceitar isto gravaria a tabela vazia, e a tabela vazia apagaria todo
    // Resumo já escrito. É o pior caso silencioso deste importador.
    const m = recusa('Repositório,Número de commits,Efetivo\n')
    expect(m).toContain('só o cabeçalho')
    expect(m).toContain('Sem ocorrência no mês')
  })

  test('cabeçalho ausente: cita a linha que veio', () => {
    const m = recusa('controle_acervo,42,Cap Fulano\nDsgTools,17,Ten Sicrano')
    expect(m).toContain('cabeçalho')
    expect(m).toContain('controle_acervo,42,Cap Fulano')
  })

  test('coluna A MENOS: nomeia qual falta', () => {
    const m = recusa('Repositório,Efetivo\ncontrole_acervo,Cap Fulano')
    expect(m).toContain('Número de commits')
  })

  test('coluna A MAIS no cabeçalho: nomeia a intrusa', () => {
    const m = recusa(
      'Repositório,Número de commits,Efetivo,Resumo\ncontrole_acervo,42,Cap Fulano,fez coisas'
    )
    expect(m).toContain('"Resumo"')
    // A mensagem diz por que o Resumo não entra, que é a dúvida real de quem
    // exportou a tabela da 5.1 em vez do CSV do painel.
    expect(m).toContain('preserva')
  })

  test('cabeçalho com a mesma coluna duas vezes', () => {
    const m = recusa('Repositório,Repositório,Efetivo\na,b,c')
    expect(m).toContain('repete')
  })

  test('separador ponto e vírgula (Excel em português)', () => {
    // Adivinhar o separador seria pior que recusar: o ponto e vírgula é o que
    // separa os militares DENTRO da coluna Efetivo.
    const m = recusa([
      'Repositório;Número de commits;Efetivo',
      'controle_acervo;42;Cap Fulano;Maj Beltrano'
    ].join('\n'))

    expect(m).toContain('ponto e vírgula')
    expect(m).toContain('CSV (separado por vírgulas)')
  })

  test('commits que não é número: nomeia a linha, o valor e o repositório', () => {
    const m = recusa(`${CSV_PAINEL}\nmodelagens,quarenta e dois,Cap Fulano`)

    expect(m).toContain('linha 5')
    expect(m).toContain('quarenta e dois')
    expect(m).toContain('modelagens')
  })

  test('commits vazio, decimal ou negativo também são recusa', () => {
    const com = valor =>
      recusa(`Repositório,Número de commits,Efetivo\nmodelagens,${valor},Cap Fulano`)

    expect(com('')).toContain('só entra número inteiro')
    expect(com('4.2')).toContain('só entra número inteiro')
    expect(com('-7')).toContain('só entra número inteiro')
  })

  test('repositório sem nome', () => {
    const m = recusa('Repositório,Número de commits,Efetivo\n,42,Cap Fulano')
    expect(m).toContain('sem o nome do repositório')
  })

  test('repositório repetido: nomeia AS DUAS linhas', () => {
    // Repetição quer dizer duas exportações coladas. "O último vence" gravaria
    // metade de um mês em silêncio.
    const m = recusa(`${CSV_PAINEL}\ncontrole_acervo,9,Ten Sicrano`)

    expect(m).toContain('controle_acervo')
    expect(m).toContain('linhas 2 e 5')
  })

  test('repetido também quando muda só a caixa', () => {
    expect(recusa(`${CSV_PAINEL}\nDSGTOOLS,9,Ten Sicrano`)).toContain('duas vezes')
  })

  test('linha mais CURTA que o cabeçalho', () => {
    const m = recusa(`${CSV_PAINEL}\nmodelagens,7`)
    expect(m).toContain('linha 5')
    expect(m).toContain('2 coluna(s)')
  })
})

describe('analisar: o que ele aceita limpando, e AVISA', () => {
  test('vírgula sobrando na última coluna volta para o Efetivo', () => {
    // O efetivo é texto livre e é a única coluna onde a vírgula a mais faz
    // sentido. Recusar o arquivo inteiro por causa de um nome com vírgula seria
    // desproporcional, e aceitar calado esconderia o remendo.
    const { repositorios, avisos } = csv.analisar(
      'Repositório,Número de commits,Efetivo\ncontrole_acervo,42,Cap Fulano, Maj Beltrano'
    )

    expect(repositorios[0].efetivo).toBe('Cap Fulano, Maj Beltrano')
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toContain('Linha 2')
    expect(avisos[0]).toContain('vírgula')
  })

  test('campo entre aspas do Excel não vira duas colunas', () => {
    const { repositorios, avisos } = csv.analisar(
      'Repositório,Número de commits,Efetivo\ncontrole_acervo,42,"Cap Fulano, Maj Beltrano"'
    )

    expect(repositorios[0].efetivo).toBe('Cap Fulano, Maj Beltrano')
    // Entre aspas não há remendo nenhum: a linha tem as três colunas.
    expect(avisos).toEqual([])
  })

  test('efetivo vazio entra, com aviso nomeando o repositório', () => {
    const { repositorios, avisos } = csv.analisar(
      'Repositório,Número de commits,Efetivo\ncontrole_acervo,42,'
    )

    expect(repositorios).toEqual([
      { repo: 'controle_acervo', commits: '42', efetivo: '' }
    ])
    expect(avisos[0]).toContain('controle_acervo')
    expect(avisos[0]).toContain('sem efetivo')
  })

  test('vírgula sobrando com o Efetivo FORA do fim é recusa', () => {
    // Sem o efetivo no fim, não há como saber a qual coluna a sobra pertence.
    const m = recusa([
      'Efetivo,Repositório,Número de commits',
      'Cap Fulano,controle_acervo,42,7'
    ].join('\n'))

    expect(m).toContain('Efetivo fora do fim')
  })
})

// ---------------------------------------------------------------------------
// planejar: o cruzamento com o que já está gravado
//
// É AQUI QUE MORA O REQUISITO. As três primeiras colunas se refazem pelo CSV; o
// Resumo é do que já estava lá.
// ---------------------------------------------------------------------------

const linhaGravada = (repo, commits, efetivo, resumo) => [repo, commits, efetivo, resumo]

describe('planejar: a primeira importação', () => {
  test('toda linha entra com Resumo VAZIO, e a tabela fica com 4 colunas', () => {
    const { linhas, novos, atualizados, removidos, resumosPreservados } =
      csv.planejar([], repos(CSV_PAINEL))

    expect(linhas).toEqual([
      ['controle_acervo', '42', 'Cap Fulano;Maj Beltrano', ''],
      ['DsgTools', '17', 'Ten Sicrano', ''],
      ['ferramentas_edicao', '3', 'Cap Fulano', '']
    ])
    expect(linhas.every(l => l.length === 4)).toBe(true)
    expect(novos).toEqual(['controle_acervo', 'DsgTools', 'ferramentas_edicao'])
    expect(atualizados).toEqual([])
    expect(removidos).toEqual([])
    expect(resumosPreservados).toBe(0)
  })

  test('a ordem é a do CSV, que o painel já traz por commits', () => {
    const { linhas } = csv.planejar([], repos(CSV_PAINEL))
    expect(linhas.map(l => l[0])).toEqual([
      'controle_acervo', 'DsgTools', 'ferramentas_edicao'
    ])
  })
})

describe('planejar: A REIMPORTAÇÃO NÃO APAGA O RESUMO', () => {
  // O caso que justifica a feature inteira. A pessoa importa no dia 1, escreve
  // os resumos durante o mês e reimporta no dia 30 com os commits atualizados.
  const JA_GRAVADO = [
    linhaGravada('controle_acervo', '10', 'Cap Fulano', 'Subiu o módulo Efetivo.'),
    linhaGravada('DsgTools', '4', 'Ten Sicrano', 'Correção do validador de geometria.'),
    linhaGravada('ferramentas_edicao', '1', 'Cap Fulano', '')
  ]

  test('o Resumo escrito sobrevive, e os commits e o efetivo se refazem', () => {
    const { linhas, resumosPreservados } = csv.planejar(JA_GRAVADO, repos(CSV_PAINEL))

    // O RESUMO, que é o requisito.
    expect(linhas[0][csv.COL.RESUMO]).toBe('Subiu o módulo Efetivo.')
    expect(linhas[1][csv.COL.RESUMO]).toBe('Correção do validador de geometria.')

    // VARIÂNCIA: a prova de que os commits mudaram DE VERDADE. Sem esta
    // asserção, um planejar que devolvesse as linhas antigas intactas passaria
    // no caso do Resumo e o teste não provaria nada.
    expect(JA_GRAVADO[0][csv.COL.COMMITS]).toBe('10')
    expect(linhas[0][csv.COL.COMMITS]).toBe('42')
    expect(linhas[1][csv.COL.COMMITS]).toBe('17')
    expect(linhas[0][csv.COL.EFETIVO]).toBe('Cap Fulano;Maj Beltrano')

    expect(resumosPreservados).toBe(2)
  })

  test('a linha que ainda não tem Resumo continua sem, e não ganha lixo', () => {
    const { linhas } = csv.planejar(JA_GRAVADO, repos(CSV_PAINEL))
    expect(linhas[2][csv.COL.RESUMO]).toBe('')
  })

  test('repositório NOVO entra com Resumo vazio, ao lado dos que já tinham', () => {
    const comNovo = `${CSV_PAINEL}\nmodelagens,8,Maj Beltrano`
    const { linhas, novos, atualizados } = csv.planejar(JA_GRAVADO, repos(comNovo))

    expect(novos).toEqual(['modelagens'])
    expect(atualizados).toHaveLength(3)
    expect(linhas[3]).toEqual(['modelagens', '8', 'Maj Beltrano', ''])
    // E o vizinho antigo não foi contaminado.
    expect(linhas[0][csv.COL.RESUMO]).toBe('Subiu o módulo Efetivo.')
  })

  test('o casamento ignora a CAIXA do nome', () => {
    // `dsgtools` e `DsgTools` são o mesmo repositório. Tratá-los como dois
    // perderia o Resumo por causa de uma letra maiúscula.
    const outraCaixa = 'Repositório,Número de commits,Efetivo\ndsgtools,17,Ten Sicrano'
    const { linhas, novos, atualizados } = csv.planejar(JA_GRAVADO, repos(outraCaixa))

    expect(novos).toEqual([])
    expect(atualizados).toEqual(['dsgtools'])
    expect(linhas[0][csv.COL.RESUMO]).toBe('Correção do validador de geometria.')
    // O nome gravado passa a ser o do CSV, que é o que o GitHub escreve.
    expect(linhas[0][csv.COL.REPO]).toBe('dsgtools')
  })

  test('importar DUAS vezes o mesmo CSV dá o mesmo resultado', () => {
    const primeira = csv.planejar(JA_GRAVADO, repos(CSV_PAINEL))
    const segunda = csv.planejar(primeira.linhas, repos(CSV_PAINEL))

    expect(segunda.linhas).toEqual(primeira.linhas)
    expect(segunda.removidos).toEqual([])
  })
})

describe('planejar: o repositório que sumiu do CSV', () => {
  const JA_GRAVADO = [
    linhaGravada('controle_acervo', '10', 'Cap Fulano', 'Subiu o módulo Efetivo.'),
    linhaGravada('aholo', '3', 'Ten Sicrano', 'Tour virtual do museu.'),
    linhaGravada('modelagens', '1', 'Maj Beltrano', '')
  ]

  test('SAI da tabela: a 5.1 reporta o que foi trabalhado no período', () => {
    const so = 'Repositório,Número de commits,Efetivo\ncontrole_acervo,42,Cap Fulano'
    const { linhas } = csv.planejar(JA_GRAVADO, repos(so))

    expect(linhas.map(l => l[0])).toEqual(['controle_acervo'])
    // VARIÂNCIA: a tabela ANTES tinha os três. Sem isto, um planejar que
    // devolvesse lista vazia satisfaria a comparação acima.
    expect(JA_GRAVADO.map(l => l[0])).toEqual(['controle_acervo', 'aholo', 'modelagens'])
  })

  test('sai NOMEADO, com o Resumo que se perde, para a confirmação poder citá-lo', () => {
    const so = 'Repositório,Número de commits,Efetivo\ncontrole_acervo,42,Cap Fulano'
    const { removidos } = csv.planejar(JA_GRAVADO, repos(so))

    expect(removidos).toEqual([
      { repo: 'aholo', resumo: 'Tour virtual do museu.' },
      { repo: 'modelagens', resumo: '' }
    ])
    // Quem tem Resumo escrito é o que faz o controlador pedir confirmação.
    expect(removidos.filter(r => r.resumo)).toHaveLength(1)
  })

  test('linha gravada SEM nome de repositório conta como removida', () => {
    // Ela não casa com nada. Some de fininho seria o comportamento errado, e um
    // Resumo escrito nela entra na confirmação como os outros.
    const atuais = [...JA_GRAVADO, linhaGravada('', '', '', 'resumo órfão')]
    const { removidos } = csv.planejar(atuais, repos(CSV_PAINEL))

    expect(removidos).toContainEqual({ repo: '', resumo: 'resumo órfão' })
  })

  test('linha gravada com menos de 4 células não quebra o cruzamento', () => {
    const { linhas } = csv.planejar([['controle_acervo', '10']], repos(CSV_PAINEL))
    expect(linhas[0]).toEqual(['controle_acervo', '42', 'Cap Fulano;Maj Beltrano', ''])
  })

  test('repetido NA TABELA: fica o Resumo que existe', () => {
    const atuais = [
      linhaGravada('controle_acervo', '1', 'Cap Fulano', ''),
      linhaGravada('controle_acervo', '2', 'Cap Fulano', 'o que vale')
    ]
    const { linhas, removidos } = csv.planejar(atuais, repos(CSV_PAINEL))

    expect(linhas[0][csv.COL.RESUMO]).toBe('o que vale')
    expect(removidos).toEqual([])
  })
})
