import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatDateTime, formatNumber, monthName } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { chip, badgeAbaixoMinimo } from '@components/status-chip.js';
import { getTipoMaterial, getConsumoMensal } from '@services/mapoteca-service.js';
import { openMaterialDialog } from './material-dialog.js';

function summaryCard(label, value, extra = null) {
  return el('div', { className: 'summary-card' }, [
    el('div', { className: 'summary-card__value', textContent: value }),
    el('div', { className: 'summary-card__label', textContent: label }),
    extra ? el('div', { style: { marginTop: '6px' } }, [extra]) : null,
  ]);
}

function backButton() {
  return el('button', {
    className: 'btn btn--text',
    type: 'button',
    'aria-label': 'Voltar para tipos de material',
    onClick: () => { location.hash = '/materiais'; },
  }, [svgIcon(ICONS.arrowBack, 18), 'Voltar']);
}

/**
 * Tipo de material details page (#/materiais/:id).
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderMaterialDetails(container, { params }) {
  const id = Number(params.id);
  let disposed = false;
  let cleanups = [];

  function dispose() {
    for (const fn of cleanups) {
      try { fn(); } catch { /* noop */ }
    }
    cleanups = [];
  }

  async function load() {
    dispose();
    container.innerHTML = '';

    const ano = new Date().getFullYear();
    let material;
    let consumoMensal = [];
    try {
      [material, consumoMensal] = await Promise.all([
        getTipoMaterial(id),
        getConsumoMensal(ano).catch(() => []),
      ]);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o tipo de material');
      container.appendChild(el('div', { className: 'page' }, [
        el('div', { className: 'page__header' }, [backButton()]),
        el('p', { textContent: err.message || 'Erro ao carregar o tipo de material' }),
      ]));
      return;
    }
    if (disposed) return;

    const estoqueTotal = Number(material.estoque?.total || 0);
    const abaixoMinimo = material.estoque_minimo !== null
      && estoqueTotal < Number(material.estoque_minimo);

    // -------------------------------------------------------------------------
    // Header
    // -------------------------------------------------------------------------
    const titleArea = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
    }, [
      backButton(),
      el('h1', { className: 'page__title', textContent: material.nome }),
      chip(material.ativo ? 'Ativo' : 'Inativo', material.ativo ? 'success' : 'default'),
      abaixoMinimo ? badgeAbaixoMinimo() : null,
    ]);

    const editBtn = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => openMaterialDialog({ material, onSaved: load }),
    }, [svgIcon(ICONS.edit, 16), 'Editar']);

    // -------------------------------------------------------------------------
    // Summary cards
    // -------------------------------------------------------------------------
    const summaryGrid = el('div', { className: 'summary-cards' }, [
      summaryCard('Estoque total', formatNumber(estoqueTotal), abaixoMinimo ? badgeAbaixoMinimo() : null),
      summaryCard('Estoque mínimo', formatNumber(material.estoque_minimo)),
      summaryCard('Meta anual', formatNumber(material.meta_anual)),
      summaryCard('Total consumido', formatNumber(material.consumo?.total_consumido)),
      summaryCard('Último consumo', formatDate(material.consumo?.ultimo_consumo)),
    ]);

    // -------------------------------------------------------------------------
    // Estoque por localização
    // -------------------------------------------------------------------------
    const estoqueTable = createDataTable({
      columns: [
        { key: 'localizacao_nome', label: 'Localização', sortable: true },
        {
          key: 'quantidade',
          label: 'Quantidade',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
        {
          key: 'data_atualizacao',
          label: 'Atualizado em',
          render: (row) => formatDateTime(row.data_atualizacao || row.data_criacao),
        },
        {
          key: 'usuario_atualizacao_nome',
          label: 'Atualizado por',
          render: (row) => row.usuario_atualizacao_nome || row.usuario_criacao_nome || '-',
        },
      ],
      rows: material.estoque?.registros || [],
      pageSize: 10,
      emptyMessage: 'Sem estoque registrado para este material',
    });
    cleanups.push(() => estoqueTable._cleanup());

    // -------------------------------------------------------------------------
    // Consumo recente
    // -------------------------------------------------------------------------
    const consumoTable = createDataTable({
      columns: [
        {
          key: 'data_consumo',
          label: 'Data do consumo',
          sortable: true,
          render: (row) => formatDate(row.data_consumo),
        },
        {
          key: 'quantidade',
          label: 'Quantidade',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
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
      rows: material.consumo?.registros_recentes || [],
      pageSize: 10,
      emptyMessage: 'Sem consumo registrado para este material',
    });
    cleanups.push(() => consumoTable._cleanup());

    // -------------------------------------------------------------------------
    // Consumo mensal do ano (bar chart)
    // -------------------------------------------------------------------------
    const consumoDoMaterial = consumoMensal
      .filter(r => Number(r.tipo_material_id) === id)
      .sort((a, b) => Number(a.mes) - Number(b.mes))
      .map(r => ({ mes_nome: monthName(r.mes), quantidade: Number(r.quantidade) }));

    const consumoChart = createBarChart({
      title: `Consumo mensal em ${ano}`,
      data: consumoDoMaterial.some(r => r.quantidade > 0) ? consumoDoMaterial : [],
      xKey: 'mes_nome',
      series: [{ dataKey: 'quantidade', label: 'Quantidade consumida' }],
    });
    cleanups.push(() => consumoChart._cleanup());

    // -------------------------------------------------------------------------
    // Page assembly
    // -------------------------------------------------------------------------
    container.appendChild(el('div', { className: 'page' }, [
      el('div', { className: 'page__header' }, [
        titleArea,
        el('div', { className: 'page__actions' }, [editBtn]),
      ]),
      material.descricao
        ? el('p', {
            textContent: material.descricao,
            style: { color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)' },
          })
        : null,
      summaryGrid,
      el('div', { className: 'dashboard-section' }, [
        el('div', { className: 'dashboard-section__header' }, [
          el('h2', { className: 'dashboard-section__title', textContent: 'Estoque por localização' }),
        ]),
        estoqueTable.element,
      ]),
      el('div', { className: 'dashboard-section' }, [
        el('div', { className: 'dashboard-section__header' }, [
          el('h2', { className: 'dashboard-section__title', textContent: 'Consumo recente' }),
        ]),
        consumoTable.element,
      ]),
      consumoChart,
    ]));
  }

  await load();

  return () => {
    disposed = true;
    dispose();
  };
}
