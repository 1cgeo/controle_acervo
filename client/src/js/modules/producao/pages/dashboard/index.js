import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { createStatsCard } from '@components/stats-card.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import {
  getQuantidadeAno, getFinalizadasAno, getLotesEmExecucao,
} from '@services/producao-service.js';
import './dashboard.css';

/** Quantos lotes o gráfico desenha. A tabela abaixo continua trazendo todos. */
const LOTES_NO_GRAFICO = 10;

/**
 * As TRÊS fontes do painel, cada uma com o próprio nome, a própria busca e a
 * própria mensagem de falha.
 *
 * A lista existe para o carregamento, a faixa de falhas e o "tentar de novo"
 * lerem a MESMA definição: três cópias divergiriam na primeira fonte que alguém
 * acrescentasse a uma delas.
 */
const FONTES = [
  {
    id: 'previsto',
    // `campo` é o nome da coluna NO SERVIDOR; `destino` é o da linha juntada.
    // Os dois divergem porque as três consultas nomeiam a contagem cada uma à
    // sua maneira (`quantidade`, `finalizadas`, `em_execucao`), e a tela precisa
    // de um nome só por coluna.
    campo: 'quantidade',
    destino: 'previsto',
    rotulo: 'Previsto no ano',
    buscar: (ano) => getQuantidadeAno(ano),
    erro: 'Não foi possível carregar o previsto do ano.',
  },
  {
    id: 'finalizadas',
    campo: 'finalizadas',
    destino: 'finalizadas',
    rotulo: 'Finalizado no ano',
    buscar: (ano) => getFinalizadasAno(ano),
    erro: 'Não foi possível carregar as finalizadas do ano.',
  },
  {
    id: 'execucao',
    campo: 'em_execucao',
    destino: 'em_execucao',
    rotulo: 'Em execução',
    // SEM ANO, e a ausência é do servidor: `/dashboard/execucao` responde o
    // retrato de HOJE. "Em execução" é um estado do presente, e não um
    // acumulado do exercício.
    buscar: () => getLotesEmExecucao(),
    erro: 'Não foi possível carregar as versões em execução.',
  },
];

/** A soma de uma coluna, tolerante a nulo e a texto vindo do banco. */
const somar = (linhas, campo) =>
  (linhas || []).reduce((total, linha) => total + (Number(linha[campo]) || 0), 0);

/**
 * As três listas viram UMA lista por lote.
 *
 * A CHAVE É `lote_id`, e não o nome: as três consultas o devolvem, e dois lotes
 * de projetos diferentes podem repetir o rótulo. Casar por nome juntaria os dois
 * numa linha só, e ninguém veria o erro.
 *
 * O QUE FALTOU NÃO VIRA ZERO. Fonte que falhou entra como `null`, e a tabela
 * escreve travessão: zero é uma AFIRMAÇÃO sobre o banco ("nenhuma versão
 * finalizou"), e a ausência de resposta é outra coisa.
 *
 * @param {Object<string, Array|null>} porFonte - o resultado de cada fonte, ou
 *   null quando ela falhou
 * @returns {Array<Object>}
 */
