import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import {
  getAcessosResumo,
  getAcessosLogados,
  getLoginsDia,
  getLoginsMes,
  getLoginsUsuarios,
  getLoginsClientes,
} from '@services/plataforma-service.js';

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

/** Primeiro dia do mes -> 'MM/AAAA'. */
function mesCurto(iso) {
  const partes = String(iso || '').split('-');
  return partes.length === 3 ? `${partes[1]}/${partes[0]}` : String(iso || '');
}

/** Instante ISO -> 'DD/MM/AAAA HH:MM', no fuso de quem esta lendo. */
function instante(valor) {
  if (!valor) return '-';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Tela de ACESSOS (#/acessos), do administrador global.
 *
 * Ela existe desde 2026-08-02, com a fusao da autenticacao: ate ali o registro
 * de quem entrava no SCA morava no banco do Auth Server, e o painel que o lia
 * era de la. `dgeo.login` guarda uma linha por login bem-sucedido, e esta tela
 * e a unica leitora dela.
 *
 * O que ela responde, do topo para baixo: quantos podem entrar, quantos
 * entraram, quando se entra (serie diaria e mensal), quem mais entra e por onde
 * se entra. As series vem com o dia sem login valendo ZERO, e nao faltando, o
 * que e feito no servidor com `generate_series`.
 *
 * `verifyAdmin` no servidor e `adminLoader` na rota: saber quem entrou e quando
 * nao e dado de modulo nenhum, e nao ha perfil de "acessos".
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderAcessos(container, _ctx) {
  let disposed = false;

  // ---------------------------------------------------------------------------
  // Topo: os tres numeros
  // ---------------------------------------------------------------------------
  const cardAtivos = createStatsCard({
    title: 'Usuários ativos',
    value: '-',
    icon: svgIcon(ICONS.people, 24),
    color: 'primary',
    loading: true,
  });
  const cardHoje = createStatsCard({
    title: 'Logins hoje',
    value: '-',
    icon: svgIcon(ICONS.schedule, 24),
    color: 'success',
    loading: true,
  });
  const cardMes = createStatsCard({
    title: 'Logins (30 dias)',
    value: '-',
    icon: svgIcon(ICONS.assignment, 24),
    color: 'info',
    loading: true,
  });

  // ---------------------------------------------------------------------------
  // Series
  // ---------------------------------------------------------------------------
  const graficoDia = createLineChart({
    title: 'Logins por dia (últimos 14 dias)',
    xKey: 'dia',
    series: [{ dataKey: 'logins', label: 'Logins', fill: true }],
    loading: true,
  });

  const graficoMes = createBarChart({
    title: 'Logins por mês (últimos 12 meses)',
    xKey: 'mes',
    series: [{ dataKey: 'logins', label: 'Logins' }],
    loading: true,
  });

  const graficoUsuarios = createBarChart({
    title: 'Quem mais entrou (30 dias)',
    xKey: 'usuario',
    series: [{ dataKey: 'logins', label: 'Logins' }],
    horizontal: true,
    loading: true,
  });

  const graficoClientes = createBarChart({
    title: 'Por onde se entra (30 dias)',
    xKey: 'cliente',
    series: [{ dataKey: 'logins', label: 'Logins' }],
    loading: true,
  });

  // ---------------------------------------------------------------------------
  // Quem entrou hoje
  //
  // Uma linha por par pessoa + cliente: quem abriu a interface e o plugin no
  // mesmo dia aparece duas vezes, de propósito, porque a pergunta da tabela e
  // "quem esta no sistema, e por onde".
  // ---------------------------------------------------------------------------
  const tabela = createDataTable({
    columns: [
      {
        key: 'nome_guerra',
        label: 'Pessoa',
        sortable: true,
        render: (row) => [row.tipo_posto_grad, row.nome_guerra].filter(Boolean).join(' ') || '-',
      },
      { key: 'login', label: 'Login', sortable: true, render: (row) => row.login || '-' },
      { key: 'cliente', label: 'Cliente', render: (row) => rotuloCliente(row.cliente) },
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

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Acessos' }),
    ]),
    el('p', {
      className: 'page__subtitle',
      textContent:
        'Histórico de login do SCA. Uma linha por entrada bem-sucedida, pela interface web ou pelo plugin do QGIS.',
    }),
    el('div', { className: 'stats-grid' }, [cardAtivos, cardHoje, cardMes]),
    graficoDia,
    graficoMes,
    graficoUsuarios,
    graficoClientes,
    el('h2', { className: 'page__section-title', textContent: 'Quem entrou hoje' }),
    tabela.element,
  ]);
  container.appendChild(page);

  // ---------------------------------------------------------------------------
  // Carga
  //
  // `allSettled`, e nao `all`: sao seis rotas independentes, e uma delas falhar
  // nao e razao para a tela inteira ficar em branco. Cada pedaco cai sozinho,
  // e o aviso sai uma vez so em vez de seis.
  // ---------------------------------------------------------------------------
  async function load() {
    const [resumo, dia, mes, usuarios, clientes, logados] = await Promise.allSettled([
      getAcessosResumo(),
      getLoginsDia(),
      getLoginsMes(),
      getLoginsUsuarios(),
      getLoginsClientes(),
      getAcessosLogados(),
    ]);

    if (disposed) return;

    if (resumo.status === 'fulfilled') {
      cardAtivos.update({ value: resumo.value.usuarios_ativos ?? 0, loading: false });
      cardHoje.update({ value: resumo.value.logins_hoje ?? 0, loading: false });
      cardMes.update({ value: resumo.value.logins_30_dias ?? 0, loading: false });
    } else {
      cardAtivos.update({ value: '-', loading: false });
      cardHoje.update({ value: '-', loading: false });
      cardMes.update({ value: '-', loading: false });
    }

    graficoDia.update({
      data: (dia.status === 'fulfilled' ? dia.value : []).map((p) => ({
        dia: diaCurto(p.data),
        logins: p.logins,
      })),
      loading: false,
    });

    graficoMes.update({
      data: (mes.status === 'fulfilled' ? mes.value : []).map((p) => ({
        mes: mesCurto(p.data),
        logins: p.logins,
      })),
      loading: false,
    });

    graficoUsuarios.update({
      data: usuarios.status === 'fulfilled' ? usuarios.value : [],
      loading: false,
    });

    graficoClientes.update({
      data: (clientes.status === 'fulfilled' ? clientes.value : []).map((c) => ({
        cliente: rotuloCliente(c.cliente),
        logins: c.logins,
      })),
      loading: false,
    });

    tabela.update({
      rows: logados.status === 'fulfilled' ? logados.value || [] : [],
      loading: false,
    });

    const falhou = [resumo, dia, mes, usuarios, clientes, logados].filter(
      (r) => r.status === 'rejected'
    );
    if (falhou.length) {
      showError(falhou[0].reason?.message || 'Erro ao carregar os acessos');
    }
  }

  await load();

  return () => {
    disposed = true;
    tabela._cleanup();
  };
}
