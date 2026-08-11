'use strict'

// A ESTRUTURA do RPCMTec: os 33 blocos do documento, em ordem, com quem
// preenche cada um. Eram 34 até 2026-08-08, quando o chefe fundiu a 7.3
// (Tintas) na 7.2 (Papel) e a 7.3 sumiu. Nada foi renumerado.
//
// DEFINIÇÃO ÚNICA. Daqui saem quatro coisas que antes moravam em quatro
// lugares e escorregavam uma da outra:
//
//   o GERADOR      sabe quais subseções ele deve calcular;
//   a TELA         sabe quais campos mostrar e quais deixar editáveis;
//   o PDF          sabe a ordem, os títulos e a grade de coluna;
//   o FECHAMENTO   sabe o que exigir antes de congelar;
//   a AUTORIZAÇÃO  sabe de que módulo é cada subseção (`modulo`, abaixo).
//
// MEDIDO no OOXML de uma edição real, no padrão de nove seções. Título,
// cabeçalho de tabela e grade de coluna são valores LIDOS daquele arquivo, e não
// escolhas nossas: o PDF que o sistema emite tem de ser o documento que a
// Divisão já usa.
//
// AS SEIS DIVERGÊNCIAS DELIBERADAS em relação ao modelo estão marcadas nas
// subseções 2.1, 3.3, 3.4, 6.1 e 7.2 (esta com duas: as cinco colunas, e a fusão
// da antiga 7.3 dentro dela), cada uma com a razão ao lado. As duas mais novas
// são de 2026-08-08: a 2.1 ganhou a coluna "Plano até o mês", e a 3.3 trocou o
// cabeçalho "Qtd" por "Qtd no acervo" porque o número dela mudou de significado.

// Quem preenche. Espelha `dominio.origem_subsecao`.
const ORIGEM = {
  CALCULADA: 1,
  DIGITADA: 2,
  FIXA: 3
}

// O `modulo` de cada subseção: DE QUE ÁREA ela fala, no `nome_abrev` de
// `dominio.modulo`. Entrou em 2026-08-08, quando o chefe recortou a escrita do
// RPCMTec por módulo: LER o relatório inteiro é de qualquer gerente, e ESCREVER
// uma subseção é do gerente do módulo dela. Quem cobra é
// `rpcmtec/verify_modulo_subsecao.js`.
//
// O CRITÉRIO É A ORIGEM DO DADO, e não o número da seção. Por isso a 2.2, a 2.4
// e a 2.7 são do ACERVO embora morem na seção do PIT (o que elas contam sai de
// `acervo.versao` e de `acervo.produto`), e a 3.3 é do PIT embora more na
// seção da Mapoteca (o Extra-PIT é `pit.demanda_extra`). Recortar por seção
// entregaria o Extra-PIT a quem atende balcão e o estado do acervo a quem não
// cataloga nada.
//
// `modulo: null` NÃO é esquecimento: é "de módulo nenhum", e essas ficam com o
// ADMINISTRADOR. São a finalidade (1.1), o desenvolvimento e a TI (5.1 e 5.2), a
// divulgação (8.1 a 8.5) e as lições do chefe (9.1 a 9.3). Nenhuma delas tem
// cadastro em módulo algum do SCA, e não existe módulo de TI nem de comunicação
// social: dar dono a elas por semelhança seria conceder acesso que ninguém
// decidiu conceder. O dia em que uma ganhar cadastro, ela ganha módulo aqui,
// numa linha.
//
// O DIA CHEGOU PARA A 7.1, em 2026-08-08. O equipamento técnico ganhou cadastro
// (o módulo `equipamento`, com `equipamento.indisponibilidade`), e a subseção
// saiu desta lista e virou CALCULADA na mesma linha. Foram duas palavras
// trocadas, e é exatamente o que a frase acima existia para permitir: a previsão
// estava escrita aqui dois meses antes de alguém pedir.
//
// A ORDEM IMPORTA E DERRUBA O BOOT SE INVERTIDA: todo `modulo` não-nulo tem de
// existir no mapa `MODULO` de `login/verify_perfil.js`, e
// `verify_modulo_subsecao.js` confere isso no `require`, e não na primeira
// requisição. `'equipamento'` só pôde entrar aqui depois de `equipamento: 6`
// entrar lá e de `(6, 'Equipamento', 'equipamento')` entrar em `dominio.modulo`.
//
// A CHAVE É OBRIGATÓRIA em toda subseção, inclusive nas de módulo nenhum, e
// `verify_modulo_subsecao.js` recusa CARREGAR se faltar em alguma: sem isso,
// subseção nova nasceria muda e cairia no administrador por omissão, que é
// decisão demais para se tomar por descuido.

