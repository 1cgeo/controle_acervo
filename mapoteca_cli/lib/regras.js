'use strict'

// O que o joi.describe() NAO consegue contar.
//
// A forma de cada recurso (campos, tipos, obrigatorios, condicionais) e lida ao
// vivo do schema Joi e nunca e copiada. Mas a regra de negocio mora nos
// COMENTARIOS dos *_schema.js e dos *_ctrl.js, e nas decisoes que o chefe tomou
// lendo documento de verdade, invisiveis para o describe(). E justamente ela que
// evita o erro caro: nao saber que duas linhas com o mesmo MI sao UM item custa
// imprimir o dobro de folhas, nao um 400.
//
// Este arquivo e a UNICA prosa curada do CLI. Regra aqui vale por ser curta e
// por explicar o PORQUE; qualquer coisa que o Joi ja diga (tipo, tamanho,
// obrigatoriedade, valores aceitos) NAO entra aqui, para nao criar uma segunda
// fonte de verdade.
//
// Ao mudar uma regra de negocio no server/, atualize a linha correspondente.

const GERAL = [
  'A mapoteca e o modulo de PEDIDOS do SCA: um cliente (OM ou civil) pede cartas e a',
  'DGEO atende. O acesso e por PERFIL no modulo: consulta LE tudo (inclusive o livro',
  'de material), operador imprime e faz TUDO de material (lanca movimento, cadastra e',
  'conta), gerente cadastra pedido, cliente, item e anexo. O administrador passa em',
  'tudo. Publico, sem login, so a consulta por localizador (e o /api e o /api/login).',
  'O CRUD tem forma propria e nao segue /recurso/:id:',
  '  PUT    vai na COLECAO com o id dentro do corpo, e SUBSTITUI a linha inteira;',
  '  DELETE vai na COLECAO com um ARRAY de ids, ou seja, e sempre operacao em lote.',
  'Toda escrita deve ser conferida LENDO DE VOLTA, nunca pela mensagem de sucesso: o',
  'modo de falha recorrente registrado no vault e "a ferramenta disse OK e nada foi',
  'gravado".'
]

