import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showError } from '@utils/toast.js';
import { formatNumber, monthName, toNumber } from '@utils/format.js';
import { isAdmin } from '@store/auth-store.js';
import { createStatsCard } from '@components/stats-card.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createTabs } from '@components/tabs/tabs.js';
import { createExportBar } from '@components/export-bar/export-bar.js';
import {
  getAcessosResumo,
  getAcessosLogados,
  getLoginsDia,
  getLoginsUsuarios,
  getEfetivoDoMes,
  getPeriodosEfetivo,
  getDivergenciasEfetivo,
  exportacoesEfetivo,
} from '@services/plataforma-service.js';

/** Intervalo do auto-refresh da aba ativa, como nos outros tres dashboards. */
const REFRESH_MS = 60 * 1000;

/** Recortes oferecidos no filtro de periodo da aba Acessos, em DIAS. */
const PERIODOS = [7, 14, 30, 90];
const PERIODO_PADRAO = 30;

/** Teto do ranking de logins por pessoa. O Joi do servidor aceita ate 100. */
const MAX_RANKING = 10;

/**
 * Falha e VAZIO sao coisas diferentes, e escrever as duas igual e o defeito que
 * isto evita: rota fora do ar virando '-' no cartao e 'Sem dados disponiveis' no
 * grafico se le como zero legitimo, e "ninguem esta impedido" no lugar de "nao
 * deu para saber".
 */
const TEXTO_FALHA = 'Falha ao carregar. O dado não foi lido.';
const VALOR_FALHA = 'Erro';

/**
 * "Não deu para medir", que é a TERCEIRA coisa, ao lado de falha e de zero.
 *
 * Um mês que ainda não começou não tem aproveitamento nem dia perdido. Escrever
 * '0' ali afirmaria que a Divisão não rendeu nada, e '-' se leria como falha.
 */
const SEM_MEDIDA = 'Ainda não';

/** Rotulo de um cliente de login. A lista e fechada (login/login_schema.js). */
const NOME_CLIENTE = {
  sca_web: 'Interface web',
  sca_qgis: 'Plugin do QGIS',
};

const rotuloCliente = (cliente) => NOME_CLIENTE[cliente] || cliente || '-';

/** 'AAAA-MM-DD' -> 'DD/MM'. A data ja vem no dia LOCAL, resolvida no servidor. */
function diaCurto(iso) {
  const partes = String(iso || '').split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : String(iso || '');
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA'. Dia de calendario, sem passar por Date. */
function diaLongo(iso) {
  const partes = String(iso || '').split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : '-';
}

/** Instante ISO -> 'DD/MM/AAAA HH:MM', no fuso de quem esta lendo. */
function instante(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Percentual como a tela o escreve: '66,7%'. Sem espaço antes do sinal. */
function percentual(valor) {
  const n = toNumber(valor);
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/**
 * Dias-militar: '21,3 dias'. Uma casa decimal, porque a unidade é fracionária
 * por construção -- um impedimento de 50% num dia custa meio dia-militar.
 */
function diasMilitar(valor) {
  const n = toNumber(valor);
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

/** Nome de guerra com o posto na frente: '3 Sgt Silva'. */
function nomeMilitar(pessoa) {
  return [pessoa.posto_abrev || pessoa.tipo_posto_grad, pessoa.nome_guerra]
    .filter(Boolean)
    .join(' ') || pessoa.login || '-';
}

/**
 * A pessoa como LINK para o aproveitamento dela.
 *
 * A tela de aproveitamento le `usuario_uuid` da query string, e por isso a
 * consulta de quem entrou hoje passou a devolver o uuid: sem identidade real, a
 * linha morria como texto.
 */
function linkMilitar(uuid, texto) {
  if (!uuid) return texto;
  return el('a', { href: `#/aproveitamento?usuario_uuid=${uuid}`, textContent: texto });
}

/**
 * Envolve um painel (grafico ou tabela) numa caixa que sabe dizer FALHOU.
 *
 * O componente de grafico e o de tabela so tem dois estados, carregando e
 * vazio. Em vez de mexer nos dois componentes, que servem o sistema inteiro, a
 * caixa troca o painel por um aviso quando a rota daquele painel cai.
 *
 * @param {string|null} titulo - nulo quando o painel ja vive sob um cabecalho
 * @param {HTMLElement} painel
 * @returns {HTMLElement} com `.setFalha(boolean)`
 */
function caixaComFalha(titulo, painel) {
  const aviso = el('div', { className: 'chart-card' }, [
    titulo ? el('div', { className: 'chart-card__title', textContent: titulo }) : null,
    el('div', { className: 'chart-card__body' }, [
      el('div', { className: 'chart-card__empty', textContent: TEXTO_FALHA }),
    ]),
  ]);

  const caixa = el('div', {}, [painel]);
  caixa.setFalha = (falhou) => {
    caixa.replaceChildren(falhou ? aviso : painel);
  };
  return caixa;
}

/** Cabecalho de secao, no padrao dos outros dashboards. */
function secao(titulo, conteudo) {
  return el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: titulo }),
    ]),
    conteudo,
  ]);
}

