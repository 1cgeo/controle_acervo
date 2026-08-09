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

/**
 * Uma linha da grade: um input por coluna, mais o botao de remover.
 *
 * `aoTeclar` e `aoColar` chegam de fora porque as duas acoes SAEM da linha:
 * descer do fim da tabela cria linha nova, e colar uma planilha de cinco linhas
 * cria quatro. Quem sabe fazer isso e a grade, e nao a linha.
 */
function criarLinha(cabecalhos, valores, aoRemover, aoTeclar, aoColar) {
  const inputs = cabecalhos.map((_, i) => el('input', {
    className: 'form-field__input rpcm-grade__input',
    type: 'text',
    // O rotulo da coluna vai no campo: na grade nao ha `<label>`, e sem isto o
    // leitor de tela anuncia "caixa de texto" oito vezes por linha.
    'aria-label': cabecalhos[i],
    value: valores[i] ?? '',
  }));

  inputs.forEach((input, coluna) => {
    input.addEventListener('keydown', (e) => aoTeclar(e, linha, coluna));
    input.addEventListener('paste', (e) => aoColar(e, linha, coluna));
  });

  const remover = el('button', {
    className: 'btn btn--icon btn--danger-text',
    type: 'button',
    title: 'Remover esta linha',
    'aria-label': 'Remover esta linha',
    onClick: () => aoRemover(linha),
  }, [svgIcon(ICONS.delete, 16)]);

  const linha = el('tr', {}, [
    ...inputs.map((input) => el('td', {}, [input])),
    el('td', { className: 'rpcm-grade__acao' }, [remover]),
  ]);

  linha._valores = () => inputs.map((input) => input.value);
  linha._inputs = inputs;
  /** A linha so com espaco em branco sai sem pergunta: nao ha o que perder. */
  linha._vazia = () => inputs.every((input) => !input.value.trim());
  return linha;
}

/** A grade como texto, para comparar o que esta na tela com o que veio. */
function comoTexto(linhas) {
  return JSON.stringify(linhas.map((l) => l.map((c) => String(c ?? ''))));
}

