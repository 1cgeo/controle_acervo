import { el } from '@utils/dom.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import { getArquivosDeletados } from '@modules/acervo/services/admin-service.js';
import { montarListaPaginada } from './lista-paginada.js';

/**
 * Aba "Arquivos excluídos": a LÁPIDE (`acervo.arquivo_deletado`).
 *
 * Excluir no acervo não apaga a linha: ela é copiada para cá com as 21 colunas
 * do arquivo, mais quem excluiu, quando e o MOTIVO. É por isso que a exclusão
 * exige motivo -- sem ele, a lápide seria um registro sumido sem história, e é
 * essa história que esta tela existe para mostrar.
 *
 * A tela é de leitura pura, e não há botão de restaurar: a lápide guarda o
 * REGISTRO, não o byte. O arquivo no volume pode ter sido apagado junto, e um
 * botão de desfazer prometeria o que o sistema não sabe cumprir.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export function renderArquivosExcluidosTab(container) {
  return montarListaPaginada({
    container,
    intro: 'O que foi excluído do acervo, com quem excluiu e por quê. É registro, e não '
      + 'lixeira: não há como restaurar daqui, porque o arquivo no volume pode ter ido '
      + 'junto.',
    colunas: [
      { key: 'id', label: 'Id' },
      { key: 'produto', label: 'Produto', render: (r) => r.produto || r.nome || '-' },
      { key: 'mi', label: 'MI', render: (r) => r.mi || '-' },
      { key: 'versao', label: 'Versão', render: (r) => r.versao || '-' },
      {
        key: 'nome_arquivo',
        label: 'Arquivo',
        render: (r) => el('code', { textContent: `${r.nome_arquivo}.${r.extensao}` }),
      },
      {
        key: 'tamanho_mb',
        label: 'MB',
        render: (r) => formatNumber(r.tamanho_mb),
      },
      {
        key: 'volume_armazenamento_nome',
        label: 'Volume',
        render: (r) => r.volume_armazenamento_nome || '-',
      },
      // O motivo é o campo que justifica a tela existir, então ele não é
      // truncado nem escondido atrás de um clique.
      {
        key: 'motivo_exclusao',
        label: 'Motivo',
        render: (r) => r.motivo_exclusao || '-',
      },
      {
        key: 'usuario_delete_nome',
        label: 'Excluído por',
        render: (r) => r.usuario_delete_nome || '-',
      },
      {
        key: 'data_delete',
        label: 'Quando',
        render: (r) => formatDateTime(r.data_delete),
      },
    ],
    carregar: getArquivosDeletados,
    vazio: 'Nenhum arquivo excluído',
    erro: 'Erro ao carregar os arquivos excluídos',
  });
}
