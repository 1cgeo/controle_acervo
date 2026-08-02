import { el, svgIcon, ICONS } from '@utils/dom.js';
import { monthName } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import {
  getRpcmtec,
  downloadRpcmtecDocx,
  downloadAnuarioOds,
  downloadRtmOds,
} from '@services/rpcmtec-service.js';

/**
 * RPCMTec (#/rpcmtec): o relatorio mensal da Divisao, inteiro, numa tela so.
 *
 * TELA DE PLATAFORMA, como a de usuarios e a de metas do PIT. Ate 2026-08-01
 * eram DUAS, uma dentro da mapoteca (#/mapoteca/rpcmtec, com acervo e mapoteca)
 * e outra dentro do orcamento (#/orcamento/relatorio, com o PDR), cada uma
 * gerando um DOCX proprio com numeracao propria. Quem montava a edicao mensal
 * abria os dois arquivos e colava um no outro, no Word, todo mes.
 *
 * O QUE ELA MOSTRA e exatamente o que vai para o arquivo: as secoes chegam do
 * servidor ja com as celulas em texto, e esta tela so as desenha. Nao ha
 * formatacao aqui de proposito -- com a tela arredondando por conta, ela e o
 * DOCX divergiam e quem conferia via diferenca onde nao havia.
 *
 * O ANO tem seletor PROPRIO, e nao o da navbar: aquele e contexto de MODULO
 * (`@sca-mapoteca-ano`, `@sca-orcamento-ano`) e nao existe fora deles. O mes
 * tambem e daqui, porque o RPCMTec e sempre de um mes especifico.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderRpcmtec(container, _ctx) {
  let disposed = false;
  // Uma tabela por subsecao, indexada pelo numero ('2.7'). Elas sao criadas na
  // PRIMEIRA geracao, e nao aqui: quais subsecoes existem e o servidor que diz.
  const tabelas = new Map();

  const hoje = new Date();
  const anoCorrente = hoje.getFullYear();

  const mesSelect = el('select', {
    className: 'form-field__select',
    id: 'rpcmtec-mes',
    'aria-label': 'Selecionar mês',
    onChange: () => {
      // O rotulo do RTM carrega o mes, entao ele muda junto.
      atualizarRotuloRtm();
      gerar();
    },
  }, Array.from({ length: 12 }, (_, i) => el('option', {
    value: String(i + 1),
    textContent: monthName(i + 1),
  })));
  mesSelect.value = String(hoje.getMonth() + 1);

  // Do ano corrente para tras. Cinco anos cobrem o que se reabre na pratica: a
  // edicao mais antiga que alguem gera de novo e a do exercicio anterior.
  const anoSelect = el('select', {
    className: 'form-field__select',
    id: 'rpcmtec-ano',
    'aria-label': 'Selecionar ano',
    onChange: () => gerar(),
  }, Array.from({ length: 5 }, (_, i) => el('option', {
    value: String(anoCorrente - i),
    textContent: String(anoCorrente - i),
  })));
  anoSelect.value = String(anoCorrente);

  const baixarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => baixar(),
  }, [svgIcon(ICONS.print, 16), 'Baixar DOCX']);

  // O Anuario Estatistico sobe para a DSG no MESMO envio mensal que o RPCMTec, e
  // por isso sai da mesma tela e do mesmo mes: e uma tarefa so.
  //
  // Ele e SO DOWNLOAD, sem previa em tela (chefe, 2026-08-01). O destino dele e
  // uma aba de planilha, que se confere no proprio arquivo; e como o .ods sai da
  // planilha-semente da DSG com os valores trocados, ele ja chega no formato
  // final. Uma tabela aqui repetiria pior o que o arquivo mostra.
  const anuarioBtn = el('button', {
    className: 'btn',
    type: 'button',
    onClick: () => baixarAnuario(),
  }, [svgIcon(ICONS.print, 16), 'Baixar Anuário (ODS)']);

  // O RTM sobe para a DSG no mesmo envio, e por isso sai da mesma barra. Ele
  // tambem passou a seguir o MES escolhido em 2026-08-02 (chefe), com uma
  // diferenca que o rotulo precisa dizer: ele e ACUMULADO. Escolher marco traz
  // janeiro, fevereiro e marco; o DOCX e o Anuario trazem so marco.
  //
  // Ate esta data ele era do ano inteiro e o `mes` que a tela mandava era
  // ignorado pelo servidor: trocar o mes devolvia o mesmo arquivo.
  //
  // O rotulo carrega o mes escolhido porque o botao e o unico lugar em que essa
  // diferenca aparece; "Baixar RTM (ODS)" ao lado dos outros dois se leria como
  // se os tres fossem do mesmo periodo.
  const rtmBtn = el('button', {
    className: 'btn',
    type: 'button',
    title: 'Detalhamento da Meta 4 do PIT, acumulado de janeiro até o mês escolhido. '
      + 'O DOCX e o Anuário trazem apenas o mês.',
    onClick: () => baixarRtm(),
  }, [svgIcon(ICONS.print, 16), el('span', { className: 'rpcm-rtm-rotulo' })]);

  /** Mantem o rotulo do RTM em dia com o mes escolhido. */
  function atualizarRotuloRtm() {
    const nome = monthName(Number(mesSelect.value));
    rtmBtn.querySelector('.rpcm-rtm-rotulo').textContent =
      `Baixar RTM até ${nome} (ODS)`;
  }

  atualizarRotuloRtm();

  const toolbar = el('div', { className: 'rpcm-toolbar' }, [
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-mes', textContent: 'Mês' }),
      mesSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-ano', textContent: 'Ano' }),
      anoSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__spacer' }),
    rtmBtn,
    anuarioBtn,
    baixarBtn,
  ]);

  const secoesArea = el('div');

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header page__header--column' }, [
      el('h1', { className: 'page__title', textContent: 'RPCMTec' }),
      el('p', {
        className: 'page__subtitle',
        textContent: 'Relatório de Prestação de Contas Mensal Técnico. Acervo, mapoteca e orçamento numa geração só, na numeração e no formato do documento da Divisão.',
      }),
      toolbar,
    ]),
    secoesArea,
  ]);
  container.appendChild(page);

  /** Desenha a estrutura (uma tabela por subsecao) a partir do que o servidor mandou. */
  function montarEstrutura(secoes) {
    for (const tabela of tabelas.values()) tabela._cleanup();
    tabelas.clear();
    secoesArea.replaceChildren();

    for (const secao of secoes) {
      secoesArea.appendChild(el('h2', {
        className: 'page__section-title',
        textContent: secao.titulo,
      }));

      for (const sub of secao.subsecoes) {
        // As colunas viram c0, c1, ... porque a celula chega POSICIONAL (uma
        // lista por linha), do mesmo jeito que o DOCX a desenha. Dar nome de
        // campo a cada uma exigiria um contrato por subsecao, duplicado entre
        // servidor e tela, e e exatamente esse contrato duplicado que deixava as
        // duas telas antigas divergirem do arquivo.
        const columns = sub.cabecalhos.map((label, i) => ({
          key: `c${i}`,
          label,
          render: (row) => row[`c${i}`] ?? '-',
        }));

        const tabela = createDataTable({
          columns,
          rows: [],
          pageSize: 25,
          emptyMessage: 'Sem dados no período',
        });
        tabelas.set(sub.numero, tabela);

        secoesArea.appendChild(el('div', { className: 'dashboard-section' }, [
          el('div', { className: 'dashboard-section__header' }, [
            el('h3', {
              className: 'dashboard-section__title',
              textContent: `${sub.numero}. ${sub.titulo}`,
            }),
          ]),
          tabela.element,
        ]));
      }
    }
  }

  function preencher(secoes) {
    for (const secao of secoes) {
      for (const sub of secao.subsecoes) {
        const tabela = tabelas.get(sub.numero);
        if (!tabela) continue;
        const rows = sub.linhas.map((celulas) =>
          Object.fromEntries(celulas.map((valor, i) => [`c${i}`, valor])));
        tabela.update({ rows, loading: false });
      }
    }
  }

  function getParams() {
    return {
      ano: parseInt(anoSelect.value, 10),
      mes: parseInt(mesSelect.value, 10),
    };
  }

  async function gerar() {
    for (const tabela of tabelas.values()) tabela.update({ loading: true });
    try {
      const dados = await getRpcmtec(getParams());
      if (disposed) return;
      // A estrutura e remontada a cada geracao porque o servidor pode mudar o
      // conjunto de subsecoes (uma subsecao nova entra sem tocar nesta tela).
      montarEstrutura(dados.secoes);
      preencher(dados.secoes);
    } catch (err) {
      if (disposed) return;
      for (const tabela of tabelas.values()) tabela.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao gerar o RPCMTec');
    }
  }

  async function baixar() {
    baixarBtn.disabled = true;
    try {
      await downloadRpcmtecDocx(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o DOCX');
    } finally {
      baixarBtn.disabled = false;
    }
  }

  async function baixarRtm() {
    rtmBtn.disabled = true;
    try {
      await downloadRtmOds(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o RTM');
    } finally {
      rtmBtn.disabled = false;
    }
  }

  async function baixarAnuario() {
    anuarioBtn.disabled = true;
    try {
      await downloadAnuarioOds(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o Anuário');
    } finally {
      anuarioBtn.disabled = false;
    }
  }

  await gerar();

  return () => {
    disposed = true;
    for (const tabela of tabelas.values()) tabela._cleanup();
    tabelas.clear();
  };
}