/** O primeiro campo preenchido da linha, para a pergunta nomear o que sai. */
function resumoDaLinha(linha) {
  const primeiro = linha._valores().find((v) => v.trim());
  if (!primeiro) return '';
  return primeiro.length > 60 ? `${primeiro.slice(0, 60)}...` : primeiro;
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

    const vazio = el('p', {
      className: 'rpcm-grade__vazio',
      textContent: 'Nenhuma linha. Use "Adicionar linha" ou marque "sem ocorrência no mês".',
    });

    function atualizarVazio() {
      vazio.classList.toggle('hidden', corpo.children.length > 0);
    }

    /** Poe o foco na mesma coluna de outra linha. Falso quando nao ha linha. */
    function focarCelula(linha, coluna) {
      if (!linha || !linha._inputs) return false;
      const alvo = linha._inputs[Math.min(coluna, linha._inputs.length - 1)];
      if (!alvo) return false;
      alvo.focus();
      return true;
    }

    /** Acrescenta uma linha em branco no fim e devolve a linha criada. */
    function acrescentarLinha() {
      const nova = criarLinha(
        subsecao.cabecalhos, subsecao.cabecalhos.map(() => ''),
        aoRemover, aoTeclar, aoColar,
      );
      corpo.appendChild(nova);
      atualizarVazio();
      return nova;
    }

    /**
     * Remove a linha, PERGUNTANDO quando ha o que perder.
     *
     * A linha em branco sai calada: e a que a pessoa acabou de criar por
     * engano, e uma pergunta ali so atrapalharia. A preenchida se confirma,
     * porque o botao fica a um pixel do campo do lado.
     */
    async function aoRemover(linha) {
      if (!linha._vazia()) {
        const ok = await confirmDialog({
          title: `Remover a linha da ${subsecao.numero}`,
          message: `Isto tira da tabela a linha "${resumoDaLinha(linha)}". `
            + 'A remoção só chega ao relatório quando você salvar.',
          confirmLabel: 'Remover a linha',
          danger: true,
        });
        if (!ok) return;
      }

      // O FOCO NÃO CAI NO CORPO DA PÁGINA. Quem removeu com o teclado ficava
      // sem lugar nenhum, e o Tab seguinte recomeçava do topo do diálogo.
      const seguinte = linha.nextElementSibling || linha.previousElementSibling;
      linha.remove();
      atualizarVazio();
      if (!focarCelula(seguinte, 0)) adicionar.focus();
    }

    /**
     * O teclado da grade: digitar a tabela inteira sem tocar no mouse.
     *
     * Enter desce uma linha na mesma coluna, e no fim da tabela CRIA a próxima.
     * As setas andam entre as linhas. O Tab continua o do navegador, andando
     * célula a célula, e passa pelo botão de remover de propósito: ele é o
     * único caminho de teclado para tirar uma linha.
     */
    function aoTeclar(e, linha, coluna) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const proxima = linha.nextElementSibling;
        if (proxima) focarCelula(proxima, coluna);
        else focarCelula(acrescentarLinha(), 0);
        return;
      }
      if (e.key === 'ArrowDown' && linha.nextElementSibling) {
        e.preventDefault();
        focarCelula(linha.nextElementSibling, coluna);
        return;
      }
      if (e.key === 'ArrowUp' && linha.previousElementSibling) {
        e.preventDefault();
        focarCelula(linha.previousElementSibling, coluna);
      }
    }

    /**
     * COLAR DA PLANILHA preenche a matriz a partir da célula atual.
     *
     * O Excel e o Calc põem TAB entre as colunas e quebra de linha entre as
     * linhas. Sem isto, a planilha de doze linhas que o gestor já tem pronta
     * caía inteira dentro de UMA célula, e ele redigitava tudo.
     *
     * Texto de uma célula só (sem TAB e sem quebra) segue o caminho do
     * navegador: colar um nome dentro de um campo tem de continuar sendo colar
     * um nome dentro de um campo.
     */
    async function aoColar(e, linha, coluna) {
      const bruto = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!bruto) return;
      if (!bruto.includes('\t') && !/\r?\n/.test(bruto.trim())) return;
      e.preventDefault();

      const matriz = bruto.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
        .split('\n').map((l) => l.split('\t'));

      // O QUE A COLAGEM APAGA, dito antes. Ela escreve por cima das linhas que
      // já estão abaixo do cursor, e sem a pergunta isso some calado.
      let porCima = 0;
      let conferida = linha;
      for (const celulas of matriz) {
        if (!conferida) break;
        for (let i = 0; i < celulas.length; i++) {
          const alvo = conferida._inputs[coluna + i];
          if (alvo && alvo.value.trim()) porCima += 1;
        }
        conferida = conferida.nextElementSibling;
      }
      if (porCima > 0) {
        const ok = await confirmDialog({
          title: 'Colar por cima do que já está preenchido',
          message: `A colagem escreve ${matriz.length} linha(s) a partir daqui. `
            + `Isso substitui ${porCima} célula(s) já preenchida(s).`,
          confirmLabel: 'Colar e substituir',
          danger: true,
        });
        if (!ok) return;
      }

      let destino = linha;
      let criadas = 0;
      for (const celulas of matriz) {
        if (!destino) {
          destino = acrescentarLinha();
          criadas += 1;
        }
        for (let i = 0; i < celulas.length; i++) {
          const alvo = destino._inputs[coluna + i];
          if (alvo) alvo.value = celulas[i];
        }
        destino = destino.nextElementSibling;
      }
      atualizarVazio();

      const sobra = Math.max(...matriz.map((l) => l.length)) + coluna
        - subsecao.cabecalhos.length;
      showSuccess(
        `${matriz.length} linha(s) coladas, ${criadas} criada(s). `
        + 'Confira e use "Salvar".',
      );
      // COLUNA A MAIS NÃO SOME CALADA: a tabela tem cabeçalho fixo, e a planilha
      // de fora quase sempre traz uma coluna que o documento não tem.
      if (sobra > 0) {
        showWarning(
          `${sobra} coluna(s) da planilha ficaram de fora: a ${subsecao.numero} `
          + `tem ${subsecao.cabecalhos.length} colunas, e elas são fixas.`,
        );
      }
    }

    /**
     * Manda o CSV para o servidor e recarrega a tela com o resultado.
     *
     * O SERVIDOR E QUEM LE O ARQUIVO. Aqui nao se conta virgula nem se procura
     * cabecalho: a regra que decide o que se apaga (casar por repositorio,
     * preservar o Resumo) mora num lugar so, e vale tambem para o `pit_cli`.
     *
     * @param {string} texto - o conteudo do CSV, cru
     */
    async function importarCsv(texto) {
      if (!String(texto).trim()) {
        showError('Nada para importar: o texto do CSV está vazio.');
        return;
      }

      if (mudou()) {
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
      corpo.appendChild(criarLinha(
        subsecao.cabecalhos, valores, aoRemover, aoTeclar, aoColar,
      ));
    }
    atualizarVazio();

    const adicionar = el('button', {
      className: 'btn',
      type: 'button',
      onClick: () => focarCelula(acrescentarLinha(), 0),
    }, [svgIcon(ICONS.add, 16), 'Adicionar linha']);

    conteudo = el('div', {}, [
      ...(subsecao.numero === SUBSECAO_COM_CSV ? [barraCsv()] : []),
      // O QUE CADA BOTÃO FAZ, ANTES DO CLIQUE. "Sem ocorrência no mês" apaga a
      // tabela, e quem descobria isso descobria pela pergunta de confirmação,
      // com a mão já no botão.
      el('p', {
        className: 'form-field__help rpcm-grade__ajuda',
        textContent: 'As colunas são fixas e vêm do documento da Divisão. '
          + 'Enter desce uma linha, e no fim da tabela cria a próxima. '
          + 'Colar da planilha preenche várias linhas de uma vez. '
          + '"Salvar" grava a tabela. "Sem ocorrência no mês" apaga o conteúdo '
          + 'e declara que não houve nada a relatar.',
      }),
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
      'aria-label': `${subsecao.numero}. ${subsecao.titulo}`,
      // O `value` do `<textarea>` é PROPRIEDADE, e não atributo. Ver a lista
      // `PROPRIEDADES_NAO_ATRIBUTOS` em `utils/dom.js`: enquanto o `el()`
      // gravava isto como atributo, este campo abria em branco por cima do
      // texto já escrito, e salvar apagava a subseção.
      value: subsecao.texto ?? '',
    });
    conteudo = el('div', { className: 'form-field' }, [
      el('p', {
        className: 'form-field__help',
        textContent: '"Salvar" grava este texto. "Sem ocorrência no mês" apaga '
          + 'o texto e declara que não houve nada a relatar.',
      }),
      campoTexto,
    ]);
  }

  /** A pessoa mexeu e ainda não salvou? */
  function mudou() {
    if (ehTabela) {
      const naTela = Array.from(corpo.children).map((l) => l._valores());
      return comoTexto(naTela) !== comoTexto(subsecao.linhas || []);
    }
    return (campoTexto.value || '') !== (subsecao.texto ?? '');
  }

  /**
   * A GUARDA DO DESCARTE, para Escape, X, fundo e "Cancelar".
   *
   * Fechar o diálogo jogava fora o que estava na tela sem dizer nada. Numa
   * subseção de doze linhas, um Escape distraído custava a digitação inteira.
   */
  async function podeFechar() {
    if (!mudou()) return true;
    return confirmDialog({
      title: `Sair da ${subsecao.numero} sem salvar`,
      message: 'Você alterou esta subseção e ainda não salvou. Fechar agora '
        + 'descarta o que está na tela.',
      confirmLabel: 'Descartar e fechar',
      cancelLabel: 'Continuar editando',
      danger: true,
    });
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
  async function salvar(semOcorrencia, fechar, setOcupado) {
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
    // O DIÁLOGO NÃO SE FECHA COM A GRAVAÇÃO EM VOO, e o botão clicado mostra
    // que ela começou. Sem isto nada na tela mudava, e um Escape no meio jogava
    // fora o formulário para onde o erro do servidor voltaria.
    if (setOcupado) setOcupado(true);
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
      // GRAVOU: o que está na tela passa a ser o que está no servidor. Sem esta
      // linha a guarda de descarte continuaria vendo alteração pendente, e
      // perguntaria se pode descartar o que ela mesma acabou de salvar.
      if (ehTabela) subsecao.linhas = linhas;
      else subsecao.texto = texto;

      fechar();
      if (onSaved) onSaved();
    } catch (err) {
      // A MENSAGEM DO SERVIDOR VEM PRIMEIRO: ela nomeia a linha e a coluna que
      // não fecham, na palavra do documento. A queda diz o que fazer, e não só
      // que algo deu errado.
      showError(err.message
        || 'Não foi possível gravar a subseção. Confira se a edição do '
        + 'RPCMTec continua aberta e tente de novo.');
    } finally {
      salvando = false;
      if (setOcupado) setOcupado(false);
    }
  }

  modal = openModal({
    title: `${subsecao.numero}. ${subsecao.titulo}`,
    content: conteudo,
    width: '960px',
    podeFechar,
    actions: [
      {
        label: 'Cancelar',
        variant: 'text',
        // `fecharComGuarda`, e não o `close` da ação: "Cancelar" é o caminho
        // mais provável do descarte acidental, e é o que mais precisa da
        // pergunta.
        onClick: () => modal.fecharComGuarda(),
      },
      {
        label: 'Sem ocorrência no mês',
        variant: 'secondary',
        onClick: ({ close, setOcupado }) => salvar(true, close, setOcupado),
      },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => salvar(false, close, setOcupado),
      },
    ],
  });
}
