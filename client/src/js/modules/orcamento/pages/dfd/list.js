import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import * as svc from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openDfdDialog } from './dfd-dialog.js';

/**
 * Valor que mais se repete numa coluna das linhas carregadas.
 *
 * Serve de valor padrao do DFD NOVO: `area_requisitante` e
 * `vinculo_plano_gestao` sao iguais nos 8 DFDs reais, e redigitar os dois a cada
 * cadastro so cria divergencia de grafia. O padrao sai do dado do proprio ano,
 * e nao de um literal no codigo, entao ele acompanha a realidade sozinho.
 *
 * @param {Array<Object>} linhas
 * @param {string} campo
 * @returns {string|null} null quando nao ha valor preenchido
 */
function valorMaisComum(linhas, campo) {
  const contagem = new Map();
  for (const linha of (linhas || [])) {
    const valor = linha[campo];
    if (valor === null || valor === undefined || valor === '') continue;
    contagem.set(valor, (contagem.get(valor) || 0) + 1);
  }
  let escolhido = null;
  let maior = 0;
  for (const [valor, vezes] of contagem) {
    if (vezes > maior) { escolhido = valor; maior = vezes; }
  }
  return escolhido;
}

/**
 * Lista de DFD (#/dfd). Documento de Formalizacao da Demanda, com itens.
 * O conjunto de DFDs do ano da tela e o "PCA do ano".
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderDfdList(container, _ctx) {
  let disposed = false;
  // Criar e editar DFD sao operador; excluir e gerente. Baixar o anexo e
  // consulta e fica para todo mundo.
  const pode = permissoes('orcamento');
  // Dominios e selects compartilhados pelos dialogs (carregados uma vez).
  let dominios = {
    grauPrioridade: [],
    tipoItem: [],
  };
  // Valores padrao do DFD novo, medidos nas linhas do ano carregado.
  let padroes = {};

  // O ano e DESTA tela, comeca no ano atual e nao guarda nada (chefe,
  // 2026-08-04). `permitirOutroAno` porque o ano decide ONDE o DFD e cadastrado:
  // montar o PCA do exercicio seguinte comeca num ano vazio.
  const filtroAno = criarFiltroAno({
    carregarAnos: svc.getAnos,
    permitirOutroAno: true,
    onChange: () => load(),
  });

  const title = el('h1', { className: 'page__title', textContent: `DFD ${filtroAno.getAno()}` });
  const resumo = el('p', { className: 'page__subtitle', textContent: '' });

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openDfdDialog({
      ano: filtroAno.getAno(),
      dominios,
      padroes,
      onSaved: load,
    }),
  }, [svgIcon(ICONS.add, 16), 'Novo DFD']);

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      // A coluna "Ano" saiu daqui: a lista ja e filtrada pelo ano, entao ela
      // repetia o mesmo valor em toda linha. Pior, o numero real e "103/2025"
      // dentro do ano 2026, e as duas colunas lado a lado se liam como
      // contradicao. O ano agora esta no titulo. O grau de prioridade, que o
      // servidor ja mandava e nenhuma coluna mostrava, ocupa o lugar.
      {
        key: 'grau_prioridade',
        label: 'Prioridade',
        sortable: true,
        render: (row) => row.grau_prioridade || '-',
      },
      { key: 'rotulo', label: 'Rótulo', render: (row) => row.rotulo || '-' },
      {
        // O texto INTEIRO vai para a celula, e o corte e da CSS. Cortar antes
        // fazia o `title` do <td> (data-table.js:347-348) repetir o texto ja
        // cortado, entao passar o mouse nao revelava nada. A classe 'truncate'
        // tambem nao existe no CSS: as reais sao `.text-truncate` e
        // `.data-table__cell--truncate`. 4 dos 8 objetos de 2026 passam de 80
        // caracteres, e o maior tem 201.
        key: 'objeto',
        label: 'Objeto',
        className: 'data-table__cell--truncate',
        render: (row) => row.objeto || '-',
      },
      {
        key: 'valor_estimado',
        label: 'Valor estimado',
        sortable: true,
        // NUMERIC chega como texto, e a ordem por string mente. As irmas
        // (notas-empenho, rpnp) ja passam por toNumber.
        sortValue: (row) => toNumber(row.valor_estimado),
        render: (row) => formatCurrency(row.valor_estimado),
      },
      {
        key: 'consta_pca',
        label: 'Consta PCA',
        render: (row) => (row.consta_pca ? 'Sim' : 'Não'),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum DFD cadastrado',
    actions: [
      {
        // SEM gate de perfil. O DFD leva justificativa, area requisitante,
        // prazo, vinculo e a LISTA DE ITENS, que sao a substancia do PCA, e o
        // unico caminho ate eles era o botao Editar, so de operador. Quem le o
        // PCA para decidir e justamente o perfil de consulta.
        icon: ICONS.visibility,
        title: 'Ver',
        onClick: (row) => handleVer(row),
      },
      {
        icon: ICONS.download,
        title: 'Baixar anexo (PDF)',
        visible: (row) => row.arquivo_id != null,
        onClick: (row) => svc.downloadArquivo(row.arquivo_id, row.arquivo_nome)
          .catch((err) => showError(err.message || 'Erro ao baixar anexo')),
      },
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => handleEdit(row),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        title,
        resumo,
      ]),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [
      filtroAno.element,
    ]),
    table.element,
  ]);
  container.appendChild(page);

  function atualizarResumo(dfds) {
    const total = (dfds || []).reduce((soma, d) => soma + (Number(d.valor_estimado) || 0), 0);
    const n = (dfds || []).length;
    resumo.textContent = `PCA ${filtroAno.getAno()}: ${n} ${n === 1 ? 'DFD' : 'DFDs'}, total ${formatCurrency(total)}`;
  }

  async function load() {
    const ano = filtroAno.getAno();
    title.textContent = `DFD ${ano}`;
    table.update({ loading: true });
    try {
      const [dfds, grauPrioridade, tipoItem] = await Promise.all([
        svc.getDfds(ano),
        svc.getGrauPrioridade(),
        svc.getTipoItemDfd(),
      ]);
      if (disposed) return;
      dominios = { grauPrioridade, tipoItem };
      padroes = {
        area_requisitante: valorMaisComum(dfds, 'area_requisitante'),
        vinculo_plano_gestao: valorMaisComum(dfds, 'vinculo_plano_gestao'),
      };
      atualizarResumo(dfds);
      table.update({ rows: dfds, loading: false });
    } catch (err) {
      if (disposed) return;
      // O resumo TAMBEM cai. Sem isto a tela mantinha "PCA 2026: 8 DFDs" sobre
      // uma tabela vazia, depois de a carga falhar.
      resumo.textContent = '';
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar DFD');
    }
  }

  async function handleVer(row) {
    try {
      const dfd = await svc.getDfd(row.id);
      if (disposed) return;
      openDfdDialog({ dfd, dominios, somenteLeitura: true });
    } catch (err) {
      showError(err.message || 'Erro ao carregar DFD');
    }
  }

  async function handleEdit(row) {
    try {
      const dfd = await svc.getDfd(row.id);
      if (disposed) return;
      openDfdDialog({ dfd, dominios, onSaved: load });
    } catch (err) {
      showError(err.message || 'Erro ao carregar DFD');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir DFD',
      message: `Tem certeza que deseja excluir o DFD ${row.numero}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await svc.deleteDfd(row.id);
      showSuccess('DFD excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir DFD');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
