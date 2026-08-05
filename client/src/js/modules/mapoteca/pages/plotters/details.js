import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatDateTime, formatNumber, formatCurrency, toIsoDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createDateField, createTextareaField } from '@components/form-fields/form-fields.js';
import { chip } from '@components/status-chip.js';
import { reconciliar } from '@utils/reconciliar.js';
import {
  getPlotter,
  createManutencao,
  updateManutencao,
  deleteManutencoes,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { openPlotterDialog } from './plotter-dialog.js';
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Repinta um container cujos filhos tem PAPEL fixo (o cabecalho, um cartao).
 *
 * Cada item traz a chave do papel e a fabrica do no. Papel que sai da lista some
 * da tela, e o papel que fica mantem o MESMO no. E o que preserva o foco do
 * teclado e a rolagem numa parte da tela que muda de forma, e nao so de texto.
 *
 * A funcao esta repetida na ficha do material. Duas copias curtas, de proposito:
 * promover para `utils/` na terceira tela que precisar dela.
 *
 * @param {Element} container
 * @param {Array<{chave:string, criar:()=>Node}|null>} itens - nulo se omite
 */
function pintarPapeis(container, itens) {
  reconciliar(container, itens.filter(Boolean), {
    chave: (item) => item.chave,
    criar: (item) => item.criar(),
  });
}

/**
 * Monta ou repinta o cartao de resumo, sempre no MESMO no.
 * @param {HTMLElement} cartao
 * @param {{rotulo:string, valor:string}} dado
 * @returns {HTMLElement} o mesmo cartao
 */
function pintarCartao(cartao, dado) {
  pintarPapeis(cartao, [
    { chave: 'valor', criar: () => el('div', { className: 'summary-card__value' }) },
    {
      chave: 'rotulo',
      criar: () => el('div', { className: 'summary-card__label', textContent: dado.rotulo }),
    },
  ]);
  cartao.querySelector('.summary-card__value').textContent = dado.valor;
  return cartao;
}

function backButton() {
  return el('button', {
    className: 'btn btn--text',
    type: 'button',
    'aria-label': 'Voltar para plotters',
    onClick: () => { location.hash = '/mapoteca/plotters'; },
  }, [svgIcon(ICONS.arrowBack, 18), 'Voltar']);
}

/**
 * Open the create/edit dialog for a maintenance record.
 * @param {Object} options
 * @param {number} options.plotterId
 * @param {Object|null} [options.manutencao] - existing record to edit (null creates)
 * @param {Function} [options.onSaved]
 */
function openManutencaoDialog({ plotterId, manutencao = null, onSaved = null }) {
  const isEdit = Boolean(manutencao);

  const dataField = createDateField({
    label: 'Data da manutenção',
    required: true,
    value: manutencao ? (toIsoDate(manutencao.data_manutencao) || '') : (toIsoDate(new Date()) || ''),
  });
  const valorField = createNumberField({
    label: 'Valor (R$)',
    required: true,
    min: 0.01,
    step: 0.01,
    value: manutencao ? Number(manutencao.valor) : undefined,
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: manutencao?.descricao || '',
  });

  const content = el('div', { className: 'form-grid' }, [
    dataField.element,
    valorField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  let saving = false;
  openModal({
    title: isEdit ? 'Editar manutenção' : 'Adicionar manutenção',
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;
          dataField.setError(null);
          valorField.setError(null);

          const dataManutencao = dataField.getValue();
          const valor = valorField.getValue();

          let valid = true;
          if (!dataManutencao) {
            dataField.setError('Informe a data da manutenção');
            valid = false;
          }
          if (valor === null || valor <= 0) {
            valorField.setError('Informe um valor maior que zero');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            plotter_id: plotterId,
            data_manutencao: dataManutencao,
            valor,
            descricao: descricaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateManutencao({ id: manutencao.id, ...payload });
              showSuccess('Manutenção atualizada com sucesso');
            } else {
              await createManutencao(payload);
              showSuccess('Manutenção registrada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a manutenção');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}

/**
 * Plotter details page (#/plotters/:id).
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderPlotterDetails(container, { params }) {
  const id = Number(params.id);
  let disposed = false;
  let cleanups = [];
  const pode = permissoes('mapoteca');

  // O equipamento vivo, lido no MOMENTO do clique. O botao Editar agora
  // sobrevive a gravacao, e um `plotter` capturado na montagem ficaria velho.
  let plotter = null;
  // Os nos da pagina, montados uma vez. Nulo antes da primeira carga, e nulo de
  // novo depois de um erro, que troca a ficha pela tela de erro.
  let tela = null;

  function dispose() {
    for (const fn of cleanups) {
      try { fn(); } catch { /* noop */ }
    }
    cleanups = [];
  }

  async function handleDeleteManutencao(row) {
    const ok = await confirmDialog({
      title: 'Excluir manutenção',
      message: `Tem certeza que deseja excluir a manutenção de ${formatDate(row.data_manutencao)} no valor de ${formatCurrency(row.valor)}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteManutencoes([row.id]);
      showSuccess('Manutenção excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir a manutenção');
    }
  }

  /**
   * Monta a ficha UMA vez. Dai em diante o `load` so repinta.
   *
   * O DEFEITO QUE ISTO CORRIGE. Esta ficha tem TRES
   * gravacoes ligadas ao recarregador: editar o equipamento, salvar uma
   * manutencao e excluir uma manutencao. Cada uma zerava o container e montava
   * outra tabela. Iam junto a busca, a ordenacao, a pagina atual, a selecao e o
   * foco do teclado, porque esse estado mora no OBJETO da tabela, e nao no DOM.
   * O chefe mediu o efeito assim: "quando edita a UI reconstroi, que torna muito
   * chato ficar editando pois a tela fica se movendo".
   */
  function montarTela() {
    const voltar = backButton();
    const titulo = el('h1', { className: 'page__title' });
    const linhaTitulo = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
    });
    const subtitulo = el('div', {
      style: { color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: '4px' },
    });
    const areaTitulo = el('div', {}, [linhaTitulo, subtitulo]);

    const editar = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => openPlotterDialog({ plotter, onSaved: load }),
    }, [svgIcon(ICONS.edit, 16), 'Editar']);

    const cabecalho = el('div', { className: 'page__header' }, [
      areaTitulo,
      el('div', { className: 'page__actions' }, pode.gerente ? [editar] : []),
    ]);

    const resumo = el('div', { className: 'summary-cards' });

    // -------------------------------------------------------------------------
    // Maintenance table
    // -------------------------------------------------------------------------
    // Nasce carregando: a lista chega com a resposta, e o estado vazio antes
    // dela diria "nenhuma manutencao" para um plotter que tem manutencoes.
    const manutencoesTable = createDataTable({
      columns: [
        {
          key: 'data_manutencao',
          label: 'Data',
          sortable: true,
          render: (row) => formatDate(row.data_manutencao),
        },
        {
          key: 'valor',
          label: 'Valor',
          sortable: true,
          render: (row) => formatCurrency(row.valor),
        },
        { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
        {
          key: 'usuario_criacao_nome',
          label: 'Registrado por',
          render: (row) => row.usuario_criacao_nome || '-',
        },
        {
          key: 'data_criacao',
          label: 'Registrado em',
          render: (row) => formatDateTime(row.data_criacao),
        },
      ],
      rows: [],
      loading: true,
      pageSize: 10,
      emptyMessage: 'Nenhuma manutenção registrada',
      // Manutencao de plotter e gerente, criar, editar e excluir.
      actions: pode.gerente ? [
        {
          icon: ICONS.edit,
          title: 'Editar manutenção',
          onClick: (row) => openManutencaoDialog({ plotterId: id, manutencao: row, onSaved: load }),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir manutenção',
          variant: 'danger',
          onClick: (row) => handleDeleteManutencao(row),
        },
      ] : [],
    });
    cleanups.push(() => manutencoesTable._cleanup());

    const addManutencaoBtn = el('button', {
      className: 'btn btn--primary btn--sm',
      type: 'button',
      onClick: () => openManutencaoDialog({ plotterId: id, onSaved: load }),
    }, [svgIcon(ICONS.add, 14), 'Adicionar manutenção']);

    const secaoManutencoes = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Manutenções' }),
        el('div', { className: 'dashboard-section__controls' }, pode.gerente ? [addManutencaoBtn] : []),
      ]),
      manutencoesTable.element,
    ]);

    // Historico de alteracoes. E o MESMO componente da ficha do pedido.
    //
    // O agregado e `plotter`, e ele reune o equipamento e as MANUTENCOES: quem
    // pergunta "quando este plotter parou" quer os dois no mesmo lugar.
    //
    // Ele busca sozinho ao nascer. Nas cargas seguintes quem o atualiza e o
    // `load`, por `recarregar()`.
    const historico = criarHistorico({
      modulo: 'mapoteca',
      entidade: 'plotter',
      id,
      subtitulo: 'Alteracoes no equipamento e nas manutencoes',
    });
    cleanups.push(() => historico.cleanup());

    // A pagina nao tem bloco que entre e saia: monta-se inteira uma vez.
    const pagina = el('div', { className: 'page' }, [
      cabecalho,
      resumo,
      secaoManutencoes,
      historico.element,
    ]);

    return {
      pagina, linhaTitulo, voltar, titulo, subtitulo, resumo, manutencoesTable, historico,
      // Quantas linhas a tabela mostra agora. Ver `marcarCarregando`.
      linhas: 0,
    };
  }

  /**
   * Avisa a tabela de que uma recarga comecou.
   *
   * So a tabela que JA tem linhas e marcada. A tabela vazia trocaria a mensagem
   * de vazio por um esqueleto de dez linhas, e a tela pularia justamente no
   * caso em que nao ha nada a preservar.
   */
  function marcarCarregando() {
    if (tela && tela.linhas > 0) tela.manutencoesTable.update({ loading: true });
  }

  /** Escreve o dado novo nos nos que ja existem. */
  function pintar() {
    const stats = plotter.estatisticas || {};

    tela.titulo.textContent = `${plotter.modelo} — ${plotter.nr_serie}`;

    // A linha do titulo e uma lista curta de nos com papel fixo. Voltar e o
    // titulo mantem o no; so o chip se refaz, e apenas quando o estado muda.
    pintarPapeis(tela.linhaTitulo, [
      { chave: 'voltar', criar: () => tela.voltar },
      { chave: 'titulo', criar: () => tela.titulo },
      {
        chave: `ativo:${plotter.ativo}`,
        criar: () => chip(
          plotter.ativo ? 'Ativo' : 'Inativo',
          plotter.ativo ? 'success' : 'default',
        ),
      },
    ]);

    tela.subtitulo.textContent = `Aquisição: ${formatDate(plotter.data_aquisicao)} · Vida útil: ${
      plotter.vida_util === null || plotter.vida_util === undefined
        ? '-'
        : `${formatNumber(plotter.vida_util)} meses`
    }`;

    const tempoMedio = stats.tempo_medio_entre_manutencoes_dias;
    const cartoes = [
      { rotulo: 'Total de manutenções', valor: formatNumber(stats.total_manutencoes) },
      { rotulo: 'Última manutenção', valor: formatDate(stats.data_ultima_manutencao) },
      { rotulo: 'Valor total', valor: formatCurrency(stats.valor_total_manutencoes) },
      { rotulo: 'Valor médio', valor: formatCurrency(stats.valor_medio_manutencoes) },
      {
        rotulo: 'Tempo médio entre manutenções',
        valor: tempoMedio === null || tempoMedio === undefined
          ? '-'
          : `${formatNumber(Math.round(Number(tempoMedio)))} dias`,
      },
    ];
    // O rotulo e a identidade do cartao: o valor muda, o no fica.
    reconciliar(tela.resumo, cartoes, {
      chave: (dado) => dado.rotulo,
      criar: (dado) => pintarCartao(el('div', { className: 'summary-card' }), dado),
      atualizar: (no, dado) => pintarCartao(no, dado),
    });

    const manutencoes = plotter.manutencoes || [];
    tela.manutencoesTable.update(manutencoes);
    tela.linhas = manutencoes.length;
  }

  async function load() {
    // Recarga silenciosa: a tabela fica na tela com as linhas que ja tem, e so
    // avisa que esta carregando. Trocar por esqueleto encolhia a tela.
    marcarCarregando();

    let carregado;
    try {
      carregado = await getPlotter(id);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o plotter');
      // Sem dado nao ha ficha. A tela de erro toma o lugar dela, e a proxima
      // carga bem-sucedida monta a ficha de novo.
      dispose();
      tela = null;
      plotter = null;
      container.innerHTML = '';
      container.appendChild(el('div', { className: 'page' }, [
        el('div', { className: 'page__header' }, [backButton()]),
        el('p', { textContent: err.message || 'Erro ao carregar o plotter' }),
      ]));
      return;
    }
    if (disposed) return;

    plotter = carregado;

    const primeira = !tela;
    if (primeira) {
      tela = montarTela();
      container.innerHTML = '';
      container.appendChild(tela.pagina);
    }

    pintar();

    // Na primeira carga o historico ja busca sozinho.
    if (!primeira) tela.historico.recarregar();
  }

  await load();

  return () => {
    disposed = true;
    dispose();
  };
}