/**
 * Select com o rotulo ao lado, no padrao do dashboard do orcamento.
 *
 * Devolve os DOIS nos, e nao um bloco: os controles de uma secao vivem todos
 * dentro do mesmo `dashboard-section__controls`, e aninhar um dentro do outro
 * quebraria a linha.
 *
 * O rotulo VISIVEL e o `aria-label` sao separados de proposito: na tela cabe
 * 'Mês:', e quem le por audio precisa de 'Selecionar mês'.
 *
 * @returns {Array<HTMLElement>}
 */
function seletor({ rotulo, aria, opcoes, valor, onChange }) {
  const select = el('select', {
    className: 'chart-card__select',
    'aria-label': aria,
    onChange: (e) => onChange(e.target.value),
  }, opcoes.map(o => el('option', { value: String(o.value), textContent: o.label })));
  select.value = String(valor);
  return [el('span', { textContent: `${rotulo}:` }), select];
}

// =============================================================================
// Aba EFETIVO
// =============================================================================

/**
 * O mes anterior a (ano, mes). Dezembro do ano de tras quando o mes e janeiro.
 * @returns {{ano:number, mes:number}}
 */
function mesAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

/**
 * Aba "Efetivo": quem esta na Divisao neste mes, quanto rendeu, quanto o
 * impedimento custou, quem chegou, quem saiu e o que nao bate entre cadastro e
 * passagem.
 *
 * ELA ABRE A TELA: o painel de login mede a plataforma, e o chefe pergunta pela
 * tropa.
 *
 * TRES FONTES, todas do modulo EFETIVO:
 *   - `/efetivo/mes`: quem esteve, quantos dias, o aproveitamento, o impedimento
 *   - `/efetivo/periodos`: as passagens do ano, de onde saem entrada e saida
 *   - `/efetivo/divergencias`: conta ativa sem passagem no mes
 *
 * O MES CORRENTE E PARCIAL, e a tela diz isso. A passagem em aberto cobre o mes
 * inteiro, INCLUSIVE o que nao aconteceu: em 07 de agosto a conta do mes inteiro
 * ja dava 31 de 31 dias, e o cartao publicava projecao com cara de medida. Os
 * numeros da tela saem dos campos `_decorrido`, e o aviso diz quantos dias
 * correram. O campo do mes inteiro continua existindo, e e o da 6.1 do RPCMTec.
 *
 * A MEDIA E PONDERADA por dias na Divisao, como a da tela de Aproveitamento. A
 * simples da o mesmo peso a quem ficou um dia e a quem ficou o mes, e era assim
 * que uma chegada no fim do mes derrubava o numero da Divisao. As duas telas do
 * modulo diziam medias diferentes com o mesmo nome.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
async function renderEfetivoTab(container) {
  let disposed = false;

  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth() + 1;

  const anos = [ano + 1, ano, ano - 1, ano - 2];

  const cards = {
    presentes: createStatsCard({
      title: 'Militares na Divisão no mês',
      value: '-',
      icon: svgIcon(ICONS.people, 24),
      color: 'primary',
      loading: true,
    }),
    aproveitamento: createStatsCard({
      title: 'Aproveitamento da Divisão, ponderado por dias na DGEO',
      value: '-',
      icon: svgIcon(ICONS.dataUsage, 24),
      color: 'success',
      loading: true,
    }),
    perdidos: createStatsCard({
      title: 'Dias-militar perdidos para impedimento',
      value: '-',
      icon: svgIcon(ICONS.schedule, 24),
      color: 'warning',
      loading: true,
    }),
    divergencias: createStatsCard({
      title: 'Contas ativas sem passagem no mês',
      value: '-',
      icon: svgIcon(ICONS.warning, 24),
      color: 'error',
      loading: true,
    }),
  };

  // O RECORTE E O QUE FAZ O GRAFICO DIZER ALGUMA COISA. Com 25 militares, 19
  // deles a 100%, sobravam 19 barras identicas empurrando as 6 que importam para
  // dentro de 300px de altura. Aqui entra so quem esta abaixo de 100%, e em
  // ordem CRESCENTE: um grafico de barras existe para comparar grandeza, e o
  // anterior vinha ordenado por hierarquia, que e outra coisa.
  const TITULO_GRAFICO = 'Militares abaixo de 100% no mês';
  const grafico = createBarChart({
    title: TITULO_GRAFICO,
    xKey: 'militar',
    series: [{ dataKey: 'aproveitamento', label: 'Aproveitamento (%)' }],
    horizontal: true,
    loading: true,
    emptyMessage: 'Todos os militares do mês estão a 100%',
  });
  const caixaGrafico = caixaComFalha(TITULO_GRAFICO, grafico);

  // O custo por CAUSA, em dias-militar. E a pergunta que o percentual medio nao
  // responde: 87,8% nao diz quanto o mes perdeu nem para que.
  const TITULO_CAUSAS = 'Dias-militar perdidos, por causa';
  const graficoCausas = createBarChart({
    title: TITULO_CAUSAS,
    xKey: 'causa',
    series: [{ dataKey: 'dias', label: 'Dias-militar' }],
    horizontal: true,
    loading: true,
    emptyMessage: 'Nenhum impedimento consumiu dia no mês',
  });
  const caixaCausas = caixaComFalha(TITULO_CAUSAS, graficoCausas);

  const tabelaEfetivo = createDataTable({
    columns: [
      {
        key: 'militar',
        label: 'Militar',
        sortable: true,
        render: (row) => linkMilitar(row.usuario_uuid, row.militar),
      },
      // O DENOMINADOR FICA A VISTA, como no mapa anual: '5 de 31' e '31 de 31'
      // sao a diferenca entre "chegou dia 27" e "esteve o mes todo", e sem ele a
      // coluna nao distingue "nao estava" de "nao rendeu".
      {
        key: 'dias_na_dgeo',
        label: 'Dias na Divisão',
        sortable: true,
        sortValue: (row) => toNumber(row.dias_na_dgeo),
        render: (row) => `${row.dias_na_dgeo} de ${row.dias_decorridos}`,
      },
      {
        key: 'aproveitamento',
        label: 'Aproveitamento',
        sortable: true,
        sortValue: (row) => toNumber(row.aproveitamento),
        render: (row) => percentual(row.aproveitamento),
      },
      {
        key: 'dias_perdidos',
        label: 'Dias perdidos',
        sortable: true,
        sortValue: (row) => toNumber(row.dias_perdidos),
        render: (row) => diasMilitar(row.dias_perdidos),
      },
      {
        key: 'impedimentos',
        label: 'Impedimentos',
        render: (row) => row.impedimentos || 'Nenhum',
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Ninguém teve passagem pela DGEO neste mês',
  });
  const caixaEfetivo = caixaComFalha(null, tabelaEfetivo.element);

  const tabelaMovimento = createDataTable({
    columns: [
      {
        key: 'militar',
        label: 'Militar',
        sortable: true,
        render: (row) => linkMilitar(row.usuario_uuid, row.militar),
      },
      { key: 'movimento', label: 'Movimento', sortable: true },
      { key: 'data', label: 'Data', sortable: true, render: (row) => diaLongo(row.data) },
    ],
    rows: [],
    pageSize: 10,
    loading: true,
    emptyMessage: 'Ninguém entrou nem saiu neste ano',
  });
  const caixaMovimento = caixaComFalha(null, tabelaMovimento.element);

  const tabelaDivergencias = createDataTable({
    columns: [
      {
        key: 'militar',
        label: 'Pessoa',
        sortable: true,
        render: (row) => linkMilitar(row.usuario_uuid, row.militar),
      },
      { key: 'situacao', label: 'O que não bate', sortable: true },
    ],
    rows: [],
    pageSize: 10,
    loading: true,
    emptyMessage: 'Toda conta ativa tem passagem pela DGEO neste mês',
  });
  const caixaDivergencias = caixaComFalha(null, tabelaDivergencias.element);

  // O aviso de mes PARCIAL e o cabecalho do movimento anual mudam a cada carga,
  // e por isso sao nos vazios preenchidos por `load`, e nao texto fixo.
  const avisoParcial = el('div', { style: { margin: '0 0 12px' } });
  const resumoMovimento = el('p', {
    className: 'efetivo-resumo',
    style: { margin: '0 0 8px', color: 'var(--text-secondary)' },
  });
  // O endpoint do CSV carrega ano e mes, entao a barra se refaz a cada troca de
  // recorte, e SO nela (ver `recorteExportado` no `load`).
  const barraExport = el('div', {});
  let recorteExportado = null;

  const filtros = el('div', { className: 'dashboard-section__header' }, [
    el('h2', { className: 'dashboard-section__title', textContent: 'Efetivo do mês' }),
    el('div', { className: 'dashboard-section__controls' }, [
      ...seletor({
        rotulo: 'Ano',
        aria: 'Selecionar ano',
        opcoes: anos.map(a => ({ value: a, label: String(a) })),
        valor: ano,
        onChange: (valor) => {
          ano = Number(valor);
          load();
        },
      }),
      ...seletor({
        rotulo: 'Mês',
        aria: 'Selecionar mês',
        opcoes: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) })),
        valor: mes,
        onChange: (valor) => {
          mes = Number(valor);
          load();
        },
      }),
    ]),
  ]);

  container.appendChild(el('div', { className: 'dashboard-section' }, [
    filtros,
    barraExport,
    avisoParcial,
    el('div', { className: 'stats-grid' }, Object.values(cards)),
    caixaGrafico,
    caixaCausas,
    secao('Militares no mês', caixaEfetivo),
    secao('Entradas e saídas no ano', el('div', {}, [resumoMovimento, caixaMovimento])),
    secao('Contas ativas sem passagem no mês', caixaDivergencias),
  ]));

  /**
   * O aviso de mes PARCIAL, com o delta contra o mes anterior.
   *
   * Ele nao e enfeite: sem ele, "87,8%" num dia 7 se le como o resultado do mes,
   * e a comparacao com o mes fechado ao lado passa a ser entre coisas
   * diferentes. Mes inteiramente no futuro nao tem numero nenhum, e a frase diz
   * isso em vez de mostrar zero.
   *
   * @param {number} decorridos - dias do mes ja vividos
   * @param {number} doMes - dias do mes
   * @param {number|null} delta - pontos percentuais contra o mes anterior
   */
  function montarAvisoParcial(decorridos, doMes, delta) {
    avisoParcial.innerHTML = '';

    const partes = [];
    if (decorridos === 0) {
      partes.push(`${monthName(mes)} de ${ano} ainda não começou. Não há o que medir:`
        + ' os números abaixo seriam projeção das passagens e dos impedimentos em'
        + ' aberto, e não medida.');
    } else if (decorridos < doMes) {
      partes.push(`Mês em curso: os números abaixo cobrem ${decorridos} de ${doMes} dias.`);
    }

    if (delta !== null) {
      const anterior = mesAnterior(ano, mes);
      const sinal = delta > 0 ? '+' : '';
      partes.push(`Aproveitamento ${sinal}${delta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`
        + ` ponto percentual contra ${monthName(anterior.mes)} de ${anterior.ano}.`);
    }

    if (!partes.length) return;

    avisoParcial.appendChild(el('p', {
      className: 'efetivo-projecao',
      style: {
        margin: '0',
        color: decorridos === 0 ? 'var(--color-warning)' : 'var(--text-secondary)',
      },
      textContent: partes.join(' '),
    }));
  }

  /**
   * O aproveitamento da DIVISAO, PONDERADO por dias na Divisao, sobre os dias
   * DECORRIDOS. Mesma conta da tela de Aproveitamento, na janela do mes.
   *
   *   dias disponiveis = aproveitamento_decorrido_i x dias_decorridos_i / 100
   *   ponderada        = SOMA(dias disponiveis) / SOMA(dias_na_dgeo_decorridos)
   *
   * Devolve NULO com denominador zero, e nao zero: ninguem com dia vivido na
   * Divisao e "nao deu para medir", e nao "rendeu nada".
   *
   * @param {Array<Object>} efetivo
   * @returns {number|null}
   */
  function aproveitamentoPonderado(efetivo) {
    const diasNaDgeo = efetivo.reduce((t, p) => t + toNumber(p.dias_na_dgeo_decorridos), 0);
    if (diasNaDgeo <= 0) return null;
    const diasDisponiveis = efetivo.reduce(
      (t, p) => t + (toNumber(p.aproveitamento_decorrido) * toNumber(p.dias_decorridos)) / 100, 0
    );
    return (diasDisponiveis / diasNaDgeo) * 100;
  }

  async function load() {
    const pedido = `${ano}-${mes}`;
    const anterior = mesAnterior(ano, mes);

    const [efetivoRes, periodosRes, divergenciasRes, anteriorRes] = await Promise.allSettled([
      getEfetivoDoMes(ano, mes),
      getPeriodosEfetivo(ano),
      getDivergenciasEfetivo(ano, mes),
      // SO PARA O DELTA. Falhar aqui nao estraga a tela: o aviso perde a frase de
      // comparacao e o resto continua de pe, e por isso ele nao entra na lista de
      // erros que vira toast.
      getEfetivoDoMes(anterior.ano, anterior.mes),
    ]);

    // Trocar de mes no meio da carga invalida a resposta que estiver a caminho.
    if (disposed || pedido !== `${ano}-${mes}`) return;

    // SO QUANDO O RECORTE MUDA. O auto-refresh de 60s passa por aqui, e trocar a
    // barra a cada minuto arrancaria o botao no meio de um download em curso: o
    // rotulo 'Exportando...' e o `aria-busy` moram no botao antigo.
    if (recorteExportado !== pedido) {
      recorteExportado = pedido;
      barraExport.replaceChildren(createExportBar({
        items: exportacoesEfetivo(ano, mes),
        ariaLabel: 'Exportações do efetivo',
      }));
    }

    const efetivoOk = efetivoRes.status === 'fulfilled';
    const efetivo = efetivoOk ? (efetivoRes.value || []) : [];

    // Todo mundo do mes tem o mesmo mes, entao os dois denominadores saem da
    // primeira linha. Sem ninguem, cai no calendario, que e a mesma regua do
    // servidor (`dias_do_mes` = todos os dias do mes).
    const doMes = efetivo.length
      ? toNumber(efetivo[0].dias_do_mes)
      : new Date(ano, mes, 0).getDate();
    const decorridos = efetivo.length ? toNumber(efetivo[0].dias_decorridos) : diasDecorridos();

    const ponderada = efetivoOk ? aproveitamentoPonderado(efetivo) : null;

    const anteriorOk = anteriorRes.status === 'fulfilled';
    const ponderadaAnterior = anteriorOk
      ? aproveitamentoPonderado(anteriorRes.value || [])
      : null;
    const delta = ponderada !== null && ponderadaAnterior !== null
      ? ponderada - ponderadaAnterior
      : null;

    montarAvisoParcial(decorridos, doMes, efetivoOk ? delta : null);

    const diasPerdidos = efetivo.reduce((t, p) => t + toNumber(p.dias_perdidos), 0);

    if (efetivoOk) {
      cards.presentes.update({ value: formatNumber(efetivo.length), loading: false });
      cards.aproveitamento.update({
        value: ponderada === null ? SEM_MEDIDA : percentual(ponderada),
        loading: false,
      });
      cards.perdidos.update({
        value: decorridos === 0 ? SEM_MEDIDA : diasMilitar(diasPerdidos),
        loading: false,
      });
    } else {
      cards.presentes.update({ value: VALOR_FALHA, loading: false });
      cards.aproveitamento.update({ value: VALOR_FALHA, loading: false });
      cards.perdidos.update({ value: VALOR_FALHA, loading: false });
    }

    const linhasEfetivo = efetivo.map(p => ({
      id: p.usuario_uuid,
      usuario_uuid: p.usuario_uuid,
      militar: nomeMilitar(p),
      dias_na_dgeo: p.dias_na_dgeo_decorridos,
      dias_decorridos: p.dias_decorridos,
      aproveitamento: p.aproveitamento_decorrido,
      dias_perdidos: p.dias_perdidos,
      impedimentos: (p.impedimentos || [])
        .map(i => `${i.descricao} (${i.percentual}%)`)
        .join('; '),
    }));

    // ABAIXO DE 100%, COM O PIOR EM CIMA. O Chart.js desenha o indice 0 no TOPO
    // do eixo de categoria, entao a ordem que chega e CRESCENTE: quem menos
    // rendeu e a primeira linha que o olho encontra.
    //
    // O corte e 99,95 e nao 100: `aproveitamento` vem do servidor arredondado em
    // uma casa, e comparar igualdade com ponto flutuante deixaria passar quem
    // esta a 99,96% desenhado como '100,0%'.
    const abaixoDeCem = linhasEfetivo
      .filter(p => toNumber(p.aproveitamento) < 99.95)
      .sort((a, b) => toNumber(a.aproveitamento) - toNumber(b.aproveitamento))
      .map(p => ({ militar: p.militar, aproveitamento: toNumber(p.aproveitamento) }));

    caixaGrafico.setFalha(!efetivoOk);
    grafico.update({ data: abaixoDeCem, loading: false });

    // --- Custo por causa ---------------------------------------------------
    //
    // O servidor ja rateia a perda entre os impedimentos do dia quando eles
    // somam mais de 100%, entao somar por descricao aqui nao passa do total.
    const porCausa = new Map();
    for (const p of efetivo) {
      for (const i of p.impedimentos || []) {
        porCausa.set(i.descricao, (porCausa.get(i.descricao) || 0) + toNumber(i.dias_perdidos));
      }
    }
    // MAIOR CAUSA EM CIMA, pela mesma régua do gráfico acima: índice 0 no topo.
    const causas = [...porCausa.entries()]
      .filter(([, dias]) => dias > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([causa, dias]) => ({ causa, dias: Number(dias.toFixed(2)) }));

    caixaCausas.setFalha(!efetivoOk);
    graficoCausas.update({ data: causas, loading: false });

    caixaEfetivo.setFalha(!efetivoOk);
    tabelaEfetivo.update({ rows: linhasEfetivo, loading: false });

    // --- Entradas e saidas, no ANO -----------------------------------------
    //
    // MENSAL ERA ZERO QUASE SEMPRE: em 2026 houve entrada em 4 dos 12 meses e
    // saida em 2, e 23 das 27 passagens sao a carga inicial de 1º de janeiro. Um
    // cartao que marca zero onze meses por ano nao mede movimento, mede o
    // recorte. No ano o dado tem sinal, e a lista cabe numa tela.
    const periodosOk = periodosRes.status === 'fulfilled';
    const periodos = periodosOk ? (periodosRes.value || []) : [];

    const doAno = (data) => Boolean(data) && String(data).slice(0, 4) === String(ano);
    const entradas = periodos.filter(p => doAno(p.data_inicio));
    const saidas = periodos.filter(p => doAno(p.data_fim));

    resumoMovimento.textContent = periodosOk
      ? `${entradas.length} ${entradas.length === 1 ? 'entrada' : 'entradas'}`
        + ` e ${saidas.length} ${saidas.length === 1 ? 'saída' : 'saídas'} em ${ano}.`
      : TEXTO_FALHA;

    caixaMovimento.setFalha(!periodosOk);
    tabelaMovimento.update({
      rows: [
        ...entradas.map(p => ({
          id: `${p.id}:entrada`,
          usuario_uuid: p.usuario_uuid,
          militar: nomeMilitar(p),
          movimento: 'Entrou',
          data: p.data_inicio,
        })),
        ...saidas.map(p => ({
          id: `${p.id}:saida`,
          usuario_uuid: p.usuario_uuid,
          militar: nomeMilitar(p),
          movimento: 'Saiu',
          data: p.data_fim,
        })),
      ],
      loading: false,
    });

    // --- Divergencias ------------------------------------------------------
    //
    // Quem PODE ENTRAR no sistema e nao consta na Divisao: ou a passagem nao foi
    // lancada, ou a pessoa saiu e o acesso ficou aberto. Quem RECORTA e o
    // servidor, sob o modulo efetivo; antes a tela cruzava `GET /usuarios`, que e
    // do administrador global e devolve o cadastro inteiro para contar tres
    // nomes.
    //
    // O CONTRARIO NAO E DIVERGENCIA: `dgeo.usuario.ativo` e flag de LOGIN, e a
    // maioria do efetivo nao usa o SCA.
    const divergenciasOk = divergenciasRes.status === 'fulfilled';
    const divergencias = (divergenciasOk ? divergenciasRes.value || [] : []).map(u => ({
      id: `ativo:${u.usuario_uuid}`,
      usuario_uuid: u.usuario_uuid,
      militar: nomeMilitar(u),
      situacao: 'Conta ativa, sem passagem pela DGEO no mês',
    }));

    cards.divergencias.update({
      value: divergenciasOk ? formatNumber(divergencias.length) : VALOR_FALHA,
      loading: false,
    });
    caixaDivergencias.setFalha(!divergenciasOk);
    tabelaDivergencias.update({ rows: divergencias, loading: false });

    // `anteriorRes` FICA DE FORA: ele so alimenta a frase de comparacao, e um
    // toast de erro por causa dela diria que a tela falhou quando ela nao
    // falhou.
    const falhou = [efetivoRes, periodosRes, divergenciasRes].filter(r => r.status === 'rejected');
    if (falhou.length) {
      showError(falhou[0].reason?.message || 'Erro ao carregar o efetivo do mês');
    }
  }

  /** Dias do mes escolhido ja vividos, pela mesma regua do servidor. */
  function diasDecorridos() {
    const agora = new Date();
    const doMes = new Date(ano, mes, 0).getDate();
    if (ano < agora.getFullYear() || (ano === agora.getFullYear() && mes < agora.getMonth() + 1)) {
      return doMes;
    }
    if (ano === agora.getFullYear() && mes === agora.getMonth() + 1) return agora.getDate();
    return 0;
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      grafico._cleanup();
      graficoCausas._cleanup();
      tabelaEfetivo._cleanup();
      tabelaMovimento._cleanup();
      tabelaDivergencias._cleanup();
    },
    refresh: load,
  };
}

