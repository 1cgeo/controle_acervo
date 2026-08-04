'use strict'

// A ESTRUTURA do RPCMTec: os 34 blocos do documento, em ordem, com quem
// preenche cada um.
//
// DEFINIÇÃO ÚNICA. Daqui saem quatro coisas que antes moravam em quatro
// lugares e escorregavam uma da outra:
//
//   o GERADOR      sabe quais subseções ele deve calcular;
//   a TELA         sabe quais campos mostrar e quais deixar editáveis;
//   o PDF          sabe a ordem, os títulos e a grade de coluna;
//   o FECHAMENTO   sabe o que exigir antes de congelar.
//
// Até 2026-08-05 os títulos e os cabeçalhos estavam escritos dentro do
// `gerar()` e as grades dentro do gerador de DOCX, e as subseções que o SCA não
// calculava não existiam em lugar nenhum -- quem montava o relatório abria o
// Word e preenchia as doze restantes lá. Agora o documento inteiro é
// preenchido e guardado no sistema (decisão do chefe, 2026-08-05).
//
// MEDIDO no OOXML da edição de julho/2026, que é a primeira no padrão de nove
// seções. Título, cabeçalho de tabela e grade de coluna são valores LIDOS
// daquele arquivo, não escolhas nossas: o PDF que o sistema emite tem de ser o
// documento que a Divisão já usa.
//
// AS TRÊS DIVERGÊNCIAS DELIBERADAS em relação ao modelo estão marcadas nas
// subseções 3.4, 6.1 e 7.3, cada uma com a razão ao lado.

// Quem preenche. Espelha `dominio.origem_subsecao`.
const ORIGEM = {
  CALCULADA: 1,
  DIGITADA: 2,
  FIXA: 3
}