const REGRAS = {
  pedido: [
    'Nasce em situacao 3 (Em andamento): cadastrar o pedido e um ato, imprimir e',
    'entregar sao atos posteriores. So marque 5 (Concluido) quando houver entrega.',
    'O localizador_pedido e gerado pelo servidor no POST e NUNCA muda: um PUT que o',
    'traga tem o campo descartado. E por ele que o solicitante consulta o pedido sem',
    'login.',
    'documento_solicitacao e o numero do DIEx/Oficio; documento_solicitacao_nup e o NUP.',
    'O NUP e a chave pratica de deduplicacao: antes de cadastrar, procure o NUP na',
    'lista, ou o mesmo pedido entra duas vezes.',
    'ponto_contato e o contato DESTE pedido (posto, nome de guerra, funcao e TELEFONE,',
    'numa string so). Nao confundir com cliente.ponto_contato_principal, que e o',
    'contato perene da OM. Ele costuma estar no FECHO do documento, depois da tabela.',
    'prazo so se o documento der DATA explicita. Exercicio citado sem data nao vira',
    'prazo: deixe nulo e registre em observacao. Prazo inventado vira cobranca errada.',
    'demandante e a secao ou a sigla que pediu (ex.: "6 RCB / 3a Secao"). O nome do',
    'cliente e sempre por extenso, e vem do cadastro. NAO existe mais `omds`: a coluna',
    'foi podada em 2026-08-08 por ser a mesma casa em todas as 124 linhas preenchidas,',
    'e no relatorio ela virou constante.',
    'palavras_chave sao etiquetas livres, e o filtro --palavra_chave da listagem casa a',
    'etiqueta INTEIRA e sensivel a maiuscula ("Extra-PIT" nao acha "extra-pit", e',
    '"Extra" nao acha "Extra-PIT"). E o operador @> do indice GIN: casar pedaco',
    'abandonaria o indice. O filtro SOMA com o ano, nunca o substitui.',
    'Campos de pedido civil (canal_recebimento_id, municipio, qtd_imagens) ficam nulos',
    'em pedido de OM.',
    'previsto_pit responde se o atendimento estava previsto no PIT do ano; e o que',
    'separa o pedido planejado do pedido de oportunidade nos relatorios.',
    'Excluir um pedido leva junto TODOS os itens dele (o servidor apaga produto_pedido',
    'antes). Nao ha desfazer.'
  ],

  item: [
    'Todo item aponta EXATAMENTE UM produto: uuid_versao (acervo) OU nome_avulso',
    '(descrito ali mesmo, no item). Mandar os dois, ou nenhum, e recusado.',
    'NAO ha catalogo de produto avulso, e nao deve haver. O avulso e impresso de',
    'OCASIAO, e o que merecer cadastro estavel merece estar no acervo. E raro: um ou',
    'dois casos por ano, do tipo papel quadriculado para a Central de Tiro.',
    'O CORTE E DE POSSE, nao de formato: o acervo guarda o que E NOSSO, com versao e',
    'arquivo; o avulso guarda o que SO PASSOU PELA IMPRESSORA.',
    'Folha nossa que ainda nao esta catalogada NAO vira avulso: ela vira item quando',
    'entrar no acervo. Usar avulso ali esconde a lacuna de catalogacao, que e',
    'exatamente o que se quer enxergar.',
    'A dimensao fisica vai em descricao_avulso ("80 x 68 cm, quadricula de 4 x 4 cm").',
    'Essa descricao E PUBLICA: sai na consulta do cliente por localizador.',
    'Um pedido mistura item de acervo e item avulso a vontade. O avulso conta como',
    'entrega normal nos relatorios e no atendimento; nao ha "pedido avulso".',
    'Quando o MI (ou o quadrante) e o NOME se contradizem numa linha do documento, o MI',
    'MANDA. O MI e verificavel contra o acervo; o nome so revela a intencao de quem',
    'digitou. A divergencia vira observacao do item, nunca decisao silenciosa.',
    'Duas linhas do documento que colapsam no MESMO MI sao UM item, com a quantidade',
    'de UMA linha, nao a soma. A duplicata e erro de copia do solicitante, e imprimir o',
    'dobro e o erro caro. Anote as duas linhas na observacao.',
    'No 25k o solicitante costuma escrever o MI da folha 50k mae com o quadrante entre',
    'parenteses no nome ("2962-4 Cerro da Gloria (NE)"): o MI real e 2962-4-NE.',
    'Ao casar a folha com o acervo, vale a versao mais recente por data de edicao QUE',
    'TENHA ARQUIVO. Versao sem arquivo e registro historico (placeholder) e nao serve',
    'para imprimir.',
    'tipo_midia_id 6 (Sulfite 120g) e o padrao do que a mapoteca imprime; so mude com',
    'pedido explicito.',
    'O item NAO tem forma nem data de entrega: as duas sao do PEDIDO (forma_entrega_id',
    'e data_atendimento). Mandar essas chaves no item nao grava nada, e a resposta traz',
    'o aviso de campo ignorado.',
    'quantidade e o que se pediu, e e tambem o que os relatorios contam como entregue:',
    'NAO existe mais `quantidade_fornecida`, podada em 2026-08-08 por ser igual a',
    'quantidade em 1759 de 1759 linhas. O que de fato saiu da impressora e',
    'quantidade_impressa, que vem do lancamento de impressao e nao do item.',
    'tipo_midia_fornecida_id FICOU, e nao caiu junto so por ter sufixo parecido: ele',
    'tem 25 divergencias reais (item pedido em tyvek e atendido em sulfite). Preencha',
    'so quando a midia usada DIFERIR da pedida; nulo quer dizer "saiu como pedido".',
    'producao_especifica marca a folha que precisa ser produzida antes de atender.'
  ],

  cliente: [
    'A base guarda o nome POR EXTENSO ("6o Regimento de Cavalaria Blindado"); o',
    'documento assina a sigla ("6o RCB"). Procure por extenso e por palavra-chave',
    'ANTES de criar, ou a mesma OM entra duas vezes e o historico dela racha em duas.',
    'A sigla e a secao pertencem ao pedido (campo demandante), nao ao nome do cliente.',
    'ponto_contato_principal e o contato PERENE da OM; o contato de um pedido especifico',
    'vai em pedido.ponto_contato.',
    'Nao ha busca no servidor: a listagem devolve todos os clientes e o casamento e do',
    'cliente da API. E o que "mapoteca cliente resolver" faz.',
    'Cliente com pedido associado NAO pode ser excluido: o servidor recusa com 400.'
  ],

  movimento: [
    'O LIVRO e a UNICA porta de escrita do material. O saldo por localizacao e o',
    'ACUMULADO deste livro, aplicado por gatilho: nao ha rota que edite saldo.',
    'Os tres tipos sao as tres coisas que acontecem com o material, e o',
    'tipo_movimento_id decide QUAIS lados a linha tem de ter:',
    '  1 Entrada        chega de fora: SEM origem, COM destino.',
    '  2 Transferencia  muda de lugar: os dois lados, e destino DIFERENTE da origem.',
    '  3 Consumo        acaba: origem = 1 (Secao) e SEM destino.',
    'Consumo so sai da SECAO. As localizacoes sao etapas da vida do material, e nao',
    'prateleiras: consumir de "Saldo no empenho" seria gastar, no papel, o que ainda',
    'esta com o fornecedor. Material no Almoxarifado precisa de uma Transferencia',
    'antes de ser consumido.',
    'NAO EXISTE MOVIMENTO DE AJUSTE. Havia um quarto tipo, Contagem, que lancava a',
    'diferenca entre a prateleira e o sistema, e ele foi extinto em 2026-08-08: o',
    'saldo tem de estar certo por estes tres. Faltou na prateleira material que saiu,',
    'e o lancamento e Consumo; sobrou material que chegou, e e Entrada. A',
    'consequencia foi aceita junto: quebra e extravio entram na 7.2 do RPCMTec como',
    'gasto, porque nao ha mais onde separar um do outro.',
    'LANCAMENTO ERRADO tem outro conserto: edite ou apague a linha errada. Editar ou',
    'excluir um movimento MEXE NO SALDO -- o gatilho desfaz o efeito da linha antiga',
    'e aplica a nova -- e e assim que o saldo volta exato, sem somar ao livro um',
    'evento que nunca aconteceu. Corrigir para mais um consumo que ja esvaziou a',
    'prateleira volta 400 por falta de saldo, e nao e engano.',
    'quantidade e sempre POSITIVA e INTEIRA: o sentido mora em qual lado esta',
    'preenchido, nunca no sinal.',
    'O consumo do RPCMTec (7.2) e do painel e o DECLARADO, ou seja, exatamente o que',
    'for lancado como tipo 3 aqui. Nada e derivado da impressao: produto impresso e',
    'rolo de papel sao coisas separadas desde 2026-08-08.',
    'O banco RECUSA consumo sem saldo na Secao (o saldo nao pode ficar negativo).',
    'Nao ha rota de dominio para os tipos de movimento: os tres codes acima sao a',
    'lista inteira, e a resposta traz tipo_movimento_nome ja resolvido. O code 4',
    'foi a Contagem, extinta em 2026-08-08, e a linha dela saiu do dominio na',
    '1.48.0: nao ha banco nenhum com movimento desse tipo para listar.'
  ],

  estoque: [
    'SO LEITURA. O saldo e derivado do livro de movimentos, e as rotas que o',
    'escreviam (POST, PUT, DELETE e POST /estoque_material/transferir) sairam em',
    '2026-08-08. Para mudar saldo, lance um movimento: mapoteca schema movimento.',
    'Uma linha por par (material, localizacao), e so as que existem: material sem',
    'saldo em lugar nenhum nao aparece aqui, e aparece em tipo_material com zero.',
    'O saldo guarda so o dia de HOJE, sem historico mensal. Quem quer o passado le o',
    'livro por data (mapoteca movimento listar --data_inicio ... --data_fim ...).'
  ],

  tipo_material: [
    'A UNIDADE VAI NO NOME, e nao em coluna propria: "Papel Sulfite 120g" sao rolos',
    'de 50 m e "Cartucho MK - T730" e unidade avulsa. O nome e UNICO no banco.',
    'estoque_minimo alimenta o alerta de reposicao e compara contra o DISPONIVEL',
    '(Secao + Almoxarifado), nunca contra o total: o que esta em "Aquisicao realizada"',
    'ou em "Saldo no empenho" foi comprado e ainda nao chegou aqui.',
    'A listagem devolve estoque_disponivel, estoque_total e abaixo_minimo calculados',
    'do saldo; nenhum dos tres se envia no corpo.',
    'Cadastrar material e de OPERADOR, nao de gerente: quem faz a contagem na',
    'prateleira e quem descobre ali que o cartucho novo ainda nao existe no sistema.',
    'Material com movimento ou com saldo NAO pode ser excluido; desative com',
    'ativo = false.'
  ],

  plotter: [
    'vida_util e em MESES. Plotter inativo continua no historico de manutencao: nao',
    'exclua, marque ativo = false.'
  ],

  manutencao: [
    'O custo de manutencao do ano entra no resumo anual do dashboard; e o numero que',
    'justifica a substituicao do equipamento.'
  ]
}

