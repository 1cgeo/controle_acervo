import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { getRpnps, deleteRpnp } from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { permissoes } from '@store/auth-store.js';
import { openRpnpDialog } from './rpnp-dialog.js';

// O RPNP (Restos a Pagar Não Processados) alimenta a subseção 4.3 do RPCMTec.
const COMPRIMENTO_TRUNCAR = 80;

function truncar(texto) {
  if (!texto) return '-';
  return texto.length > COMPRIMENTO_TRUNCAR ? `${texto.slice(0, COMPRIMENTO_TRUNCAR)}…` : texto;
}

// Nulo nao e zero. `valor_a_liquidar` nulo quer dizer NAO INFORMADO, e
// toNumber(null) devolve 0 (utils/format.js): a linha nula era pintada de
// quitada e afundava na ordem. Em producao sao 11 dos 15 RPNP de 2026, entre
// eles o maior empenho do ano. Um teste guarda isto (list.nulo.test.js).
function temValorALiquidar(row) {
  return row.valor_a_liquidar !== null && row.valor_a_liquidar !== undefined && row.valor_a_liquidar !== '';
}

/**
 * Lista de RPNP (#/rpnp). Restos a pagar não processados; alimenta a subseção 4.3.
 * Filtra pelo ano de contexto global (navbar).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderRpnpList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('orcamento');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openRpnpDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo RPNP']);

  const table = createDataTable({
    columns: [
      {
        key: 'empenho',
        label: 'Empenho',
        render: (row) => row.empenho_label || row.nota_empenho_numero || '-',
      },
      {
        key: 'finalidade',
        label: 'Finalidade',
        className: 'truncate',
        render: (row) => truncar(row.finalidade),
      },
      {
        key: 'valor_empenhado',
        label: 'Empenhado',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_empenhado),
        render: (row) => formatCurrency(row.valor_empenhado),
      },
      {
        key: 'valor_a_liquidar',
        label: 'A liquidar',
        sortable: true,
        // Sem valor proprio, o RPNP entra na ordem pelo tamanho do empenho. O
        // data-table joga null para o FIM em qualquer direcao (data-table.js:167),
        // e o fim e onde ficam os quitados: o nao informado voltaria a ser lido
        // como saldado, que e justamente o defeito corrigido aqui.
        sortValue: (row) => (temValorALiquidar(row)
          ? toNumber(row.valor_a_liquidar)
          : toNumber(row.valor_empenhado)),
        render: (row) => formatCurrency(row.valor_a_liquidar),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    // A lista abre pelo maior valor a liquidar (chefe, 2026-07-31). O RPNP que
    // importa e o que ainda deve dinheiro; o de saldo zero ja e historico e
    // desce para o fim. Antes a ordem era ano e id de cadastro, que nao diz nada
    // sobre o que precisa de acao.
    defaultSort: { key: 'valor_a_liquidar', dir: 'desc' },
    // Saldo zero fica esmaecido: da para varrer a lista e ver de longe onde
    // acaba o que ainda pede trabalho. Sao TRES estados, nao dois: informado
    // maior que zero, informado zero (quitado) e nao informado. So o quitado
    // recebe a classe.
    rowClassName: (row) => (temValorALiquidar(row) && toNumber(row.valor_a_liquidar) <= 0
      ? 'data-table__row--quitada'
      : ''),
    emptyMessage: 'Nenhum RPNP cadastrado',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openRpnpDialog({ rpnpId: row.id, onSaved: load }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  const resumo = el('p', { className: 'page__subtitle', textContent: '' });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('h1', { className: 'page__title', textContent: 'RPNP' }),
        resumo,
      ]),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    table.element,
  ]);
  container.appendChild(page);

  // O total soma SO as linhas com valor informado, e diz quantas ficaram de
  // fora. Somar o nulo como zero daria um total menor que o real, com cara de
  // numero fechado: o usuario decidiria por um valor falso.
  function atualizarResumo(rpnps) {
    const linhas = rpnps || [];
    const informadas = linhas.filter(temValorALiquidar);
    const total = informadas.reduce((soma, rp) => soma + toNumber(rp.valor_a_liquidar), 0);
    const semValor = linhas.length - informadas.length;
    let texto = `${linhas.length} RPNP em ${getAno()}, total a liquidar ${formatCurrency(total)}`;
    if (semValor > 0) {
      texto += `; ${semValor} sem valor informado, fora do total`;
    }
    resumo.textContent = texto;
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getRpnps(getAno());
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
      atualizarResumo(dados);
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      resumo.textContent = '';
      showError(err.message || 'Erro ao carregar RPNP');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir RPNP',
      message: `Tem certeza que deseja excluir o RPNP ${row.empenho_label || row.nota_empenho_numero || ''}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRpnp(row.id);
      showSuccess('RPNP excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir RPNP');
    }
  }

  const offAno = onAnoChange(() => load());

  await load();

  return () => {
    disposed = true;
    offAno();
    table._cleanup();
  };
}