// O texto da 1.1, idêntico em todas as edições desde fevereiro/2025.
const TEXTO_FINALIDADE =
  'O Relatório de Prestação de Contas Mensal Técnico (RPCMTec) é um ' +
  'instrumento de avaliação da gestão que permite ao Chefe do 1º Centro de ' +
  'Geoinformação (1º CGEO) verificar, mensalmente, as ações e ' +
  'responsabilidades dos integrantes da Divisão de Geoinformação, o ' +
  'cumprimento de normas, planos e diretrizes, visando à efetividade, ' +
  'economicidade, eficiência e eficácia na execução das atividades ' +
  'finalísticas do 1º CGEO.'

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
        titulo: 'Estado Atual do PIT',
        origem: ORIGEM.CALCULADA,
        fonte: 'pit.meta_vigente e pit.execucao',
        cabecalhos: ['Meta', 'Item', 'Produto ou serviço', 'Quantidade',
          'Prontos no mês', 'Prontos', 'Previsão de término'],
        grade: [1665, 825, 2835, 1425, 1005, 1035, 1365]
      },
      {
        numero: '2.2',
        titulo: 'Totais do Mês e do Ano',
        origem: ORIGEM.DIGITADA,
        fonte: 'SAP',
        cabecalhos: ['Tipo de produto', 'Quantidade no mês', 'Quantidade no ano'],
        grade: [4965, 2370, 2520]
      },
      {
        numero: '2.3',
        titulo: 'Execução por Lote de Produção',
        origem: ORIGEM.DIGITADA,
        fonte: 'SAP',
        cabecalhos: ['Lote SAP', 'Número de Produtos', 'Número de operadores',
          'Percentual concluído'],
        grade: [3210, 2025, 2400, 2205]
      },
      {
        numero: '2.4',
        titulo: 'Entregas detalhada de produtos finais (BDGEx, IGW, EBGeo) no mês',
        origem: ORIGEM.DIGITADA,
        fonte: 'SAP',
        cabecalhos: ['Tipo produto', 'Escala', 'UUID BDGEx', 'Identificador',
          'Meta PIT', 'Lote SAP'],
        grade: [1740, 1050, 2535, 1560, 1440, 1485]
      },
      {
        numero: '2.5',
        titulo: 'Atividades de campo',
        origem: ORIGEM.DIGITADA,
        fonte: 'SAP',
        cabecalhos: ['Local', 'Data', 'Finalidade Campo', 'Efetivo'],
        grade: [2715, 2250, 2985, 1890]
      },
      {
        numero: '2.6',
        titulo: 'Capacitações externas',
        origem: ORIGEM.CALCULADA,
        fonte: 'rpcmtec.capacitacao, tipo Ministrada',
        cabecalhos: ['Capacitação', 'Período', 'Instituições participantes',
          'Efetivo capacitado'],
        grade: [2160, 2385, 3015, 2205]
      },
      {
        numero: '2.7',
        titulo: 'Estado do Acervo',
        origem: ORIGEM.CALCULADA,
        fonte: 'acervo.produto recortado pela área de suprimento',
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
        titulo: 'Totais do Mês e do Ano',
        origem: ORIGEM.CALCULADA,
        fonte: 'mapoteca.pedido',
        cabecalhos: ['Indicador', 'Total no mês', 'Total no ano'],
        grade: [5010, 2580, 2175]
      },
      {
        numero: '3.2',
        titulo: 'Entregas da mapoteca',
        origem: ORIGEM.CALCULADA,
        fonte: 'mapoteca.pedido, cliente militar',
        cabecalhos: ['Solicitante', 'Documento de solicitação', 'Quantidade',
          'Situação'],
        grade: [2040, 3345, 2010, 2415]
      },
      {
        numero: '3.3',
        titulo: 'Extra-PIT',
        origem: ORIGEM.CALCULADA,
        fonte: 'pit.demanda_extra',
        cabecalhos: ['Demandante', 'Tipo de produto', 'Qtd', 'Situação',
          'Documento autorização', 'Descrição'],
        grade: [1590, 1575, 630, 1215, 1455, 3360]
      },
      {
        numero: '3.4',
        titulo: 'LAI e atendimento à órgãos públicos',
        origem: ORIGEM.CALCULADA,
        fonte: 'mapoteca.pedido, cliente civil e órgão público',
        // QUATRO colunas, e o modelo tem três (decisão do chefe, 2026-08-01):
        // saiu o "Documento de solicitação", que é o DIEx de encaminhamento da
        // DSG e não identifica a manifestação, e entraram o NUP do Fala.BR e a
        // descrição do que a pessoa pediu. A largura total continua a do
        // modelo, 9825, para a tabela nascer do tamanho das vizinhas.
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
        titulo: 'Execução por ND',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.pdr_item e orcamento.nota_credito',
        cabecalhos: ['ND', 'Valor previsto (Prioridade 1)', 'Valor recebido',
          'Valor empenhado', 'Valor liquidado total', 'Valor Recolhido'],
        grade: [1388, 2151, 1388, 1638, 1638, 1638]
      },
      {
        numero: '4.2',
        titulo: 'Situação dos créditos recebidos',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.nota_credito, classificação PDR',
        cabecalhos: COLUNAS_CREDITO,
        grade: [855, 855, 840, 2865, 1125, 1170, 1140, 945]
      },
      {
        numero: '4.3',
        titulo: 'Situação RPNP',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.rpnp',
        cabecalhos: ['Empenho', 'Finalidade', 'Valor Empenhado', 'Valor a liquidar'],
        grade: [2040, 2670, 2100, 3000]
      },
      {
        numero: '4.4',
        titulo: 'GCALC DSG',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.licitacao, tipo GCALC DSG',
        cabecalhos: COLUNAS_LICITACAO,
        grade: [2340, 3150, 2145, 2205]
      },
      {
        numero: '4.5',
        titulo: 'Demais Licitações da atividade-fim',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.licitacao, tipo Própria',
        cabecalhos: COLUNAS_LICITACAO,
        grade: [2535, 2955, 2145, 2205]
      },
      {
        numero: '4.6',
        titulo: 'Recebimento de material',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.recebimento_material',
        cabecalhos: ['Empenho', 'Material', 'Prazo de entrega', 'Situação'],
        grade: [1965, 2685, 1755, 3435]
      },
      {
        numero: '4.7',
        titulo: 'Situação de créditos Extra-PDR',
        origem: ORIGEM.CALCULADA,
        fonte: 'orcamento.nota_credito, classificação Extra-PDR',
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
        titulo: 'Repositórios trabalhados (https://1cgeo.github.io/github_dashboard/)',
        origem: ORIGEM.DIGITADA,
        fonte: 'CLI do github_dashboard',
        cabecalhos: ['Repositório', 'Número de commits no período', 'Efetivo',
          'Resumo'],
        grade: [2705, 1695, 2705, 2705]
      },
      {
        numero: '5.2',
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
        titulo: 'Aproveitamento do efetivo',
        origem: ORIGEM.CALCULADA,
        fonte: 'dgeo.efetivo_periodo e dgeo.impedimento',
        // TRÊS colunas, e o modelo tem duas: a de "Aproveitamento" entrou em
        // 2026-08-02, porque uma tabela de aproveitamento sem o aproveitamento
        // é a que o documento tinha e que o chefe pediu para desfazer. A
        // largura total continua a do modelo, e a coluna do meio cede o espaço
        // porque é a única que é prosa.
        cabecalhos: ['Militar', 'Atividades', 'Aproveitamento'],
        grade: [2310, 6015, 1500]
      },
      {
        numero: '6.2',
        titulo: 'Capacitação do efetivo',
        origem: ORIGEM.CALCULADA,
        fonte: 'rpcmtec.capacitacao, tipo Recebida',
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
        titulo: 'Equipamento Técnico Indisponível',
        origem: ORIGEM.DIGITADA,
        cabecalhos: ['Equipamento', 'Data indisponibilidade',
          'Motivo indisponibilidade', 'Previsão de retorno'],
        grade: [2265, 2145, 3300, 2160]
      },
      {
        numero: '7.2',
        titulo: 'Estoque de Insumos de Impressão - Papel',
        origem: ORIGEM.CALCULADA,
        // O consumo do papel é DERIVADO da impressão desde 2026-08-04: cada
        // exemplar gasta uma folha da mídia, e a mídia aponta o papel. Antes
        // disso ele saía só de `consumo_material`, que ninguém preenche, e a
        // coluna dizia 0 com 1.753 impressões registradas.
        fonte: 'estoque atual e do mês anterior, consumo das impressões, projeção pelo ritmo',
        cabecalhos: COLUNAS_INSUMO,
        grade: [3374, 1554, 1554, 1491, 1896]
      },
      {
        numero: '7.3',
        titulo: 'Estoque de Insumos de Impressão - Tintas',
        origem: ORIGEM.CALCULADA,
        // A tinta NÃO se deriva da impressão: quanto de cartucho uma folha
        // gasta depende do que está desenhado nela. O consumo vem da troca
        // DECLARADA, e fica zerado enquanto ninguém a declarar -- o que é
        // diferente de estar errado.
        fonte: 'estoque atual e do mês anterior, consumo declarado em mapoteca.consumo_material',
        // CINCO colunas, e o modelo tem oito: lá as tintas se abriam em uma
        // coluna por plotter (HP 70, HP 72, HP 730), e aqui cada cartucho é
        // uma LINHA de `mapoteca.tipo_material`. Por isso a 7.3 usa a grade da
        // 7.2, que tem as mesmas cinco colunas.
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
        titulo: 'Publicações em BI das atividades e metas de produção concluídas',
        origem: ORIGEM.DIGITADA,
        cabecalhos: COLUNAS_BI,
        grade: [2730, 5100, 2055]
      },
      {
        numero: '8.2',
        titulo: 'Publicações em BI das atividades de desenvolvimento',
        origem: ORIGEM.DIGITADA,
        cabecalhos: COLUNAS_BI,
        grade: [3615, 2415, 3855]
      },
      {
        numero: '8.3',
        titulo: 'Relatórios, Ordens de Instrução e Ordens de Serviço',
        origem: ORIGEM.DIGITADA,
        fonte: 'doc_dgeo, página índice de relatórios',
        cabecalhos: ['Identificação', 'Título'],
        grade: [4470, 5400]
      },
      {
        numero: '8.4',
        titulo: 'Matérias de comunicação social',
        origem: ORIGEM.DIGITADA,
        cabecalhos: ['Título', 'Link de acesso'],
        grade: [3615, 6240]
      },
      {
        numero: '8.5',
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
      { numero: '9.1', titulo: 'Boas práticas', origem: ORIGEM.DIGITADA, texto: true },
      { numero: '9.2', titulo: 'Lições aprendidas', origem: ORIGEM.DIGITADA, texto: true },
      { numero: '9.3', titulo: 'Oportunidade de melhoria', origem: ORIGEM.DIGITADA, texto: true }
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

module.exports = {
  ORIGEM,
  SECOES,
  BLOCOS,
  NUMEROS_CALCULADOS,
  NUMEROS_DIGITADOS,
  TEXTO_FINALIDADE,
  bloco
}
