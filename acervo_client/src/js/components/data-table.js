import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';

/**
 * Create a paginated data table.
 * @param {Object} options
 * @param {Array<{key: string, label: string, format?: Function, className?: string}>} options.columns
 * @param {Array<Object>} options.data
 * @param {boolean} options.loading
 * @param {string} [options.emptyMessage]
 * @param {number} [options.pageSize]
 * @returns {HTMLElement}
 */
export function createDataTable({
  columns,
  data = [],
  loading = false,
  emptyMessage = 'Sem dados disponiveis',
  pageSize = 10,
}) {
  let currentPage = 0;
  let currentPageSize = pageSize;
  let currentData = data;

  const tableScroll = el('div', { className: 'data-table-scroll' });
  const paginationEl = el('div', { className: 'pagination' });

  const wrapper = el('div', { className: 'data-table-wrapper' }, [
    tableScroll,
    paginationEl,
  ]);

  function render() {
    clearChildren(tableScroll);
    clearChildren(paginationEl);

    if (loading) {
      renderSkeleton();
      return;
    }

    if (!currentData.length) {
      tableScroll.appendChild(el('div', { className: 'data-table__empty', textContent: emptyMessage }));
      return;
    }

    // Table header
    const thead = el('thead', {}, [
      el('tr', {}, columns.map(col =>
        el('th', { textContent: col.label })
      )),
    ]);

    // Paginated rows
    const start = currentPage * currentPageSize;
    const pageData = currentData.slice(start, start + currentPageSize);

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
    renderPagination();
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

  function renderPagination() {
    const totalPages = Math.ceil(currentData.length / currentPageSize);
    if (totalPages <= 1 && currentData.length <= currentPageSize) return;

    const start = currentPage * currentPageSize + 1;
    const end = Math.min((currentPage + 1) * currentPageSize, currentData.length);

    // Page size selector
    const pageSizeSelect = el('select', {
      className: 'pagination__select',
      onChange: (e) => {
        currentPageSize = parseInt(e.target.value);
        currentPage = 0;
        render();
      },
    }, [5, 10, 25].map(size =>
      el('option', {
        value: String(size),
        textContent: `${size} por pagina`,
        ...(size === currentPageSize ? { selected: 'selected' } : {}),
      })
    ));

    // Fix selected state
    pageSizeSelect.value = String(currentPageSize);

    const info = el('div', { className: 'pagination__info' }, [
      el('span', { textContent: `${start}-${end} de ${currentData.length}` }),
      pageSizeSelect,
    ]);

    const prevBtn = el('button', {
      className: 'pagination__btn',
      disabled: currentPage === 0 ? 'disabled' : undefined,
      'aria-label': 'Pagina anterior',
      onClick: () => { if (currentPage > 0) { currentPage--; render(); } },
    }, [svgIcon(ICONS.chevronLeft, 18)]);

    const nextBtn = el('button', {
      className: 'pagination__btn',
      disabled: currentPage >= totalPages - 1 ? 'disabled' : undefined,
      'aria-label': 'Proxima pagina',
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
