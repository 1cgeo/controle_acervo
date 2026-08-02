import { el } from '@utils/dom.js';
import { formatDateTime } from '@utils/format.js';
import { getArquivosIncorretos } from '@modules/acervo/services/admin-service.js';
import { montarListaPaginada } from './lista-paginada.js';

/**
 * Aba "Arquivos com problema": o que está marcado com status de ERRO.
 *
 * A lista mistura duas origens de propósito, e a coluna "Situação" é o que as
 * separa: arquivo vivo com erro de carregamento, e arquivo já excluído cuja
 * exclusão falhou. São dois trabalhos diferentes -- o primeiro se recarrega, o
 * segundo se investiga no volume --, e uni-los numa lista só é o que permite
 * ver, de uma vez, tudo o que o acervo sabe estar errado.
 *
 * QUEM ESCREVE ESSE STATUS é a aba "Verificar arquivos no volume": ela relê o
 * disco e reclassifica nos dois sentidos. Esta aba só lê o resultado, e por isso
 * uma lista vazia aqui não quer dizer "está tudo certo" -- quer dizer "ninguém
 * verificou desde a última correção".
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export function renderArquivosProblemaTab(container) {
  return montarListaPaginada({
    container,
    intro: 'Arquivos marcados com status de erro. A marca é gravada pela verificação '
      + 'contra o volume, na aba ao lado: lista vazia significa que nada foi apontado '
      + 'na última verificação, e não que o disco foi conferido hoje.',
    colunas: [
      { key: 'id', label: 'Id' },
      { key: 'nome', label: 'Nome', render: (r) => r.nome || '-' },
      {
        key: 'nome_arquivo',
        label: 'Arquivo',
        render: (r) => el('code', { textContent: `${r.nome_arquivo}.${r.extensao}` }),
      },
      { key: 'versao_nome', label: 'Versão', render: (r) => r.versao_nome || '-' },
      { key: 'volume_nome', label: 'Volume', render: (r) => r.volume_nome || '-' },
      // O servidor manda o rótulo pronto ('Arquivo com erro' / 'Arquivo deletado
      // com erro'), que é o que distingue as duas origens da união.
      { key: 'tipo', label: 'Situação' },
      {
        key: 'data_modificacao',
        label: 'Última mudança',
        render: (r) => formatDateTime(r.data_modificacao || r.data_cadastramento),
      },
    ],
    carregar: getArquivosIncorretos,
    vazio: 'Nenhum arquivo marcado com erro',
    erro: 'Erro ao carregar os arquivos com problema',
  });
}
