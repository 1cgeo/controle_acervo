import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatBoolean, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { permissoes } from '@store/auth-store.js';
import {
  getVolumesArmazenamento,
  excluirVolumesArmazenamento,
} from '@modules/acervo/services/admin-service.js';
import { openVolumeDialog } from './volume-dialog.js';

/**
 * Aba "Armazenamento": os volumes onde o acervo grava arquivo.
 *
 * Ela existe na WEB porque a tarefa nao tem nada de espacial: so no plugin, o
 * cadastro exigiria QGIS instalado.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderVolumesTab(container) {
  let disposed = false;
  const pode = permissoes('acervo');

  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openVolumeDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo volume']);

  const table = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true },
      // O caminho e monoespacado porque e um valor a ser conferido caractere a
      // caractere, e nao um texto a ser lido.
      {
        key: 'volume',
        label: 'Caminho',
        sortable: true,
        render: (row) => el('code', { textContent: row.volume }),
      },
      {
        key: 'capacidade_gb',
        label: 'Capacidade (GB)',
        sortable: true,
        render: (row) => formatNumber(row.capacidade_gb),
      },
      {
        key: 'layout_origem',
        label: 'Layout de origem',
        sortable: true,
        render: (row) => formatBoolean(row.layout_origem),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum volume de armazenamento cadastrado',
    actions: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openVolumeDialog({ volume: row, onSaved: load }),
      },
      // Excluir e GERENTE no servidor, um nivel acima de criar e editar: o
      // volume e referenciado por arquivo, por arquivo deletado e pela
      // associacao com tipo de produto.
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ] : [],
  });

  // A tabela mora num container proprio para o estado de erro poder toma-lo sem
  // levar junto o texto de apoio e o botao "Novo volume".
  const areaTabela = el('div', {}, [table.element]);

  const secao = el('div', {}, [
    el('div', { className: 'admin-aba__topo' }, [
      el('p', {
        className: 'page__subtitle',
        textContent: 'Volumes onde os arquivos do acervo são gravados. O caminho é '
          + 'o que o servidor enxerga, e não o que a sua máquina tem mapeado.',
      }),
      el('div', { className: 'page__actions' }, pode.operador ? [novoBtn] : []),
    ]),
    areaTabela,
  ]);
  container.appendChild(secao);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getVolumesArmazenamento();
      if (disposed) return;
      // Devolve a tabela que uma falha anterior tirou daqui.
      if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);
      const rows = dados.map(v => ({ ...v, capacidade_gb: Number(v.capacidade_gb) }));
      table.update({ rows, loading: false });
    } catch (err) {
      if (disposed) return;
      // Estado de ERRO, e nao tabela zerada. Com zero linhas a tabela dizia
      // "Nenhum volume de armazenamento cadastrado", e esta e a tela em que
      // alguem leria isso e cadastraria de novo um volume que ja existe.
      table.update({ rows: [], loading: false });
      mostrarErro(areaTabela, err, load);
      showError(err.message || 'Erro ao carregar os volumes de armazenamento');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir volume de armazenamento',
      message: `Excluir o volume "${row.nome}"? A exclusão falha enquanto houver `
        + 'arquivo, arquivo excluído ou tipo de produto associado a ele.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await excluirVolumesArmazenamento([row.id]);
      showSuccess('Volume excluído com sucesso');
      await load();
    } catch (err) {
      // O servidor ja diz QUAL vinculo impediu ("há Arquivos associados ao
      // volume", "há Volume Tipo Produto associados"). Trocar por um texto
      // generico aqui esconderia justamente o que a pessoa precisa desfazer.
      showError(err.message || 'Erro ao excluir o volume');
    }
  }

  // A primeira carga e AGUARDADA: o `ready` do componente de abas espera o
  // render, entao quem espera por ele (o teste, e a troca de aba) encontra a
  // tabela ja preenchida em vez de um esqueleto que enche depois.
  await load();

  return {
    cleanup: () => {
      disposed = true;
      table._cleanup();
    },
    refresh: load,
  };
}
