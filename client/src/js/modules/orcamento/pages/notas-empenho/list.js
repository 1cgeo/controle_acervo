import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import {
  getNotasEmpenho,
  deleteNotaEmpenho,
  getNotasCredito,
  getAnos,
} from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openNotaEmpenhoDialog } from './nota-empenho-dialog.js';

/**
 * O que ainda falta liquidar de uma NE.
 *
 * O empenhado que vale e o LIQUIDO da anulacao: NE anulada em parte nunca vai
 * liquidar o valor cheio, e contar o bruto a deixaria eternamente "em aberto".
 * Nunca devolve negativo, para a linha nao aparecer no topo por erro de
 * lancamento.
 * @param {Object} ne
 * @returns {number}
 */
function aLiquidar(ne) {
  const liquido = toNumber(ne.valor_empenhado) - toNumber(ne.valor_anulado);
  return Math.max(0, liquido - toNumber(ne.total_liquidado));
}

/**
 * Tolerância da quitação, em reais. Meio centavo.
 *
 * Os valores chegam como NUMERIC(15,2) e a subtração roda em ponto flutuante:
 * sobra resíduo. Dado real, a NE 2026NE000023: 2499.01 menos 339.16 menos
 * 2159.85 dá 4.547473508864641e-13, e não zero. Com o teste `<= 0` ela perdia o
 * chip "Liquidada" e subia na ordem padrão, que é por saldo.
 *
 * Meio centavo é menor que a menor diferença que o dado sabe representar: um
 * centavo de verdade continua em aberto.
 */
const TOLERANCIA_QUITACAO = 0.005;

/** A NE ja liquidou tudo o que podia? NE de valor liquido zero conta como sim. */
function estaQuitada(ne) {
  return aLiquidar(ne) < TOLERANCIA_QUITACAO;
}

/**
 * Lista de Notas de Empenho (#/notas_empenho). Filtros no topo: ano da tela e
 * nota de credito. A acao "Ver detalhes" navega para a pagina de detalhes da NE
 * (liquidacoes e recebimentos de material).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx - `?ano=` abre a lista naquele ano
 * @returns {Function} cleanup
 */
