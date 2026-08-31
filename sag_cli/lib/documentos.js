'use strict'

// O mapa documento -> pagina do SAG.
//
// E a UNICA coisa copiada do SAG neste CLI, e por isso e a menor possivel: so o
// nome do arquivo PHP. Coluna, filtro e valor de dominio saem da pagina viva em
// tempo de execucao (lib/contrato.js), como o orcamento_cli faz com o Joi do
// server/. Contrato copiado apodrece; um nome de arquivo, nao.
//
// `medido` diz se o contrato de consulta ja foi exercido de verdade contra o
// SAG. O que esta em false NAO e suspeita de defeito: e ausencia de prova, e o
// CLI avisa antes de entregar o resultado. Quem medir, mude aqui.
const DOCUMENTOS = {
  nc: {
    pagina: 'docNcuq1',
    nome: 'Nota de Movimentacao de Credito',
    medido: '2026-08-07',
    // Colunas uteis para alimentar orcamento.nota_credito. A pagina oferece 39.
    //
    // DESTINO_VALOR_ITEM ENTRA E VALOR_NC NAO VIRA DINHEIRO, e a distincao foi
    // medida em 2026-08-07. A linha do SAG e um ITEM da NC; a linha do SCA e um
    // par (NC, ND). Na 2026NC420174, duas linhas trazem VALOR_NC 18.422,14 as
    // duas, e DESTINO_VALOR_ITEM 18.023,14 e 399,00, que somam exatamente o
    // total. Ou seja: VALOR_NC e o TOTAL DA NC repetido em cada item.
    //
    // Ler o valor de VALOR_NC funciona enquanto a NC tem uma ND so, e mente na
    // hora em que ela tem duas: a 2026NC000758 do vault traz 339015 com
    // R$ 7.125,00 e 339033 com R$ 2.178,00, e VALOR_NC diria 9.303,00 nas duas.
    // O SCA modela esse caso de proposito ("uma NC com mais de uma ND entra uma
    // vez por ND"), entao o erro entraria direto no lugar que o previu.
    padrao: [
      'NUMERO_NC', 'DATA_EMISSAO', 'DESTINO_ND', 'DESTINO_PTRES', 'DESTINO_FONTE',
      'DESTINO_PI', 'UG_EMITENTE', 'DESTINO_ACAO', 'DESTINO_PO', 'GRUPO',
      'DESTINO_VALOR_ITEM', 'VALOR_NC', 'OBS'
    ],
    // Como a linha do SAG vira campo do SCA. Serve ao comando `conferir` e ao
    // corpo que ele imprime para o orcamento_cli.
    paraSca: {
      NUMERO_NC: 'numero',
      DATA_EMISSAO: 'data_emissao',
      DESTINO_ND: 'cod_nd',
      DESTINO_PTRES: 'ptres',
      DESTINO_FONTE: 'fonte',
      DESTINO_PI: 'cod_pi',
      UG_EMITENTE: 'ug_emitente',
      DESTINO_VALOR_ITEM: 'valor_nc',
      OBS: 'finalidade_historico'
    },
    // A chave e a identidade da NC no SCA. As linhas do SAG que caem na mesma
    // chave sao itens do mesmo credito e se SOMAM (ver `somar`).
    chave: ['numero', 'cod_nd', 'ug_emitente'],
    somar: ['valor_nc']
  },
  ne: {
    pagina: 'docNeuq1',
    nome: 'Nota de Empenho',
    medido: '2026-08-07',
    // A pagina oferece 50 colunas. OBS_LI e a observacao da LIQUIDACAO, e vem
    // junto da NE: e por ela que se descobre o que aconteceu com o empenho sem
    // uma segunda consulta.
    padrao: [
      'NR', 'DATA_EMISSAO', 'VALOR_NE', 'FAV', 'ND', 'PI', 'PTRES', 'ACAO',
      'PO', 'PROCESSO', 'SI', 'OBS', 'OBS_LI'
    ],
    paraSca: {
      NR: 'numero',
      DATA_EMISSAO: 'data_empenho',
      VALOR_NE: 'valor_empenhado',
      OBS: 'finalidade'
    },
    chave: ['numero'],
    // VALOR_NE NAO SE SOMA, e a diferenca em relacao a NC e o que este campo
    // registra. A tela da NE tambem devolve uma linha por item (ITEM, ORDEM,
    // VALOR_OPERACAO), e VALOR_NE e o total do empenho repetido. Somar aqui
    // multiplicaria o empenho pelo numero de itens dele.
    //
    // NAO MEDIDO CONTRA UMA NE DE VARIOS ITENS. Enquanto isso nao acontecer, o
    // `conferir ne` deduplica pela chave e mantem a primeira linha, que e o
    // comportamento seguro: erra para menos, e nunca infla o empenhado.
    somar: null
  },
  ns: {
    pagina: 'docNsuq1',
    nome: 'Nota de Lancamento de Sistema (liquidacao)',
    medido: '2026-08-31',
    // A PAGINA OFERECE 42 COLUNAS, E A LINHA E UM EVENTO, nao um documento. Uma
    // NS aparece uma vez por evento contabil, e a mesma NS pode tocar mais de um
    // empenho: a 2026NS000320 de 07 MAI 26 estornou 1.668,84 da 2025NE000266 e
    // repartiu o valor entre ela (406,97) e a 2025NE000239 (1.261,87). Somar as
    // linhas sem separar por INSCRICAO01 e por EVENTO multiplica.
    //
    // O EMPENHO LIQUIDADO ESTA EM INSCRICAO01, no numero do SIAFI
    // ('2025NE000266'), e VALOR_TRANSACAO e o valor DAQUELE evento.
    //
    // A LIQUIDACAO SE LE POR 401005 MENOS 406005, e nao pela uniao de 511005,
    // 551001 e 551004. Medido em 2026-08-31 sobre os 15 RPNP de 2026: as 37
    // linhas de 401005 sao exatamente as 37 dessas tres, porque 401005 e a
    // contrapartida orcamentaria de todas elas, e o par de ESTORNO
    // (4xx005 -> 406005, 55x001 -> 556001) so aparece do lado do 4. Ler so as
    // tres deixa passar o estorno em silencio, que foi como R$ 1.668,84
    // ficaram contados duas vezes no SAP por quase quatro meses. A regra do
    // estorno no SIAFI e o terceiro digito virando 6.
    padrao: [
      'UG', 'NR', 'DATA_EMISSAO', 'EVENTO', 'INSCRICAO01', 'INSCRICAO02',
      'VALOR_TRANSACAO', 'TITULO_CREDITO', 'FAV', 'OBS'
    ],
    // SEM `paraSca` E SEM `chave`, DE PROPOSITO. A liquidacao do SCA aponta uma
    // `nota_empenho_id`, e o que o SAG entrega e o numero do SIAFI. As NEs de
    // 2025 no SCA guardam o codigo interno do RPCA Tecnico ('RPCA-404530') em
    // `numero`, entao nao ha casamento por numero: quem sabe os dois lados e
    // `orcamento.rpnp.empenho_label`. Enquanto isso for verdade, `sag conferir`
    // nao aceita `ns`, e a conferencia se faz a mao.
    paraSca: null,
    chave: null
  },
  ob: {
    pagina: 'docObuq',
    nome: 'Ordem Bancaria',
    medido: null,
    padrao: null,
    paraSca: null,
    chave: null
  },
  ro: {
    pagina: 'docRouq',
    nome: 'Registro Orcamentario',
    medido: null,
    padrao: null,
    paraSca: null,
    chave: null
  },
  nl: {
    pagina: 'docNluq',
    nome: 'Nota de Lancamento',
    medido: null,
    padrao: null,
    paraSca: null,
    chave: null
  },
  ra: {
    pagina: 'docRauq',
    nome: 'Registro de Arrecadacao',
    medido: null,
    padrao: null,
    paraSca: null,
    chave: null
  },
  dr: {
    pagina: 'docDruq',
    nome: 'DAR',
    medido: null,
    padrao: null,
    paraSca: null,
    chave: null
  },
  df: {
    pagina: 'docDfuq',
    nome: 'DARF',
    medido: null,
    padrao: null,
    paraSca: null,
    chave: null
  }
}

function documento (chave) {
  const doc = DOCUMENTOS[String(chave || '').toLowerCase()]
  if (!doc) {
    throw new Error(
      `Documento desconhecido: "${chave}". Conhecidos: ${Object.keys(DOCUMENTOS).join(', ')}.`
    )
  }
  return doc
}

function listarChaves () {
  return Object.keys(DOCUMENTOS)
}

module.exports = { DOCUMENTOS, documento, listarChaves }