export function juntarPorLote(porFonte) {
  const porId = new Map();

  const garantir = (linha) => {
    const chave = linha.lote_id;
    if (!porId.has(chave)) {
      porId.set(chave, {
        lote_id: chave,
        lote: linha.lote,
        previsto: null,
        finalizadas: null,
        em_execucao: null,
      });
    }
    return porId.get(chave);
  };

  FONTES.forEach((fonte) => {
    const lista = porFonte[fonte.id];
    if (!Array.isArray(lista)) return;
    lista.forEach((linha) => {
      garantir(linha)[fonte.destino] = Number(linha[fonte.campo]) || 0;
    });
  });

  // Fonte que RESPONDEU mas não citou o lote está dizendo zero sobre ele: o
  // servidor agrupa por lote e omite o que não tem contagem.
  const respondeu = {};
  FONTES.forEach((fonte) => { respondeu[fonte.id] = Array.isArray(porFonte[fonte.id]); });

  return [...porId.values()].map((linha) => {
    const previsto = respondeu.previsto ? (linha.previsto || 0) : null;
    const finalizadas = respondeu.finalizadas ? (linha.finalizadas || 0) : null;
    const emExecucao = respondeu.execucao ? (linha.em_execucao || 0) : null;

    // O TETO DO "EM EXECUÇÃO" É O QUE SOBRA DO PREVISTO, e o corte vem do SAP.
    // As duas contagens têm recortes diferentes: o previsto é do ANO do PIT e o
    // em execução é de HOJE, sem ano nenhum. Sem o teto, um lote com meta antiga
    // já cumprida mostraria "não iniciado" negativo.
    const emExecucaoNoLote = (previsto === null || emExecucao === null)
      ? emExecucao
      : Math.min(emExecucao, Math.max(0, previsto - (finalizadas || 0)));

    const naoIniciado = (previsto === null || finalizadas === null || emExecucaoNoLote === null)
      ? null
      : Math.max(0, previsto - finalizadas - emExecucaoNoLote);

    return {
      ...linha,
      previsto,
      finalizadas,
      em_execucao: emExecucaoNoLote,
      nao_iniciado: naoIniciado,
      conclusao: (previsto === null || finalizadas === null || previsto === 0)
        ? null
        : (finalizadas / previsto) * 100,
    };
  }).sort((a, b) => (b.previsto || 0) - (a.previsto || 0)
    || String(a.lote || '').localeCompare(String(b.lote || '')));
}

/** Número, ou travessão quando a fonte daquela coluna não respondeu. */
const numeroOuTraco = (valor) => (valor === null || valor === undefined ? '—' : formatNumber(valor));

