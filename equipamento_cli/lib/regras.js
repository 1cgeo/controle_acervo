'use strict'

// O que o joi.describe() NAO consegue contar.
//
// A forma de cada recurso (campos, tipos, obrigatorios, limites) e lida ao vivo
// do schema Joi e nunca e copiada. Mas a regra de negocio mora nos COMENTARIOS
// do equipamento_schema.js, do equipamento_ctrl.js e do DDL, invisiveis para o
// describe(), e e justamente ela que evita o erro caro: nao saber que a situacao
// e DERIVADA custa procurar por meia hora um campo de escrita que nao existe,
// nao um 400.
//
// Este arquivo e a UNICA prosa curada do CLI. Regra aqui vale por ser curta e
// por explicar o PORQUE; qualquer coisa que o Joi ja diga (tipo, tamanho,
// obrigatoriedade, mensagem de erro) NAO entra aqui, para nao criar uma segunda
// fonte de verdade.
//
// Ao mudar uma regra de negocio no server/, atualize a linha correspondente.

const GERAL = [
  'O equipamento e o modulo do PARQUE DE MATERIAL da Divisao: estacao total, GNSS,',
  'plotter, drone. Ele responde tres perguntas: o que temos, em que situacao cada bem',
  'esta HOJE, e o que ja aconteceu com ele.',
  'As rotas ficam sob /api/equipamento/. So /api (health) e /api/login sao publicos.',
  'Acesso por PERFIL no modulo equipamento:',
  '  consulta  le o parque, a ficha, o painel e tira o Relatorio DMT;',
  '  operador  LANCA o que acontece com o bem (indisponibilidade, afastamento,',
  '            manutencao) e cadastra tipo novo;',
  '  gerente   mexe na CARGA: cria, altera e apaga o BEM, lanca transferencia e',
  '            descarga, e apaga tipo.',
  'O administrador passa em tudo. O CLI nao afrouxa nada: quem recusa e o servidor.',
  'O corpo e validado pelo validador ESTRITO: chave desconhecida volta 400 com a',
  'sugestao do nome mais parecido, e nunca e descartada em silencio.',
  'O PUT SUBSTITUI A LINHA INTEIRA. Mandar so o campo que mudou apaga todo o resto,',
  'calado. Por isso `alterar`, `editar` e `fechar` LEEM o registro, aplicam a mudanca e',
  'reenviam o corpo completo, em vez de aceitar um corpo parcial.',
  'Toda escrita se confere LENDO DE VOLTA, nunca pela mensagem de sucesso.'
]

