'use strict'

// O que o joi.describe() NAO consegue contar.
//
// A forma de cada operacao (campos, tipos, obrigatorios, dependencias) e lida ao
// vivo do schema Joi e nunca e copiada. Mas a regra de negocio mora nos
// COMENTARIOS dos *_schema.js e dos *_ctrl.js, invisiveis para o describe(), e e
// justamente ela que evita o erro caro: nao saber que nulo e zero sao coisas
// diferentes na celula da grade custa um numero errado no RPCMTec, nao um 400.
//
// Este arquivo e a UNICA prosa curada do CLI. Regra aqui vale por ser curta e
// por explicar o PORQUE; qualquer coisa que o Joi ja diga (tipo, tamanho,
// obrigatoriedade, formato) NAO entra aqui, para nao criar uma segunda fonte de
// verdade.
//
// Ao mudar uma regra de negocio no server/, atualize a linha correspondente.

const GERAL = [
  'O PIT e o RPCMTec são rotas de PLATAFORMA, e não de módulo: /api/metas e',
  '/api/rpcmtec não levam prefixo, como /api/usuarios. Não existe "perfil de',
  'PIT" nem "perfil de RPCMTec", porque não existe módulo com esse nome.',
  '',
  'A GUARDA muda dentro do próprio /api/metas, e essa é a única sutileza de',
  'acesso desta área:',
  '  ler a meta, o Extra-PIT, a mídia, o exercício e a revisão  exige só LOGIN;',
  '  ler a execução mensal (a grade e o resumo)                 exige GERENTE de',
  '  qualquer módulo, ou administrador (verifyGerente lê o BANCO a cada',
  '  requisição, e não o token: rebaixar perfil vale na hora);',
  '  ESCREVER qualquer coisa do PIT                             exige',
  '  ADMINISTRADOR global.',
  'O /api/rpcmtec inteiro exige ADMINISTRADOR, inclusive a leitura: a edição',
  'cruza os três módulos numa peça só e traz valor de crédito, empenho e',
  'liquidação.',
  '',
  'O corpo do /api/metas passa por validação ESTRITA: chave desconhecida vira',
  '400 com sugestão de nome. O do /api/rpcmtec passa pela validação padrão, que',
  'DESCARTA a chave desconhecida em silêncio. O CLI valida localmente no modo de',
  'cada grupo, e avisa o descarte.',
  '',
  'A numeração do PIT NÃO é estável entre anos: guarde o id da meta, nunca o',
  'código dela.',
  '',
  'O efetivo (passagens, impedimentos e o mapa de aproveitamento) não está aqui:',
  'use o efetivo_cli.'
]

