import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { chip } from '@components/status-chip.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { getAuditoria } from '@modules/acervo/services/acervo-service.js';

// DEFECT primeiro: e o unico que exige acao. A mesma ordem do CLI
// (`acervo auditar`) e do dialogo do plugin, porque e a mesma pergunta.
const ORDEM = { DEFECT: 0, REVISAR: 1, INFO: 2 };

// A severidade e do SERVIDOR, e a tela NAO reclassifica nada: ela mora ao lado
// do schema que descreve, em server/src/acervo/invariantes.js. Aqui so se
// escolhe a cor.
const VARIANTE = { DEFECT: 'error', REVISAR: 'warning', INFO: 'info' };

const EXPLICACAO = {
  DEFECT: 'Tem de dar zero. Qualquer ocorrência é um dado errado no acervo.',
  REVISAR: 'Lente larga, para triagem humana. Achado NÃO é necessariamente erro.',
  INFO: 'Estatística de cobertura; nunca é erro.',
};

/**
 * Quantas linhas de amostra pedir por invariante.
 *
 * O total vem sempre inteiro do servidor; a amostra e o que se le. O teto da
 * rota e 100, e 50 ja e mais do que alguem tria numa sentada -- quem precisa da
 * lista toda vai pelo CLI (`acervo auditar --check 7a --amostra 100`), que e o
 * caminho de quem esta consertando em lote.
 */
const AMOSTRA = 50;

/**
 * O ULTIMO resultado desta sessao, com a HORA em que ele foi medido.
 *
 * A tela NAO roda sozinha ao abrir, e isso e deliberado: sao dezenas de
 * consultas numa transacao, e o `7a` deriva o nome padrao de cada arquivo do
 * acervo. Rodando na montagem, um clique errado na sidebar custava uma auditoria
 * inteira, e voltar de outra tela custava outra.
 *
 * Guardar o resultado NAO e cachear a resposta: nada aqui e servido como se
 * fosse de agora. A hora da medicao vai para a tela junto do numero, e o botao
 * continua sendo o unico jeito de medir. E a diferenca que importa -- o modo de
 * falhar caro desta tela e mostrar a contagem de antes da correcao para quem
 * acabou de corrigir, e um numero datado nao faz isso.
 *
 * Mora no MODULO, e nao na funcao, justamente para sobreviver a troca de tela.
 * `esquecerUltimaAuditoria` existe para o teste comecar do zero.
 */
let ultimaAuditoria = null;

/** Descarta o resultado lembrado (usado pelos testes). */
export function esquecerUltimaAuditoria() {
  ultimaAuditoria = null;
}

/** 'às 10:52': a hora da medição, para o número nunca passar por atual. */
const horaDe = (quando) =>
  quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** O texto da coluna de ocorrencias, que tem tres estados e nao dois. */
function textoTotal(r) {
  if (r.erro) return 'erro';
  if (!r.total) return '—';
  return formatNumber(r.total) + (r.truncada ? '+' : '');
}

/**
 * A tabela de AMOSTRA de um invariante.
 *
 * As colunas saem do PROPRIO resultado, e nao de uma lista fixa: cada invariante
 * devolve o que importa para ele (o 7a devolve `esperado`, o 3i devolve as duas
 * datas, o 4h devolve `falta`), e uma tabela de colunas fixas esconderia
 * justamente a coluna que explica a ocorrencia. E a mesma decisao do dialogo do
 * plugin, pela mesma razao.
 */
function tabelaAmostra(r) {
  if (r.erro) {
    return el('p', {
      className: 'auditoria__vazio',
      textContent: `Este invariante falhou no servidor: ${r.erro}`,
    });
  }

  const amostra = r.amostra || [];
  if (!amostra.length) {
    return el('p', {
      className: 'auditoria__vazio',
      textContent: `${r.codigo}: nenhuma ocorrência.`,
    });
  }

  const colunas = Object.keys(amostra[0]);

  return el('div', { className: 'auditoria__amostra-scroll' }, [
    el('table', { className: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, colunas.map(c => el('th', { textContent: c }))),
      ]),
      el('tbody', {}, amostra.map(linha =>
        el('tr', {}, colunas.map(c => el('td', {
          textContent: linha[c] === null || linha[c] === undefined ? '' : String(linha[c]),
        })))
      )),
    ]),
  ]);
}

