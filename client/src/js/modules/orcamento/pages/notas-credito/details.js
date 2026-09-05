import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate, formatDateTime, toNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarHistorico } from '@components/historico/historico.js';
import { rotuloMetaPit } from '@services/plataforma-service.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';
import { permissoes } from '@store/auth-store.js';
import {
  getNotaCredito,
  getNotasCredito,
  getRecolhimentos,
  getNotasEmpenho,
} from '@modules/orcamento/services/orcamento-service.js';
import { openRecolhimentosDialog } from './recolhimentos-dialog.js';

/**
 * FICHA DA NOTA DE CRÉDITO (#/orcamento/notas_credito/:id), SOMENTE LEITURA.
 *
 * POR QUE ELA EXISTE. Sete campos da NC não tinham caminho nenhum para quem tem
 * perfil de consulta: `ptres`, `fonte`, `cod_pi`, `doc_ro`,
 * `finalidade_historico` e `observacao` só apareciam no diálogo de EDIÇÃO, que
 * está atrás de `pode.operador` na lista. Medido em 2026-08-08, a única pessoa
 * com perfil no módulo é de CONSULTA: na prática esses campos eram invisíveis
 * para quem usa o sistema.
 *
 * A ficha é a mesma forma da ficha da NE (`notas-empenho/details.js`): cartões
 * de rótulo/valor no topo, tabelas das coisas que se penduram na NC embaixo, e o
 * painel de histórico no fim. Ela NÃO grava nada. Editar continua sendo o
 * diálogo, e lançar recolhimento continua sendo o diálogo de recolhimentos, que
 * esta tela apenas abre.
 *
 * O SALDO E O EMPENHADO NÃO SE CALCULAM AQUI. `GET /notas_credito/:id` não os
 * traz; quem os calcula é a LISTAGEM, com a mesma régua que o servidor usa para
 * barrar um empenho acima do crédito. Por isso a ficha lê a linha desta NC na
 * listagem do ano em vez de refazer a conta: uma segunda conta na tela ficaria
 * livre para prometer crédito que o servidor recusa. Quando essa leitura falha,
 * as duas linhas somem em vez de mostrar um número inventado.
 */

/**
 * Linha rótulo/valor do cartão, com os dois nós guardados para repintura.
 * @param {string} rotulo
 * @param {boolean} [longo] - texto corrido (finalidade, observação): rótulo em
 *   cima e valor à esquerda, senão um parágrafo sai com a margem irregular
 * @returns {{element:HTMLElement, label:HTMLElement, valor:HTMLElement}}
 */
function criarLinha(rotulo, longo = false) {
  const label = el('span', { className: 'detail-card__label', textContent: rotulo });
  const valor = el('span', { className: 'detail-card__value' });
  const className = longo
    ? 'detail-card__row detail-card__row--longo'
    : 'detail-card__row';
  return {
    element: el('div', { className }, [label, valor]),
    label,
    valor,
  };
}

/** Código e nome de um domínio numa célula só ('339039 - Outros serviços'). */
function codigoENome(codigo, nome) {
  if (codigo === null || codigo === undefined || codigo === '') return '-';
  return nome ? `${codigo} - ${nome}` : String(codigo);
}