// O texto da 1.1, idêntico em todas as edições desde fevereiro/2025 -- salvo o
// nome do Centro, que até 2026-08-09 estava escrito aqui duas vezes.
//
// ESTE ARQUIVO É DE DADOS, e é lido na carga do processo: quando ele é avaliado
// não há requisição, não há conexão com o banco e não há a quem perguntar de
// quem é a instalação. Uma constante não podia continuar contendo o nome, e uma
// consulta aqui dentro seria pior ainda -- ela rodaria uma vez, no `require`, e
// congelaria o nome até alguém reiniciar o serviço.
//
// A SAÍDA SÃO DOIS MARCADORES, e o texto continua sendo uma cadeia constante. O
// nome entra na MONTAGEM da edição (`rpcmtec_edicao_ctrl.montar`), que é onde já
// existe requisição, banco e instituição lida. Ver `aplicarInstituicao`, logo
// abaixo, que é o único lugar que os troca.
//
// OS DOIS MARCADORES SÃO ESTES, e a lista não é aberta: `{nome}` é o nome por
// extenso e `{sigla}` é a sigla, os dois de `dgeo.instituicao`. Marcador
// escrito errado não vira erro, vira chave impressa no documento -- e é por isso
// que ele mora ao lado do texto que o usa, e não numa convenção espalhada.
const TEXTO_FINALIDADE =
  'O Relatório de Prestação de Contas Mensal Técnico (RPCMTec) é um ' +
  'instrumento de avaliação da gestão que permite ao Chefe do {nome} ' +
  '({sigla}) verificar, mensalmente, as ações e ' +
  'responsabilidades dos integrantes da Divisão de Geoinformação, o ' +
  'cumprimento de normas, planos e diretrizes, visando à efetividade, ' +
  'economicidade, eficiência e eficácia na execução das atividades ' +
  'finalísticas do {sigla}.'

/**
 * Troca os marcadores de um texto FIXO pelo nome e pela sigla da instituição.
 *
 * SÓ VALE PARA A ORIGEM FIXA. A digitada é texto de pessoa, e trocar `{nome}` no
 * que alguém escreveu à mão seria uma substituição que ninguém pediu; a
 * calculada não tem prosa.
 *
 * NA MONTAGEM, E NÃO NO FECHAMENTO -- e o fechamento, mesmo assim, congela o
 * texto JÁ TROCADO, porque ele grava o que a montagem devolveu. É o desejado: a
 * edição fechada guarda o nome que o documento afirmava quando foi assinado, e
 * um Centro que se renomeie depois não reescreve o passado.
 *
 * @param {string|null} texto
 * @param {{nome: string, sigla: string}} instituicao
 * @returns {string|null}
 */
const aplicarInstituicao = (texto, instituicao) => {
  if (texto == null) return texto

  return String(texto)
    .replace(/\{nome\}/g, instituicao.nome)
    .replace(/\{sigla\}/g, instituicao.sigla)
}

// Cabeçalhos que se repetem entre subseções. Escritos uma vez, porque duas
// cópias divergem na primeira coluna que for acrescentada a uma só.
const COLUNAS_CREDITO = ['NC', 'NE', 'ND', 'Finalidade', 'Valor NC',
  'Valor Empenhado', 'Valor Liquidado', 'Valor Recolhido']
const COLUNAS_LICITACAO = ['Objeto da Licitação', 'Fase Atual',
  'Valor Total Estimado da Licitação', 'Valor Final Homologado']
const COLUNAS_INSUMO = ['Insumo', 'Estoque atual', 'Estoque mês anterior',
  'Consumo no mês', 'Previsão de falta de estoque']
const COLUNAS_BI = ['Resumo', 'Militares', 'Dados do BI']