/**
 * Auditoria do acervo (#/acervo/auditoria): os invariantes LOGICOS, rodados no
 * servidor.
 *
 * Nao confundir com "Verificar Inconsistencias" do plugin, que compara o banco
 * com o DISCO. Aqui nenhum invariante olha o disco: sao regras de COERENCIA
 * entre tabelas (MI que nao bate com o INOM, versao Regular sem arquivo, serie
 * de edicao invertida, nome fisico divergente do padrao derivado).
 *
 * A tela e a TERCEIRA porta para o mesmo motor: o CLI (`acervo auditar`) e o
 * dialogo do QGIS ja existiam, e os dois exigem instalar alguma coisa. Gerente
 * que so usa o navegador nao tinha como ver o estado do acervo.
 *
 * DUAS decisoes de desenho:
 *
 * 1. **A auditoria roda UMA vez e o filtro de severidade e do CLIENTE.** Sao
 *    dezenas de consultas numa transacao so, e refazer tudo para esconder linha
 *    cobraria uma auditoria inteira por clique num combo. O servidor aceita
 *    `?severidade=`, e a tela nao usa: o custo dela e o mesmo dos dois lados, e
 *    de la ele e pago de novo.
 * 2. **So pinta quem TEM ocorrencia.** Um DEFECT com zero e boa noticia, e
 *    pinta-lo de vermelho faria a tela parecer cheia de problema justamente no
 *    dia em que o acervo esta limpo.
 *
 * @param {HTMLElement} container
 * @returns {Promise<Function>} cleanup
 */