export async function renderNotasEmpenhoList(container, ctx) {
  // O ANO VIAJA NA URL (`?ano=`), e por isso a tela o LE do `ctx.query`.
  //
  // Nao contradiz a regra do `criarFiltroAno` (o ano e DA TELA e nao guarda
  // nada): quem o carrega e a URL daquela navegacao, que a pessoa ve na barra de
  // endereco. Sem isto, o link de uma pendencia do painel de 2025 e o "Voltar"
  // de um registro de 2025 caiam numa lista aberta em 2026, onde o que se foi
  // buscar nao existe.
  const anoDaUrl = () => {
    const n = parseInt(((ctx && ctx.query) || new URLSearchParams()).get('ano'), 10);
    return Number.isFinite(n) ? n : null;
  };
  let disposed = false;

  // O NUMERO DA REQUISICAO, que decide quem pinta.
  //
  // `disposed` so protege a SAIDA da pagina. Numa rede lenta, trocar o filtro
  // duas vezes dispara duas cargas, e quem PINTA e a que chegar por ultimo: a
  // resposta antiga pintava por cima da nova, com o seletor mostrando um recorte
  // e a tabela mostrando outro. Aqui so a ULTIMA pedida pinta, no acerto e no
  // erro.
  let requisicao = 0;
  let filtroNotaCredito = null;
  const pode = permissoes('orcamento');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openNotaEmpenhoDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova nota de empenho']);

  // ---- Filtros ----
  // O ano e DESTA tela, comeca no ano atual e nao guarda nada. Trocar o ano tambem LIMPA o filtro de NC: as NCs sao do ano
  // anterior e a lista ficaria presa a uma NC que nao esta mais nas opcoes.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnos,
    anoInicial: anoDaUrl(),
    permitirOutroAno: true,
    onChange: async () => {
      filtroNotaCredito = null;
      notaCreditoFilter.setValue(null);
      await loadFilterOptions();
      await load();
    },
  });

  const notaCreditoFilter = createSelectField({
    label: 'Nota de crédito',
    options: [],
    placeholder: 'Todas as notas de crédito',
    onChange: (id) => {
      filtroNotaCredito = id;
      load();
    },
  });

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'nota_credito_numero',
        label: 'NC',
        render: (row) => row.nota_credito_numero || '-',
      },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        // O numero NAO distingue as NEs: tres NEs reais de 2026 compartilham o
        // 2026NE000024 e so a NC as separa. A finalidade e o unico texto que diz
        // para que serve o empenho, e a busca da tabela varre esta coluna.
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
        key: 'total_liquidado',
        label: 'Liquidado',
        sortable: true,
        sortValue: (row) => toNumber(row.total_liquidado),
        render: (row) => (row.total_liquidado === null || row.total_liquidado === undefined
          ? '-'
          : formatCurrency(row.total_liquidado)),
      },
      {
        // Coluna NOVA, e o criterio de ordem da tela: o que
        // importa e o que ainda falta liquidar. Ela nao vem do backend, e sai da
        // conta empenhado menos anulado menos liquidado.
        key: 'a_liquidar',
        label: 'A liquidar',
        sortable: true,
        sortValue: (row) => aLiquidar(row),
        render: (row) => (estaQuitada(row)
          ? el('span', { className: 'chip chip--success', textContent: 'Liquidada' })
          : formatCurrency(aLiquidar(row))),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    // Maior saldo a liquidar primeiro, e as 100% liquidadas no fim (chefe,
    // Ordenar por ano e numero espalha o que precisa de
    // acao entre o que ja fechou.
    defaultSort: { key: 'a_liquidar', dir: 'desc' },
    rowClassName: (row) => (estaQuitada(row) ? 'data-table__row--quitada' : ''),
    emptyMessage: 'Nenhuma nota de empenho cadastrada',
    actions: [
      {
        // Abre a pagina de detalhes da NE, onde se lancam liquidacoes e
        // recebimentos. Icone de "assignment" (prancheta) deixa claro que e
        // uma area de lancamento/gestao, nao apenas visualizacao.
        icon: ICONS.assignment,
        title: 'Detalhes e lançamento de liquidações',
        onClick: (row) => { location.hash = `/orcamento/notas_empenho/${row.id}`; },
      },
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openNotaEmpenhoDialog({
          neId: row.id,
          ano: filtroAno.getAno(),
          onSaved: load,
        }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  // A tabela vive num no proprio para o estado de ERRO poder tomar o lugar dela
  // e devolve-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Notas de Empenho' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', { className: 'page__filters' }, [
      filtroAno.element,
      notaCreditoFilter.element,
    ]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhuma nota de empenho
   * cadastrada": a falha da API lia-se como ano sem empenho, e as duas pedem
   * acoes opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * no: uma segunda falha guardaria o proprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, load);
  }

  async function loadFilterOptions() {
    try {
      const notasCredito = await getNotasCredito({ ano: filtroAno.getAno() });
      if (disposed) return;
      notaCreditoFilter.setOptions((notasCredito || []).map(nc => ({
        value: nc.id,
        label: nc.cod_nd ? `${nc.numero ?? `NC ${nc.id}`} - ${nc.cod_nd}` : (nc.numero ?? `NC ${nc.id}`),
      })));
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar filtros');
    }
  }

  async function load() {
    const minha = ++requisicao;
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

    table.update({ loading: true });
    try {
      const dados = await getNotasEmpenho({
        ano: filtroAno.getAno(),
        nota_credito_id: filtroNotaCredito ?? undefined,
      });
      if (disposed || minha !== requisicao) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed || minha !== requisicao) return;
      table.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar notas de empenho');
    }
  }

  async function handleDelete(row) {
    // O NUMERO SOZINHO NAO IDENTIFICA A NE: tres NEs reais de 2026 compartilham
    // o 2026NE000024, e so a NC e a finalidade as separam (ver o comentario da
    // coluna "Finalidade" acima). A confirmacao nomeia as tres coisas, como a da
    // nota de credito ja faz com a chave dela.
    //
    // A FINALIDADE ENTRA CORTADA. Ela e TEXT sem limite, e a coluna da tabela ja
    // corta por CSS; a caixa de confirmacao, nao. Uma finalidade de duzentos
    // caracteres empurrava o botao "Excluir" para baixo da dobra do modal em
    // tela estreita, e a frase que importa ("Esta acao nao pode ser desfeita")
    // ficava atras do texto colado. A regua e a mesma da licitacao: 80.
    const finalidadeCurta = row.finalidade && row.finalidade.length > 80
      ? `${row.finalidade.slice(0, 80)}…`
      : row.finalidade;
    const rotulo = [
      row.numero,
      row.ano != null ? `ano ${row.ano}` : null,
      row.nota_credito_numero ? `NC ${row.nota_credito_numero}` : null,
      finalidadeCurta || null,
    ].filter(Boolean).join(' / ');
    const ok = await confirmDialog({
      title: 'Excluir nota de empenho',
      message: `Tem certeza que deseja excluir a NE ${rotulo}? Esta ação não pode `
        + 'ser desfeita. Uma NE com liquidação ou recebimento lançado é recusada.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteNotaEmpenho(row.id);
      showSuccess('Nota de empenho excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir nota de empenho');
    }
  }

  await loadFilterOptions();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
