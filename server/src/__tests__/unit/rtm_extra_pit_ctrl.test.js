'use strict'

// A aba EXTRA_PIT do RTM: a CAMADA DE DADOS.
//
// O modo de falhar deste código não é dar erro. É entregar uma planilha que
// abre, soma, e está errada: a aba com 15 linhas onde o RTM tem 44 (porque
// alguém a construiu de UMA tabela só), a quantidade como TEXTO (a coluna zera
// no RTM e ninguém vê), a data lida com fuso, a demanda CANCELADA na lista do
// que foi atendido, e a coluna 'Descrição do Produto/Serviço' preenchida com a
// observação. Os casos abaixo existem por isso.
//
// O QUE ESTE ARQUIVO NÃO PROVA, e está provado noutro lugar: que as duas
// consultas EXECUTAM e recortam certo. Isso pede banco, e este pacote é o
// `rapido`. Foi provado contra PostgreSQL de verdade, com DDL de verdade e doze
// linhas semeadas -- cinco passam, sete são recusadas --, e o log está no
// scratchpad da sessão (`prova-cruzamento.js`).
//
// Os valores esperados foram medidos no RTM de agosto de 2026
// (`1_CGEO_RTM_AGO_26_preenchido.ods`, aba EXTRA_PIT, 44 linhas de dado), e os
// códigos dos domínios são lidos do DDL, e não redigitados aqui.

const fs = require('fs')
const path = require('path')

const {
  paraAbaExtraPit,
  CHAVES_ABA_EXTRA_PIT,
  ORIGEM_LINHA,
  SITUACOES_NA_ABA,
  TIPOS_CLIENTE_NA_ABA,
  SITUACOES_PEDIDO_ENTREGUE,
  DEMANDANTE_LAI,
  ROTULO_LAI
} = require('../../rpcmtec/rtm_extra_pit_ctrl')

const RAIZ = path.resolve(__dirname, '..', '..', '..', '..')
const FONTE = path.resolve(__dirname, '..', '..', 'rpcmtec', 'rtm_extra_pit_ctrl.js')

// Uma linha de cada ORIGEM, como a consulta as entrega: os dois lados já chegam
// com os mesmos nomes de campo, resolvidos cada um na sua metade do UNION.
//
// Os valores são os das linhas L8 e L2 do RTM de agosto, copiados.
const DA_DEMANDA = {
  origem: ORIGEM_LINHA.DEMANDA_EXTRA,
  omds: '1º CGEO',
  demandante: 'CCOp',
  produto: 'Capacitação em EBGeo',
  nota: 'Efetivo de 16 militares',
  quantidade: 1,
  quantidade_materializada: 0,
  documento_autorizacao: 'DIEx nº 209-GPPG/DSG de 02 de fevereiro de 2026',
  data_conclusao: '2026-02-03',
  situacao: 'Concluído',
  referencia: 'demanda_extra:8'
}

const DO_PEDIDO_LAI = {
  origem: ORIGEM_LINHA.PEDIDO_CIVIL,
  omds: '1º CGEO',
  demandante: 'DSG',
  produto: 'Lei de Acesso a Informação 60143.000014/2026-78',
  nota: 'Fotos aéreas no município de Canoas – RS',
  quantidade: 1,
  quantidade_materializada: null,
  documento_autorizacao: null,
  data_conclusao: '2026-01-08',
  situacao: 'Concluído',
  referencia: 'pedido:12'
}

// O fonte sem comentário. Prosa que descreve a régua não é a régua: pela mesma
// razão de `routes/modulo_em_toda_rota.test.js` e de
// `mapoteca_colunas_podadas.test.js`, a varredura lê o código.
const semComentario = texto =>
  texto
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1').replace(/--.*$/, ''))
    .join('\n')

const fonte = () => semComentario(fs.readFileSync(FONTE, 'utf8'))

