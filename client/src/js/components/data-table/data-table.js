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
 * Create a client-side data table with search, sorting, pagination, row
 * actions and (optional) multi-selection.
 *
 * @param {Object} options
 * @param {Array<{key:string, label:string, render?:(row:Object)=>(string|Node), sortable?:boolean, className?:string}>} options.columns
 *        - render(row) returns a string or a DOM Node for the cell; default is row[key] ?? '-'.
 *        - sortable: enables click-to-sort on the header (sorts by row[key]).
 * @param {Array<Object>} [options.rows]
 * @param {boolean} [options.searchable] - shows the client-side search input
 * @param {number} [options.pageSize] - 5 | 10 | 25 (default 10)
 * @param {Array<{label?:string, icon?:string, onClick:(row:Object)=>void, title?:string, variant?:'default'|'danger'}>} [options.actions]
 *        - per-row action buttons ('icon' is an SVG path string from ICONS)
 * @param {boolean} [options.selectable] - adds a checkbox column (bulk operations)
 * @param {(selected:Array<Object>)=>void} [options.onSelectionChange]
 * @param {string} [options.emptyMessage]
 * @param {boolean} [options.loading]
 * @returns {{element:HTMLElement, update:(rowsOrState:Array|{rows?:Array, loading?:boolean})=>void, getSelected:()=>Array<Object>, clearSelection:()=>void, _cleanup:()=>void}}
 */
