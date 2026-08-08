import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatBoolean, formatCurrency, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { mostrarErro } from '@components/estado-erro.js';
import * as svc from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openDfdDialog } from './dfd-dialog.js';

/**
 * Valor que mais se repete numa coluna das linhas carregadas.
 *
 * Serve de valor padrao do DFD NOVO: `area_requisitante` e igual nos 8 DFDs
 * reais, e redigita-la a cada cadastro so cria divergencia de grafia. O padrao
 * sai do dado do proprio ano, e nao de um literal no codigo, entao ele acompanha
 * a realidade sozinho.
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
  // SO `tipoItem`: o grau de prioridade saiu do DFD em 2026-08-08, e com a
  // coluna sairam o dominio `dominio.grau_prioridade` e a rota que o servia.
  let dominios = {
    tipoItem: [],
  };
  // Valores padrao do DFD novo, medidos nas linhas do ano carregado.
  let padroes = {};

  // O ano e DESTA tela, comeca no ano atual e nao guarda nada. `permitirOutroAno` porque o ano decide ONDE o DFD e cadastrado:
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
      // contradicao. O ano agora esta no titulo.
      //
      // A coluna "Prioridade" tambem saiu, em 2026-08-08: `grau_prioridade_id`
      // estava preenchida em 1 de 8 DFDs, com um unico valor, e nenhum filtro,
      // agrupamento ou relatorio a lia. A coluna do banco e o dominio inteiro
      // sairam junto.
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
        // CALCULADO desde 2026-08-08: o servidor o deriva da soma dos itens, e
        // ninguem mais o digita. A coluna fica, porque e o numero que o DFD leva
        // ao PCA.
        key: 'valor_estimado',
        label: 'Valor estimado (calc.)',
        sortable: true,
        // NUMERIC chega como texto, e a ordem por string mente. As irmas
        // (notas-empenho, rpnp) ja passam por toNumber.
        sortValue: (row) => toNumber(row.valor_estimado),
        render: (row) => formatCurrency(row.valor_estimado),
      },
      {
        key: 'consta_pca',
        label: 'Consta PCA',
        render: (row) => formatBoolean(row.consta_pca),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum DFD cadastrado',
    actions: [
      {
        // SEM gate de perfil. O DFD leva a area requisitante, o objeto e a
        // LISTA DE ITENS, que sao a substancia do PCA, e o unico caminho ate
        // eles era o botao Editar, so de operador. Quem le o PCA para decidir e
        // justamente o perfil de consulta.
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

  // A tabela vive num no proprio para o estado de ERRO poder tomar o lugar dela
  // e devolve-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        title,
        resumo,
      ]),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', { className: 'page__filters' }, [
      filtroAno.element,
    ]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhum DFD cadastrado": a falha da
   * API lia-se como ano sem PCA, e as duas pedem acoes opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * no: uma segunda falha guardaria o proprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, load);
  }

  function atualizarResumo(dfds) {
    const total = (dfds || []).reduce((soma, d) => soma + (Number(d.valor_estimado) || 0), 0);
    const n = (dfds || []).length;
    resumo.textContent = `PCA ${filtroAno.getAno()}: ${n} ${n === 1 ? 'DFD' : 'DFDs'}, total ${formatCurrency(total)}`;
  }

  async function load() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

    const ano = filtroAno.getAno();
    title.textContent = `DFD ${ano}`;
    table.update({ loading: true });
    try {
      const [dfds, tipoItem] = await Promise.all([
        svc.getDfds(ano),
        svc.getTipoItemDfd(),
      ]);
      if (disposed) return;
      dominios = { tipoItem };
      padroes = {
        area_requisitante: valorMaisComum(dfds, 'area_requisitante'),
      };
      atualizarResumo(dfds);
      table.update({ rows: dfds, loading: false });
    } catch (err) {
      if (disposed) return;
      // O resumo TAMBEM cai. Sem isto a tela mantinha "PCA 2026: 8 DFDs" sobre
      // uma tabela vazia, depois de a carga falhar.
      resumo.textContent = '';
      table.update({ loading: false });
      falhaNaCarga(err);
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
