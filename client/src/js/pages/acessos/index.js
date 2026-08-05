import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showError } from '@utils/toast.js';
import { formatNumber, monthName, toNumber } from '@utils/format.js';
import { createStatsCard } from '@components/stats-card.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createTabs } from '@components/tabs/tabs.js';
import {
  getAcessosResumo,
  getAcessosLogados,
  getLoginsDia,
  getLoginsUsuarios,
  getEfetivoDoMes,
  getPeriodosEfetivo,
  getUsuarios,
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
 * Aba "Efetivo": quem esta na Divisao neste mes, quanto rendeu, quem chegou,
 * quem saiu, quem esta impedido e o que nao bate entre cadastro e passagem.
 *
 * ELA ABRE A TELA: o painel de login mede a plataforma, e o chefe pergunta pela
 * tropa.
 *
 * A FONTE JA EXISTIA E NAO TINHA TELA: `controller.resumoMensal` e a rota
 * `/efetivo/mes` nasceram para a subsecao 6.1 do RPCMTec, e nenhuma pagina do
 * client consumia `getEfetivoDoMes`. Aqui nao ha consulta nova.
 *
 * TRES FONTES, e cada cartao diz de qual delas veio:
 *   - `/efetivo/mes`: quem esteve, quantos dias, o aproveitamento, o impedimento
 *   - `/efetivo/periodos`: as passagens do ano, de onde saem entrada e saida
 *   - `/usuarios`: o cadastro, para confrontar com a passagem
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
      title: 'Aproveitamento médio no mês',
      value: '-',
      icon: svgIcon(ICONS.dataUsage, 24),
      color: 'success',
      loading: true,
    }),
    entradas: createStatsCard({
      title: 'Entradas no mês',
      value: '-',
      icon: svgIcon(ICONS.add, 24),
      color: 'info',
      loading: true,
    }),
    saidas: createStatsCard({
      title: 'Saídas no mês',
      value: '-',
      icon: svgIcon(ICONS.logout, 24),
      color: 'warning',
      loading: true,
    }),
    divergencias: createStatsCard({
      title: 'Divergências entre cadastro e efetivo',
      value: '-',
      icon: svgIcon(ICONS.warning, 24),
      color: 'error',
      loading: true,
    }),
  };

  const TITULO_GRAFICO = 'Aproveitamento por militar no mês';
  const grafico = createBarChart({
    title: TITULO_GRAFICO,
    xKey: 'militar',
    series: [{ dataKey: 'aproveitamento', label: 'Aproveitamento (%)' }],
    horizontal: true,
    loading: true,
  });
  const caixaGrafico = caixaComFalha(TITULO_GRAFICO, grafico);

  const tabelaEfetivo = createDataTable({
    columns: [
      {
        key: 'militar',
        label: 'Militar',
        sortable: true,
        render: (row) => linkMilitar(row.usuario_uuid, row.militar),
      },
      { key: 'dias_na_dgeo', label: 'Dias na Divisão', sortable: true },
      {
        key: 'aproveitamento',
        label: 'Aproveitamento',
        sortable: true,
        sortValue: (row) => toNumber(row.aproveitamento),
        render: (row) => percentual(row.aproveitamento),
      },
      {
        key: 'impedimentos',
        label: 'Impedimentos',
        render: (row) => row.impedimentos || 'Nenhum',
      },
      { key: 'conta', label: 'Conta', render: (row) => (row.ativo ? 'Ativa' : 'Desativada') },
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
    emptyMessage: 'Ninguém entrou nem saiu neste mês',
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
    emptyMessage: 'O cadastro e o efetivo do mês batem',
  });
  const caixaDivergencias = caixaComFalha(null, tabelaDivergencias.element);

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
    el('div', { className: 'stats-grid' }, Object.values(cards)),
    caixaGrafico,
    secao('Militares no mês', caixaEfetivo),
    secao('Entradas e saídas no mês', caixaMovimento),
    secao('Divergências entre cadastro e efetivo', caixaDivergencias),
  ]));

  /** Primeiro e ultimo dia do mes escolhido, em 'AAAA-MM-DD'. */
  const primeiroDia = () => `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = () => {
    const ultimo = new Date(ano, mes, 0).getDate();
    return `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
  };
  const dentroDoMes = (data) => {
    if (!data) return false;
    const dia = String(data).slice(0, 10);
    return dia >= primeiroDia() && dia <= ultimoDia();
  };

  async function load() {
    const pedido = `${ano}-${mes}`;

    const [efetivoRes, periodosRes, usuariosRes] = await Promise.allSettled([
      getEfetivoDoMes(ano, mes),
      getPeriodosEfetivo(ano),
      getUsuarios(),
    ]);

    // Trocar de mes no meio da carga invalida a resposta que estiver a caminho.
    if (disposed || pedido !== `${ano}-${mes}`) return;

    const efetivoOk = efetivoRes.status === 'fulfilled';
    const efetivo = efetivoOk ? (efetivoRes.value || []) : [];

    if (efetivoOk) {
      const media = efetivo.length
        ? efetivo.reduce((soma, p) => soma + toNumber(p.aproveitamento), 0) / efetivo.length
        : 0;
      cards.presentes.update({ value: formatNumber(efetivo.length), loading: false });
      cards.aproveitamento.update({ value: percentual(media), loading: false });
    } else {
      cards.presentes.update({ value: VALOR_FALHA, loading: false });
      cards.aproveitamento.update({ value: VALOR_FALHA, loading: false });
    }

    const linhasEfetivo = efetivo.map(p => ({
      id: p.usuario_uuid,
      usuario_uuid: p.usuario_uuid,
      militar: nomeMilitar(p),
      dias_na_dgeo: p.dias_na_dgeo,
      aproveitamento: p.aproveitamento,
      ativo: p.ativo,
      impedimentos: (p.impedimentos || [])
        .map(i => `${i.descricao} (${i.percentual}%)`)
        .join('; '),
    }));

    caixaGrafico.setFalha(!efetivoOk);
    grafico.update({
      data: linhasEfetivo.map(p => ({
        militar: p.militar,
        aproveitamento: toNumber(p.aproveitamento),
      })),
      loading: false,
    });

    caixaEfetivo.setFalha(!efetivoOk);
    tabelaEfetivo.update({ rows: linhasEfetivo, loading: false });

    // --- Entradas e saidas -------------------------------------------------
    //
    // A passagem e um INTERVALO, e nao um retrato mensal: entrar no mes e ter
    // `data_inicio` dentro dele, e sair e ter `data_fim` dentro dele. Quem
    // atravessa o mes inteiro nao e nem uma coisa nem outra.
    const periodosOk = periodosRes.status === 'fulfilled';
    const periodos = periodosOk ? (periodosRes.value || []) : [];

    const entradas = periodos.filter(p => dentroDoMes(p.data_inicio));
    const saidas = periodos.filter(p => dentroDoMes(p.data_fim));

    if (periodosOk) {
      cards.entradas.update({ value: formatNumber(entradas.length), loading: false });
      cards.saidas.update({ value: formatNumber(saidas.length), loading: false });
    } else {
      cards.entradas.update({ value: VALOR_FALHA, loading: false });
      cards.saidas.update({ value: VALOR_FALHA, loading: false });
    }

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
    // Tres numeros de "quantas pessoas" convivem no modulo e nenhum media a
    // mesma coisa: conta habilitada, pessoa cadastrada e militar com passagem.
    // Esta secao nomeia CADA desencontro em vez de deixar os tres numeros no ar.
    const usuariosOk = usuariosRes.status === 'fulfilled';
    const usuarios = usuariosOk ? (usuariosRes.value || []) : [];
    const divergenciasOk = usuariosOk && efetivoOk;

    // ESTAR NA DGEO COM A CONTA DESATIVADA NÃO É DIVERGÊNCIA.
    // `dgeo.usuario.ativo` é flag de LOGIN, e a maioria do efetivo não usa o
    // SCA: listar isso enche a tela de ruído e afoga as linhas que importam.
    //
    // A divergência que importa é a outra: quem PODE ENTRAR no sistema e não
    // consta na Divisão. Ou a passagem não foi lançada, ou a pessoa saiu e o
    // acesso ficou aberto.
    const uuidsNoMes = new Set(efetivo.map(p => p.usuario_uuid));
    const divergencias = usuarios
      .filter(u => u.ativo && !uuidsNoMes.has(u.uuid))
      .map(u => ({
        id: `ativo:${u.uuid}`,
        usuario_uuid: u.uuid,
        militar: nomeMilitar(u),
        situacao: 'Conta ativa, sem passagem pela DGEO no mês',
      }));

    cards.divergencias.update({
      value: divergenciasOk ? formatNumber(divergencias.length) : VALOR_FALHA,
      loading: false,
    });
    caixaDivergencias.setFalha(!divergenciasOk);
    tabelaDivergencias.update({ rows: divergencias, loading: false });

    const falhou = [efetivoRes, periodosRes, usuariosRes].filter(r => r.status === 'rejected');
    if (falhou.length) {
      showError(falhou[0].reason?.message || 'Erro ao carregar o efetivo do mês');
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      grafico._cleanup();
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
    semSenha: createStatsCard({
      title: 'Contas sem senha',
      value: '-',
      icon: svgIcon(ICONS.lock, 24),
      color: 'warning',
      loading: true,
    }),
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
      cards.semSenha.update({
        value: formatNumber(resumo.value.contas_sem_senha ?? 0),
        loading: false,
      });
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
 * Dashboard do efetivo (#/acessos), do administrador global.
 *
 * DUAS ABAS NA MESMA ROTA: Efetivo (abre a tela) e Acessos. A rota e `#/acessos`
 * e o rotulo no menu e "Dashboard": renomear URL quebra link guardado.
 *
 * POR QUE O EFETIVO ABRE. Medir LOGIN nao e medir gente: uma conta de servico
 * domina o ranking e os graficos nascem degenerados. O chefe pergunta quem esta
 * na Divisao, quanto rendeu, quem chegou e quem saiu. O historico de login
 * continua, uma aba atras.
 *
 * `verifyAdmin` no servidor e `adminLoader` na rota: nem o historico de acesso
 * nem o efetivo sao dado de modulo, e a aba Efetivo mostra licença de saúde e
 * função acumulada, nominalmente.
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
      { id: 'acessos', label: 'Acessos', render: renderAcessosTab },
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
