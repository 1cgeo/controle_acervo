import { el, svgIcon, ICONS } from '@utils/dom.js';
import {
  getArquivos,
  uploadArquivo,
  downloadArquivo,
  deleteArquivo,
} from '@modules/orcamento/services/orcamento-service.js';
import { showError, showSuccess } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { permissoes } from '@store/auth-store.js';

const ACCEPT_PDF = '.pdf';
const ACCEPT_PDR = '.pdf,.xlsx,.xls,.csv,.ods';

/**
 * Widget de anexos reutilizavel para NC, DFD, PDR e recolhimento de credito.
 *
 * Modos:
 *  - 'single' (NC/DFD): no maximo 1 anexo; reenviar substitui. Em edicao (com
 *    vinculo) o upload e imediato; em criacao (sem id ainda) o File fica retido
 *    e e enviado por flush(novoVinculo) depois que o registro pai e criado.
 *  - 'multi' (PDR, recolhimento): N anexos. O PDR sempre tem vinculo (pdr_ano) e
 *    sobe na hora; o recolhimento pode nascer sem id, e ai o primeiro arquivo
 *    fica retido e sobe no flush, como no modo single.
 *
 * @param {Object} opts
 * @param {'single'|'multi'} opts.mode
 * @param {Object|null} opts.vinculo - { nota_credito_id } | { dfd_id } |
 *   { pdr_ano } | { recolhimento_id }; sem id => diferido
 * @param {string} [opts.accept] - accept do input file
 * @param {string} [opts.label]
 * @param {string} [opts.buttonLabel] - texto do botao quando vazio (ex.: 'Selecionar PDF')
 * @returns {{ element: HTMLElement, flush: (vinculo:Object)=>Promise<any>, hasPending: ()=>boolean }}
 *
 * PERFIL: o widget e usado em NC, DFD e PDR, entao o gate mora AQUI, uma vez,
 * em vez de em cada tela que o chama. Anexar e POST /orcamento/arquivos
 * (operador) e remover e DELETE (gerente); baixar e consulta e nunca some.
 * Quem so consulta ve a lista de anexos e o botao de baixar, nada mais.
 */
