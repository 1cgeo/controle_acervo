import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber, formatDate } from '@utils/format.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { chip } from '@components/status-chip.js';
import { estadoErro } from '@components/estado-erro.js';
import { isAdmin, ehGerenteDeAlgumModulo } from '@store/auth-store.js';
import { getPlanoDoAno } from '@modules/acervo/services/acervo-service.js';
import { getGradePit, getDiagnosticoPit, getAnosMetaPit } from '@services/plataforma-service.js';

/**
 * Aba "Plano do Ano" do dashboard do acervo, e a PRIMEIRA.
 *
 * POR QUE ELA ABRE O PAINEL. As outras abas respondem o que o acervo TEM
 * (produto, versao, GB) e o que ENTROU. Nenhuma respondia o que o acervo DEVE, e
 * era a pergunta do chefe: quais folhas estao prometidas, para quando, e como a
 * meta do PIT vai. Numero de estoque quase nao muda; prazo muda todo dia, e por
 * isso vem antes.
 *
 * DUAS FONTES, E CADA UMA COM SEU GUARDA. O plano do ACERVO (folha planejada,
 * lote, Extra-PIT) sai de `GET /dashboard/plano_ano`, que cobra consulta: quem
 * consulta o acervo ve o acervo. A grade do PIT sai de `GET /metas/execucao`,
 * que cobra GERENTE, porque ela e o plano da Divisao inteira e nao so do acervo.
 * Sem esse recorte, quem tem consulta abriria a aba para receber 403 na metade
 * dela.
 *
 * O ATRASO VEM DO SERVIDOR. Subtrair datas aqui erraria o fuso (a coluna e DATE
 * e chega como texto), e duas telas fazendo a mesma conta chegariam a dois
 * numeros.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderPlanoTab(container) {
  let disposed = false;
  // ESPELHA o `verifyGerente` do servidor, e o `isAdmin` faz parte dele: aquele
  // middleware passa "o ADMINISTRADOR GLOBAL e o GERENTE de qualquer módulo".
  //
  // Sem o `isAdmin`, o administrador com `perfis` vazio (que é o caso do usuário
  // de carga em produção) via o aviso "as metas aparecem para o perfil de
  // gerente" numa rota que o servidor teria respondido. Guarda de tela mais
  // rígido que o do servidor esconde tela que a pessoa PODE abrir, e isso é tão
  // errado quanto o contrário: só não é inseguro.
  const podeVerPit = isAdmin() || ehGerenteDeAlgumModulo();
  let ano = new Date().getFullYear();

  const filtro = criarFiltroAno({
    carregarAnos: getAnosMetaPit,
    permitirOutroAno: false,
    onChange: (novo) => { ano = novo; load(); },
  });

  const corpo = el('div', { className: 'plano-ano__corpo' });
  container.appendChild(el('div', { className: 'filtro-barra' }, [filtro.element]));
  container.appendChild(corpo);

  // ---------------------------------------------------------------------------
  // A faixa de metas
  // ---------------------------------------------------------------------------

  /**
   * A barra que compara o realizado com o prometido.
   *
   * A COR SAI DA COMPARACAO COM O PLANO, e nao de uma faixa fixa de porcentagem.
   * Uma meta com 30% em marco esta no rumo; a mesma 30% em novembro esta parada.
   * Quem sabe a diferenca e o PLANEJADO, que ja e a promessa acumulada.
   */
  function barraMeta(realizado, planejado, prometido) {
    const alvo = Number(prometido) || 0;
    const feito = Number(realizado) || 0;
    const plano = Number(planejado) || 0;
    const pct = alvo > 0 ? Math.min(100, (feito / alvo) * 100) : 0;

    let variante = 'neutro';
    if (alvo > 0 && feito >= alvo) variante = 'success';
    else if (plano > 0 && feito >= plano) variante = 'success';
    else if (plano > 0 && feito >= plano * 0.75) variante = 'warning';
    else if (plano > 0) variante = 'error';

    // O TRILHO TAMBÉM LEVA A COR, e não só o preenchimento. Visto na tela: com
    // realizado ZERO o `fill` tem largura 0% e some, então a meta 6.1 (0 de
    // 4.200 prometidas) ficava com a barra cinza vazia, idêntica à meta que não
    // tem plano nenhum. O pior caso era o único que não gritava.
    return el('div', {
      className: `progress-bar progress-bar--${variante}`,
      title: `${feito} de ${alvo}`,
    }, [
      el('div', {
        className: `progress-bar__fill progress-bar__fill--${variante}`,
        style: { width: `${pct}%` },
      }),
    ]);
  }

  const COLUNAS_META = [
    { key: 'item', label: 'Item', sortable: true },
    { key: 'descricao', label: 'Produto ou serviço', className: 'data-table__cell--truncate' },
    {
      key: 'quantidade_prevista',
      label: 'Promete',
      sortable: true,
      render: (r) => formatNumber(r.quantidade_prevista),
    },
    { key: 'planejado', label: 'Planejado', sortable: true, render: (r) => formatNumber(r.planejado) },
    { key: 'realizado', label: 'Realizado', sortable: true, render: (r) => formatNumber(r.realizado) },
    {
      key: 'progresso',
      label: 'Progresso',
      // `sortValue` porque a celula e um no, e ordenar por ele ordenaria por
      // '[object HTMLDivElement]'.
      sortValue: (r) => (Number(r.quantidade_prevista) > 0
        ? Number(r.realizado) / Number(r.quantidade_prevista)
        : 0),
      render: (r) => barraMeta(r.realizado, r.planejado, r.quantidade_prevista),
    },
    {
      key: 'origem',
      label: 'Origem',
      render: (r) => chip(r.origem || 'Manual', r.origem === 'Manual' ? 'default' : 'info'),
    },
  ];

  // ---------------------------------------------------------------------------
  // O que falta produzir
  // ---------------------------------------------------------------------------

  const COLUNAS_PRODUZIR = [
    { key: 'mi', label: 'MI', sortable: true },
    { key: 'produto', label: 'Produto', sortable: true, className: 'data-table__cell--truncate' },
    { key: 'tipo_produto', label: 'Tipo' },
    { key: 'tipo_escala', label: 'Escala' },
    { key: 'meta', label: 'Meta', render: (r) => r.meta || r.demanda_extra || '-' },
    { key: 'lote', label: 'Lote', render: (r) => r.lote || '-' },
    {
      key: 'data_prevista',
      label: 'Prometida para',
      sortable: true,
      // Sem promessa NAO e "-", e um AVISO. A folha planejada sem data e erro de
      // cadastro, e some do planejado do PIT sem erro nenhum: o diagnostico do
      // servidor a acusa, e aqui ela tem de saltar aos olhos na propria linha.
      render: (r) => (r.data_prevista
        ? formatDate(r.data_prevista)
        : chip('Sem data prevista', 'error')),
    },
    {
      key: 'dias_atraso',
      label: 'Atraso',
      sortable: true,
      render: (r) => {
        if (r.dias_atraso === null || r.dias_atraso === undefined) return '-';
        const dias = Number(r.dias_atraso);
        return dias > 0 ? chip(`${formatNumber(dias)} dia(s)`, 'error') : chip('No prazo', 'success');
      },
    },
  ];

  const COLUNAS_LOTE = [
    { key: 'pit', label: 'Lote (PIT)', sortable: true },
    { key: 'nome', label: 'Nome', className: 'data-table__cell--truncate' },
    { key: 'projeto', label: 'Projeto', className: 'data-table__cell--truncate' },
    { key: 'versoes', label: 'Versões', sortable: true, render: (r) => formatNumber(r.versoes) },
    {
      key: 'data_fim',
      label: 'Prazo',
      sortable: true,
      render: (r) => (r.data_fim ? formatDate(r.data_fim) : chip('Sem prazo', 'warning')),
    },
    {
      key: 'dias_atraso',
      label: 'Atraso',
      sortable: true,
      render: (r) => {
        if (r.dias_atraso === null || r.dias_atraso === undefined) return '-';
        const dias = Number(r.dias_atraso);
        return dias > 0 ? chip(`${formatNumber(dias)} dia(s)`, 'error') : chip('No prazo', 'success');
      },
    },
  ];

  const COLUNAS_EXTRA = [
    { key: 'descricao', label: 'Demanda', className: 'data-table__cell--truncate' },
    { key: 'tipo_produto', label: 'Tipo' },
    { key: 'quantidade', label: 'Quantidade', sortable: true, render: (r) => formatNumber(r.quantidade) },
    {
      key: 'versoes_prontas',
      label: 'Produzido',
      sortable: true,
      render: (r) => `${formatNumber(r.versoes_prontas)} de ${formatNumber(r.quantidade)}`,
    },
    {
      key: 'documento_autorizacao',
      label: 'Autorização',
      className: 'data-table__cell--truncate',
      render: (r) => r.documento_autorizacao || '-',
    },
  ];

  const COLUNAS_DIAGNOSTICO = [
    { key: 'item', label: 'Item', sortable: true },
    { key: 'descricao', label: 'Produto ou serviço', className: 'data-table__cell--truncate' },
    { key: 'origem', label: 'Origem' },
    {
      key: 'quantidade_prevista',
      label: 'Promete',
      render: (r) => formatNumber(r.quantidade_prevista),
    },
    { key: 'cadastradas', label: 'Cadastradas', render: (r) => formatNumber(r.cadastradas) },
    {
      key: 'sem_data',
      label: 'Sem data prevista',
      sortable: true,
      render: (r) => (Number(r.sem_data) > 0
        ? chip(formatNumber(r.sem_data), 'error')
        : formatNumber(r.sem_data)),
    },
    {
      key: 'faltam',
      label: 'Falta cadastrar',
      sortable: true,
      render: (r) => (Number(r.faltam) > 0
        ? chip(formatNumber(r.faltam), 'warning')
        : formatNumber(r.faltam)),
    },
  ];

  /** Cartão com título e uma tabela dentro, que é o bloco desta aba. */
  function bloco(titulo, subtitulo, tabela) {
    return el('div', { className: 'chart-card' }, [
      el('div', { className: 'chart-card__title', textContent: titulo }),
      subtitulo
        ? el('div', { className: 'chart-card__subtitle', textContent: subtitulo })
        : null,
      tabela.element,
    ].filter(Boolean));
  }

  async function load() {
    corpo.replaceChildren(el('div', {
      className: 'skeleton', style: { height: '220px' }, 'aria-hidden': 'true',
    }));

    // A grade e o diagnostico so entram para quem passa no verifyGerente. Pedir
    // sem o perfil traria 403 e derrubaria a aba inteira por causa de um bloco.
    const pedidos = [getPlanoDoAno(ano)];
    if (podeVerPit) pedidos.push(getGradePit(ano), getDiagnosticoPit(ano));

    const [plano, grade, diagnostico] = await Promise.allSettled(pedidos);
    if (disposed) return;

    if (plano.status === 'rejected') {
      // O plano do acervo e o CORPO da aba. Sem ele nao ha o que mostrar, e uma
      // tabela vazia diria "nada a produzir", que e a leitura oposta.
      corpo.replaceChildren(estadoErro(plano.reason, load));
      return;
    }

    const dados = plano.value || {};
    const blocos = [];

    if (podeVerPit && grade && grade.status === 'fulfilled') {
      const linhas = (Array.isArray(grade.value) ? grade.value : [])
        .filter(m => !m.cancelada);
      blocos.push(bloco(
        `Metas do PIT ${ano}`,
        'O que o plano promete, o que ele planejou até aqui e o que saiu.',
        createDataTable({
          columns: COLUNAS_META, rows: linhas, paginated: false, searchable: true,
          emptyMessage: `Nenhuma meta cadastrada para ${ano}.`,
          defaultSort: { key: 'item', dir: 'asc' },
        })
      ));
    } else if (podeVerPit && grade && grade.status === 'rejected') {
      // Estado de erro DO BLOCO, e nao da aba: o plano do acervo veio certo e
      // continua na tela.
      blocos.push(estadoErro(grade.reason, load));
    }

    if (podeVerPit && diagnostico && diagnostico.status === 'fulfilled') {
      // SO o que tem problema. A lista inteira treina quem olha a ignora-la, e
      // ai ela para de servir no dia em que estiver certa.
      const problemas = (Array.isArray(diagnostico.value) ? diagnostico.value : [])
        .filter(d => Number(d.sem_data) > 0 || Number(d.faltam) > 0);
      if (problemas.length) {
        blocos.push(bloco(
          'Cadastro incompleto do PIT',
          'Meta automática cujo número sai do cadastro. Sem a data, a folha não entra no planejado e a grade mostra zero.',
          createDataTable({
            columns: COLUNAS_DIAGNOSTICO, rows: problemas, paginated: false,
            emptyMessage: 'Cadastro completo.',
          })
        ));
      }
    }

    blocos.push(bloco(
      'A produzir',
      'Folha prometida que ainda não virou edição regular.',
      createDataTable({
        columns: COLUNAS_PRODUZIR, rows: dados.a_produzir || [], paginated: true,
        pageSize: 10, searchable: true,
        emptyMessage: 'Nenhuma folha planejada em aberto.',
      })
    ));

    blocos.push(bloco(
      'Lotes em andamento',
      'Corrida de produção que ainda não fechou.',
      createDataTable({
        columns: COLUNAS_LOTE, rows: dados.lotes_em_execucao || [], paginated: false,
        emptyMessage: 'Nenhum lote em andamento.',
      })
    ));

    blocos.push(bloco(
      `Extra-PIT ${ano}`,
      'A exceção autorizada, e quanto dela já virou folha.',
      createDataTable({
        columns: COLUNAS_EXTRA, rows: dados.extra_pit || [], paginated: true,
        pageSize: 10, searchable: true,
        emptyMessage: `Nenhuma demanda Extra-PIT em ${ano}.`,
      })
    ));

    if (!podeVerPit) {
      blocos.push(el('div', { className: 'alert-panel__item alert-panel__item--info' }, [
        svgIcon(ICONS.warning, 18),
        el('span', {
          className: 'alert-panel__item-text',
          textContent: 'As metas do PIT aparecem para o perfil de gerente.',
        }),
      ]));
    }

    corpo.replaceChildren(...blocos);
  }

  await load();

  return {
    cleanup: () => { disposed = true; },
    refresh: load,
  };
}
