import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showError, showSuccess, showWarning } from '@utils/toast.js';
import { gravarSubsecao, importarRepositorios51 } from '@services/rpcmtec-service.js';

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

/**
 * A UNICA subsecao com importacao de CSV.
 *
 * O numero esta escrito aqui e no caminho da rota
 * (`server/src/rpcmtec/rpcmtec_route.js`), e nao e generico de proposito: o
 * formato lido e o do painel do GitHub, e o painel so alimenta a 5.1. Um botao
 * em todas as 18 subsecoes digitadas ofereceria despejar tabela de commits na
 * 9.3.
 */
const SUBSECAO_COM_CSV = '5.1';

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
  // O dialogo em si, para a importacao poder fecha-lo. Ela grava no servidor e
  // recarrega a tela, entao deixar a grade velha aberta por cima do resultado
  // mostraria numeros que ja nao valem.
  let modal = null;

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

    /** A grade como texto, para comparar o que esta na tela com o que veio. */
    function comoTexto(linhas) {
      return JSON.stringify(linhas.map((l) => l.map((c) => String(c ?? ''))));
    }

    /**
     * A pessoa mexeu na grade sem salvar?
     *
     * A importacao grava no SERVIDOR, e o servidor cruza com o que esta GRAVADO.
     * Um Resumo digitado agora, ainda nao salvo, nao existe para ele: importar
     * por cima o levaria embora. Quem sabe disso e esta tela, entao e ela que
     * avisa.
     */
    function gradeMudou() {
      const naTela = Array.from(corpo.children).map((l) => l._valores());
      return comoTexto(naTela) !== comoTexto(subsecao.linhas || []);
    }

    /**
     * Manda o CSV para o servidor e recarrega a tela com o resultado.
     *
     * O SERVIDOR E QUEM LE O ARQUIVO. Aqui nao se conta virgula nem se procura
     * cabecalho: a regra que decide o que se apaga (casar por repositorio,
     * preservar o Resumo) mora num lugar so, e vale tambem para o `producao_cli`.
     *
     * @param {string} texto - o conteudo do CSV, cru
     */
    async function importarCsv(texto) {
      if (!String(texto).trim()) {
        showError('Nada para importar: o texto do CSV está vazio.');
        return;
      }

      if (gradeMudou()) {
        const ok = await confirmDialog({
          title: 'Importar por cima do que está na tela',
          message: 'Você mexeu na tabela e ainda não salvou. A importação lê o '
            + 'CSV contra o que está GRAVADO no servidor, então o que você '
            + 'digitou agora se perde. Cancele, use "Salvar" e importe depois.',
          confirmLabel: 'Importar e perder o que está na tela',
          danger: true,
        });
        if (!ok) return;
      }

      try {
        await enviar(texto, false);
      } catch (err) {
        // 409 É RECUSA QUE SE CONFIRMA, e não erro: o CSV não traz um
        // repositório que já tem Resumo escrito. A mensagem do servidor nomeia
        // quais são, e é ela que a pessoa precisa ler para decidir.
        if (err.status !== 409) {
          showError(err.message || 'Não foi possível importar o CSV');
          return;
        }

        const ok = await confirmDialog({
          title: 'A importação apaga Resumo já escrito',
          message: err.message,
          confirmLabel: 'Importar e apagar',
          danger: true,
        });
        if (!ok) return;

        try {
          await enviar(texto, true);
        } catch (segundo) {
          showError(segundo.message || 'Não foi possível importar o CSV');
        }
      }
    }

    /** A chamada em si, e o relato do que ela fez. */
    async function enviar(texto, confirmarRemocao) {
      const r = await importarRepositorios51(edicaoId, texto, confirmarRemocao);

      const partes = [`${r.total} repositório(s) na 5.1`];
      if (r.novos.length) partes.push(`${r.novos.length} novo(s)`);
      if (r.resumos_preservados) {
        partes.push(`${r.resumos_preservados} resumo(s) preservado(s)`);
      }
      if (r.removidos.length) partes.push(`${r.removidos.length} removido(s)`);
      showSuccess(`${partes.join(', ')}.`);

      // OS AVISOS APARECEM, e não ficam no corpo da resposta. Eles dizem o que o
      // importador REMENDOU (vírgula sobrando, efetivo vazio), e um remendo que
      // ninguém vê é um remendo aceito calado.
      for (const aviso of (r.avisos || [])) showWarning(aviso);

      if (modal) modal.close();
      if (onSaved) onSaved();
    }

    /** O <input type=file>, escondido: quem se clica é o botão ao lado. */
    const seletor = el('input', {
      type: 'file',
      accept: '.csv,text/csv,text/plain',
      className: 'hidden',
      onChange: async () => {
        const arquivo = seletor.files && seletor.files[0];
        // Limpa AGORA, e não depois: sem isto, escolher o mesmo arquivo duas
        // vezes seguidas não dispara `change` na segunda, e a tela fica muda.
        seletor.value = '';
        if (!arquivo) return;
        try {
          await importarCsv(await arquivo.text());
        } catch (err) {
          showError(err.message || 'Não foi possível ler o arquivo');
        }
      },
    });

    /** O dialogo de COLAR, para quem rodou o `dashboard_cli` no terminal. */
    function abrirColar() {
      const area = el('textarea', {
        className: 'form-field__textarea',
        rows: 10,
        placeholder: 'Repositório,Número de commits,Efetivo\n'
          + 'controle_acervo,42,Cap Fulano;Maj Beltrano',
      });

      openModal({
        title: 'Colar o CSV do github_dashboard',
        width: '640px',
        content: el('div', { className: 'form-field' }, [
          el('p', {
            className: 'form-field__help',
            textContent: 'Cole a saída de `dashboard_cli --formato csv` ou o '
              + 'conteúdo do arquivo baixado em "Dados Consolidados". O Resumo '
              + 'já escrito na 5.1 é preservado.',
          }),
          area,
        ]),
        actions: [
          { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
          {
            label: 'Importar',
            variant: 'primary',
            onClick: ({ close }) => {
              close();
              importarCsv(area.value);
            },
          },
        ],
      });
    }

    /**
     * A barra da 5.1: as DUAS entradas do CSV.
     *
     * As duas existem porque as duas são o caminho real. Quem usa a tela do
     * painel baixa o arquivo; quem rodou o `dashboard_cli` no terminal tem o
     * texto e nenhum arquivo para escolher.
     */
    function barraCsv() {
      return el('div', { className: 'rpcm-grade__importar' }, [
        el('p', {
          className: 'form-field__help',
          textContent: 'Importe o CSV do github_dashboard para preencher '
            + 'repositório, commits e efetivo de uma vez. O Resumo é escrito à '
            + 'mão, e a importação preserva o que já está lá.',
        }),
        seletor,
        el('button', {
          className: 'btn',
          type: 'button',
          onClick: () => seletor.click(),
        }, [svgIcon(ICONS.description, 16), 'Escolher arquivo CSV']),
        el('button', {
          className: 'btn',
          type: 'button',
          onClick: abrirColar,
        }, [svgIcon(ICONS.contentCopy, 16), 'Colar o CSV']),
      ]);
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
      ...(subsecao.numero === SUBSECAO_COM_CSV ? [barraCsv()] : []),
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

  /**
   * O que "Sem ocorrência no mês" APAGA, se apagar alguma coisa.
   *
   * A gravação manda `linhas: []` e `texto: null`, e o UPSERT do servidor
   * sobrescreve o que estava lá. Numa subseção com doze linhas preenchidas, um
   * clique errado no botão vizinho de "Salvar" as leva embora.
   *
   * @returns {number} quantas linhas somem; 1 quando é a prosa preenchida
   */
  function conteudoQueSeriaApagado() {
    if (ehTabela) return corpo.children.length;
    return (campoTexto.value || '').trim() ? 1 : 0;
  }

  /** Grava, com `semOcorrencia` decidindo se o conteudo vai junto. */
  async function salvar(semOcorrencia, fechar) {
    if (salvando) return;

    // CONFIRMA quando há o que perder. Sem conteúdo nenhum a marcação é o gesto
    // esperado, e uma pergunta ali só atrapalharia quem preenche as 18
    // subseções do mês.
    if (semOcorrencia) {
      const quantas = conteudoQueSeriaApagado();
      if (quantas > 0) {
        const oQueSai = ehTabela
          ? `as ${quantas} linha(s) já preenchidas`
          : 'o texto já preenchido';
        const ok = await confirmDialog({
          title: `Marcar ${subsecao.numero} como sem ocorrência`,
          message: `Isto apaga ${oQueSai} desta subseção do RPCMTec. `
            + 'Para guardar o que está na tela, use "Salvar".',
          confirmLabel: 'Apagar e marcar',
          danger: true,
        });
        if (!ok) return;
      }
    }

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

  modal = openModal({
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