// Regras que nao pertencem a um recurso, e sim a um verbo do CLI.
const REGRAS_VERBO = {
  resolver: [
    'A busca do acervo (/api/acervo/busca) e por semelhanca (ILIKE): ela devolve o que',
    'CONTEM o termo. O casamento exato do MI e responsabilidade de quem chama, e e o',
    'que este comando faz. MI ambiguo vira aviso e nenhuma escolha, nunca um chute.',
    'O MI precisa ser o completo, com quadrante no 25k (2962-4-NE).',
    'Entre as versoes de um produto, ganha a mais recente por data de edicao COM',
    'arquivo. Uma folha 25k costuma ter varias edicoes historicas sem arquivo.'
  ],

  cadastrar: [
    'Nao ha transacao entre criar o pedido, criar os itens e subir o anexo: sao rotas',
    'distintas. Se algo falhar no meio, o pedido JA existe. Nunca repita o cadastro',
    'inteiro (duplicaria); rode de novo com o mesmo plano, que o comando completa o que',
    'falta em vez de recriar.',
    'A idempotencia se apoia no NUP (ou no numero do documento) para o pedido, e no',
    'uuid_versao para o item.',
    'O nome do arquivo do anexo e o que fica no banco e e por ele que a mapoteca acha o',
    'documento. Renomeie para algo legivel (DIEx_123_6RCB.pdf) ANTES de subir: PDF',
    'baixado de sistema costuma vir com nome opaco.'
  ]
}

module.exports = { REGRAS, GERAL, REGRAS_VERBO }