export async function renderAuditoria(container) {
  let disposed = false;
  // Respostas voltam fora de ordem; so a mais recente pode pintar a tela.
  let requisicao = 0;
  let resultados = [];
  let selecionado = null;

  const severidadeSelect = el('select', {
    className: 'auditoria__select',
    'aria-label': 'Filtrar por severidade',
    onChange: () => {
      selecionado = null;
      pintar();
    },
  }, [
    el('option', { value: '', textContent: 'Todas as severidades' }),
    ...['DEFECT', 'REVISAR', 'INFO'].map(s =>
      el('option', { value: s, textContent: s })
    ),
  ]);

  const rodarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => rodar(),
  }, [svgIcon(ICONS.dataUsage, 18), el('span', { textContent: 'Rodar auditoria' })]);

  const resumoEl = el('p', { className: 'auditoria__resumo' });
  const legendaEl = el('div', { className: 'auditoria__legenda' },
    ['DEFECT', 'REVISAR', 'INFO'].map(s =>
      el('div', { className: 'auditoria__legenda-item' }, [
        chip(s, VARIANTE[s]),
        el('span', { textContent: EXPLICACAO[s] }),
      ])
    )
  );

  const detalheEl = el('section', { className: 'auditoria__detalhe' });

  const tabela = createDataTable({
    columns: [
      { key: 'codigo', label: 'Código', sortable: true },
      {
        key: 'severidade',
        label: 'Severidade',
        sortable: true,
        sortValue: r => ORDEM[r.severidade] ?? 9,
        render: r => chip(r.severidade, VARIANTE[r.severidade]),
      },
      {
        key: 'total',
        label: 'Ocorrências',
        sortable: true,
        className: 'auditoria__num',
        // Invariante que QUEBROU ordena no topo, junto do que tem ocorrencia:
        // ele e o unico cujo numero ninguem sabe, e escondê-lo no fim da lista
        // faria a auditoria parecer completa sem ser.
        sortValue: r => (r.erro ? Infinity : (r.total || 0)),
        render: r => el('span', {
          className: r.erro ? 'auditoria__erro' : '',
          textContent: textoTotal(r),
        }),
      },
      { key: 'titulo', label: 'Invariante', sortable: true },
    ],
    rows: [],
    paginated: false,
    searchable: true,
    loading: true,
    emptyMessage: 'Nenhum invariante nesta severidade.',
    rowClassName: r => (r.erro
      ? 'auditoria__linha--erro'
      : (r.total ? `auditoria__linha--${r.severidade.toLowerCase()}` : '')),
    actions: [{
      icon: ICONS.visibility,
      title: 'Ver ocorrências',
      onClick: (r) => {
        selecionado = r.codigo;
        pintarDetalhe();
        // O jsdom nao implementa scrollIntoView, e rolar aqui e conforto: a
        // amostra ja esta na tela, e sem a guarda o teste da tabela quebraria
        // por causa do que ela NAO prova.
        if (typeof detalheEl.scrollIntoView === 'function') {
          detalheEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      },
    }],
  });

  function resumir(visiveis) {
    // Antes da primeira medição o resumo é o convite, e trocá-lo por contagens
    // de uma lista vazia diria "0 com ocorrência" sobre nada.
    if (!ultimaAuditoria) return;

    const comOcorrencia = visiveis.filter(r => r.total);
    const defeitos = visiveis
      .filter(r => r.severidade === 'DEFECT')
      .reduce((s, r) => s + (r.total || 0), 0);
    const quebrados = visiveis.filter(r => r.erro).map(r => r.codigo);

    const partes = [
      // A hora vem PRIMEIRO, e sempre: sem ela, o resultado lembrado de dez
      // minutos atras se leria como a medicao de agora.
      `Medido às ${horaDe(ultimaAuditoria.quando)}`,
      `${formatNumber(visiveis.length)} invariante(s) rodados`,
      `${formatNumber(comOcorrencia.length)} com ocorrência`,
    ];
    if (defeitos) partes.push(`${formatNumber(defeitos)} ocorrência(s) de DEFECT`);
    if (quebrados.length) {
      partes.push(`invariante(s) com erro: ${quebrados.join(', ')}`);
    }
    resumoEl.textContent = `${partes.join('. ')}.`;
  }

  function pintarDetalhe() {
    const r = resultados.find(x => x.codigo === selecionado);
    if (!r) {
      detalheEl.replaceChildren(el('p', {
        className: 'auditoria__vazio',
        textContent: 'Escolha um invariante para ver as ocorrências.',
      }));
      return;
    }

    // A amostra e limitada de proposito. Anunciar "50 de 1.284" e o que impede
    // alguem de corrigir as 50 e achar que acabou.
    const rotulo = r.truncada
      ? `${r.codigo}: ${r.titulo} (mostrando ${formatNumber((r.amostra || []).length)} de ${formatNumber(r.total)})`
      : `${r.codigo}: ${r.titulo}`;

    detalheEl.replaceChildren(
      el('h3', { className: 'auditoria__detalhe-titulo' }, [
        chip(r.severidade, VARIANTE[r.severidade]),
        el('span', { textContent: rotulo }),
      ]),
      tabelaAmostra(r)
    );
  }

  function pintar() {
    const escolhida = severidadeSelect.value;
    const visiveis = resultados
      .filter(r => !escolhida || r.severidade === escolhida)
      .sort((a, b) =>
        (ORDEM[a.severidade] ?? 9) - (ORDEM[b.severidade] ?? 9)
        || (b.total || 0) - (a.total || 0)
        || a.codigo.localeCompare(b.codigo));

    tabela.update({ rows: visiveis, loading: false });
    resumir(visiveis);
    pintarDetalhe();
  }

  async function rodar() {
    const meu = ++requisicao;
    rodarBtn.disabled = true;
    severidadeSelect.disabled = true;
    resumoEl.textContent = 'Rodando os invariantes no servidor...';
    tabela.update({ rows: [], loading: true });

    try {
      const dados = await getAuditoria({ amostra: AMOSTRA });
      if (disposed || meu !== requisicao) return;
      resultados = Array.isArray(dados) ? dados : [];
      ultimaAuditoria = { resultados, quando: new Date() };
      pintar();
    } catch (err) {
      if (disposed || meu !== requisicao) return;
      // A MEDICAO ANTERIOR FICA NA TELA, e nao uma tabela vazia.
      //
      // Zerar `resultados` custava duas coisas. A tabela passava a dizer
      // "Nenhum invariante nesta severidade", que nesta tela se le como acervo
      // limpo -- exatamente o oposto do que aconteceu. E o resumo, repintado no
      // primeiro toque no filtro de severidade, afirmava "Medido às 10:52. 0
      // invariante(s) rodados. 0 com ocorrência.": a hora da medicao que deu
      // certo, com as contagens da que falhou.
      resultados = ultimaAuditoria ? ultimaAuditoria.resultados : [];
      pintar();
      resumoEl.textContent = ultimaAuditoria
        ? `Não foi possível rodar a auditoria agora. Na tela, a medição das `
          + `${horaDe(ultimaAuditoria.quando)}.`
        : 'Não foi possível rodar a auditoria.';
      showError(err.message || 'Não foi possível rodar a auditoria.');
    } finally {
      if (!disposed && meu === requisicao) {
        rodarBtn.disabled = false;
        severidadeSelect.disabled = false;
      }
    }
  }

  container.appendChild(
    el('div', { className: 'page auditoria' }, [
      el('header', { className: 'page__header' }, [
        el('div', {}, [
          el('h1', { className: 'page__title', textContent: 'Auditoria do acervo' }),
          el('p', {
            className: 'page__subtitle',
            textContent: 'Os invariantes lógicos do acervo: as regras de coerência que o '
              + 'banco não consegue exigir sozinho. Nenhum deles olha o disco, e nenhum escreve.',
          }),
        ]),
        el('div', { className: 'page__actions' }, [severidadeSelect, rodarBtn]),
      ]),
      legendaEl,
      resumoEl,
      tabela.element,
      detalheEl,
    ])
  );

  // Abrir a tela NAO mede nada. Ou ela repinta o que ja foi medido nesta sessao,
  // dizendo QUANDO, ou convida a rodar.
  if (ultimaAuditoria) {
    resultados = ultimaAuditoria.resultados;
    pintar();
  } else {
    tabela.update({ rows: [], loading: false });
    resumoEl.textContent = 'A auditoria roda dezenas de consultas no servidor, '
      + 'inclusive uma que deriva o nome padrão de cada arquivo do acervo. '
      + 'Aperte "Rodar auditoria" para medir.';
    pintarDetalhe();
  }

  return () => {
    disposed = true;
    requisicao++;
    if (tabela._cleanup) tabela._cleanup();
  };
}