// A grade de coluna, em twip, COPIADA do modelo. Elas não são proporcionais
// entre si: a "Finalidade" da 4.2 é larga porque o texto é longo, e a "Qtd" da
// 3.3 é estreita porque cabe um número.
const SECOES = [
  {
    numero: 1,
    titulo: '1. FINALIDADE',
    subsecoes: [
      {
        numero: '1.1',
        modulo: null,
        // SEM título: no documento a 1.1 é o próprio parágrafo, e não um
        // rótulo seguido de texto. O desenhador imprime "1.1. O Relatório...".
        titulo: null,
        origem: ORIGEM.FIXA,
        texto: true,
        conteudo: TEXTO_FINALIDADE
      }
    ]
  },
  {
    numero: 2,
    titulo: '2. EXECUÇÃO DO PIT',
    subsecoes: [
      {
        numero: '2.1',
        modulo: 'pit',
        titulo: 'Estado Atual do PIT',
        origem: ORIGEM.CALCULADA,
        fonte: 'pit.meta_vigente e pit.execucao',
        pendencia: 'Nenhum lançamento de meta no mês',
        // OITO colunas, e o modelo tem sete. É a QUINTA divergência deliberada,
        // decidida pelo chefe em 2026-08-08: entrou "Plano até o mês".
        //
        // O NÚMERO JÁ EXISTIA E SE PERDIA. `resumoDoAno` calcula `planejado_ate`
        // com o comentário "é o que separa 'entregou 30 de 252' de 'entregou 30
        // onde o plano pedia 30'", o `pit_cli` o imprimia, e o documento
        // que o chefe assina, não. Sem ele a 2.1 só sabe comparar o mês contra a
        // promessa do ANO, e em agosto toda meta parece atrasada.
        //
        // A POSIÇÃO É AO LADO DE "Prontos", e não no fim da tabela. O plano só
        // significa alguma coisa encostado no realizado do MESMO recorte: os
        // dois são acumulados de janeiro até o mês da edição, e lê-se um contra
        // o outro. Pô-lo depois de "Previsão de término" deixaria uma coluna de
        // data entre os dois números que se comparam, e a leitura morreria ali.
        // As sete colunas do modelo continuam na ordem do modelo: a nova é
        // INSERIDA antes da última, e nenhuma trocou de lugar.
        //
        // "Plano", e não "Planejado" nem "Previsto". `quantidade_prevista` é a
        // promessa do ano, que já é a coluna "Quantidade": chamar a nova de
        // "Previsto" faria duas colunas com o mesmo nome dizerem números
        // diferentes. "Planejado" seria fiel a `quantidade_planejada`, mas a
        // palavra sozinha ocupa 1.077 twip em Carlito 12 negrito e não cabe numa
        // coluna de número sem roubar largura de quem tem texto. (A MEDIDA É DE
        // 2026-08-08: em 2026-08-11 o cabeçalho da tabela desceu para 10 e o PDF
        // trocou de fonte, e a folga é outra. A grade não mudou.)
        cabecalhos: ['Meta', 'Item', 'Produto ou serviço', 'Quantidade',
          'Prontos no mês', 'Prontos', 'Plano até o mês', 'Previsão de término'],
        // A GRADE FOI REFEITA, e não acrescida: a soma é a LARGURA DA TABELA na
        // página do modelo, e ela continua 10155 twip, como antes da coluna
        // nova. Os 1005 twip dela saíram de quem tinha folga -- 705 de "Produto
        // ou serviço", que é prosa e reflui, 150 de "Previsão de término", que
        // guarda 'AGO 26', e 150 de "Item", que guarda '1.10'.
        //
        // O QUE NÃO CEDEU, e por quê: "Meta" (1665) mal comporta
        // 'Desenvolvimento' e já estoura em 'Aerolevantamento'; "Quantidade"
        // (1425) tem 19 twip de sobra sobre o próprio cabeçalho; e as duas de
        // "Prontos" (1005 e 1035) têm 38 e 68. Encolher qualquer uma dessas
        // quatro quebra o cabeçalho ou a palavra dentro da célula.
        grade: [1665, 675, 2130, 1425, 1005, 1035, 1005, 1215]
      },
      {
        numero: '2.2',
        modulo: 'acervo',
        titulo: 'Totais do Mês e do Ano',
        // CALCULADA desde 2026-08-05. Ela era digitada com fonte 'SAP', e nao
        // precisava ser: o que ela conta e a versao REGULAR que ficou pronta no
        // mes, e isso o acervo sabe sozinho. Enquanto foi digitada, o numero do
        // relatorio e o do acervo podiam divergir sem nada acusar.
        origem: ORIGEM.CALCULADA,
        fonte: 'acervo.versao, tipo Regular, por mes de edicao',
        pendencia: 'Nenhum produto concluído no mês',
        cabecalhos: ['Tipo de produto', 'Quantidade no mês', 'Quantidade no ano'],
        grade: [4965, 2370, 2520]
      },
      {
        numero: '2.3',
        modulo: 'pit',
        titulo: 'Execução por Lote de Produção',
        origem: ORIGEM.DIGITADA,
        fonte: 'SAP',
        cabecalhos: ['Lote SAP', 'Número de Produtos', 'Número de operadores',
          'Percentual concluído'],
        grade: [3210, 2025, 2400, 2205]
      },
      {
        numero: '2.4',
        modulo: 'acervo',
        titulo: 'Entregas detalhada de produtos finais (BDGEx, IGW, EBGeo) no mês',
        // CALCULADA desde 2026-08-05, pela mesma razao da 2.2. O identificador
        // que a coluna 'UUID BDGEx' pede E o `uuid_versao`: e com ele que o
        // produto e publicado la, e nao ha um segundo identificador a guardar.
        //
        // Desde 2026-08-07 ela lista so o que foi ENTREGUE, e nao tudo o que
        // ficou pronto: entra a versao com arquivo carregado (BDGEx, IGW ou
        // GEDW). Divergir da 2.2 ao lado passa a ser o esperado, e a diferenca
        // entre as duas e a fila de carga.
        origem: ORIGEM.CALCULADA,
        fonte: 'acervo.versao Regular, por mes de edicao, so a que tem arquivo carregado',
        pendencia: 'Nenhuma entrega no mês',
        cabecalhos: ['Tipo produto', 'Escala', 'UUID BDGEx', 'Identificador',
          'Meta PIT', 'Lote SAP'],
        grade: [1740, 1050, 2535, 1560, 1440, 1485]
      },
      {
        numero: '2.5',
        modulo: 'pit',
        titulo: 'Atividades de campo',
        // CALCULADA desde 2026-08-08, e DIGITADA (fonte 'SAP') até ali. Todo mês
        // alguém abria a tela do SAP e transcrevia estas linhas a mão. Com o
        // schema `campo` no banco, elas saem do cadastro e o número do relatório
        // deixa de poder divergir dele sem nada acusar. É o mesmo movimento que
        // tirou a 2.2 e a 2.4 da digitação em 2026-08-05, e a 7.1 e a 3.x com o
        // módulo `equipamento`.
        //
        // O RECORTE É O MÊS INTEIRO, e não um dia: campo é um INTERVALO, e a
        // pergunta da subseção é "que atividade de campo houve em julho".
        // Um campo que atravessa a virada do mês aparece nas DUAS edições, e é
        // o certo -- ele estava acontecendo nos dois.
        //
        // O CABEÇALHO E A GRADE NÃO MUDARAM, e não é sorte: são os do modelo da
        // Divisão. O que mudou foi de onde vem a linha.
        origem: ORIGEM.CALCULADA,
        fonte: 'campo.campo, pelo período que cruza o mês, exceto o cancelado',
        pendencia: 'Nenhuma atividade de campo no mês',
        cabecalhos: ['Local', 'Data', 'Finalidade Campo', 'Efetivo'],
        grade: [2715, 2250, 2985, 1890]
      },
      {
        numero: '2.6',
        modulo: 'pit',
        titulo: 'Capacitações externas',
        origem: ORIGEM.CALCULADA,
        fonte: 'rpcmtec.capacitacao, tipo Ministrada',
        pendencia: 'Nenhuma capacitação ministrada concluída no mês',
        cabecalhos: ['Capacitação', 'Período', 'Instituições participantes',
          'Efetivo capacitado'],
        grade: [2160, 2385, 3015, 2205]
      },
      {
        numero: '2.7',
        modulo: 'acervo',
        titulo: 'Estado do Acervo',
        origem: ORIGEM.CALCULADA,
        fonte: 'acervo.produto recortado pela área de suprimento',
        pendencia: 'Nenhum produto no acervo',
        cabecalhos: ['Escala', 'Tipo de produto', 'Total catalogado',
          'Catalogo no mês', 'Universo da ASC', '% da ASC'],
        grade: [1380, 1755, 2070, 1515, 1515, 1515]
      }
    ]
  },
  {
    numero: 3,
    titulo: '3. MAPOTECA',
    subsecoes: [
      {
        numero: '3.1',
        modulo: 'mapoteca',
        titulo: 'Totais do Mês e do Ano',
        origem: ORIGEM.CALCULADA,
        fonte: 'mapoteca.pedido',
        pendencia: 'Nenhum pedido da mapoteca no mês',
        cabecalhos: ['Indicador', 'Total no mês', 'Total no ano'],
        grade: [5010, 2580, 2175]
      },
      {
        numero: '3.2',
        modulo: 'mapoteca',
        titulo: 'Entregas da mapoteca',
        origem: ORIGEM.CALCULADA,
        fonte: 'mapoteca.pedido, cliente militar',
        pendencia: 'Nenhuma entrega a OM no mês',
        cabecalhos: ['Solicitante', 'Documento de solicitação', 'Quantidade',
          'Situação'],
        grade: [2040, 3345, 2010, 2415]
      },
      {
        numero: '3.3',
        modulo: 'pit',
        titulo: 'Extra-PIT',
        origem: ORIGEM.CALCULADA,
        fonte: 'pit.demanda_extra',
        pendencia: 'Nenhuma demanda Extra-PIT no mês',
        // "Qtd no acervo", e o modelo escreve "Qtd". O cabeçalho mudou porque o
        // NÚMERO mudou, por decisão do chefe em 2026-08-08: a coluna imprimia
        // `demanda_extra.quantidade`, que é o que a demanda DECLARA, e passou a
        // imprimir `quantidade_materializada`, que é a contagem real de
        // `acervo.versao.demanda_extra_id`. Na produção, a 3.3 de abril de 2026
        // afirmava 76 produtos onde o acervo tinha 26.
        //
        // O CABEÇALHO TINHA DE MUDAR JUNTO. "Qtd" sobre um número que deixou de
        // ser a quantidade pedida mente de outro jeito, e mais caro: ninguém
        // desconfia de um rótulo que continua o de sempre. "Qtd no acervo" diz o
        // que se conta e onde, e é a mesma palavra que a tela do Extra-PIT usa
        // na coluna irmã ('No acervo', em `pages/extra-pit/list.js`).
        //
        // O PREÇO, e ele é real: a demanda de origem MANUAL não tem versão para
        // contar, e sai 0. Na produção são 8 das 12 demandas com entrega, e as
        // edições de fevereiro, março e junho de 2026 sairiam com a coluna toda
        // zerada. O 0 é verdade sobre o ACERVO e não sobre o trabalho, e quem
        // decide se isso basta é o chefe -- está registrado aqui para a próxima
        // pessoa não tomar por descuido.
        cabecalhos: ['Demandante', 'Tipo de produto', 'Qtd no acervo',
          'Situação', 'Documento autorização', 'Descrição'],
        // A soma continua 9825, a largura da tabela no modelo. Os 630 twip da
        // antiga "Qtd" não comportam a palavra 'acervo' (701 twip em Carlito 12
        // negrito, mais 126 de recuo -- medida de 2026-08-08, antes de o
        // cabeçalho da tabela cair para 10), então a coluna foi a 945 e os 315 saíram
        // de "Descrição", a única com folga: "Demandante" tem 110 twip de sobra
        // sobre o próprio cabeçalho e "Documento autorização", 113.
        grade: [1590, 1575, 945, 1215, 1455, 3045]
      },
      {
        numero: '3.4',
        modulo: 'mapoteca',
        titulo: 'LAI e atendimento à órgãos públicos',
        origem: ORIGEM.CALCULADA,
        fonte: 'mapoteca.pedido, cliente civil e órgão público',
        pendencia: 'Nenhum pedido de LAI ou de órgão público no mês',
        // QUATRO colunas, e o modelo tem três: saiu o "Documento de
        // solicitação", que é o DIEx de encaminhamento da DSG e não identifica
        // a manifestação, e entraram o NUP do Fala.BR e a descrição do que a
        // pessoa pediu. A largura total continua a do modelo, 9825, para a
        // tabela nascer do tamanho das vizinhas.
        cabecalhos: ['Solicitante', 'Código da LAI (NUP)', 'Descrição', 'Situação'],
        grade: [2040, 2400, 3200, 2185]
      }
    ]
  },
  {
    numero: 4,
    titulo: '4. EXECUÇÃO DO PDR',
    subsecoes: [
      {
        numero: '4.1',
        modulo: 'orcamento',
        titulo: 'Execução por ND',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.pdr_item e orcamento.nota_credito',
        pendencia: 'Nenhum item de PDR com crédito',
        // "Valor previsto", e nao mais "Valor previsto (Prioridade 1)". O
        // cabeçalho afirmava um recorte que a consulta NUNCA fez: ela soma todo
        // `pdr_item.valor_autorizado` do ano, sem filtro de prioridade nenhum.
        // A prioridade nem sequer existia em `pdr_item` -- ela morava em `dfd`,
        // preenchida em 1 linha de 8, e saiu na 1.43.0 junto com
        // `dominio.grau_prioridade`. Decisão do chefe em 2026-08-08: o cabeçalho
        // passa a dizer o que a consulta faz, e não o contrário. A GRADE não
        // muda: as larguras são as do modelo da Divisão, e a tabela tem de
        // continuar colável na subseção de mesmo número.
        cabecalhos: ['ND', 'Valor previsto', 'Valor recebido',
          'Valor empenhado', 'Valor liquidado total', 'Valor Recolhido'],
        grade: [1388, 2151, 1388, 1638, 1638, 1638]
      },
      {
        numero: '4.2',
        modulo: 'orcamento',
        titulo: 'Situação dos créditos recebidos',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.nota_credito, classificação PDR',
        pendencia: 'Nenhuma nota de crédito do PDR',
        cabecalhos: COLUNAS_CREDITO,
        grade: [855, 855, 840, 2865, 1125, 1170, 1140, 945]
      },
      {
        numero: '4.3',
        modulo: 'orcamento',
        titulo: 'Situação RPNP',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.rpnp',
        pendencia: 'Nenhum RPNP cadastrado',
        cabecalhos: ['Empenho', 'Finalidade', 'Valor Empenhado', 'Valor a liquidar'],
        grade: [2040, 2670, 2100, 3000]
      },
      {
        numero: '4.4',
        modulo: 'orcamento',
        titulo: 'GCALC DSG',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.licitacao, tipo GCALC DSG',
        pendencia: 'Nenhuma licitação GCALC DSG cadastrada',
        cabecalhos: COLUNAS_LICITACAO,
        grade: [2340, 3150, 2145, 2205]
      },
      {
        numero: '4.5',
        modulo: 'orcamento',
        titulo: 'Demais Licitações da atividade-fim',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.licitacao, tipos Própria e Participante',
        pendencia: 'Nenhuma licitação própria ou como participante',
        cabecalhos: COLUNAS_LICITACAO,
        grade: [2535, 2955, 2145, 2205]
      },
      {
        numero: '4.6',
        modulo: 'orcamento',
        titulo: 'Recebimento de material',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.recebimento_material',
        pendencia: 'Nenhum recebimento de material no mês',
        cabecalhos: ['Empenho', 'Material', 'Prazo de entrega', 'Situação'],
        grade: [1965, 2685, 1755, 3435]
      },
      {
        numero: '4.7',
        modulo: 'orcamento',
        titulo: 'Situação de créditos Extra-PDR',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.nota_credito, classificação Extra-PDR',
        pendencia: 'Nenhuma nota de crédito Extra-PDR',
        cabecalhos: COLUNAS_CREDITO,
        grade: [855, 870, 840, 2295, 1185, 1245, 1485, 1050]
      }
    ]
  },
  {
    numero: 5,
    // O 'e' minúsculo é do documento.
    titulo: '5. DESENVOLVIMENTO e TI',
    subsecoes: [
      {
        numero: '5.1',
        modulo: null,
        titulo: 'Repositórios trabalhados (https://1cgeo.github.io/github_dashboard/)',
        origem: ORIGEM.DIGITADA,
        fonte: 'CLI do github_dashboard',
        cabecalhos: ['Repositório', 'Número de commits no período', 'Efetivo',
          'Resumo'],
        grade: [2705, 1695, 2705, 2705]
      },
      {
        numero: '5.2',
        modulo: null,
        titulo: 'Backup',
        origem: ORIGEM.DIGITADA,
        cabecalhos: ['Dado ou sistema', 'Último backup completo',
          'Total em Gb de backup', 'Espaço disponível para backup em Gb'],
        grade: [2700, 1830, 2565, 2700]
      }
    ]
  },
  {
    numero: 6,
    titulo: '6. RECURSOS HUMANOS',
    subsecoes: [
      {
        numero: '6.1',
        modulo: 'efetivo',
        titulo: 'Aproveitamento do efetivo',
        origem: ORIGEM.CALCULADA,
        fonte: 'dgeo.efetivo_periodo e dgeo.impedimento',
        pendencia: 'Nenhum período de efetivo cadastrado',
        // TRÊS colunas, e o modelo tem duas: uma tabela de aproveitamento sem
        // o aproveitamento não responde nada. A largura total continua a do
        // modelo, e a coluna do meio cede o espaço porque é a única que é prosa.
        cabecalhos: ['Militar', 'Atividades', 'Aproveitamento'],
        grade: [2310, 6015, 1500]
      },
      {
        numero: '6.2',
        modulo: 'efetivo',
        titulo: 'Capacitação do efetivo',
        origem: ORIGEM.CALCULADA,
        fonte: 'rpcmtec.capacitacao, tipo Recebida',
        pendencia: 'Nenhuma capacitação recebida concluída no mês',
        cabecalhos: ['Plano / Código', 'Capacitação', 'Instituição', 'Militar'],
        grade: [2310, 2415, 2325, 2835]
      }
    ]
  },
  {
    numero: 7,
    titulo: '7. EQUIPAMENTO E MATERIAL',
    subsecoes: [
      {
        numero: '7.1',
        modulo: 'equipamento',
        titulo: 'Equipamento Técnico Indisponível',
        // CALCULADA desde 2026-08-08, e de módulo nenhum até ali. Ela era
        // digitada porque não havia de onde ler: o material permanente da
        // Divisão vivia numa PLANILHA, e a lista mensal era redigitada a mão
        // dentro do relatório. Com o módulo `equipamento` e a tabela
        // `equipamento.indisponibilidade`, ela sai do banco, e o número do
        // relatório deixa de poder divergir do cadastro sem nada acusar. É a
        // mesma razão que tirou a 2.2 e a 2.4 do 'SAP' em 2026-08-05.
        //
        // O CABEÇALHO E A GRADE NÃO MUDARAM, e não é sorte: são os do modelo da
        // Divisão, e o DDL foi DERIVADO deles -- `data_inicio`, `motivo` e
        // `previsao_retorno` nasceram com o nome da coluna do documento. Esta
        // subseção não tem divergência deliberada nenhuma.
        //
        // O RECORTE É O ÚLTIMO DIA DO MÊS, e não qualquer dia dele (decisão do
        // chefe). Ele DIVERGE da 6.1, que recorta por interseção com o mês
        // inteiro, e a divergência é deliberada: ver o comentário da consulta em
        // `rpcmtec_ctrl.js` e o registro em `docs/decisoes.md`.
        origem: ORIGEM.CALCULADA,
        fonte: 'equipamento.indisponibilidade aberta no último dia do mês',
        pendencia: 'Nenhum equipamento indisponível no último dia do mês',
        cabecalhos: ['Equipamento', 'Data indisponibilidade',
          'Motivo indisponibilidade', 'Previsão de retorno'],
        grade: [2265, 2145, 3300, 2160]
      },
      {
        numero: '7.2',
        modulo: 'mapoteca',
        // UMA TABELA DE INSUMOS, e o modelo tem duas ("- Papel" e "- Tintas").
        // É a QUARTA divergência deliberada, decidida pelo chefe em 2026-08-08,
        // e a 7.3 SUMIU: nada foi renumerado, e a seção 7 passou a ser 7.1
        // Equipamento e 7.2 Insumos.
        //
        // A separação exigia uma coluna (`tipo_material.categoria_id`) cuja
        // única função era escolher em qual das duas tabelas a linha sairia. Ela
        // classificava para um recorte que o documento não usava para nada: as
        // duas tinham as MESMAS cinco colunas, a mesma grade e a mesma fonte, e
        // ninguém olha "só as tintas". Uma coluna que só pode errar, e que erra
        // calada, não paga uma quebra de tabela.
        //
        // TODO MATERIAL ATIVO entra, e não só o insumo de impressão. O cabeçote
        // acaba do mesmo jeito que o cartucho, e ficar de fora por ser "peça"
        // era decisão que se tomava no cadastro e se descobria no relatório.
        //
        // PENDÊNCIA CONHECIDA, e ela nasceu com a fusão: a coluna "Estoque
        // atual" agora soma ROLO e CARTUCHO. O total da coluna não tem
        // significado físico, e cada LINHA continua tendo. O conserto, se um dia
        // incomodar, é a unidade virar dado -- não a tabela voltar a se partir.
        titulo: 'Estoque de Insumos de Impressão',
        origem: ORIGEM.CALCULADA,
        pendencia: 'Nenhum insumo de impressão cadastrado',
        // O CONSUMO É O DECLARADO, e só ele. Este texto dizia "consumo das
        // impressões" até 2026-08-08: era o que valia antes de 2026-08-07,
        // quando o chefe desfez a derivação, e ficou aqui apontando uma fonte
        // que o gerador já não usava.
        //
        // "Estoque atual" conta SÓ Seção + Almoxarifado: 'Aquisição realizada' e
        // 'Saldo no empenho' são material comprado e ainda não entregue, e
        // somá-los reportaria como estoque a resma que está com o fornecedor.
        fonte: 'estoque na Seção e no Almoxarifado, estoque do mês anterior, consumo declarado em mapoteca.movimento_material',
        // CINCO colunas, e o modelo da tabela de tintas tinha oito: lá elas se
        // abriam em uma coluna por plotter (HP 70, HP 72, HP 730), e aqui cada
        // cartucho é uma LINHA de `mapoteca.tipo_material`.
        cabecalhos: COLUNAS_INSUMO,
        grade: [3374, 1554, 1554, 1491, 1896]
      }
    ]
  },
  {
    numero: 8,
    titulo: '8. DIVULGAÇÃO DAS ATIVIDADES',
    subsecoes: [
      {
        numero: '8.1',
        modulo: null,
        titulo: 'Publicações em BI das atividades e metas de produção concluídas',
        origem: ORIGEM.DIGITADA,
        cabecalhos: COLUNAS_BI,
        grade: [2730, 5100, 2055]
      },
      {
        numero: '8.2',
        modulo: null,
        titulo: 'Publicações em BI das atividades de desenvolvimento',
        origem: ORIGEM.DIGITADA,
        cabecalhos: COLUNAS_BI,
        grade: [3615, 2415, 3855]
      },
      {
        numero: '8.3',
        modulo: null,
        titulo: 'Relatórios, Ordens de Instrução e Ordens de Serviço',
        origem: ORIGEM.DIGITADA,
        fonte: 'doc_dgeo, página índice de relatórios',
        cabecalhos: ['Identificação', 'Título'],
        grade: [4470, 5400]
      },
      {
        numero: '8.4',
        modulo: null,
        titulo: 'Matérias de comunicação social',
        origem: ORIGEM.DIGITADA,
        cabecalhos: ['Título', 'Link de acesso'],
        grade: [3615, 6240]
      },
      {
        numero: '8.5',
        modulo: null,
        titulo: 'Artigos publicados e apresentações em congressos/conferências/etc',
        origem: ORIGEM.DIGITADA,
        cabecalhos: ['Título', 'Evento', 'Data', 'Militares'],
        grade: [2050, 2288, 2773, 2773]
      }
    ]
  },
  {
    numero: 9,
    titulo: '9. BOAS PRÁTICAS, LIÇÕES APRENDIDAS E OPORTUNIDADES DE MELHORIA',
    subsecoes: [
      { numero: '9.1', modulo: null, titulo: 'Boas práticas', origem: ORIGEM.DIGITADA, texto: true },
      { numero: '9.2', modulo: null, titulo: 'Lições aprendidas', origem: ORIGEM.DIGITADA, texto: true },
      { numero: '9.3', modulo: null, titulo: 'Oportunidade de melhoria', origem: ORIGEM.DIGITADA, texto: true }
    ]
  }
]