const REGRAS = {
  meta: [
    'A meta é separada entre IDENTIDADE e DECLARAÇÃO. `pit.meta` guarda o que',
    'revisão nenhuma muda (ano, número, item) e o que o SCA decide (unidade,',
    'origem); `pit.meta_revisao` guarda o que a DSG declara, uma linha por',
    'revisão que mudou algo. A leitura sai de `pit.meta_vigente`.',
    'ESCREVER A DECLARAÇÃO EXIGE REVISÃO EM RASCUNHO no ano. É o que faz o',
    'histórico ficar completo por construção: não dá para mudar o que o PIT',
    'promete sem dizer qual documento autorizou.',
    'SÓ A META-FOLHA recebe lançamento. A meta subdividida tem um cabeçalho',
    '(item nulo) e uma linha por item, e quem entrega é o item. A meta indivisa',
    'É folha.',
    'origem_id diz de ONDE VEM o número: 1 Manual, 2 Capacitação, 3 Produção, 4',
    'Impressão. Virar uma meta para automática é ato deliberado, e o portão dele',
    'é o ensaio: ele mostra o digitado e o calculado lado a lado ANTES da virada.',
    'unidade_id diz o que a meta CONTA: 1 Folha, 2 Marco, 3 Capacitação, 4 Item',
    'de acervo, 5 Atividade. O controlador cobra a coerência com a origem:',
    'Produção e Impressão exigem Folha, e Capacitação exige Capacitação.',
    'Não há situacao_id digitado: "Em execução" e "Concluída" a grade calcula do',
    'que foi lançado. O único ato de situação que é da DSG é `cancelada`.'
  ],

  execucao: [
    'UMA GRADE, e não duas. A mesma linha guarda o PLANEJADO e o REALIZADO do',
    'mês, porque a razão de as duas abas existirem (PLANEJ_PIT e EXEC_PIT) é a',
    'comparação entre elas.',
    'NULO E ZERO SÃO COISAS DIFERENTES nos dois números: nulo é "ninguém lançou"',
    'e zero é "conferi e não houve". Zero é resposta, e some da tela se for',
    'tratado como ausência.',
    'No corpo do lançamento, OMITIR um campo é NÃO MEXER e mandar NULO é APAGAR.',
    'É o que deixa o modo "Executar" gravar o realizado sem carregar o plano',
    'junto. A célula que fica sem nenhum dos quatro campos é APAGADA.',
    'A cor da grade compara o ACUMULADO, nunca o mês sozinho: senão trabalho',
    'adiantado apareceria como atraso.',
    'O resumo com --mes lê a revisão VIGENTE NAQUELE MÊS, e não a de hoje: o',
    'RPCMTec de agosto continua reportando o que reportava depois de a DSG',
    'publicar uma revisão em setembro.',
    'O ensaio responde inclusive na meta que ainda está Manual, que é justamente',
    'a que interessa olhar.'
  ],

  exercicio: [
    'Três situações: 1 Em elaboração, 2 Vigente, 3 Encerrado. Omitir na criação',
    'vale Vigente.',
    'Encerrar o ano é pôr situacao_id 3, e é isso que faz o servidor recusar',
    'alteração em exercício fechado.'
  ],

  revisao: [
    'O fluxo, do jeito que o gerente o vive: abrir o exercício, abrir a revisão',
    'SEM data de vigência (é isso que a deixa em rascunho), anexar o PDF',
    'assinado, alterar as metas (elas caem na revisão aberta sozinhas), conferir',
    'as alterações contra o documento, e só então publicar.',
    'A GRADE SÓ MUDA NA PUBLICAÇÃO. Enquanto a revisão é rascunho ela não rege',
    'nada, e o RPCMTec do mês anterior continua reportando o que reportava.',
    'UM RASCUNHO POR ANO, cobrado por índice parcial no banco. Com dois abertos,',
    'a alteração de uma meta cairia na revisão errada sem ninguém perceber.',
    'A data de vigência pode ser RETROATIVA, e às vezes tem de ser: o R1 de 2026',
    'foi assinado em 14/05 e o documento é de 11/05. A data do documento NÃO é a',
    'da assinatura digital.',
    '`pit.meta_revisao` é ESPARSA: as linhas de uma revisão SÃO as alterações',
    'dela. Por isso existe remover-meta, que tira a declaração de uma meta do',
    'rascunho sem apagar a meta.'
  ],

  extra: [
    'O Extra-PIT é a exceção AUTORIZADA, e não todo trabalho fora do plano. Por',
    'isso documento_autorizacao é obrigatório: o modelo do relatório tem uma',
    'coluna para provar.',
    'NÃO se deriva de `mapoteca.pedido.previsto_pit`, que é falso por omissão.',
    'origem_id aceita só Manual (1) e Produção (3), e o banco cobra o mesmo por',
    'CHECK. Ausente vira Manual.',
    'quantidade_materializada é CALCULADA na leitura (versões do acervo que',
    'apontam a demanda), nunca gravada. Sai zero para a demanda Manual.',
    'Não há desconto na 2.1: o Extra-PIT não é lançado em `pit.execucao`.'
  ],

  midia: [
    'Responde outra pergunta que `mapoteca.pedido.meta_pit_id`, e os dois NÃO se',
    'substituem. O campo do pedido diz "estava previsto no PIT sob esta meta"; a',
    'meta 4 conta o que SAIU, e o que saiu está no ITEM entregue.',
    'Pedido planejado em tyvek e atendido em sulfite conta na meta do SULFITE,',
    'porque foi ele que saiu.',
    'O ANO está na chave porque a numeração do PIT é reescrita todo ano.',
    'O ano do corpo TAMBÉM está na meta, e a duplicata é deliberada: a UNIQUE',
    '(ano, tipo_midia_id) não enxerga coluna de outra tabela. O controlador',
    'confere que os dois casam antes de gravar.'
  ],

  edicao: [
    'A regra que governa tudo é a ASSINATURA. Edição ABERTA: as subseções',
    'calculadas saem do banco a cada abertura, e só o digitado persiste. Edição',
    'FECHADA: tudo vem congelado do instante do fechamento.',
    'O congelamento só acontece NO FECHAMENTO. Gravada cedo, a edição',
    'envelheceria em silêncio no primeiro pedido corrigido.',
    'REABRIR APAGA o congelado das subseções CALCULADAS (o digitado fica). Fechar',
    'de novo recalcula tudo com o banco de hoje, e o que foi assinado deixa de',
    'ser reproduzível.',
    'conferir é o contrapeso do congelamento: numa edição fechada, recalcula as',
    'calculadas e mostra a diferença contra o congelado. Sem ele, congelar seria',
    'esquecer.',
    'O fechamento RECUSA com subseção digitada por visitar e sem assinante',
    'definido. O assinante é o uuid do cadastro, e não um nome digitado: o bloco',
    'de assinatura do PDF sai de `dgeo.usuario`.',
    'Edição FECHADA não se exclui: reabra primeiro. É gesto explícito de',
    'propósito, porque o CASCADE leva subseções e anexos.',
    'Os bytes do anexo moram na própria linha do banco, e a listagem nunca os',
    'traz: eles só saem no download.'
  ],

  subsecao: [
    'O RPCMTec tem 34 blocos, e quinze deles o SCA não sabe calcular: são estes.',
    'Onze vêm de outro sistema ou de fora (2.2 a 2.5 do SAP, 5.1 do painel do',
    'GitHub, 8.3 do doc_dgeo) e o resto não tem cadastro em lugar nenhum.',
    'AS COLUNAS NÃO SE INVENTAM. O cabeçalho é fixo, medido no documento da',
    'Divisão, e o servidor confere o tamanho de cada linha contra ele. Deixar',
    'desenhar a tabela faria o RPCMTec deixar de ser comparável consigo mesmo.',
    'sem_ocorrencia declara o vazio POR DECISÃO, e separa "não houve" de "ninguém',
    'preencheu". Marcá-lo junto com conteúdo é contradição, e o CHECK do banco a',
    'recusa.',
    'Limpar faz a subseção voltar a NÃO EXISTIR, que não é ficar vazia: o',
    'fechamento a cobra de novo.',
    'copiar-mes-anterior NÃO sobrescreve: a subseção já preenchida volta em',
    '"preservadas". As linhas copiadas são reconferidas contra a estrutura de',
    'HOJE, que pode ter ganhado coluna desde o mês passado.',
    'Tudo aqui só funciona com a edição ABERTA.'
  ],

  capacitacao: [
    'UM cadastro para os dois lados do mesmo fato: tipo_id 1 e 2 separam a',
    'MINISTRADA (subseção 2.6) da RECEBIDA (6.2). Duas tabelas com dez colunas',
    'iguais divergiriam na primeira que fosse acrescentada a uma só.',
    'O servidor NÃO recusa a coluna que não pertence ao tipo, e é deliberado: ele',
    'não sabe se a linha está sendo montada aos poucos. Quem decide o que aparece',
    'é o formulário, e quem decide o que SAI é o gerador.',
    '`militares` é a lista de quem da Divisão participou, por uuid do cadastro, e',
    'vale para os DOIS tipos: na ministrada são os instrutores, na recebida os',
    'capacitados. O papel vem do tipo_id, e não de um campo.',
    'A lista é REGRAVADA INTEIRA a cada salvamento. Omiti-la manda lista vazia',
    '(o default do Joi) e apaga quem estava lá.',
    'meta_pit_id é anulável, e a maioria fica nula: em 2026 o PIT só promete',
    'capacitação MINISTRADA (a meta 5).'
  ],

  anuario: [
    'O Anuário e a aba META4_DETALHADA saem junto do RPCMTec porque são a MESMA',
    'tarefa mensal: os três arquivos sobem para a DSG no mesmo envio. Nenhum dos',
    'dois é subseção do relatório, e por isso não entram no PDF.',
    'O Anuário é do MÊS. O RTM é ACUMULADO até o mês escolhido, e é o único',
    'download desta área que acumula.',
    'Quem NOMEIA os arquivos é o servidor, e o nome importa: é o que a DSG',
    'recebe. Sem --saida, o CLI usa o nome que veio no Content-Disposition.'
  ]
}

module.exports = { REGRAS, GERAL }
