import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { reconciliar } from '@utils/reconciliar.js';

// O primeiro valor tambem e o piso que esconde a paginacao (lista menor que
// ele cabe inteira na tela). O 100 entrou em 2026-07-27, para varrer os pedidos
// do ano sem virar pagina.
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];

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
 * @param {Array<{key:string, label:string, render?:(row:Object)=>(string|Node), sortable?:boolean, className?:string, sortValue?:(row:Object)=>(number|string)}>} options.columns
 *        - render(row) returns a string or a DOM Node for the cell; default is row[key] ?? '-'.
 *        - sortable: enables click-to-sort on the header (sorts by row[key]).
 *        - sortValue(row): valor usado na ordenação, quando row[key] não serve.
 *          Existe por dois motivos concretos. Primeiro, NUMERIC do PostgreSQL
 *          chega como STRING no JSON, e comparar '1000.00' com '500.00' como
 *          texto ordena errado. Segundo, há coluna cujo critério é derivado
 *          (percentual liquidado), e não uma coluna do registro.
 * @param {{key:string, dir?:('asc'|'desc')}} [options.defaultSort] - ordem inicial
 *        da tabela. O clique no cabeçalho continua mandando a partir daí.
 * @param {(row:Object)=>string} [options.rowClassName] - classe extra do <tr>,
 *        para a tela marcar visualmente uma condição (ex.: empenho 100% liquidado).
 * @param {(row:Object)=>(string|number)} [options.rowKey] - identidade ESTÁVEL da
 *        linha, quando ela não tem `id` nem `uuid`. É o que faz a seleção e o nó
 *        do <tbody> sobreviverem a uma recarga: as linhas voltam do servidor como
 *        OBJETOS NOVOS, e comparar por referência perderia todas.
 * @param {Array<Object>} [options.rows]
 * @param {boolean} [options.searchable] - shows the client-side search input
 * @param {number} [options.pageSize] - 5 | 10 | 25 (default 10)
 * @param {boolean} [options.paginated] - false mostra TODAS as linhas e some com o
 *        rodapé de paginação. Use quando a própria consulta já limita o conjunto
 *        (um "Top 10", por exemplo): paginar 10 linhas em páginas de 5 só esconde
 *        metade de uma lista que cabe inteira na tela.
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
  paginated = true,
  actions = [],
  selectable = false,
  onSelectionChange = null,
  emptyMessage = 'Sem dados disponíveis',
  loading = false,
  defaultSort = null,
  rowClassName = null,
  rowKey = null,
}) {
  let allRows = rows;
  let isLoading = loading;
  let searchTerm = '';
  let sortKey = defaultSort ? defaultSort.key : null;
  let sortDir = defaultSort && defaultSort.dir === 'desc' ? -1 : 1; // 1 asc, -1 desc
  let currentPage = 0;
  let currentPageSize = PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : 10;
  // Guarda CHAVES, nunca o objeto da linha. Ver keyOf().
  const selected = new Set();

  // Tabela e corpo vivos entre renders, para o <tbody> se reconciliar em vez de
  // ser recriado. Nulos quando a tela mostra esqueleto ou o estado vazio.
  let tableEl = null;
  let tbodyEl = null;
  // Quantas linhas a tabela pintou da última vez. É o tamanho que o esqueleto
  // copia, para o container não encolher durante o carregamento.
  let paintedRows = 0;

  const tableScroll = el('div', { className: 'data-table-scroll' });
  const paginationEl = el('div', { className: 'pagination' });

  /**
   * Identidade estável da linha, nesta ordem: rowKey das opções, row.id,
   * row.uuid, a própria referência.
   *
   * A ordem vem do que o servidor devolve. Toda listagem do SCA traz `id`, e as
   * rotas do acervo trazem também `uuid`. O prefixo separa os dois espaços: o id
   * numérico 1 nunca colide com um uuid de texto '1'.
   *
   * A referência é o último recurso, e vale só enquanto o objeto for o mesmo.
   * Tabela sem chave estável volta ao comportamento antigo: recarregar perde a
   * seleção, porque as linhas novas são outros objetos.
   *
   * A chave tem de ser ÚNICA na lista. Chave repetida junta as linhas numa só
   * para a seleção. Tabela com id repetido (agregação, junção) passa rowKey.
   */
  function keyOf(row) {
    if (rowKey) {
      const chave = rowKey(row);
      if (chave !== undefined && chave !== null) return chave;
    }
    if (row && typeof row === 'object') {
      if (row.id !== undefined && row.id !== null) return `id:${row.id}`;
      if (row.uuid !== undefined && row.uuid !== null) return `uuid:${row.uuid}`;
    }
    return row;
  }

  const isSelected = (row) => selected.has(keyOf(row));

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
      const col = columns.find(c => c.key === sortKey);
      const valorDe = col && typeof col.sortValue === 'function'
        ? col.sortValue
        : (row) => row[sortKey];

      result = [...result].sort((a, b) => {
        const va = valorDe(a);
        const vb = valorDe(b);
        // Nulo vai para o FIM, independente da direção: a linha sem valor não
        // é "a menor", é a que não responde ao critério.
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
    return allRows.filter(isSelected);
  }

  /**
   * Tira da seleção a chave que não existe mais na lista.
   * Sem a poda, a linha excluída e recriada com o mesmo id voltaria marcada.
   */
  function pruneSelection() {
    if (!selected.size) return;
    const vivas = new Set(allRows.map(keyOf));
    for (const chave of [...selected]) {
      if (!vivas.has(chave)) selected.delete(chave);
    }
  }

  function clearSelection() {
    selected.clear();
    notifySelection();
    render();
  }

  function buildHeader(pageRows) {
    const cells = [];

    if (selectable) {
      const allOnPageSelected = pageRows.length > 0 && pageRows.every(isSelected);
      const headerCheckbox = el('input', {
        className: 'data-table__checkbox',
        type: 'checkbox',
        'aria-label': 'Selecionar todos da página',
        onChange: (e) => {
          if (e.target.checked) {
            pageRows.forEach(r => selected.add(keyOf(r)));
          } else {
            pageRows.forEach(r => selected.delete(keyOf(r)));
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

  // Estado de cada <tr> vivo. O nó sobrevive à recarga, mas a linha que ele
  // mostra é outro objeto: o closure do checkbox e o do botão leem estado.row,
  // nunca a variável capturada na criação. Sem isso o nó reaproveitado
  // dispararia a ação com a linha VELHA, e o bug seria invisível na tela.
  const rowState = new WeakMap();

  function visibleActions(row) {
    // action.visible(row) opcional: oculta a acao para linhas que nao a suportam
    // (ex.: botao de download so quando ha anexo).
    return actions.filter(action => typeof action.visible !== 'function' || action.visible(row));
  }

  function buildActionButton(action, estado) {
    const btn = el('button', {
      className: `data-table__action-btn${action.variant === 'danger' ? ' data-table__action-btn--danger' : ''}`,
      title: action.title || action.label || '',
      'aria-label': action.title || action.label || 'Ação',
      onClick: (e) => {
        e.stopPropagation();
        action.onClick(estado.row);
      },
    });
    if (action.icon) {
      btn.appendChild(svgIcon(action.icon, 18));
    } else {
      btn.textContent = action.label || '';
    }
    return btn;
  }

  /** Monta o <tr> vazio (células e listeners) e pinta nele a primeira linha. */
  function buildRow(row) {
    const estado = { row, checkbox: null, dataCells: [], actionsCell: null, acoes: null };
    const cells = [];

    if (selectable) {
      estado.checkbox = el('input', {
        className: 'data-table__checkbox',
        type: 'checkbox',
        'aria-label': 'Selecionar linha',
        onChange: (e) => {
          const chave = keyOf(estado.row);
          if (e.target.checked) {
            selected.add(chave);
          } else {
            selected.delete(chave);
          }
          notifySelection();
          tr.classList.toggle('data-table__row--selected', selected.has(chave));
        },
      });
      cells.push(el('td', { className: 'data-table__checkbox-cell' }, [estado.checkbox]));
    }

    for (const col of columns) {
      const td = el('td', { className: col.className || '' });
      estado.dataCells.push(td);
      cells.push(td);
    }

    if (actions.length) {
      estado.actionsCell = el('td', { className: 'data-table__actions-cell' });
      cells.push(estado.actionsCell);
    }

    const tr = el('tr', {}, cells);
    rowState.set(tr, estado);
    paintRow(tr, row);

    return tr;
  }

  /** Repinta um <tr> já montado com a linha nova, sem trocar o nó. */
  function paintRow(tr, row) {
    const estado = rowState.get(tr);
    estado.row = row;

    columns.forEach((col, i) => {
      const td = estado.dataCells[i];
      const content = col.render ? col.render(row) : (row[col.key] ?? '-');
      if (content instanceof Node) {
        td.replaceChildren(content);
        // A célula é reaproveitada: o título da carga anterior sairia junto com
        // o nó antigo, e aqui ele não sai sozinho.
        if (td.hasAttribute('title')) td.removeAttribute('title');
      } else {
        td.textContent = String(content);
        if (col.className && col.className.includes('truncate')) {
          td.title = String(content);
        }
      }
    });

    if (estado.actionsCell) {
      const visiveis = visibleActions(row);
      // Os botões só se refazem quando o CONJUNTO visível muda. Assim o foco do
      // teclado sobrevive à recarga que não mexeu nas ações da linha.
      const mesmas = estado.acoes
        && estado.acoes.length === visiveis.length
        && estado.acoes.every((a, i) => a === visiveis[i]);
      if (!mesmas) {
        estado.acoes = visiveis;
        estado.actionsCell.replaceChildren(
          ...visiveis.map(action => buildActionButton(action, estado))
        );
      }
    }

    const classes = [];
    if (isSelected(row)) classes.push('data-table__row--selected');
    if (rowClassName) {
      const extra = rowClassName(row);
      if (extra) classes.push(extra);
    }
    tr.className = classes.join(' ');

    if (estado.checkbox) estado.checkbox.checked = isSelected(row);

    return tr;
  }

  function renderSkeleton() {
    // O esqueleto copia a FORMA da tabela que ele substitui, colunas e linhas.
    // Cinco linhas fixas encolhiam a tela de 25 linhas em cerca de 840 px, e a
    // devolviam logo depois: era a causa principal do "a tela fica se movendo".
    const headCells = [];
    if (selectable) headCells.push(el('th', { className: 'data-table__checkbox-cell' }));
    for (const col of columns) headCells.push(el('th', { textContent: col.label }));
    if (actions.length) {
      headCells.push(el('th', { className: 'data-table__actions-cell', textContent: 'Ações' }));
    }

    // Na primeira carga não há o que copiar, e o pageSize é a melhor aposta do
    // tamanho que a tabela vai ter. A aposta erra quando a lista vem menor que a
    // página, e a tela ainda encolhe uma vez. É só na PRIMEIRA pintura da página:
    // da segunda em diante o número medido manda, e a altura fica reservada.
    const total = paintedRows || currentPageSize;

    const bodyRows = [];
    for (let i = 0; i < total; i++) {
      bodyRows.push(
        el('tr', { className: 'data-table--loading' },
          headCells.map(() => el('td', {}, [
            el('div', { className: 'skeleton data-table__skeleton-row' }),
          ]))
        )
      );
    }
    tableScroll.appendChild(el('table', { className: 'data-table' }, [
      el('thead', {}, [el('tr', {}, headCells)]),
      el('tbody', {}, bodyRows),
    ]));
  }

  /**
   * Reserva a altura medida do container enquanto o esqueleto está no ar.
   * A medida sai ANTES da troca do conteúdo, e a CSS aplica o valor pela classe.
   */
  function reserveHeight(altura) {
    if (altura > 0) {
      tableScroll.style.setProperty('--data-table-altura-reservada', `${altura}px`);
    }
    tableScroll.classList.add('data-table-scroll--carregando');
  }

  function releaseHeight() {
    tableScroll.classList.remove('data-table-scroll--carregando');
    tableScroll.style.removeProperty('--data-table-altura-reservada');
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

  /** Descarta a tabela viva e devolve o container vazio. */
  function resetTable() {
    tableEl = null;
    tbodyEl = null;
    clearChildren(tableScroll);
  }

  function render() {
    // A medida sai ANTES de qualquer troca, senão o container já colapsou.
    const alturaAtual = tableScroll.offsetHeight;
    // Recarga silenciosa: a tabela que JÁ tem linhas montadas não volta ao
    // esqueleto. Ela continua na tela e só avisa que está carregando, por
    // classe. É o que mantém os 34 pontos de chamada de update({loading:true})
    // como estão, sem mexer no layout a cada gravação.
    const recarregando = isLoading && allRows.length > 0;
    wrapper.classList.toggle('data-table-wrapper--recarregando', recarregando);

    clearChildren(paginationEl);

    if (isLoading && !recarregando) {
      reserveHeight(alturaAtual);
      resetTable();
      renderSkeleton();
      return;
    }

    releaseHeight();

    const filtered = getFilteredRows();

    if (!filtered.length) {
      resetTable();
      paintedRows = 0;
      tableScroll.appendChild(el('div', {
        className: 'data-table__empty',
        textContent: searchTerm ? 'Nenhum resultado para a busca' : emptyMessage,
      }));
      return;
    }

    let pageRows = filtered;
    if (paginated) {
      const totalPages = Math.max(1, Math.ceil(filtered.length / currentPageSize));
      if (currentPage >= totalPages) currentPage = totalPages - 1;
      const startIdx = currentPage * currentPageSize;
      pageRows = filtered.slice(startIdx, startIdx + currentPageSize);
    }

    // A tabela só se recria quando não existe (primeira carga) ou quando o
    // esqueleto e o estado vazio a descartaram. Nos demais renders ela fica, e
    // é o que permite reconciliar o corpo em vez de recriá-lo.
    if (!tableEl || tableEl.parentNode !== tableScroll) {
      clearChildren(tableScroll);
      tbodyEl = el('tbody');
      tableEl = el('table', { className: 'data-table' }, [el('thead'), tbodyEl]);
      tableScroll.appendChild(tableEl);
    }

    // O cabeçalho depende do estado inteiro (ordem, "selecionar todos") e não
    // guarda foco: trocá-lo por completo é mais simples e não toca no corpo.
    tableEl.replaceChild(buildHeader(pageRows), tableEl.firstChild);

    // O corpo se reconcilia: a linha de mesma chave mantém o nó, e o foco do
    // teclado sobrevive à recarga.
    reconciliar(tbodyEl, pageRows, {
      chave: keyOf,
      criar: buildRow,
      atualizar: paintRow,
    });
    paintedRows = pageRows.length;

    if (paginated) renderPagination(filtered.length);
  }

  /**
   * Troca as linhas. A página atual e a seleção SOBREVIVEM: quem grava a 40ª
   * pessoa de uma lista de 54 volta para a linha 40, e não para a página 1. A
   * busca e a ordenação já sobreviviam. Também aceita { rows, loading }.
   *
   * A seleção casa por CHAVE (ver keyOf), e não por referência: as linhas novas
   * vêm do servidor como outros objetos.
   *
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
    pruneSelection();
    clampPage();
    notifySelection();
    render();
  }

  /**
   * Traz a página atual de volta para dentro da lista.
   * A lista encolhe (exclusão, filtro do servidor), e a página onde a tela
   * estava pode ter deixado de existir. Aí ela cai para a ÚLTIMA válida.
   */
  function clampPage() {
    const total = getFilteredRows().length;
    const totalPages = Math.max(1, Math.ceil(total / currentPageSize));
    if (currentPage >= totalPages) currentPage = totalPages - 1;
    if (currentPage < 0) currentPage = 0;
  }

  function _cleanup() {
    selected.clear();
  }

  render();

  return { element: wrapper, update, getSelected, clearSelection, _cleanup };
}