export function createFileAttachment({
  mode = 'single',
  vinculo = null,
  accept,
  label,
  buttonLabel,
} = {}) {
  const isMulti = mode === 'multi';
  const acceptAttr = accept || (isMulti ? ACCEPT_PDR : ACCEPT_PDF);
  const hasVinculo = !!(vinculo && Object.values(vinculo).some((v) => v != null));
  const pode = permissoes('orcamento');

  let arquivos = [];
  let pendingFile = null;
  let busy = false;
  // A mensagem da falha de LEITURA da lista, quando houve. Ver `emptyEl`.
  let erroLeitura = null;

  const listEl = el('div', { className: 'file-attach__list' });

  /**
   * O estado da lista sem itens, em DUAS leituras.
   *
   * "Nenhum arquivo anexado" e uma afirmacao sobre o servidor. Quando a consulta
   * FALHA a lista tambem fica vazia, e a mesma frase passava a mentir: em modo
   * `single` o botao voltava a dizer "Selecionar PDF" em vez de "Substituir", e
   * quem anexasse ali sobrescreveria o extrato que ja estava la.
   */
  const emptyEl = el('div', {
    className: 'file-attach__empty',
    textContent: 'Nenhum arquivo anexado.',
  });
  const fileInput = el('input', {
    type: 'file',
    accept: acceptAttr,
    className: 'hidden',
    onChange: onPick,
  });
  const pickBtn = el('button', {
    type: 'button',
    className: 'btn btn--secondary btn--sm',
    onClick: () => fileInput.click(),
  });

  const root = el('div', { className: 'file-attach' }, [
    label ? el('div', { className: 'file-attach__title', textContent: label }) : null,
    listEl,
    emptyEl,
    el('div', { className: 'file-attach__actions' }, pode.operador ? [pickBtn, fileInput] : []),
  ]);

  function actionBtn(icon, title, onClick, danger = false) {
    const btn = el(
      'button',
      {
        type: 'button',
        className: `data-table__action-btn${danger ? ' data-table__action-btn--danger' : ''}`,
        title,
        onClick,
      },
      [svgIcon(icon, 18)]
    );
    // Os botoes de linha se REFAZEM a cada `render`, entao o `busy` tem de ser
    // aplicado aqui: sem isto o `render({busy:true})` so travava o botao de
    // anexar, e dois cliques no lixo disparavam dois DELETE do mesmo id.
    btn.disabled = busy;
    return btn;
  }

  /**
   * @param {string} name
   * @param {{onDownload:Function|null, onRemove:Function, podeRemover?:boolean}} acoes
   *   podeRemover: o arquivo ainda NAO enviado (pendingFile) sempre pode sair,
   *   porque tirar da mao nao chama rota nenhuma. Ja o anexo salvo depende de
   *   DELETE, que e gerente.
   */
  function fileRow(name, { onDownload, onRemove, podeRemover = true }) {
    return el('div', { className: 'file-attach__item' }, [
      svgIcon(ICONS.description, 18),
      el('span', { className: 'file-attach__name', textContent: name, title: name }),
      el('span', { className: 'file-attach__row-actions' }, [
        onDownload ? actionBtn(ICONS.download, 'Baixar', onDownload) : null,
        podeRemover ? actionBtn(ICONS.delete, 'Remover', onRemove, true) : null,
      ]),
    ]);
  }

  function pickLabel() {
    if (isMulti) return 'Adicionar arquivo';
    const temArquivo = arquivos.length > 0 || pendingFile;
    if (temArquivo) return 'Substituir';
    // Com a leitura falhada nao se sabe se ha anexo, e "Substituir" e o rotulo
    // que NAO promete apagar nada por engano.
    if (erroLeitura) return 'Substituir';
    return buttonLabel || 'Selecionar arquivo';
  }

  function render() {
    listEl.replaceChildren();

    if (hasVinculo) {
      for (const a of arquivos) {
        listEl.appendChild(
          fileRow(a.nome_original, {
            onDownload: () =>
              downloadArquivo(a.id, a.nome_original).catch((e) =>
                showError(e.message || 'Erro ao baixar arquivo')
              ),
            onRemove: () => onRemoveExisting(a),
            podeRemover: pode.gerente,
          })
        );
      }
    } else if (pendingFile) {
      listEl.appendChild(
        fileRow(pendingFile.name, {
          onDownload: null,
          onRemove: () => {
            pendingFile = null;
            render();
          },
        })
      );
    }

    const vazio = listEl.children.length === 0;
    emptyEl.textContent = erroLeitura
      ? `${erroLeitura} A lista de anexos não foi lida, e isto não quer dizer que não há anexo.`
      : 'Nenhum arquivo anexado.';
    emptyEl.classList.toggle('hidden', !vazio);

    pickBtn.replaceChildren(svgIcon(ICONS.add, 16), document.createTextNode(' ' + pickLabel()));
    pickBtn.disabled = busy;
  }

  async function onPick(e) {
    const file = e.target.files && e.target.files[0];
    fileInput.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;

    if (hasVinculo) {
      busy = true;
      render();
      try {
        // A resposta do upload é a lista AUTORITATIVA: ela desfaz a leitura que
        // havia falhado antes.
        arquivos = await uploadArquivo(vinculo, file);
        erroLeitura = null;
        showSuccess('Arquivo anexado com sucesso');
      } catch (err) {
        showError(err.message || 'Erro ao anexar arquivo');
      } finally {
        busy = false;
        render();
      }
    } else {
      pendingFile = file;
      render();
    }
  }

  async function onRemoveExisting(a) {
    // CONFIRMA ANTES. O clique apagava o arquivo do servidor sem pergunta
    // nenhuma, e o lixo fica a um pixel do botao de baixar. A mesma operacao no
    // anexo do RPCMTec ja passa por confirmacao.
    const ok = await confirmDialog({
      title: 'Remover anexo',
      message: `Remover "${a.nome_original}"? O arquivo sai do servidor e esta `
        + 'ação não pode ser desfeita.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;

    busy = true;
    render();
    try {
      await deleteArquivo(a.id);
      arquivos = arquivos.filter((x) => x.id !== a.id);
      showSuccess('Arquivo removido');
    } catch (err) {
      showError(err.message || 'Erro ao remover arquivo');
    } finally {
      busy = false;
      render();
    }
  }

  // Envia o arquivo retido (modo diferido) apos o registro pai ser criado.
  async function flush(novoVinculo) {
    if (!pendingFile) return null;
    const res = await uploadArquivo(novoVinculo, pendingFile);
    pendingFile = null;
    return res;
  }

  // Carrega os anexos existentes (quando ja ha vinculo).
  if (hasVinculo) {
    getArquivos(vinculo)
      .then((lista) => {
        arquivos = lista || [];
        erroLeitura = null;
        render();
      })
      .catch((err) => {
        erroLeitura = err.message || 'Erro ao carregar anexos.';
        render();
        showError(err.message || 'Erro ao carregar anexos');
      });
  }

  render();

  return {
    element: root,
    flush,
    hasPending: () => !!pendingFile,
  };
}