// A família inteira de um domínio, contada no DDL. Listar parte de uma família é
// o que faz uma régua aprovar o caso que ela existe para pegar.
const familiaDoDominio = (arquivo, tabela) => {
  const ddl = fs.readFileSync(path.join(RAIZ, 'er', arquivo), 'utf8')
  const bloco = ddl.match(new RegExp(`INSERT INTO ${tabela}[\\s\\S]*?;`))[0]
  return [...bloco.matchAll(/\((\d+),\s*'([^']+)'\)/g)]
    .map(([, code, nome]) => ({ code: Number(code), nome }))
}

describe('EXTRA_PIT: o contrato de saída', () => {
  test('devolve exatamente as sete chaves da aba, na ordem das colunas A a G', () => {
    // Sobrando ou faltando uma chave, a linha de dado sai deslocada em relação
    // ao cabeçalho, e a planilha continua abrindo.
    expect(CHAVES_ABA_EXTRA_PIT).toEqual([
      'omds',
      'demandante',
      'descricao',
      'quantidade',
      'data_conclusao',
      'documento_autorizacao',
      'observacao'
    ])

    const [linha] = paraAbaExtraPit([DA_DEMANDA])
    expect(Object.keys(linha)).toEqual(CHAVES_ABA_EXTRA_PIT)
  })

  test('a coluna interna `origem` NÃO vaza para a planilha', () => {
    // Ela existe para investigar linha errada, e não para a DSG ler. Uma oitava
    // chave na saída deslocaria a aba inteira.
    const [linha] = paraAbaExtraPit([DA_DEMANDA])
    expect(linha.origem).toBeUndefined()
    expect(linha.referencia).toBeUndefined()
    expect(linha.situacao).toBeUndefined()
  })

  test('a coluna C leva o PRODUTO e a G leva a nota, e não o contrário', () => {
    // A troca é silenciosa: as duas são texto livre, e as duas cabem na célula.
    // O que decide é a medida -- do lado da demanda, `tipo_produto` é NOT NULL e
    // a coluna C está preenchida em 44/44; `descricao` é anulável e a G, em
    // 41/44 -- mais o texto real: 'Capacitação em EBGeo' é O QUE se produziu, e
    // 'Efetivo de 16 militares' é a nota ao lado.
    const [linha] = paraAbaExtraPit([DA_DEMANDA])
    expect(linha.descricao).toBe('Capacitação em EBGeo')
    expect(linha.observacao).toBe('Efetivo de 16 militares')
  })

  test('a OMDS vem do parâmetro da consulta, e continua saindo', () => {
    const [linha] = paraAbaExtraPit([DA_DEMANDA])
    expect(linha.omds).toBe('1º CGEO')
    expect(linha.demandante).toBe('CCOp')
  })
})

describe('EXTRA_PIT: o CRUZAMENTO das duas fontes', () => {
  // Medido na produção em 2026-09-11: `pit.demanda_extra` de 2026 tem 15
  // registros e ZERO LAI; a aba do RTM de agosto tem 44 linhas, 29 delas LAI.
  // Uma aba construída de uma tabela só sai com um terço do relatório e parece
  // completa, que é pior do que aba nenhuma.

  test('as duas origens entram, e a contagem total é a soma', () => {
    const linhas = paraAbaExtraPit([DA_DEMANDA, DO_PEDIDO_LAI])
    expect(linhas).toHaveLength(2)
  })

  test('a linha da demanda autorizada atravessa inteira', () => {
    const [, daDemanda] = paraAbaExtraPit([DO_PEDIDO_LAI, DA_DEMANDA])
    expect(daDemanda).toEqual({
      omds: '1º CGEO',
      demandante: 'CCOp',
      descricao: 'Capacitação em EBGeo',
      quantidade: 1,
      data_conclusao: '2026-02-03',
      documento_autorizacao: 'DIEx nº 209-GPPG/DSG de 02 de fevereiro de 2026',
      observacao: 'Efetivo de 16 militares'
    })
  })

  test('a linha de LAI atravessa inteira, na forma da planilha', () => {
    // É a L2 do RTM de agosto, verbatim: o rótulo por extenso mais o NUP, o
    // demandante DSG, e a coluna F VAZIA.
    const [daLai] = paraAbaExtraPit([DO_PEDIDO_LAI, DA_DEMANDA])
    expect(daLai).toEqual({
      omds: '1º CGEO',
      demandante: 'DSG',
      descricao: 'Lei de Acesso a Informação 60143.000014/2026-78',
      quantidade: 1,
      data_conclusao: '2026-01-08',
      documento_autorizacao: null,
      observacao: 'Fotos aéreas no município de Canoas – RS'
    })
  })

  test('as duas se INTERCALAM por data, e não saem em blocos por fonte', () => {
    // A aba é cronológica. Concatenar as duas consultas e não reordenar poria o
    // Extra-PIT inteiro antes da LAI inteira, e o leitor do RTM leria duas
    // listas coladas em vez de uma linha do tempo.
    const linhas = paraAbaExtraPit([
      { ...DA_DEMANDA, data_conclusao: '2026-02-03' },
      { ...DA_DEMANDA, data_conclusao: '2026-07-30', demandante: 'extra julho' },
      { ...DO_PEDIDO_LAI, data_conclusao: '2026-01-08' },
      { ...DO_PEDIDO_LAI, data_conclusao: '2026-03-28', demandante: 'lai marco' }
    ])
    expect(linhas.map(l => l.data_conclusao)).toEqual([
      '2026-01-08', '2026-02-03', '2026-03-28', '2026-07-30'
    ])
  })

  test('a consulta lê as DUAS tabelas, unidas', () => {
    // No CÓDIGO, e não no comentário. Se um dia alguém "simplificar" o UNION, a
    // aba volta a ter um terço do relatório sem nada dar erro.
    const codigo = fonte()
    expect(codigo).toMatch(/FROM pit\.demanda_extra/)
    expect(codigo).toMatch(/FROM mapoteca\.pedido/)
    expect(codigo).toMatch(/UNION ALL/)
  })

  test('cada lado cobra a sua data de conclusão', () => {
    // Sem isso, a versão anual traria a linha sem data com a célula em branco e
    // a versão até o mês a deixaria cair sozinha, porque `<` sobre NULL não é
    // verdadeiro: a mesma linha apareceria num relatório e sumiria do outro.
    const codigo = fonte()
    expect(codigo).toMatch(/d\.data_entrega IS NOT NULL/)
    expect(codigo).toMatch(/p\.data_atendimento IS NOT NULL/)
  })
})

describe('EXTRA_PIT: a quantidade é NÚMERO', () => {
  test('sai como number, e não como texto', () => {
    // Número é o que a planilha de destino soma. Texto passaria despercebido e
    // zeraria a coluna no RTM.
    const [linha] = paraAbaExtraPit([{ ...DO_PEDIDO_LAI, quantidade: 151 }])
    expect(linha.quantidade).toBe(151)
    expect(typeof linha.quantidade).toBe('number')
  })

  test('a cadeia numérica do driver vira número, e não fica cadeia', () => {
    // O PIOR CASO é este: '12' chega da camada de baixo, a célula sai com tipo
    // string e a coluna 'Qnt' do RTM deixa de somar sem nada acusar.
    const [linha] = paraAbaExtraPit([{ ...DA_DEMANDA, quantidade: '12' }])
    expect(linha.quantidade).toBe(12)
    expect(typeof linha.quantidade).toBe('number')
  })

  test('o que não é número sai VAZIO, e nunca NaN nem texto', () => {
    // Célula vazia é visível na planilha; 'doze' sob o rótulo 'Qnt' não é, e NaN
    // contamina a soma da coluna inteira. O pedido civil sem imagem e sem item
    // impresso chega aqui NULO de propósito: um zero afirmaria que nada saiu.
    for (const ruim of ['doze', null, undefined, '']) {
      const [linha] = paraAbaExtraPit([{ ...DO_PEDIDO_LAI, quantidade: ruim }])
      expect(linha.quantidade).toBeNull()
    }
  })
})

describe('EXTRA_PIT: a data de conclusão', () => {
  test('sai em AAAA-MM-DD nos dois lados', () => {
    const [lai, demanda] = paraAbaExtraPit([DO_PEDIDO_LAI, DA_DEMANDA])
    expect(lai.data_conclusao).toBe('2026-01-08')
    expect(demanda.data_conclusao).toBe('2026-02-03')
  })

  test('fica VAZIA quando não houve entrega', () => {
    // As duas consultas já recusam a linha sem data, mas o tradutor é público e
    // não pode inventar hoje no lugar do que não aconteceu.
    for (const vazio of [null, undefined, '']) {
      const [linha] = paraAbaExtraPit([{ ...DA_DEMANDA, data_conclusao: vazio }])
      expect(linha.data_conclusao).toBeNull()
    }
  })

  test('não anda de dia quando vem como Date, nas duas bordas do dia', () => {
    // A coluna é DATE, mas quem chama pode passar um Date. Ler os componentes
    // LOCAIS (e não o ISO em UTC) é o que impede o dia de andar. Mesma regra de
    // `rtm_ods.celulaData`.
    //
    // AS DUAS BORDAS, porque uma só não exercita o eixo: a meia-noite local em
    // UTC-3 já cai no mesmo dia em UTC, e `toISOString` passaria no caso.
    // 23h30 denuncia o fuso NEGATIVO (D+1) e 00h30 denuncia o POSITIVO (D-1);
    // só em UTC exato nenhuma das duas separa, e aí não há o que separar.
    const dois = n => String(n).padStart(2, '0')
    const local = d =>
      `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`

    for (const data of [
      new Date(2026, 1, 3, 0, 30),
      new Date(2026, 1, 3, 23, 30)
    ]) {
      const [linha] = paraAbaExtraPit([{ ...DA_DEMANDA, data_conclusao: data }])
      expect(linha.data_conclusao).toBe(local(data))
      expect(linha.data_conclusao).toBe('2026-02-03')
    }
  })

  test('a linha sem data vai para o fim', () => {
    const linhas = paraAbaExtraPit([
      { ...DA_DEMANDA, data_conclusao: null, demandante: 'sem data' },
      { ...DA_DEMANDA, data_conclusao: '2026-07-30', demandante: 'julho' },
      { ...DO_PEDIDO_LAI, data_conclusao: '2026-01-08', demandante: 'janeiro' }
    ])
    expect(linhas.map(l => l.demandante)).toEqual(['janeiro', 'julho', 'sem data'])
  })
})

describe('EXTRA_PIT: o documento de autorização', () => {
  test('sai VERBATIM, com nº, acento e quebra de linha', () => {
    // É a coluna que distingue a exceção AUTORIZADA de trabalho fora do plano, e
    // o valor real do RTM de agosto traz DOIS DIEx numa célula só, separados por
    // quebra de linha. Normalizar qualquer pedaço dele apaga a prova.
    const documento =
      'DIEx nº 209-GPPG/DSG de 02 de fevereiro de 2026\n' +
      'DIEx nº 183-E3/DSG de 29 de janeiro de 2026'

    const [linha] = paraAbaExtraPit([
      { ...DA_DEMANDA, documento_autorizacao: documento }
    ])
    expect(linha.documento_autorizacao).toBe(documento)
  })

  test('o travessão do outro valor real atravessa intacto', () => {
    const documento = 'DIEx nº 790-E3/DS – 17 de abril de 2026'
    const [linha] = paraAbaExtraPit([
      { ...DA_DEMANDA, documento_autorizacao: documento }
    ])
    expect(linha.documento_autorizacao).toBe(documento)
  })

  test('o pedido civil não inventa autorização a partir do ofício', () => {
    // A solicitação e a autorização são documentos DIFERENTES, e a coluna F
    // existe para provar a segunda. No RTM de agosto ela está preenchida em 2 de
    // 44 linhas, nenhuma delas de LAI.
    const [linha] = paraAbaExtraPit([DO_PEDIDO_LAI])
    expect(linha.documento_autorizacao).toBeNull()
    expect(fonte()).toMatch(/NULL::text AS documento_autorizacao/)
  })

  test('cadeia em branco vira célula VAZIA, e não o literal "-"', () => {
    // A aba EXTRA_PIT não usa '-' em coluna nenhuma (medido no RTM de agosto),
    // ao contrário da META4_DETALHADA.
    const [linha] = paraAbaExtraPit([
      { ...DA_DEMANDA, documento_autorizacao: '   ' }
    ])
    expect(linha.documento_autorizacao).toBeNull()
  })
})

describe('EXTRA_PIT: a régua da DEMANDA AUTORIZADA', () => {
  const familia = familiaDoDominio('dominio.sql', 'dominio\\.situacao_extra_pit')
  const codigoDe = nome => familia.find(s => s.nome === nome).code

  test('o domínio tem os cinco códigos que a régua conhece', () => {
    // Se um sexto nascer, este caso reprova e alguém tem de DECIDIR se ele entra
    // na aba, em vez de ficar de fora por omissão.
    expect(familia).toEqual([
      { code: 1, nome: 'Previsto' },
      { code: 2, nome: 'Em produção' },
      { code: 3, nome: 'Enviado' },
      { code: 4, nome: 'Concluído' },
      { code: 5, nome: 'Cancelado' }
    ])
  })

  test('entram as duas situações que AFIRMAM entrega, e só elas', () => {
    expect([...SITUACOES_NA_ABA].sort()).toEqual(
      [codigoDe('Enviado'), codigoDe('Concluído')].sort()
    )
  })

  test('Previsto, Em produção e Cancelado ficam de fora', () => {
    // O PIOR CASO que a régua existe para pegar: a demanda CANCELADA na lista do
    // que foi atendido. As outras duas ainda não aconteceram -- na produção de
    // 2026 são 3 Previsto de 15.
    for (const nome of ['Previsto', 'Em produção', 'Cancelado']) {
      expect(SITUACOES_NA_ABA).not.toContain(codigoDe(nome))
    }
  })

  test('os códigos vêm do domínio compartilhado, e não redigitados no fonte', () => {
    // Uma segunda cópia dos números divergiria da primeira que fosse corrigida.
    const codigo = fonte()
    expect(codigo).toMatch(/SITUACAO_EXTRA_PIT\.ENVIADO/)
    expect(codigo).toMatch(/SITUACAO_EXTRA_PIT\.CONCLUIDO/)
    expect(codigo).toMatch(/d\.situacao_id IN \(\$<situacoesExtra:csv>\)/)
  })
})

describe('EXTRA_PIT: a régua do PEDIDO CIVIL', () => {
  const tipos = familiaDoDominio('mapoteca.sql', 'mapoteca\\.tipo_cliente')
  const situacoes = familiaDoDominio('mapoteca.sql', 'mapoteca\\.situacao_pedido')
  const codigoDe = (familia, nome) => familia.find(s => s.nome === nome).code

  test('o domínio de cliente tem os nove códigos que a régua conhece', () => {
    expect(tipos).toEqual([
      { code: 1, nome: 'OM EB' },
      { code: 2, nome: 'OM Aeronáutica' },
      { code: 3, nome: 'OM Marinha' },
      { code: 4, nome: 'Órgão Publico Federal' },
      { code: 5, nome: 'Órgão Publico Estadual' },
      { code: 6, nome: 'Órgão Publico Municipal' },
      { code: 7, nome: 'Pessoa Jurídica' },
      { code: 8, nome: 'Pessoa Física' },
      { code: 9, nome: 'Lei de Acesso à Informação (LAI)' }
    ])
  })

  test('entram a LAI e os TRÊS órgãos públicos', () => {
    // 29 das 44 linhas do RTM de agosto são LAI. Sem este corte a aba sai com 15.
    expect([...TIPOS_CLIENTE_NA_ABA].sort((a, b) => a - b)).toEqual([
      codigoDe(tipos, 'Órgão Publico Federal'),
      codigoDe(tipos, 'Órgão Publico Estadual'),
      codigoDe(tipos, 'Órgão Publico Municipal'),
      codigoDe(tipos, 'Lei de Acesso à Informação (LAI)')
    ].sort((a, b) => a - b))
  })

  test('as três OM militares ficam de fora, porque são a Meta 4', () => {
    // O PIOR CASO desta régua: o pedido de OM entrando aqui e na
    // META4_DETALHADA, e a mesma entrega somada duas vezes no mesmo relatório.
    // Na produção de 2026 são 164 pedidos de OM EB contra 38 civis.
    for (const nome of ['OM EB', 'OM Aeronáutica', 'OM Marinha']) {
      expect(TIPOS_CLIENTE_NA_ABA).not.toContain(codigoDe(tipos, nome))
    }
  })

  test('Pessoa Jurídica e Pessoa Física ficam de fora, e é DECISÃO', () => {
    // ZERO pedidos dos dois tipos na produção de 2026, então dado nenhum
    // confirma nem desmente. Está no relatório como pergunta para o chefe, e
    // este caso é o que denuncia se alguém mudar isso sem passar por lá.
    for (const nome of ['Pessoa Jurídica', 'Pessoa Física']) {
      expect(TIPOS_CLIENTE_NA_ABA).not.toContain(codigoDe(tipos, nome))
    }
  })

  test('entram só as situações de pedido que AFIRMAM entrega', () => {
    expect([...SITUACOES_PEDIDO_ENTREGUE].sort()).toEqual(
      [codigoDe(situacoes, 'Remetido'), codigoDe(situacoes, 'Concluído')].sort()
    )
    for (const nome of ['Pedido Recebido', 'Em andamento', 'Cancelado',
      'Aguardando produção', 'Aguardando envio']) {
      expect(SITUACOES_PEDIDO_ENTREGUE).not.toContain(codigoDe(situacoes, nome))
    }
  })

  test('o corte é por TIPO DE CLIENTE, e está no código', () => {
    const codigo = fonte()
    expect(codigo).toMatch(/c\.tipo_cliente_id IN \(\$<tiposCliente:csv>\)/)
    expect(codigo).toMatch(/TIPO_CLIENTE\.LAI/)
  })
})

describe('EXTRA_PIT: a LAI e o demandante DSG', () => {
  test('o rótulo é o da planilha: por extenso, e não a sigla', () => {
    // Medido nas 29 linhas de LAI do RTM de agosto.
    expect(ROTULO_LAI).toBe('Lei de Acesso a Informação')
    expect(ROTULO_LAI).not.toMatch(/\bLAI\b/)
  })

  test('o demandante da LAI é uma CONSTANTE declarada, e não uma coluna', () => {
    // 'DSG' não está em coluna nenhuma: `mapoteca.cliente` guarda 'Cidadão
    // (LAI)' por LGPD (er/mapoteca.sql:141-146) e `pedido.demandante` é
    // anulável. A constante fica exportada e nomeada em vez de escondida na
    // query -- é o que este repositório acabou de podar de `pedido.omds`.
    expect(DEMANDANTE_LAI).toBe('DSG')
    expect(fonte()).toMatch(/demandanteLai: DEMANDANTE_LAI/)
  })

  test('o pedido que DECLARA demandante tem preferência sobre a constante', () => {
    const codigo = fonte()
    expect(codigo).toMatch(/NULLIF\(btrim\(p\.demandante\), ''\)/)
  })
})

describe('EXTRA_PIT: os casos de borda do tradutor', () => {
  test('lista vazia devolve lista vazia', () => {
    expect(paraAbaExtraPit([])).toEqual([])
    expect(paraAbaExtraPit(null)).toEqual([])
  })

  test('não muda a lista que recebeu', () => {
    // O tradutor ordena, e ordenar no lugar mexeria no array de quem chamou.
    const entrada = [
      { ...DA_DEMANDA, data_conclusao: '2026-07-30' },
      { ...DO_PEDIDO_LAI, data_conclusao: '2026-01-08' }
    ]
    paraAbaExtraPit(entrada)
    expect(entrada[0].data_conclusao).toBe('2026-07-30')
  })

  test('a observação ausente sai vazia, e o resto da linha continua', () => {
    const [linha] = paraAbaExtraPit([{ ...DA_DEMANDA, nota: null }])
    expect(linha.observacao).toBeNull()
    expect(linha.descricao).toBe('Capacitação em EBGeo')
    expect(linha.quantidade).toBe(1)
  })
})