// =============================================================================
// Aba ACESSOS
// =============================================================================

/**
 * Aba "Acessos": o historico de `dgeo.login`.
 *
 * O QUE FICA DE FORA, e por que:
 *   - a serie de 12 meses: sem um ano de historico acumulado, quase todos os
 *     pontos sao zero por construcao
 *   - "por onde se entra": barra sobre um dominio de DOIS valores. O dado virou
 *     COLUNA da tabela de quem entrou hoje
 *   - o subtitulo: descrevia o schema da tabela, e nao a pergunta da tela
 *
 * O QUE MUDOU DE SENTIDO: os cartoes contam PESSOA distinta, e o que fala de
 * conta se chama conta. `dgeo.usuario.ativo` e permissao de entrar, e nao gente
 * na Divisao -- quem responde por gente e a aba Efetivo.
 *
 * O RECORTE DO PERIODO agora e da tela, e vale para a serie diaria e para o
 * ranking. Os cartoes tem janela FIXA (hoje e 30 dias), e o rotulo de cada um
 * diz qual: eles sao o retrato do modulo, e nao a resposta ao filtro.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
async function renderAcessosTab(container) {
  let disposed = false;
  let periodo = PERIODO_PADRAO;

  const cards = {
    hoje: createStatsCard({
      title: 'Pessoas que entraram hoje',
      value: '-',
      icon: svgIcon(ICONS.people, 24),
      color: 'success',
      loading: true,
    }),
    mes: createStatsCard({
      title: 'Pessoas que entraram em 30 dias',
      value: '-',
      icon: svgIcon(ICONS.schedule, 24),
      color: 'info',
      loading: true,
    }),
    contas: createStatsCard({
      title: 'Contas ativas',
      value: '-',
      icon: svgIcon(ICONS.key, 24),
      color: 'primary',
      loading: true,
    }),
    // SEM 'Contas sem senha'. `dgeo.usuario.senha` e NOT NULL na pratica desde
    // que a criacao de usuario passou a gerar o hash, e o cartao marcava zero de
    // 53 contas. Numero que nao pode mudar nao e medida, e ocupava um quarto da
    // linha de cartoes. O `contas_sem_senha` continua saindo de `/acessos/resumo`
    // para quem precisar auditar.
  };

  const TITULO_DIA = 'Logins por dia no período';
  const graficoDia = createLineChart({
    title: TITULO_DIA,
    xKey: 'dia',
    series: [{ dataKey: 'logins', label: 'Logins', fill: true }],
    loading: true,
  });
  const caixaDia = caixaComFalha(TITULO_DIA, graficoDia);

  // Conta EVENTO, e o titulo diz isso. E a unica pergunta desta tela que e mesmo
  // sobre login: quem usa o sistema o dia inteiro aparece com mais logins, e e o
  // que se quer ver.
  const TITULO_PESSOAS = 'Logins por pessoa no período';
  const graficoPessoas = createBarChart({
    title: TITULO_PESSOAS,
    xKey: 'usuario',
    series: [{ dataKey: 'logins', label: 'Logins' }],
    horizontal: true,
    loading: true,
  });
  const caixaPessoas = caixaComFalha(TITULO_PESSOAS, graficoPessoas);

  const tabela = createDataTable({
    columns: [
      {
        key: 'militar',
        label: 'Pessoa',
        sortable: true,
        render: (row) => linkMilitar(row.uuid, row.militar),
      },
      { key: 'login', label: 'Login', sortable: true },
      { key: 'por_onde', label: 'Por onde' },
      { key: 'logins', label: 'Logins hoje', sortable: true },
      {
        key: 'ultimo_login',
        label: 'Último acesso',
        sortable: true,
        render: (row) => instante(row.ultimo_login),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Ninguém entrou hoje',
  });
  const caixaTabela = caixaComFalha(null, tabela.element);

  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Acessos ao SCA' }),
      el('div', { className: 'dashboard-section__controls' }, seletor({
        rotulo: 'Período',
        aria: 'Selecionar período',
        opcoes: PERIODOS.map(d => ({ value: d, label: `${d} dias` })),
        valor: periodo,
        onChange: (valor) => {
          periodo = Number(valor);
          load();
        },
      })),
    ]),
    el('div', { className: 'stats-grid' }, Object.values(cards)),
    caixaDia,
    caixaPessoas,
    secao('Quem entrou hoje', caixaTabela),
  ]));

  async function load() {
    const pedido = periodo;

    const [resumo, dia, pessoas, logados] = await Promise.allSettled([
      getAcessosResumo(),
      getLoginsDia(periodo),
      getLoginsUsuarios(periodo, MAX_RANKING),
      getAcessosLogados(),
    ]);

    if (disposed || pedido !== periodo) return;

    if (resumo.status === 'fulfilled') {
      cards.hoje.update({ value: formatNumber(resumo.value.pessoas_hoje ?? 0), loading: false });
      cards.mes.update({ value: formatNumber(resumo.value.pessoas_30_dias ?? 0), loading: false });
      cards.contas.update({ value: formatNumber(resumo.value.contas_ativas ?? 0), loading: false });
    } else {
      for (const card of Object.values(cards)) {
        card.update({ value: VALOR_FALHA, loading: false });
      }
    }

    caixaDia.setFalha(dia.status === 'rejected');
    graficoDia.update({
      data: (dia.status === 'fulfilled' ? dia.value : []).map(p => ({
        dia: diaCurto(p.data),
        logins: p.logins,
      })),
      loading: false,
    });

    caixaPessoas.setFalha(pessoas.status === 'rejected');
    graficoPessoas.update({
      data: pessoas.status === 'fulfilled' ? pessoas.value : [],
      loading: false,
    });

    caixaTabela.setFalha(logados.status === 'rejected');
    tabela.update({
      rows: (logados.status === 'fulfilled' ? logados.value || [] : []).map(p => ({
        uuid: p.uuid,
        militar: nomeMilitar(p),
        login: p.login,
        por_onde: (p.clientes || []).map(rotuloCliente).join(', ') || '-',
        logins: p.logins,
        ultimo_login: p.ultimo_login,
      })),
      loading: false,
    });

    const falhou = [resumo, dia, pessoas, logados].filter(r => r.status === 'rejected');
    if (falhou.length) {
      showError(falhou[0].reason?.message || 'Erro ao carregar os acessos');
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      graficoDia._cleanup();
      graficoPessoas._cleanup();
      tabela._cleanup();
    },
    refresh: load,
  };
}

// =============================================================================
// A tela
// =============================================================================

/**
 * Dashboard do efetivo (#/acessos).
 *
 * DUAS ABAS NA MESMA ROTA: Efetivo (abre a tela) e Acessos. A rota e `#/acessos`
 * e o rotulo no menu e "Dashboard": renomear URL quebra link guardado.
 *
 * POR QUE O EFETIVO ABRE. Medir LOGIN nao e medir gente: uma conta de servico
 * domina o ranking e os graficos nascem degenerados. O chefe pergunta quem esta
 * na Divisao, quanto rendeu, quem chegou e quem saiu. O historico de login
 * continua, uma aba atras.
 *
 * AS DUAS ABAS TEM DONOS DIFERENTES, e por isso a segunda so aparece para o
 * administrador global:
 *
 *   Efetivo  consulta no modulo EFETIVO, desde a regua de 2026-08-08. Tudo o
 *            que ela le sai de `/efetivo/*`, cujos GET cobram
 *            `verifyPerfil('consulta', 'efetivo')`; escrever ali e do gerente.
 *   Acessos  administrador global. `/acessos/*` e `verifyAdmin`, e quem entrou
 *            no sistema nao e dado do efetivo.
 *
 * Enquanto a aba Efetivo cruzava `GET /usuarios` para achar as divergencias, a
 * tela INTEIRA era do administrador global: quem responde pelo efetivo via o
 * menu "Efetivo" e nao alcancava o dashboard dele. A conta desceu para
 * `/efetivo/divergencias`, e a guarda da rota desceu junto.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderAcessos(container, _ctx) {
  const abas = createTabs({
    ariaLabel: 'Painéis do efetivo',
    tabs: [
      { id: 'efetivo', label: 'Efetivo', render: renderEfetivoTab },
      // A aba some para quem nao e administrador, em vez de aparecer e cair em
      // erro: as quatro rotas dela respondem 403, e uma aba que so sabe falhar e
      // pior que uma aba a menos.
      ...(isAdmin() ? [{ id: 'acessos', label: 'Acessos', render: renderAcessosTab }] : []),
    ],
  });

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Dashboard do Efetivo' }),
    ]),
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;

  // So a aba ATIVA se recarrega, como nos outros tres dashboards. Sem cache a
  // invalidar aqui: estas rotas nao passam por cache no cliente.
  const intervalo = setInterval(() => {
    abas.refreshActive();
  }, REFRESH_MS);

  return () => {
    clearInterval(intervalo);
    abas._cleanup();
  };
}
