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
  '/api/metas nao segue essa regua, porque nao e do orcamento: LER pede verifyAcesso',
  '(perfil em ALGUM modulo, e ter conta nao basta) e ESCREVER pede administrador.',
  'Nao existe entidade exercicio, PCA nem cabecalho de PDR: tudo e amarrado ao ANO',
  '(coluna ano, sem FK). O PCA do ano e o conjunto dos DFDs do ano; o PDR do ano e o',
  'conjunto dos pdr_item do ano.'
]

const REGRAS = {
  nc: [
    'valor_nc e o valor RECEBIDO e nunca muda por devolucao: quem cai com a devolucao e',
    'o empenho (nota_empenho.valor_anulado), nao a NC.',
    'valor_recolhido NAO E CAMPO DE ESCRITA desde a 1.40.0: a coluna foi apagada.',
    'Ele sai na LEITURA como a SOMA dos documentos de recolhimento da NC (recurso',
    '`recolhimento`), e continua sem alterar valor_nc. Manda-lo no corpo volta 400.',
    'classificacao_id responde "esta previsto no PDR autorizado?", nao e a celula',
    'orcamentaria: 1 = PDR (vai para a subsecao 4.2), 2 = Extra-PDR (subsecao 4.7).',
    'pdr_item_id so existe quando classificacao_id = 1; com Extra-PDR o campo e',
    'descartado. Ele casa o item previsto (rotulo 1D, 1E, ...).',
    'A NC NAO TEM meta_pit_id desde a 1.31.0. Mandar o campo NAO da erro: ele e',
    'descartado pelo servidor e volta listado em "avisos" na resposta. A meta que',
    'a NC financia e a meta do pdr_item dela, e a leitura ja a devolve resolvida',
    'em meta_pit_id e numero_meta. Logo: NC Extra-PDR nao tem meta, porque nao tem',
    'item, e isso e a definicao dela, nao uma pendencia.',
    'NAO HA `marcador` desde a 1.43.0, e manda-lo volta 400. Ele era o resto de',
    'vespera do recolhido digitado ("RECOLH" para dizer que a NC voltou inteira)',
    'e ja discordava do documento: 11 NCs com recolhimento integral, 8 marcadas.',
    'Unica por (ano, numero, cod_nd, ug_emitente): a numeracao do SIAFI e por UG',
    'emitente, entao o mesmo numero e ND podem existir para emitentes distintos.',
    'Colisao volta 409.',
    'Aceita 1 anexo PDF; reenviar substitui o anterior.'
  ],

  recolhimento: [
    'Uma linha por DOCUMENTO do SIAFI que devolve credito, apontando a NC que ele',
    'abate (nota_credito_id obrigatorio). A soma por NC e o valor_recolhido que a',
    'leitura da NC devolve, e o que sai nas subsecoes 4.1, 4.2 e 4.7 do RPCMTec.',
    'O numero NAO e unico sozinho: uma NC de recolhimento pode abater DUAS NCs',
    'nossas, entrando uma vez por alvo com o valor rateado (a 2026NC401316 recolhe',
    'R$ 0,98 da 400224 e R$ 0,99 da 400937). A unicidade e (ano, numero,',
    'nota_credito_id), e a colisao volta 409.',
    'cod_nd e a ND da ANULACAO (339000, 449000), e nao a da NC alvo: e o que o',
    'extrato mostra, e sem ela o documento nao se acha no SIAFI.',
    'valor e estritamente positivo (CHECK no banco): recolhimento de zero nao e',
    'documento nenhum.',
    'Aceita VARIOS anexos PDF (extrato do SIAFI e DIEx que pede a devolucao).',
    'Apagar a NC apaga os recolhimentos dela em cascata, com rastro na auditoria.'
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
    'Saldo a liquidar = valor_empenhado - valor_anulado - SUM(liquidado).',
    'A CHAVE DO SIAFI e (ug, gestao, ano, numero), e QUEM GRAVA AS DUAS PRIMEIRAS',
    'e o SERVIDOR: ele as deriva da UG emitente da NC representativa. Elas nao',
    'estao no Joi de proposito -- ninguem digita a UG de um empenho, ela e',
    'consequencia do credito, e um campo permitiria afirmar uma UG que a NC',
    'desmente. Repetir a chave volta 409, e esse 409 e novo desde a 1.43.0: o',
    'indice existia desde 2026-08-07, mas o servidor nunca escrevia `ug`, e no',
    'Postgres NULL nao colide com NULL num indice unico.'
  ],

  liquidacao: [
    'Liquida contra uma NE. A soma das liquidacoes nao pode passar do empenhado',
    'liquido (valor_empenhado - valor_anulado).'
  ],

  recebimento: [
    'Recebimento de material de uma NE. Alimenta a subsecao 4.6 do RPCMTec.'
  ],

  pdr: [
    'Nao existe tabela nem cabecalho de PDR: o PDR do ano E o conjunto dos pdr_item',
    'daquele ano. Cada item tem um rotulo (item_label: 1D, 1E, ...).',
    'valor_solicitado e o pedido; valor_autorizado e o que voltou aprovado, e e ele',
    'que vira a coluna Previsto da subsecao 4.1.',
    'O `gnd` CONTINUA NA RESPOSTA E DEIXOU DE SER DIGITADO, desde a 1.43.0: ele',
    'sai do GET com o mesmo nome, agora lido de `dominio.natureza_despesa.gnd`',
    'pelo cod_nd do item (eram iguais em 36 de 36). Manda-lo no corpo volta 400.',
    'O anexo do PDR e por ANO (vinculo pdr_ano), nao por item, e aceita varios',
    'arquivos (PDF e planilha).'
  ],

  meta: [
    'Meta do PIT do ano, o GRUPO numerado (pit.meta). SO o item do PDR aponta a',
    'META, por meta_pit_id, e e assim que o credito se liga a producao. A cadeia e',
    'nota_credito -> pdr_item -> pit.meta, e desde a 1.31.0 ela e a unica: em',
    'orcamento a ligacao com o PIT e o PDR.',
    'A META, E NAO O ITEM. O PIT tem dois niveis desde a 1.30.0: o grupo ("Meta 1 -',
    'Producao de Geoinformacao") e o item que promete ("1.1"). O trabalho (versao,',
    'pedido, capacitacao) aponta o ITEM; o credito aponta o GRUPO, porque e para o',
    'grupo que ele e autorizado. Medido em 2026-08-06: em 2026 a meta 3 tem 6 itens',
    'de PDR para 2 itens de PIT, e a meta 5 tem 5 para 3. O item do PDR e uma linha',
    'por natureza de despesa (diarias, passagens, pecas), e nao um recorte do',
    'trabalho: ele nao caberia dentro de um item do PIT.'
  ],

  dfd: [
    'O conjunto dos DFDs de um ano E o PCA daquele ano; nao existe entidade PCA.',
    'DOIS TOTAIS CONTINUAM NA RESPOSTA E DEIXARAM DE SER DIGITADOS, desde a',
    '1.43.0: `dfd_item.valor_total` e `dfd.valor_estimado`. Eles saem do GET com',
    'o mesmo nome de sempre, agora CALCULADOS (o item e quantidade *',
    'valor_unitario, arredondado a 2 casas; o DFD e a soma dos itens, e fica',
    'nulo no DFD sem item). Manda-los no corpo volta 400, porque o modulo usa o',
    'validador ESTRITO. A unica excecao e o `valor_total` DENTRO de um item, que',
    'o servidor descarta em silencio por ser eco do GET.',
    'SAIRAM DO CADASTRO na mesma versao, e tambem voltam 400: justificativa,',
    'grau_prioridade_id, data_prevista_conclusao, responsavel_cpf e',
    'vinculo_plano_gestao. Com grau_prioridade_id saiu a tabela',
    '`dominio.grau_prioridade` inteira, e com ela a rota que a servia.',
    'area_requisitante FICOU, e e o unico campo que diz DE QUEM e a demanda.',
    'Aceita 1 anexo PDF; reenviar substitui o anterior.'
  ],

  licitacao: [
    'Nao tem vinculo com DFD.',
    'Tres tipos, em dominio.tipo_licitacao (GCALC DSG, Propria, Participante); consulte',
    'os codigos com: orcamento dominio tipo_licitacao.',
    'NAO HA `nup` nem `fornecedor` desde a 1.43.0, e manda-los volta 400. Os dois',
    'nasceram em 2026-08-04 e ficaram em 0 de 11; o chefe decidiu em 2026-08-08',
    'que UM identificador basta, e o que ficou e o `numero_pregao`.',
    'Alimenta a subsecao 4.4 (GCALC DSG) e a 4.5 (demais licitacoes da',
    'atividade-fim) do RPCMTec.'
  ],

  rpnp: [
    'Exige nota_empenho_id OU empenho_label (pelo menos um): o RPNP costuma',
    'referenciar empenho de exercicio anterior, que nao esta cadastrado como NE aqui.',
    'valor_a_liquidar aceita 0: um RPNP totalmente liquidado continua sendo exibido na',
    'subsecao 4.3.'
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
    '`acervo rpcmtec --ano N --mes M --pdf`.'
  ],

  arquivo: [
    'Vinculo polimorfico a EXATAMENTE um dono: nota_credito_id, dfd_id, pdr_ano ou',
    'recolhimento_id.',
    'Os bytes ficam no proprio banco (coluna conteudo BYTEA), nao no filesystem. A',
    'listagem nunca traz o conteudo: os bytes so saem no download.',
    'NC e DFD aceitam 1 PDF (reenviar substitui); o PDR aceita varios (pdf, xlsx, xls,',
    'csv, ods) e o recolhimento aceita varios PDF.'
  ],

  configuracao: [
    'So sobrou GET /anos, que devolve os anos com dado para o seletor das telas.',
    'A tabela orcamento.configuracao foi podada em 2026-08-06: ela guardava uasg e',
    'codom, preenchidas, corretas e sem um unico leitor fora da propria tela.'
  ],

  dominio: [
    'GET exige perfil de consulta no modulo orcamento; nao e publico. POST, PUT e',
    'DELETE exigem administrador.',
    'So natureza_despesa, plano_interno e ug tem CRUD; os demais sao so leitura.',
    'SAO OITO dominios desde a 1.43.0: `grau_prioridade` foi apagada junto com a',
    'unica coluna que a apontava, e a rota que a servia saiu no mesmo commit.'
  ]
}

module.exports = { REGRAS, GERAL }