export function createDataTable({
  columns,
  rows = [],
  searchable = false,
  pageSize = 10,
  actions = [],
  selectable = false,
  onSelectionChange = null,
  emptyMessage = 'Sem dados disponíveis',
  loading = false,
}) {
  let allRows = rows;
  let isLoading = loading;
  let searchTerm = '';
  let sortKey = null;
  let sortDir = 1; // 1 asc, -1 desc
  let currentPage = 0;
  let currentPageSize = PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : 10;
  const selected = new Set();

  const tableScroll = el('div', { className: 'data-table-scroll' });
  const paginationEl = el('div', { className: 'pagination' });

  let toolbar = null;
  let searchInput = null;
  if (searchable) {
    searchInput = el('input', {
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

  function getFilteredRows() {
    let result = allRows;

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

  function notifySelection() {
    if (onSelectionChange) onSelectionChange(getSelected());
  }

  function getSelected() {
    return allRows.filter(row => selected.has(row));
  }

  function clearSelection() {
    selected.clear();
    notifySelection();
    render();
  }

  function buildHeader(pageRows) {
    const cells = [];

    if (selectable) {
      const allOnPageSelected = pageRows.length > 0 && pageRows.every(r => selected.has(r));
      const headerCheckbox = el('input', {
        className: 'data-table__checkbox',
        type: 'checkbox',
        'aria-label': 'Selecionar todos da página',
        onChange: (e) => {
          if (e.target.checked) {
            pageRows.forEach(r => selected.add(r));
          } else {
            pageRows.forEach(r => selected.delete(r));
          }
          notifySelection();
          render();
        },
      });
      headerCheckbox.checked = allOnPageSelected;
      cells.push(el('th', { className: 'data-table__checkbox-cell' }, [headerCheckbox]));
    }

    for (const col of columns) {
      if (col.sortable) {
        const indicator = sortKey === col.key ? (sortDir === 1 ? '▲' : '▼') : '';
        cells.push(el('th', {
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
        ]));
      } else {
        cells.push(el('th', { textContent: col.label }));
      }
    }

    if (actions.length) {
      cells.push(el('th', { className: 'data-table__actions-cell', textContent: 'Ações' }));
    }

    return el('thead', {}, [el('tr', {}, cells)]);
  }

  function buildRow(row) {
    const cells = [];

    if (selectable) {
      const checkbox = el('input', {
        className: 'data-table__checkbox',
        type: 'checkbox',
        'aria-label': 'Selecionar linha',
        onChange: (e) => {
          if (e.target.checked) {
            selected.add(row);
          } else {
            selected.delete(row);
          }
          notifySelection();
          tr.classList.toggle('data-table__row--selected', selected.has(row));
        },
      });
      checkbox.checked = selected.has(row);
      cells.push(el('td', { className: 'data-table__checkbox-cell' }, [checkbox]));
    }

    for (const col of columns) {
      const td = el('td', { className: col.className || '' });
      const content = col.render ? col.render(row) : (row[col.key] ?? '-');
      if (content instanceof Node) {
        td.appendChild(content);
      } else {
        td.textContent = String(content);
        if (col.className && col.className.includes('truncate')) {
          td.title = String(content);
        }
      }
      cells.push(td);
    }

    if (actions.length) {
      // action.visible(row) opcional: oculta a acao para linhas que nao a suportam
      // (ex.: botao de download so quando ha anexo).
      const actionButtons = actions
        .filter(action => typeof action.visible !== 'function' || action.visible(row))
        .map(action => {
        const btn = el('button', {
          className: `data-table__action-btn${action.variant === 'danger' ? ' data-table__action-btn--danger' : ''}`,
          title: action.title || action.label || '',
          'aria-label': action.title || action.label || 'Ação',
          onClick: (e) => {
            e.stopPropagation();
            action.onClick(row);
          },
        });
        if (action.icon) {
          btn.appendChild(svgIcon(action.icon, 18));
        } else {
          btn.textContent = action.label || '';
        }
        return btn;
      });
      cells.push(el('td', { className: 'data-table__actions-cell' }, actionButtons));
    }

    const tr = el('tr', {
      className: selected.has(row) ? 'data-table__row--selected' : '',
    }, cells);

    return tr;
  }

  function renderSkeleton() {
    const headRow = el('tr', {}, columns.map(col => el('th', { textContent: col.label })));
    const bodyRows = [];
    for (let i = 0; i < 5; i++) {
      bodyRows.push(
        el('tr', { className: 'data-table--loading' },
          columns.map(() => el('td', {}, [
            el('div', { className: 'skeleton data-table__skeleton-row' }),
          ]))
        )
      );
    }
    tableScroll.appendChild(el('table', { className: 'data-table' }, [
      el('thead', {}, [headRow]),
      el('tbody', {}, bodyRows),
    ]));
  }

  function renderPagination(totalFiltered) {
    const totalPages = Math.max(1, Math.ceil(totalFiltered / currentPageSize));
    if (totalFiltered <= PAGE_SIZE_OPTIONS[0]) return;

    const start = totalFiltered === 0 ? 0 : currentPage * currentPageSize + 1;
    const end = Math.min((currentPage + 1) * currentPageSize, totalFiltered);

    const pageSizeSelect = el('select', {
      className: 'pagination__select',
      'aria-label': 'Itens por página',
      onChange: (e) => {
        currentPageSize = parseInt(e.target.value, 10);
        currentPage = 0;
        render();
      },
    }, PAGE_SIZE_OPTIONS.map(size =>
      el('option', { value: String(size), textContent: `${size} por página` })
    ));
    pageSizeSelect.value = String(currentPageSize);

    const info = el('div', { className: 'pagination__info' }, [
      el('span', { textContent: `${start}-${end} de ${totalFiltered}` }),
      pageSizeSelect,
    ]);

    const prevBtn = el('button', {
      className: 'pagination__btn',
      'aria-label': 'Página anterior',
      onClick: () => {
        if (currentPage > 0) {
          currentPage--;
          render();
        }
      },
    }, [svgIcon(ICONS.chevronLeft, 18)]);
    prevBtn.disabled = currentPage === 0;

    const nextBtn = el('button', {
      className: 'pagination__btn',
      'aria-label': 'Próxima página',
      onClick: () => {
        if (currentPage < totalPages - 1) {
          currentPage++;
          render();
        }
      },
    }, [svgIcon(ICONS.chevronRight, 18)]);
    nextBtn.disabled = currentPage >= totalPages - 1;

    paginationEl.appendChild(info);
    paginationEl.appendChild(el('div', { className: 'pagination__controls' }, [prevBtn, nextBtn]));
  }

  function render() {
    clearChildren(tableScroll);
    clearChildren(paginationEl);

    if (isLoading) {
      renderSkeleton();
      return;
    }

    const filtered = getFilteredRows();

    if (!filtered.length) {
      tableScroll.appendChild(el('div', {
        className: 'data-table__empty',
        textContent: searchTerm ? 'Nenhum resultado para a busca' : emptyMessage,
      }));
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / currentPageSize));
    if (currentPage >= totalPages) currentPage = totalPages - 1;

    const startIdx = currentPage * currentPageSize;
    const pageRows = filtered.slice(startIdx, startIdx + currentPageSize);

    const table = el('table', { className: 'data-table' }, [
      buildHeader(pageRows),
      el('tbody', {}, pageRows.map(buildRow)),
    ]);
    tableScroll.appendChild(table);

    renderPagination(filtered.length);
  }

  /**
   * Replace the rows (resets page and selection). Also accepts
   * { rows, loading } to toggle the loading skeleton.
   * @param {Array<Object>|{rows?:Array<Object>, loading?:boolean}} rowsOrState
   */
  function update(rowsOrState) {
    if (Array.isArray(rowsOrState)) {
      allRows = rowsOrState;
      isLoading = false;
    } else if (rowsOrState && typeof rowsOrState === 'object') {
      if (rowsOrState.rows !== undefined) allRows = rowsOrState.rows;
      if (rowsOrState.loading !== undefined) isLoading = rowsOrState.loading;
    }
    currentPage = 0;
    selected.clear();
    notifySelection();
    render();
  }

  function _cleanup() {
    selected.clear();
  }

  render();

  return { element: wrapper, update, getSelected, clearSelection, _cleanup };
}