const REGRAS = {
  bem: [
    'A SITUACAO NAO SE ESCREVE: ela e DERIVADA do dia, pela funcao SQL',
    'equipamento.situacao_em(CURRENT_DATE), e vale o degrau mais alto que se aplicar:',
    '  10 Disponivel  20 Afastado  30 Em manutencao  40 Indisponivel  50 Baixado.',
    'Nao existe campo situacao_id no corpo do bem, e procurar por um e perder tempo:',
    'para mudar a situacao, lance (ou feche) o evento que a produz.',
    'ativo = false E O BEM BAIXADO, e a situacao derivada passa a mostra-lo como',
    '"Baixado", o degrau mais alto. Nao ha exclusao logica separada disto.',
    'vida_util_meses NULO NAO E ZERO: nulo quer dizer "vale a do tipo". A leitura ja',
    'devolve o valor resolvido e a coluna vida_util_herdada dizendo de onde ele veio.',
    'Cuidado ao reenviar: quem le a vida util resolvida e a manda de volta MATERIALIZA a',
    'heranca, e o bem passa a declarar a propria vida util, deixando de acompanhar o',
    'tipo. Nada acusa isso, porque o numero gravado e igual ao que a tela ja mostrava.',
    'O `equipamento alterar` preserva a heranca como nula, e so um --vida_util_meses',
    'explicito a rompe.',
    'A VIDA UTIL E EM MESES, aqui e no banco. A planilha da Secao traz a coluna em',
    'ANOS: 10 la sao 120 aqui. Digitar 10 cadastra dez meses de vida util, sem erro',
    'nenhum na hora e com o Relatorio DMT errado no fim do mes.',
    'nr_patrimonio e UNICO e passa por trim: patrimonio repetido volta 409. Antes de',
    'cadastrar, procure o numero na lista, ou o mesmo bem entra duas vezes.',
    'Apagar o bem e recusado quando ha indisponibilidade, afastamento, manutencao ou',
    'transferencia lancada nele. Bem que saiu da carga se BAIXA (ativo = false), nao se',
    'apaga: o historico dele e o que responde onde o dinheiro foi parar.',
    'classe_id, tipo_id e secao_detentora_id nao tem lista fixa no Joi de proposito:',
    'quem decide se o codigo existe e a chave estrangeira. Consulte os codigos com',
    '`equipamento dominio` e os tipos com `equipamento tipo listar`.'
  ],

  tipo: [
    'E CADASTRO, e nao dominio de code fixo: o id e SERIAL e a Divisao cadastra tipo',
    'novo pela tela ou por aqui. Por isso ele nao esta em domain_constants.js, e por',
    'isso o id de um tipo nunca vira constante no codigo.',
    'O nome e UNICO no banco: repetir volta 409.',
    'vida_util_meses do TIPO e a que o bem HERDA quando nao declara a propria, e e',
    'por causa dela que ESCREVER aqui e de GERENTE desde 2026-08-08: uma linha',
    'alterada muda a vida util de dezenas de bens de uma vez, sem passar por nenhum.',
    'LER continua em consulta, porque a listagem de bens usa o catalogo para montar',
    'o filtro por tipo. Na interface esta tela se chama Configuracao.',
    'Apagar um tipo com bem cadastrado e recusado: marque ativo = false.'
  ],

  indisponibilidade: [
    'E o bem PARADO na Divisao: quebrado, sem insumo, aguardando peca.',
    'data_fim NULA e o lancamento ABERTO, ou seja, o bem continua parado hoje.',
    'FECHAR e gravar data_fim, e so isso: nao ha campo de situacao para virar.',
    'O banco RECUSA SOBREPOSICAO no mesmo bem (EXCLUDE por daterange fechado): feche a',
    'anterior antes de lancar a nova, ou volta 409. Duas paradas simultaneas do mesmo',
    'bem nao sao duas paradas, sao uma so com dois motivos.',
    'previsao_retorno e o que o gestor PROMETE, e nao o que aconteceu: ela e a coluna',
    '18 do Relatorio DMT quando nao ha descarga solicitada.',
    'Uma indisponibilidade com data futura NAO deixa o bem indisponivel hoje: a funcao',
    'de situacao so conta o que ja comecou.'
  ],

  afastamento: [
    'E o bem FORA DA CASA, cedido a outra OM, e nao parado: ele funciona, so nao esta',
    'aqui. Por isso o degrau (20) e mais baixo que o de manutencao e o de',
    'indisponibilidade.',
    'om e TEXTO LIVRE, e nao chave estrangeira: as OMs que aparecem na planilha da',
    'Secao (por exemplo "3º BPE") nao sao cadastro deste sistema.',
    'Mesma regra de sobreposicao da indisponibilidade: um bem nao pode estar em duas',
    'OMs ao mesmo tempo, e o banco recusa com 409.',
    'previsao_termino e promessa; data_fim e o retorno de fato. FECHAR e gravar',
    'data_fim.'
  ],

  manutencao: [
    'indisponibilidade_id e OPCIONAL, e a ausencia dele e informacao: ha conserto que',
    'nao tira o bem de operacao (revisao preventiva), e ha bem parado sem que ninguem',
    'tenha aberto manutencao ainda.',
    'Quando existe, ele LIGA o conserto a parada que o explica, e e esse par que o',
    'Relatorio DMT poe na mesma linha: o motivo da parada e o valor orcado tem de',
    'falar do mesmo evento.',
    'AS TRES COLUNAS DE DINHEIRO sao valor (o que se pagou), valor_orcado (o que se',
    'orcou) e valor_pdr (o previsto no PDR). As tres sao ESTRITAMENTE POSITIVAS, por',
    'CHECK no banco: manutencao de graca nao se lanca com valor 0, se lanca SEM valor.',
    'certame e o processo por onde a compra do conserto anda ("Contrata+Brasil"). E',
    'texto livre: a licitacao do modulo orcamento e outra coisa, com outro ciclo.',
    'O cartao de custo do painel soma o `valor` das manutencoes do ANO CORRENTE por',
    'data_inicio: a manutencao entra no ano em que COMECOU, que e quando o dinheiro',
    'foi comprometido.',
    'Manutencao aberta (sem data_fim) deixa o bem "Em manutencao" (degrau 30) enquanto',
    'nao for fechada.'
  ],

  transferencia: [
    'E a movimentacao de PATRIMONIO, e por isso as escritas sao de GERENTE, e nao de',
    'operador como os outros tres historicos: ela tira o bem da carga da Divisao, ou o',
    'traz para ela.',
    'Tres tipos (Recebimento, Cessao, Descarga) e quatro situacoes (Solicitada,',
    'Autorizada, Concluida, Cancelada). Os codigos saem de `equipamento dominio`.',
    'NAO TEM data_fim, e nao e esquecimento: uma transferencia nao dura, ela se',
    'resolve. O equivalente honesto de "ainda em curso" e a situacao que nao terminou,',
    'e e isso que o filtro --aberta le aqui: nem Concluida nem Cancelada.',
    'Por isso nao ha verbo `fechar`: encerrar uma transferencia e mudar a SITUACAO,',
    'com `equipamento transferencia editar --id N --situacao_id <code>`.',
    'OS DOIS SIAFI (transferido_siafi, apropriado_siafi) sao NOT NULL com default',
    'false: a pergunta que eles respondem ("ja foi transferido no SIAFI?") nao tem',
    'terceiro estado. Num PUT, omiti-los os devolve a false.',
    'A DESCARGA SOLICITADA (tipo Descarga em situacao Solicitada) MANDA sobre a',
    'previsao de retorno no Relatorio DMT: um bem que esta saindo da carga nao tem data',
    'de volta, e anunciar uma seria promessa falsa. A coluna 18 mostra "solicitado',
    'descarga" no lugar da data.',
    'Lancar a transferencia NAO baixa o bem sozinho: dar baixa e `equipamento baixar`,',
    'que grava ativo = false. Sao dois atos, e o segundo se faz quando a descarga se',
    'conclui.'
  ],

  dashboard: [
    'Seis blocos: contagem por situacao, por secao, por tipo, os parados ha mais tempo,',
    'o custo de manutencao do ano e quantas descargas estao solicitadas.',
    'A situacao com ZERO bem aparece com zero, de proposito: um painel que some a',
    'coluna "Em manutencao" no dia em que nada esta em manutencao faz quem le achar que',
    'a coluna nunca existiu.',
    'Os parados vem do MAIS ANTIGO para o mais novo, no maximo 10: a pergunta e "o que',
    'esta encalhado", e nao "o que quebrou ontem".',
    'O custo do ano soma so a coluna `valor`, e nao o orcado nem o previsto em PDR.'
  ],

  relatorio: [
    'O Relatorio DMT e o documento de 26 colunas que a Secao ja entrega hoje, e ele e',
    'CONTRATO DE SAIDA: quem o recebe compara com o do mes passado. Por isso as colunas',
    'espelham a planilha, e nao a modelagem do banco.',
    'Ele SEMPRE baixa um .ods, e nao existe ?formato=json: quem quer o dado em JSON tem',
    '`equipamento listar` e `equipamento ver`, que devolvem o modelo do banco.',
    'Uma linha por bem, na ordem em que a carga inicial os inseriu (o ID da Secao).',
    'A coluna 18 promete duas coisas num campo so ("Previsao de disponibilidade ou',
    'descarga"): ora a data de volta, ora o texto "solicitado descarga". A modelagem as',
    'separa e o relatorio as junta de volta SO NA SAIDA, porque o documento e contrato.'
  ],

  dominio: [
    'As CINCO listas vem numa resposta so, de uma rota so (GET /dominio): a tela de bens',
    'precisa das cinco para desenhar um formulario, e cinco requisicoes para cinco',
    'catalogos de duas a cinco linhas seria cinco vezes o custo pelo mesmo desenho.',
    'Por isso `equipamento dominio <lista>` nao gasta uma chamada a mais: ele recorta',
    'localmente o que ja veio.',
    'Nao ha CRUD: sao tabelas de code fixo, semeadas pelo er/ e alteradas por migracao.',
    'A lista `situacao` traz a `precedencia` junto, e ela e o dado: e a escada da',
    'situacao derivada (10, 20, 30, 40, 50), e e por ela que se ordena, nunca pelo code.',
    'O TIPO DE EQUIPAMENTO NAO ESTA AQUI: ele e cadastro, com id SERIAL, e sai em',
    '`equipamento tipo listar`.'
  ]
}

