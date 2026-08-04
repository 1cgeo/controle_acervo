import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showError, showSuccess } from '@utils/toast.js';
import { gravarSubsecao } from '@services/rpcmtec-service.js';

/**
 * O editor de uma subsecao DIGITADA do RPCMTec.
 *
 * AS COLUNAS SAO FIXAS, e vem do servidor. O gestor preenche LINHAS numa grade
 * de cabecalho medido no documento da Divisao; deixa-lo desenhar a tabela
 * produziria uma coluna diferente por mes, e o RPCMTec deixaria de ser
 * comparavel consigo mesmo.
 *
 * A subsecao de PROSA (9.1 a 9.3) cai no mesmo dialogo, com um campo de texto no
 * lugar da grade: e o mesmo gesto do ponto de vista de quem preenche, e uma
 * segunda tela para tres subsecoes so acrescentaria lugar onde procurar.
 *
 * "SEM OCORRENCIA NO MES" e uma acao, e nao um campo vazio. A diferenca e o que
 * separa "nao houve" de "ninguem preencheu": o documento em Word saia igual nos
 * dois casos, e era impossivel saber qual dos dois se estava lendo. O
 * fechamento da edicao cobra a subsecao que ninguem visitou.
 */

/** Uma linha da grade: um input por coluna, mais o botao de remover. */
function criarLinha(cabecalhos, valores, aoRemover) {
  const inputs = cabecalhos.map((_, i) => el('input', {
    className: 'form-field__input rpcm-grade__input',
    type: 'text',
    value: valores[i] ?? '',
  }));

  const remover = el('button', {
    className: 'btn btn--icon btn--danger-text',
    type: 'button',
    title: 'Remover linha',
    onClick: () => aoRemover(linha),
  }, [svgIcon(ICONS.delete, 16)]);

  const linha = el('tr', {}, [
    ...inputs.map((input) => el('td', {}, [input])),
    el('td', { className: 'rpcm-grade__acao' }, [remover]),
  ]);

  linha._valores = () => inputs.map((input) => input.value);
  return linha;
}

/**
 * Abre o editor de uma subsecao.
 *
 * @param {Object} opts
 * @param {number} opts.edicaoId
 * @param {Object} opts.subsecao - o bloco vindo de `/rpcmtec/:id/documento`
 * @param {Function} [opts.onSaved]
 */
export function abrirEditorSubsecao({ edicaoId, subsecao, onSaved = null } = {}) {
  const ehTabela = Boolean(subsecao.cabecalhos);
  let salvando = false;

  let corpo = null;
  let campoTexto = null;
  let conteudo = null;

  if (ehTabela) {
    corpo = el('tbody');

    const aoRemover = (linha) => {
      linha.remove();
      atualizarVazio();
    };

    const vazio = el('p', {
      className: 'rpcm-grade__vazio',
      textContent: 'Nenhuma linha. Use "Adicionar linha" ou marque "sem ocorrência no mês".',
    });

    function atualizarVazio() {
      vazio.classList.toggle('hidden', corpo.children.length > 0);
    }

    for (const valores of (subsecao.linhas || [])) {
      corpo.appendChild(criarLinha(subsecao.cabecalhos, valores, aoRemover));
    }
    atualizarVazio();

    const adicionar = el('button', {
      className: 'btn',
      type: 'button',
      onClick: () => {
        corpo.appendChild(criarLinha(
          subsecao.cabecalhos, subsecao.cabecalhos.map(() => ''), aoRemover,
        ));
        atualizarVazio();
        const inputs = corpo.lastChild.querySelectorAll('input');
        if (inputs.length) inputs[0].focus();
      },
    }, [svgIcon(ICONS.add, 16), 'Adicionar linha']);

    conteudo = el('div', {}, [
      el('div', { className: 'rpcm-grade__wrap' }, [
        el('table', { className: 'rpcm-grade' }, [
          el('thead', {}, [
            el('tr', {}, [
              ...subsecao.cabecalhos.map((rotulo) => el('th', { textContent: rotulo })),
              el('th', { className: 'rpcm-grade__acao' }),
            ]),
          ]),
          corpo,
        ]),
      ]),
      vazio,
      el('div', { className: 'rpcm-grade__rodape' }, [adicionar]),
    ]);
  } else {
    campoTexto = el('textarea', {
      className: 'form-field__textarea',
      rows: 8,
      value: subsecao.texto ?? '',
    });
    conteudo = el('div', { className: 'form-field' }, [campoTexto]);
  }

  /** Grava, com `semOcorrencia` decidindo se o conteudo vai junto. */
  async function salvar(semOcorrencia, fechar) {
    if (salvando) return;
    salvando = true;
    try {
      const linhas = ehTabela && !semOcorrencia
        ? Array.from(corpo.children).map((linha) => linha._valores())
        : [];
      const texto = !ehTabela && !semOcorrencia ? (campoTexto.value || null) : null;

      await gravarSubsecao(edicaoId, subsecao.numero, {
        linhas,
        texto,
        sem_ocorrencia: semOcorrencia,
      });

      showSuccess(
        semOcorrencia
          ? `${subsecao.numero} marcada como sem ocorrência no mês`
          : `${subsecao.numero} gravada com sucesso`,
      );
      fechar();
      if (onSaved) onSaved();
    } catch (err) {
      showError(err.message || 'Erro ao gravar a subseção');
    } finally {
      salvando = false;
    }
  }

  openModal({
    title: `${subsecao.numero}. ${subsecao.titulo}`,
    content: conteudo,
    width: '960px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Sem ocorrência no mês',
        variant: 'secondary',
        onClick: ({ close }) => salvar(true, close),
      },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close }) => salvar(false, close),
      },
    ],
  });
}
