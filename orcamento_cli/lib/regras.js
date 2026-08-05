'use strict'

// O que o joi.describe() NAO consegue contar.
//
// A forma de cada recurso (campos, tipos, obrigatorios, condicionais) e lida ao
// vivo do schema Joi e nunca e copiada. Mas a regra de negocio mora nos
// COMENTARIOS dos *_schema.js e dos *_ctrl.js, invisiveis para o describe(), e
// e justamente ela que evita o erro caro: nao saber que valor_nc nao muda por
// devolucao custa um lancamento errado, nao um 400.
//
// Este arquivo e a UNICA prosa curada do CLI. Regra aqui vale por ser curta e
// por explicar o PORQUE; qualquer coisa que o Joi ja diga (tipo, tamanho,
// obrigatoriedade) NAO entra aqui, para nao criar uma segunda fonte de verdade.
//
// Ao mudar uma regra de negocio no server/, atualize a linha correspondente.

const GERAL = [
  'O orcamento e um MODULO do SCA (code 3), nao um sistema.',
  'As rotas ficam sob /api/orcamento/; /api/login e /api/metas sao de plataforma e',
  'nao levam prefixo.',
  'Acesso por perfil no modulo orcamento: consulta le, operador cria e atualiza, gerente',
  'deleta. O administrador passa em tudo. So /api (health) e /api/login sao publicos.',
  'Nao existe entidade exercicio, PCA nem cabecalho de PDR: tudo e amarrado ao ANO',
  '(coluna ano, sem FK). O PCA do ano e o conjunto dos DFDs do ano; o PDR do ano e o',
  'conjunto dos pdr_item do ano.'
]

const REGRAS = {
  nc: [
    'valor_nc e o valor RECEBIDO e nunca muda por devolucao: quem cai com a devolucao e',
    'o empenho (nota_empenho.valor_anulado), nao a NC.',
    'valor_recolhido e a parte do credito devolvida, informada na propria NC. E',
    'informativo (>= 0) e NAO altera valor_nc.',
    'classificacao_id responde "esta previsto no PDR autorizado?", nao e a celula',
    'orcamentaria: 1 = PDR (vai para a tabela 3.2), 2 = Extra-PDR (tabela 3.7).',
    'pdr_item_id so existe quando classificacao_id = 1; com Extra-PDR o campo e',
    'descartado. Ele casa o item previsto (rotulo 1D, 1E, ...).',
    'Unica por (ano, numero, cod_nd, ug_emitente): a numeracao do SIAFI e por UG',
    'emitente, entao o mesmo numero e ND podem existir para emitentes distintos.',
    'Colisao volta 409.',
    'Aceita 1 anexo PDF; reenviar substitui o anterior.'
  ],

  ne: [
    'A NE empenha contra uma ou mais NCs e HERDA delas a ND, o PI e o GND. Por isso ela',
    'nao tem esses campos nem vinculo com licitacao.',
    'Duas formas de informar as NCs, e exatamente uma delas:',
    '  legada:  nota_credito_id + valor_empenhado (uma NC so);',
    '  rateio:  notas_credito: [{nota_credito_id, valor}] (uma ou varias), e ai o',
    '           valor_empenhado passa a ser a SOMA, calculada no servidor.',
    'Todas as NCs de uma mesma NE precisam ter a mesma ND e a mesma classificacao',
    '(validado no controller).',
    'valor_anulado (default 0) nunca excede o empenhado total.',
    'Saldo a liquidar = valor_empenhado - valor_anulado - SUM(liquidado).'
  ],

  liquidacao: [
    'Liquida contra uma NE. A soma das liquidacoes nao pode passar do empenhado',
    'liquido (valor_empenhado - valor_anulado).'
  ],

  recebimento: [
    'Recebimento de material de uma NE. Alimenta a tabela 3.6 do RPCMTec.'
  ],

  pdr: [
    'Nao existe tabela nem cabecalho de PDR: o PDR do ano E o conjunto dos pdr_item',
    'daquele ano. Cada item tem um rotulo (item_label: 1D, 1E, ...).',
    'valor_solicitado e o pedido; valor_autorizado e o que voltou aprovado, e e ele',
    'que vira a coluna Previsto da tabela 3.1.',
    'O anexo do PDR e por ANO (vinculo pdr_ano), nao por item, e aceita varios',
    'arquivos (PDF e planilha).'
  ],

  meta: [
    'Meta do PIT do ano. A NC aponta a meta que ela financia (meta_pit_id), e e assim',
    'que o credito se liga a producao.'
  ],

  dfd: [
    'O conjunto dos DFDs de um ano E o PCA daquele ano; nao existe entidade PCA.',
    'Aceita 1 anexo PDF; reenviar substitui o anterior.'
  ],

  licitacao: [
    'Nao tem vinculo com DFD.',
    'Tres tipos, em dominio.tipo_licitacao (GCALC DSG, Propria, Participante); consulte',
    'os codigos com: orcamento dominio tipo_licitacao.',
    'Alimenta a tabela 3.4 (GCALC DSG) e a 3.5 (proprias) do RPCMTec.'
  ],

  rpnp: [
    'Exige nota_empenho_id OU empenho_label (pelo menos um): o RPNP costuma',
    'referenciar empenho de exercicio anterior, que nao esta cadastrado como NE aqui.',
    'valor_a_liquidar aceita 0: um RPNP totalmente liquidado continua sendo exibido na',
    'tabela 3.3.'
  ],

  dashboard: [
    'A execucao por ND e sempre CUMULATIVA: --mes N traz o acumulado de 01-jan',
    'ate o fim do mes N. A pergunta do painel e "quanto do credito do ANO ja foi',
    'executado", e nao "quanto se moveu neste mes".',
    'Registro sem data entra no acumulado do ano: credito ainda sem data de',
    'emissao e credito do ano, e some-lo fora faria o painel mostrar menos do que',
    'o banco tem.',
    'Cada linha traz o total E o split PDR/Extra (recebido, recebido_pdr,',
    'recebido_extra). O `orcamento saldo` trabalha numa faixa por vez.',
    'O RPCMTec NAO sai daqui: ele e gerado inteiro, fora dos modulos, por',
    '`acervo rpcmtec --ano N --mes M --docx`.'
  ],

  arquivo: [
    'Vinculo polimorfico a EXATAMENTE um dono: nota_credito_id, dfd_id ou pdr_ano.',
    'Os bytes ficam no proprio banco (coluna conteudo BYTEA), nao no filesystem. A',
    'listagem nunca traz o conteudo: os bytes so saem no download.',
    'NC e DFD aceitam 1 PDF (reenviar substitui); o PDR aceita varios (pdf, xlsx, xls,',
    'csv, ods).'
  ],

  configuracao: [
    'Singleton: linha unica id = 1, com CHECK (id = 1). So aceita PUT; nunca POST nem',
    'DELETE. A linha ja nasce com o banco.',
    'Guarda uasg, codom e ano_referencia (o ano padrao do seletor das telas).'
  ],

  dominio: [
    'GET exige perfil de consulta no modulo orcamento; nao e publico. POST, PUT e',
    'DELETE exigem administrador.',
    'So natureza_despesa, plano_interno e ug tem CRUD; os demais sao so leitura.'
  ]
}

module.exports = { REGRAS, GERAL }