/**
 * PAINEL DA PRODUÇÃO (#/producao), a raiz do módulo.
 *
 * TRÊS CHAMADAS INDEPENDENTES, E NENHUM `Promise.all`. A regra da casa mordeu
 * três vezes em 2026-08-08: uma chamada que falha num `Promise.all` derruba a
 * TELA INTEIRA, e a mensagem que sobra é a dela. Aqui cada fonte carrega
 * sozinha, com o próprio `catch`, e a falha dela vira uma linha na faixa de
 * avisos com um "Tentar de novo" que refaz SÓ aquela pergunta. Com o previsto
 * fora do ar, o finalizado e o em execução continuam na tela.
 *
 * O QUARTO GRÁFICO DO SAP NÃO ESTÁ AQUI, e a ausência é de recorte, não de
 * esquecimento: "Produtos Por Mês" vinha de `/acompanhamento/pit/:ano`, que é a
 * tela `#/producao/pit`. Repeti-lo faria duas telas responderem a mesma
 * pergunta e discordarem no dia em que uma fosse ajustada.
 *
 * O ANO É DA TELA, e começa no atual. O SAP fixava `new Date().getFullYear()`
 * sem seletor nenhum, e olhar o exercício anterior exigia esperar o ano virar.
 * Não há rota que diga QUAIS anos têm dado de produção, então o seletor não
 * recebe `carregarAnos`: ele abre no ano corrente e oferece "+ Outro ano…", em
 * vez de inventar uma lista que o servidor não confirmou.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderProducaoDashboard(container, _ctx) {
  let disposed = false;

  /** O que cada fonte devolveu: array quando respondeu, null quando falhou. */
  let porFonte = { previsto: null, finalizadas: null, execucao: null };
  /** A falha de cada fonte, por id. */
  let falhas = {};

  const filtroAno = criarFiltroAno({
    permitirOutroAno: true,
    onChange: () => carregar(),
  });

  const botaoAtualizar = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => carregar(),
  }, [svgIcon(ICONS.schedule, 16), 'Atualizar']);

  // --- Faixa de falhas ------------------------------------------------------
  // Uma linha POR FONTE que falhou, com o botão que refaz só aquela pergunta.
  const faixaFalhas = el('div', { className: 'producao-painel__falhas' });

  function pintarFalhas() {
    const comFalha = FONTES.filter((f) => falhas[f.id]);
    if (!comFalha.length) {
      faixaFalhas.replaceChildren();
      faixaFalhas.classList.add('hidden');
      return;
    }
    faixaFalhas.classList.remove('hidden');
    faixaFalhas.replaceChildren(...comFalha.map((fonte) => el('div', {
      className: 'producao-painel__falha',
      role: 'alert',
    }, [
      el('span', { className: 'producao-painel__falha-icone' }, [svgIcon(ICONS.warning, 18)]),
      el('span', {
        className: 'producao-painel__falha-texto',
        // A MENSAGEM DO SERVIDOR primeiro: ela distingue "sem perfil" de "sem
        // rede" de "erro no banco", e é o que decide o que a pessoa faz a
        // seguir. A frase da fonte só diz QUAL pedaço da tela ficou sem dado.
        textContent: `${fonte.erro} ${falhas[fonte.id].message || ''}`.trim(),
      }),
      el('button', {
        className: 'btn btn--secondary btn--sm',
        type: 'button',
        onClick: () => carregarFonte(fonte),
      }, [svgIcon(ICONS.schedule, 14), 'Tentar de novo']),
    ])));
  }

  // --- Cartões --------------------------------------------------------------
  const cartaoPrevisto = createStatsCard({
    title: 'Previsto no ano',
    value: '—',
    icon: svgIcon(ICONS.assignment, 22),
    color: 'primary',
    loading: true,
  });
  const cartaoFinalizado = createStatsCard({
    title: 'Finalizado no ano',
    value: '—',
    icon: svgIcon(ICONS.checkCircle, 22),
    color: 'success',
    loading: true,
  });
  const cartaoExecucao = createStatsCard({
    title: 'Em execução hoje',
    value: '—',
    icon: svgIcon(ICONS.dataUsage, 22),
    color: 'info',
    loading: true,
  });

  const cartoes = el('div', { className: 'stats-grid' }, [
    cartaoPrevisto, cartaoFinalizado, cartaoExecucao,
  ]);

  // --- Gráfico e tabela -----------------------------------------------------
  const grafico = createBarChart({
    title: 'Por lote',
    data: [],
    xKey: 'lote',
    series: [],
    horizontal: true,
    loading: true,
    emptyMessage: 'Nenhum lote com meta no ano',
  });

  const tabela = createDataTable({
    columns: [
      { key: 'lote', label: 'Lote', sortable: true },
      {
        key: 'previsto',
        label: 'Previsto',
        className: 'text-center',
        sortable: true,
        sortValue: (r) => r.previsto,
        render: (r) => numeroOuTraco(r.previsto),
      },
      {
        key: 'finalizadas',
        label: 'Finalizado',
        className: 'text-center',
        sortable: true,
        sortValue: (r) => r.finalizadas,
        render: (r) => numeroOuTraco(r.finalizadas),
      },
      {
        key: 'em_execucao',
        label: 'Em execução',
        className: 'text-center',
        sortable: true,
        sortValue: (r) => r.em_execucao,
        render: (r) => numeroOuTraco(r.em_execucao),
      },
      {
        key: 'nao_iniciado',
        label: 'Não iniciado',
        className: 'text-center',
        sortable: true,
        sortValue: (r) => r.nao_iniciado,
        render: (r) => numeroOuTraco(r.nao_iniciado),
      },
      {
        key: 'conclusao',
        label: 'Conclusão',
        className: 'text-center',
        sortable: true,
        sortValue: (r) => r.conclusao,
        render: (r) => (r.conclusao === null
          ? '—'
          : el('div', { className: 'producao-painel__barra' }, [
            el('div', {
              className: 'producao-painel__barra-preenchida',
              style: { width: `${Math.min(100, Math.round(r.conclusao))}%` },
            }),
            el('span', {
              className: 'producao-painel__barra-texto',
              textContent: `${r.conclusao.toFixed(1)}%`,
            }),
          ])),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    emptyMessage: 'Nenhum lote com meta no ano',
    loading: true,
  });

  const nota = el('p', {
    className: 'producao-painel__nota',
    textContent: 'O previsto e o finalizado são do ano escolhido. O em execução é o retrato de hoje, '
      + 'e por isso ele aparece limitado ao que ainda falta do previsto de cada lote.',
  });

  const page = el('div', { className: 'page producao-painel' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Painel da produção' }),
      el('div', { className: 'page__actions' }, [botaoAtualizar]),
    ]),
    el('div', { className: 'page__filters' }, [filtroAno.element]),
    faixaFalhas,
    cartoes,
    grafico,
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Situação por lote' }),
      ]),
      nota,
      tabela.element,
    ]),
  ]);
  container.appendChild(page);

  // --- Pintura --------------------------------------------------------------

  function pintar() {
    const respondeu = (id) => Array.isArray(porFonte[id]);

    cartaoPrevisto.update({
      loading: false,
      value: respondeu('previsto') ? formatNumber(somar(porFonte.previsto, 'quantidade')) : '—',
    });
    cartaoFinalizado.update({
      loading: false,
      value: respondeu('finalizadas') ? formatNumber(somar(porFonte.finalizadas, 'finalizadas')) : '—',
    });
    cartaoExecucao.update({
      loading: false,
      value: respondeu('execucao') ? formatNumber(somar(porFonte.execucao, 'em_execucao')) : '—',
    });

    const linhas = juntarPorLote(porFonte);
    tabela.update({ rows: linhas, loading: false });

    // SÓ AS SÉRIES QUE RESPONDERAM entram no gráfico. Uma série de zeros por
    // falha de rede se leria como "nada foi finalizado", que é o oposto de "não
    // consegui perguntar".
    const series = [];
    if (respondeu('finalizadas')) series.push({ dataKey: 'finalizadas', label: 'Finalizado' });
    if (respondeu('execucao')) series.push({ dataKey: 'em_execucao', label: 'Em execução' });
    // E "NÃO INICIADO" PEDE AS TRÊS, porque é uma CONTA entre elas: em
    // `juntarPorLote`, previsto ou finalizadas ou em execução nulo faz
    // `nao_iniciado` nulo em TODAS as linhas. Guardando só por `previsto`, a
    // legenda apareceria sem desenhar barra nenhuma, e a pessoa leria "não há
    // nada não iniciado" -- que é exatamente a leitura que as duas linhas acima
    // trabalham para evitar.
    if (respondeu('previsto') && respondeu('finalizadas') && respondeu('execucao')) {
      series.push({ dataKey: 'nao_iniciado', label: 'Não iniciado' });
    }

    grafico.update({
      loading: false,
      series,
      // OS DEZ MAIORES, e não todos: com trinta lotes as barras horizontais
      // ficam finas demais para se ler. A tabela abaixo continua com a lista
      // inteira, e é ela que responde "e o lote tal?".
      data: series.length ? linhas.slice(0, LOTES_NO_GRAFICO) : [],
    });
  }

  /**
   * Uma fonte, sozinha, com o próprio catch.
   *
   * O ANO PEDIDO É CONFERIDO DEPOIS DO `await`: trocar o ano duas vezes seguidas
   * no filtro dispara duas rodadas das três fontes, e a resposta do primeiro ano
   * que chegar atrasada entraria em `porFonte` misturada com as do segundo. O
   * painel somaria dois anos num cartão só, sem nada que acusasse. A resposta
   * que não é mais a pedida é descartada antes de tocar no estado.
   */
  async function carregarFonte(fonte) {
    const ano = filtroAno.getAno();
    try {
      const dados = await fonte.buscar(ano);
      if (disposed || ano !== filtroAno.getAno()) return;
      porFonte[fonte.id] = Array.isArray(dados) ? dados : [];
      delete falhas[fonte.id];
    } catch (err) {
      if (disposed || ano !== filtroAno.getAno()) return;
      porFonte[fonte.id] = null;
      falhas[fonte.id] = err;
    }
    if (disposed) return;
    pintarFalhas();
    pintar();
  }

  async function carregar() {
    porFonte = { previsto: null, finalizadas: null, execucao: null };
    falhas = {};
    pintarFalhas();
    cartaoPrevisto.update({ loading: true });
    cartaoFinalizado.update({ loading: true });
    cartaoExecucao.update({ loading: true });
    grafico.update({ loading: true });
    tabela.update({ loading: true });

    // TRÊS PROMESSAS EM PARALELO, e nenhum `Promise.all`: cada uma já resolve o
    // próprio erro dentro de `carregarFonte`, então o `all` aqui nunca rejeita.
    // O ganho é o de sempre (as três viajam juntas) sem o custo que mordeu em
    // 2026-08-08 (a primeira falha derrubando as outras duas).
    await Promise.all(FONTES.map(carregarFonte));
  }

  await carregar();

  return () => {
    disposed = true;
    grafico._cleanup();
    tabela._cleanup();
  };
}