// Regras que nao pertencem a um recurso, e sim a um verbo do CLI.
const REGRAS_VERBO = {
  fechar: [
    'Fechar e gravar data_fim num lancamento aberto, e o PUT do SCA substitui a linha',
    'inteira. Por isso o comando LE o lancamento antes, aplica a data e reenvia o corpo',
    'completo: mandar so {"data_fim": ...} apagaria motivo, previsao e data de inicio.',
    'Nao ha GET por id nos historicos: a leitura sai da LISTA, sem filtro. Filtrar por',
    'equipamento_id ali seria ambiguo, porque nos historicos essa mesma chave e CAMPO do',
    'corpo: em `editar --equipamento_id 5` ela quer dizer "passe este lancamento para o',
    'bem 5", e procurar o lancamento no bem de destino nao acharia nada.'
  ],

  baixar: [
    'Dar BAIXA e gravar ativo = false, e a situacao derivada passa a "Baixado". Nao e',
    'apagar: o bem continua no cadastro, com todo o historico dele.',
    'E reversivel: `equipamento alterar --id N --ativo true` traz o bem de volta.',
    'NAO CONFUNDA com baixar arquivo: o download do Relatorio DMT e',
    '`equipamento relatorio dmt --para relatorio_dmt.ods`.'
  ]
}

module.exports = { REGRAS, GERAL, REGRAS_VERBO }
