import { el } from '@utils/dom.js';
import { formatDateTime } from '@utils/format.js';
import { chip } from '@components/status-chip.js';
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
 * O ID É QUALIFICADO PELA TABELA, e isso não é enfeite. As duas origens têm
 * sequências próprias, então o mesmo número existe nas duas apontando arquivos
 * diferentes. Um id de excluído colado no cartão "Atualizar checksum" manda o
 * servidor reler OUTRO arquivo, vivo, e gravar nele: a rota não recusa, porque
 * o id existe. Mostrar o número cru era o que permitia esse erro.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */

/** Rótulo do id, sempre com a tabela a que ele pertence. */
function idQualificado(linha) {
  const excluido = linha.origem === 'arquivo_deletado';
  return el('span', { className: 'lista-id' }, [
    el('code', { textContent: `${excluido ? 'excluído' : 'arquivo'} #${linha.id}` }),
  ]);
}

export function renderArquivosProblemaTab(container) {
  return montarListaPaginada({
    container,
    intro: 'Arquivos marcados com status de erro. A marca é gravada pela verificação '
      + 'contra o volume, na aba ao lado: lista vazia significa que nada foi apontado '
      + 'na última verificação, e não que o disco foi conferido hoje. '
      + 'O que fazer com cada um depende da situação: "Arquivo com erro" se recarrega, '
      + 'ou tem o checksum remedido na aba Manutenção; "Arquivo deletado com erro" se '
      + 'investiga no volume, e o id dele NÃO serve para nenhuma ação, porque pertence '
      + 'a outra tabela.',
    colunas: [
      // O id vem qualificado pela tabela: `arquivo #12` e `excluído #12` são
      // dois arquivos diferentes, e o número sozinho não distingue.
      { key: 'id', label: 'Id', render: idQualificado },
      { key: 'nome', label: 'Nome', render: (r) => r.nome || '-' },
      {
        key: 'nome_arquivo',
        label: 'Arquivo',
        render: (r) => el('code', { textContent: `${r.nome_arquivo}.${r.extensao}` }),
      },
      { key: 'versao_nome', label: 'Versão', render: (r) => r.versao_nome || '-' },
      { key: 'volume_nome', label: 'Volume', render: (r) => r.volume_nome || '-' },
      // O servidor manda o rótulo pronto ('Arquivo com erro' / 'Arquivo deletado
      // com erro'), que é o que distingue as duas origens da união. Em chip, e
      // não em texto corrido: é a coluna que decide o que fazer com a linha.
      {
        key: 'tipo',
        label: 'Situação',
        render: (r) => chip(
          r.tipo,
          r.origem === 'arquivo_deletado' ? 'default' : 'error'
        ),
      },
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