// A lista plana, na ordem do documento, com a seção de cada bloco ao lado. É o
// que a edição grava: `ordem` e `secao_titulo` viram coluna em
// `rpcmtec.subsecao`, porque a estrutura MUDA (entre janeiro e julho de 2026 o
// RPCMTec passou de seis para nove seções) e a edição fechada tem de se
// desenhar com a estrutura que ela teve.
const BLOCOS = []
for (const secao of SECOES) {
  for (const sub of secao.subsecoes) {
    BLOCOS.push({
      ...sub,
      secaoNumero: secao.numero,
      secaoTitulo: secao.titulo,
      ordem: BLOCOS.length + 1
    })
  }
}

const PORNUMERO = new Map(BLOCOS.map(b => [b.numero, b]))

const bloco = numero => PORNUMERO.get(numero) || null

// As subseções que o gerador tem de saber calcular. Um número novo aqui sem
// implementação no gerador vira lacuna visível na tela, e não tabela ausente.
const NUMEROS_CALCULADOS = BLOCOS
  .filter(b => b.origem === ORIGEM.CALCULADA)
  .map(b => b.numero)

// As que o gestor preenche, e cuja ausência o fechamento recusa.
const NUMEROS_DIGITADOS = BLOCOS
  .filter(b => b.origem === ORIGEM.DIGITADA)
  .map(b => b.numero)

// `SECOES` e `TEXTO_FINALIDADE` saíram daqui: eram exportados e ninguém os lia
// fora deste arquivo, nem em teste. `SECOES` é a fonte de que `BLOCOS` deriva
// (o laço logo acima), e `BLOCOS` é o que o resto do sistema consome;
// `TEXTO_FINALIDADE` é usado uma vez, dentro da própria declaração de `SECOES`.
// Export sem leitor é contrato que ninguém honra e que trava a refatoração.
module.exports = {
  ORIGEM,
  BLOCOS,
  NUMEROS_CALCULADOS,
  NUMEROS_DIGITADOS,
  bloco,
  aplicarInstituicao
}
