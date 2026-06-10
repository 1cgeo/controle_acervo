import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';

const PAGE_SIZE_OPTIONS = [5, 10, 25];

const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '');
}

/**
 * Create a paginated data table with optional client-side search and sorting.
 * @param {Object} options
 * @param {Array<{key: string, label: string, format?: Function, className?: string, sortable?: boolean}>} options.columns
 *        - sortable: enables click-to-sort on the header (sorts by row[key])
 * @param {Array<Object>} options.data
 * @param {boolean} options.loading
 * @param {string} [options.emptyMessage]
 * @param {number} [options.pageSize]
 * @param {boolean} [options.searchable] - shows the client-side search input (accent-insensitive)
 * @returns {HTMLElement}
 */
export function createDataTable({
  columns,
  data = [],
  loading = false,
  emptyMessage = 'Sem dados disponíveis',
  pageSize = 10,
  searchable = false,
}) {
  let currentPage = 0;
  let currentPageSize = PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : 10;
  let currentData = data;
  let searchTerm = '';
  let sortKey = null;
  let sortDir = 1; // 1 asc, -1 desc

  const tableScroll = el('div', { className: 'data-table-scroll' });
  const paginationEl = el('div', { className: 'pagination' });

  let toolbar = null;
  if (searchable) {
    const searchInput = el('input', {
      className: 'data-table-toolbar__search-input',
      type: 'search',
      placeholder: 'Buscar...',
      'aria-label': 'Buscar na tabela',
      onInput: (e) => {
        searchTerm = normalizeText(e.target.value.trim());
        currentPage = 0;
        render();
      },
    });
    toolbar = el('div', { className: 'data-table-toolbar' }, [
      el('div', { className: 'data-table-toolbar__search' }, [
        el('span', { className: 'data-table-toolbar__search-icon' }, [svgIcon(ICONS.search, 16)]),
        searchInput,
      ]),
    ]);
  }

  const wrapper = el('div', { className: 'data-table-wrapper' }, [
    toolbar,
    tableScroll,
    paginationEl,
  ]);

  function getFilteredData() {
    let result = currentData;

    if (searchTerm) {
      result = result.filter(row =>
        columns.some(col => normalizeText(row[col.key]).includes(searchTerm))
      );
    }

    if (sortKey) {
      result = [...result].sort((a, b) => {
        const va = a[sortKey];
        const vb = b[sortKey];
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'number' && typeof vb === 'number') {
          return (va - vb) * sortDir;
        }
        return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * sortDir;
      });
    }

    return result;
  }

  function buildHeaderCell(col) {
    if (!col.sortable) {
      return el('th', { textContent: col.label });
    }

    const indicator = sortKey === col.key ? (sortDir === 1 ? '▲' : '▼') : '';
    return el('th', {
      className: 'data-table__th--sortable',
      'aria-sort': sortKey === col.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none',
      onClick: () => {
        if (sortKey === col.key) {
          sortDir = -sortDir;
        } else {
          sortKey = col.key;
          sortDir = 1;
        }
        currentPage = 0;
        render();
      },
    }, [
      col.label,
      el('span', { className: 'data-table__sort-indicator', textContent: indicator }),
    ]);
  }

  function render() {
    clearChildren(tableScroll);
    clearChildren(paginationEl);

    if (loading) {
      renderSkeleton();
      return;
    }

    const filtered = getFilteredData();

    if (!filtered.length) {
      tableScroll.appendChild(el('div', {
        className: 'data-table__empty',
        textContent: searchTerm ? 'Nenhum resultado para a busca' : emptyMessage,
      }));
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / currentPageSize));
    if (currentPage >= totalPages) currentPage = totalPages - 1;

    // Table header
    const thead = el('thead', {}, [
      el('tr', {}, columns.map(buildHeaderCell)),
    ]);

    // Paginated rows
    const start = currentPage * currentPageSize;
    const pageData = filtered.slice(start, start + currentPageSize);

    const tbody = el('tbody', {}, pageData.map(row =>
      el('tr', {}, columns.map(col => {
        const rawValue = row[col.key];
        const formatted = col.format ? col.format(rawValue, row) : (rawValue ?? '-');
        const td = el('td', { className: col.className || '' });
        if (formatted instanceof HTMLElement) {
          td.appendChild(formatted);
        } else {
          td.textContent = String(formatted);
          if (col.className?.includes('truncate')) {
            td.title = String(formatted);
          }
        }
        return td;
      }))
    ));

    const table = el('table', { className: 'data-table' }, [thead, tbody]);
    tableScroll.appendChild(table);

    // Pagination
    renderPagination(filtered.length);
  }

  function renderSkeleton() {
    const thead = el('thead', {}, [
      el('tr', {}, columns.map(col => el('th', { textContent: col.label }))),
    ]);

    const rows = [];
    for (let i = 0; i < 5; i++) {
      rows.push(
        el('tr', { className: 'data-table--loading' },
          columns.map(() => el('td', {}, [
            el('div', { className: 'skeleton data-table__skeleton-row' }),
          ]))
        )
      );
    }

    const table = el('table', { className: 'data-table' }, [
      thead,
      el('tbody', {}, rows),
    ]);
    tableScroll.appendChild(table);
  }

  function renderPagination(totalFiltered) {
    const totalPages = Math.max(1, Math.ceil(totalFiltered / currentPageSize));
    if (totalFiltered <= PAGE_SIZE_OPTIONS[0]) return;

    const start = currentPage * currentPageSize + 1;
    const end = Math.min((currentPage + 1) * currentPageSize, totalFiltered);

    // Page size selector
    const pageSizeSelect = el('select', {
      className: 'pagination__select',
      'aria-label': 'Itens por página',
      onChange: (e) => {
        currentPageSize = parseInt(e.target.value);
        currentPage = 0;
        render();
      },
    }, PAGE_SIZE_OPTIONS.map(size =>
      el('option', {
        value: String(size),
        textContent: `${size} por página`,
      })
    ));
    pageSizeSelect.value = String(currentPageSize);

    const info = el('div', { className: 'pagination__info' }, [
      el('span', { textContent: `${start}-${end} de ${totalFiltered}` }),
      pageSizeSelect,
    ]);

    const prevBtn = el('button', {
      className: 'pagination__btn',
      disabled: currentPage === 0 ? 'disabled' : undefined,
      'aria-label': 'Página anterior',
      onClick: () => { if (currentPage > 0) { currentPage--; render(); } },
    }, [svgIcon(ICONS.chevronLeft, 18)]);

    const nextBtn = el('button', {
      className: 'pagination__btn',
      disabled: currentPage >= totalPages - 1 ? 'disabled' : undefined,
      'aria-label': 'Próxima página',
      onClick: () => { if (currentPage < totalPages - 1) { currentPage++; render(); } },
    }, [svgIcon(ICONS.chevronRight, 18)]);

    const controls = el('div', { className: 'pagination__controls' }, [prevBtn, nextBtn]);

    paginationEl.appendChild(info);
    paginationEl.appendChild(controls);
  }

  /**
   * Update the table data.
   */
  wrapper.update = ({ data: newData, loading: newLoading }) => {
    if (newData !== undefined) {
      currentData = newData;
      currentPage = 0;
    }
    loading = newLoading !== undefined ? newLoading : loading;
    render();
  };

  render();
  return wrapper;
}