/**
 * Página de detalhes de uma Nota de Crédito.
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderNotaCreditoDetails(container, { params }) {
  const ncId = Number(params.id);
  let disposed = false;
  // Verdadeiro depois que o esqueleto entra na tela. Separa a PRIMEIRA carga das
  // recargas disparadas por um recolhimento novo.
  let montado = false;
  // Lançar recolhimento é operador; a ficha inteira é de consulta.
  const pode = permissoes('orcamento');
  // A NC corrente, guardada para o botão de recolhimentos, que precisa do
  // número, da ND e da UG para nomear o que está editando.
  let ncAtual = null;

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  const carregando = el('div', {
    className: 'data-table__empty',
    textContent: 'Carregando nota de crédito...',
  });
  root.appendChild(carregando);

  // ---------------------------------------------------------------------------
  // Esqueleto: montado UMA vez, e só repintado dali em diante
  // ---------------------------------------------------------------------------
  const titulo = el('h1', { className: 'page__title' });

  // "VOLTAR" LEVA O ANO DA NC. A lista abre sempre no ano corrente, entao sair
  // da ficha de uma NC de 2025 devolvia a lista de 2026, onde ela nem aparece.
  // O ano so existe depois que a NC carrega, e por isso a rota se monta no
  // CLIQUE, e nao na montagem do cabecalho.
  const rotaDaLista = () => (ncAtual && ncAtual.ano != null
    ? `/orcamento/notas_credito?ano=${ncAtual.ano}`
    : '/orcamento/notas_credito');

  const cabecalho = el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = rotaDaLista(); },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']),
      titulo,
    ]),
  ]);

  const linhaNumero = criarLinha('Número');
  const linhaAno = criarLinha('Ano');
  const linhaEmissao = criarLinha('Data de emissão');
  const linhaUg = criarLinha('UG emitente');
  const linhaNd = criarLinha('Natureza de despesa');
  // OS QUATRO CAMPOS DO SIAFI que só o diálogo de edição mostrava. Eles são o
  // que identifica o crédito dentro do sistema de origem, e sem eles a NC não se
  // acha lá.
  const linhaPtres = criarLinha('PTRES');
  const linhaFonte = criarLinha('Fonte');
  const linhaPi = criarLinha('Plano interno (PI)');
  const linhaDocRo = criarLinha('Documento RO');
  const linhaPrazo = criarLinha('Prazo de empenho');

  const linhaClassificacao = criarLinha('Classificação');
  const linhaMeta = criarLinha('Meta do PIT');
  const linhaComplementada = criarLinha('NC complementada');

  const linhaValor = criarLinha('Valor da NC');
  const linhaRecolhido = criarLinha('Recolhido');
  const linhaEmpenhado = criarLinha('Empenhado');
  const linhaSaldo = criarLinha('Saldo');

  const linhaFinalidade = criarLinha('Finalidade / histórico', true);
  const linhaObservacao = criarLinha('Observação', true);

  const linhaCadastro = criarLinha('Cadastrada em');
  const linhaAlteracao = criarLinha('Alterada em');

  const cartoes = el('div', { className: 'detail-cards' }, [
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados da NC' }),
      linhaNumero.element,
      linhaAno.element,
      linhaEmissao.element,
      linhaUg.element,
      linhaNd.element,
      linhaPtres.element,
      linhaFonte.element,
      linhaPi.element,
      linhaDocRo.element,
      linhaPrazo.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Valores' }),
      linhaValor.element,
      linhaRecolhido.element,
      linhaEmpenhado.element,
      linhaSaldo.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Classificação' }),
      linhaClassificacao.element,
      linhaMeta.element,
      linhaComplementada.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Textos' }),
      linhaFinalidade.element,
      linhaObservacao.element,
    ]),
    el('div', { className: 'detail-card' }, [
      // SEM "por quem": `GET /notas_credito/:id` devolve o UUID do usuário, e
      // não o nome, e um UUID na tela não responde a pergunta. Quem fez cada
      // coisa está no painel de histórico, com o nome e o que mudou.
      el('div', { className: 'detail-card__title', textContent: 'Registro' }),
      linhaCadastro.element,
      linhaAlteracao.element,
    ]),
  ]);

  // ---- Seção: Recolhimentos ----
  // As mesmas colunas do diálogo de recolhimentos, sem as ações: quem só
  // consulta vê o que produziu o número "Recolhido" do cartão acima.
  const recolhimentosTable = createDataTable({
    columns: [
      { key: 'numero', label: 'Documento', render: (row) => row.numero || '-' },
      {
        key: 'data_emissao',
        label: 'Emissão',
        render: (row) => formatDate(row.data_emissao),
      },
      {
        key: 'cod_nd',
        label: 'ND da anulação',
        render: (row) => codigoENome(row.cod_nd, row.nd_nome),
      },
      {
        key: 'ug_emitente',
        label: 'UG emitente',
        render: (row) => codigoENome(row.ug_emitente, row.ug_nome),
      },
      {
        key: 'valor',
        label: 'Valor',
        sortable: true,
        sortValue: (row) => toNumber(row.valor),
        render: (row) => formatCurrency(row.valor),
      },
      {
        key: 'qtd_anexos',
        label: 'Anexos',
        render: (row) => (Number(row.qtd_anexos || 0) > 0 ? String(row.qtd_anexos) : '-'),
      },
    ],
    rows: [],
    paginated: false,
    searchable: false,
    emptyMessage: 'Nenhum recolhimento lançado para esta nota de crédito',
  });

  const gerenciarRecolhimentosBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => {
      if (!ncAtual) return;
      openRecolhimentosDialog({ nc: ncAtual, onChanged: load });
    },
  }, [svgIcon(ICONS.logout, 14), 'Gerenciar recolhimentos']);

  const secaoRecolhimentos = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Recolhimentos (crédito devolvido)' }),
      // O diálogo de recolhimentos é quem escreve, e ele já esconde o que é de
      // escrita por perfil. Aqui o botão só aparece para quem tem o que fazer
      // com ele.
      el('div', { className: 'dashboard-section__controls' }, pode.operador
        ? [gerenciarRecolhimentosBtn]
        : []),
    ]),
    recolhimentosTable.element,
  ]);

  // ---- Seção: Empenhos contra esta NC ----
  //
  // A LISTA VEM DA NC REPRESENTATIVA. `GET /notas_empenho?nota_credito_id=` casa
  // `nota_empenho.nota_credito_id`, que é a NC que dita ND, PI e classificação da
  // NE. As 5 NEs reais que rateiam entre mais de uma NC aparecem só na ficha da
  // sua NC representativa, e a linha delas sai marcada como rateio. Alcançar as
  // outras exigiria um filtro novo no servidor, pela tabela de rateio.
  const empenhosTable = createDataTable({
    columns: [
      {
        key: 'numero',
        label: 'Número',
        sortable: true,
        // O RATEIO fica marcado. A NE que empenha contra mais de uma NC traz
        // aqui o valor DELA INTEIRA, e não a fatia desta NC: sem a marca, somar
        // a coluna de cabeça daria um empenhado maior que o do cartão acima.
        render: (row) => (Number(row.qtd_nc || 0) > 1
          ? el('span', {
            title: 'Esta NE rateia o empenho entre mais de uma NC; o valor da linha é o da NE inteira',
            textContent: `${row.numero || '-'} (rateio)`,
          })
          : (row.numero || '-')),
      },
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'data_empenho',
        label: 'Data do empenho',
        sortable: true,
        render: (row) => formatDate(row.data_empenho),
      },
      {
        key: 'finalidade',
        label: 'Finalidade',
        className: 'data-table__cell--truncate',
        render: (row) => row.finalidade || '-',
      },
      {
        key: 'valor_empenhado',
        label: 'Empenhado',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_empenhado),
        render: (row) => formatCurrency(row.valor_empenhado),
      },
      {
        key: 'valor_anulado',
        label: 'Anulado',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_anulado),
        render: (row) => formatCurrency(row.valor_anulado),
      },
      {
        key: 'total_liquidado',
        label: 'Liquidado',
        sortable: true,
        sortValue: (row) => toNumber(row.total_liquidado),
        render: (row) => formatCurrency(row.total_liquidado),
      },
    ],
    rows: [],
    paginated: false,
    searchable: false,
    emptyMessage: 'Nenhum empenho lançado contra esta nota de crédito',
    actions: [
      {
        icon: ICONS.assignment,
        title: 'Abrir a ficha da NE',
        onClick: (row) => { location.hash = `/orcamento/notas_empenho/${row.id}`; },
      },
    ],
  });

  const secaoEmpenhos = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Empenhos contra esta NC' }),
    ]),
    empenhosTable.element,
  ]);

  // ---- Seção: Anexo ----
  // O widget tem gate próprio: quem só consulta vê a lista e baixa, e não anexa
  // nem remove. É o mesmo componente do diálogo da NC.
  const anexo = createFileAttachment({
    mode: 'single',
    vinculo: { nota_credito_id: ncId },
    accept: '.pdf',
    buttonLabel: 'Selecionar PDF',
  });

  const secaoAnexo = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Anexo (PDF do SIAFI)' }),
    ]),
    anexo.element,
  ]);

  // ---------------------------------------------------------------------------
  // Repintura
  // ---------------------------------------------------------------------------
  /**
   * Empenhado e saldo, que vêm da LISTAGEM do ano e não da própria NC.
   * @param {Object|null} linhaDaLista - a linha desta NC na listagem, ou null
   *   quando a leitura falhou
   */
  function pintarValoresDerivados(linhaDaLista) {
    const temNumeros = linhaDaLista
      && linhaDaLista.saldo !== null
      && linhaDaLista.saldo !== undefined;
    linhaEmpenhado.element.style.display = temNumeros ? '' : 'none';
    linhaSaldo.element.style.display = temNumeros ? '' : 'none';
    if (!temNumeros) return;

    linhaEmpenhado.valor.textContent = formatCurrency(linhaDaLista.empenhado);
    const saldo = toNumber(linhaDaLista.saldo);
    linhaSaldo.valor.textContent = formatCurrency(linhaDaLista.saldo);
    // NEGATIVO É DADO, e não erro: a NC cujo crédito foi devolvido DEPOIS do
    // empenho fica mesmo abaixo de zero, e é a que precisa de atenção. Meio
    // centavo de tolerância porque NUMERIC(15,2) chega como texto.
    linhaSaldo.valor.title = saldo < -0.005
      ? 'Empenhado acima do crédito disponível, em geral porque o crédito foi devolvido depois do empenho'
      : '';
  }

  function pintarNc(nc, linhaDaLista, numeroDaComplementada) {
    titulo.textContent = `Nota de crédito ${nc.numero || `#${nc.id}`}`;

    linhaNumero.valor.textContent = nc.numero || '-';
    linhaAno.valor.textContent = nc.ano != null ? String(nc.ano) : '-';
    linhaEmissao.valor.textContent = formatDate(nc.data_emissao);
    linhaUg.valor.textContent = codigoENome(nc.ug_emitente, nc.ug_nome);
    linhaNd.valor.textContent = codigoENome(nc.cod_nd, nc.nd_nome);
    linhaPtres.valor.textContent = nc.ptres || '-';
    linhaFonte.valor.textContent = nc.fonte || '-';
    linhaPi.valor.textContent = codigoENome(nc.cod_pi, nc.pi_nome);
    linhaDocRo.valor.textContent = nc.doc_ro || '-';
    linhaPrazo.valor.textContent = formatDate(nc.prazo_empenho);

    linhaClassificacao.valor.textContent = nc.classificacao_nome || '-';
    // `rotuloMetaPit` é a MESMA função da lista de NCs, do PDR e da tela de
    // metas: uma meta não pode aparecer com nome diferente em cada tela.
    linhaMeta.valor.textContent = nc.numero_meta == null
      ? '-'
      : rotuloMetaPit({
        numero_meta: nc.numero_meta,
        item: nc.meta_item,
        descricao: nc.meta_descricao,
      });
    linhaComplementada.valor.textContent = nc.nc_complementada_id == null
      ? '-'
      : (numeroDaComplementada || `NC #${nc.nc_complementada_id}`);

    linhaValor.valor.textContent = formatCurrency(nc.valor_nc);
    linhaRecolhido.valor.textContent = formatCurrency(nc.valor_recolhido);
    pintarValoresDerivados(linhaDaLista);

    linhaFinalidade.valor.textContent = nc.finalidade_historico || '-';
    linhaObservacao.valor.textContent = nc.observacao || '-';

    linhaCadastro.valor.textContent = formatDateTime(nc.data_cadastramento);
    linhaAlteracao.valor.textContent = formatDateTime(nc.data_modificacao);

    if (!montado) {
      // Troca a mensagem de carga pelo esqueleto, uma vez só. O histórico é
      // pendurado DEPOIS disto, e por isso nunca mais é removido.
      root.replaceChildren(
        cabecalho, cartoes, secaoRecolhimentos, secaoEmpenhos, secaoAnexo
      );
      montado = true;
    }
  }

  async function load() {
    if (montado) {
      recolhimentosTable.update({ loading: true });
      empenhosTable.update({ loading: true });
    }

    let nc;
    try {
      nc = await getNotaCredito(ncId);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar a nota de crédito');
      if (montado) {
        // A ficha já está na tela. Trocar tudo por uma mensagem de erro apagaria
        // o que a pessoa está lendo por causa de uma rede que caiu por um
        // instante: o aviso já saiu no toast.
        recolhimentosTable.update({ loading: false });
        empenhosTable.update({ loading: false });
        return;
      }
      clearChildren(root);
      root.appendChild(el('div', {
        className: 'data-table__empty',
        textContent: err.message || 'Nota de crédito não encontrada',
      }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/orcamento/notas_credito'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']));
      return;
    }
    if (disposed) return;

    ncAtual = nc;

    // As três leituras que dependem da NC já carregada. Cada uma falha por si:
    // uma lista de empenhos que não veio não pode apagar a ficha inteira.
    const [recolhimentos, empenhos, doAno] = await Promise.all([
      getRecolhimentos({ nota_credito_id: ncId }).catch(() => null),
      getNotasEmpenho({ nota_credito_id: ncId }).catch(() => null),
      // A listagem do ano traz o saldo e o empenhado calculados pelo servidor, e
      // de quebra o número da NC complementada, que a ficha só conhece pelo id.
      getNotasCredito({ ano: nc.ano }).catch(() => null),
    ]);
    if (disposed) return;

    const linhaDaLista = (doAno || []).find(l => Number(l.id) === ncId) || null;
    const complementada = nc.nc_complementada_id == null
      ? null
      : (doAno || []).find(l => Number(l.id) === Number(nc.nc_complementada_id));

    pintarNc(nc, linhaDaLista, complementada ? complementada.numero : null);
    recolhimentosTable.update({ rows: recolhimentos || [], loading: false });
    empenhosTable.update({ rows: empenhos || [], loading: false });
  }

  await load();

  // Histórico de alterações. É o MESMO componente da ficha da NE e do pedido.
  // Fora do `load` de propósito: dentro dele o painel seria destruído e refeito a
  // cada recolhimento lançado.
  //
  // SÓ QUANDO A FICHA MONTOU. Falhando a primeira carga, a raiz fica com "Nota de
  // crédito não encontrada" e o botão de voltar, e o painel era pendurado ali
  // assim mesmo: uma consulta de rastreabilidade por um registro que não abriu, e
  // um título de "Histórico" embaixo de uma tela que não mostra nada.
  const historico = montado
    ? criarHistorico({
      modulo: 'orcamento',
      entidade: 'nota_credito',
      id: ncId,
      subtitulo: 'Alterações nesta nota de crédito',
    })
    : null;
  if (historico) root.appendChild(historico.element);

  return () => {
    disposed = true;
    recolhimentosTable._cleanup();
    empenhosTable._cleanup();
    if (historico) historico.cleanup();
  };
}
