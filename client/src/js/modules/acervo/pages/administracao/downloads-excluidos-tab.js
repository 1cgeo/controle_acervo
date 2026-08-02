import { el } from '@utils/dom.js';
import { formatDateTime } from '@utils/format.js';
import { getDownloadsDeletados } from '@modules/acervo/services/admin-service.js';
import { montarListaPaginada } from './lista-paginada.js';

/**
 * Aba "Downloads excluídos": quem baixou o arquivo ANTES de ele ser excluído.
 *
 * Excluir um arquivo leva os downloads dele junto para `acervo.download_deletado`.
 * A pergunta que esta tela responde não é "quem baixou", é "quem ficou com uma
 * cópia do que não existe mais" -- é o que se consulta quando um produto sai do
 * acervo por estar errado e alguém precisa avisar quem já o levou.
 *
 * O vínculo com a lápide é por `arquivo_deletado_id`, e não pela ordem em que o
 * banco devolveu os ids: por ordem, funcionaria hoje e trocaria os downloads de
 * dois arquivos no dia em que o plano de consulta mudasse, sem erro nenhum e
 * com as contagens ainda batendo.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export function renderDownloadsExcluidosTab(container) {
  return montarListaPaginada({
    container,
    intro: 'Quem baixou um arquivo antes de ele ser excluído do acervo. É a lista de '
      + 'quem ficou com uma cópia do que não existe mais.',
    colunas: [
      { key: 'id', label: 'Id' },
      { key: 'usuario_nome', label: 'Baixou', render: (r) => r.usuario_nome || '-' },
      {
        key: 'data_download',
        label: 'Quando baixou',
        render: (r) => formatDateTime(r.data_download),
      },
      { key: 'arquivo_nome', label: 'Arquivo', render: (r) => r.arquivo_nome || '-' },
      {
        key: 'nome_arquivo',
        label: 'Nome físico',
        render: (r) => (r.nome_arquivo ? el('code', { textContent: r.nome_arquivo }) : '-'),
      },
      {
        key: 'motivo_exclusao',
        label: 'Motivo da exclusão',
        render: (r) => r.motivo_exclusao || '-',
      },
      {
        key: 'data_delete',
        label: 'Excluído em',
        render: (r) => formatDateTime(r.data_delete),
      },
    ],
    carregar: getDownloadsDeletados,
    vazio: 'Nenhum download de arquivo excluído',
    erro: 'Erro ao carregar os downloads excluídos',
  });
}
