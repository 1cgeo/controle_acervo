import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import {
  getMetasPit,
  getAnosMetaPit,
  deleteMetaPit,
  codigoMetaPit,
  listarExercicios,
} from '@services/plataforma-service.js';
import { isAdmin } from '@store/auth-store.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { openMetaDialog } from './meta-dialog.js';
import { openTranscricaoDialog } from './transcricao-dialog.js';

/**
 * Metas do PIT (#/metas). Tela de PLATAFORMA, como a de usuarios.
 *
 * NAO e tela do orcamento: o PIT nao e artefato orcamentario, e sim o plano
 * anual da Divisao. O orcamento amarra a NC e o item do PDR a meta que financiam,
 * e a mapoteca amarra o pedido de impressao a meta que ele cumpre; dentro de um
 * modulo, quem so tem perfil no outro nao conseguiria nem VER a lista.
 *
 * LER e de qualquer pessoa logada. ESCREVER e do administrador global: o PIT
 * muda uma vez por ano, vem de documento assinado, e errar nele contamina os
 * tres modulos. O backend cobra a regra; aqui so escondemos o que nao adianta
 * oferecer.
 *
 * O ANO tem filtro PROPRIO no topo, o mesmo componente que as telas do
 * orcamento usam (@components/filtro-ano.js). Ele nasce no ano ATUAL e nao
 * guarda nada. Os anos vem de GET /metas/anos, mais o ano corrente, para
 * cadastrar o exercicio novo.
 *
 * O ano e DESTA tela, e nunca importado de um modulo: metas e tela de
 * PLATAFORMA, e o ano dela nao depende de em que ano alguem lancou uma nota de
 * credito.
 *
 * `permitirOutroAno` fica FALSO: aqui o ano so filtra o que ja existe, e um ano
 * vazio seria oferecer uma tela em branco. A meta de um ano novo se cria pelo
 * dialogo, que recebe o ano por parametro.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderMetasList(container, _ctx) {
  let disposed = false;
  const podeEscrever = isAdmin();
  // Os exercícios cadastrados. `pit.meta.ano` referencia `pit.exercicio(ano)`
  // (er/pit.sql:71), então ano sem exercício não aceita meta nenhuma.
  let exercicios = [];
  // Falso enquanto a lista de exercícios não foi lida. Sem esta distinção, a
  // falha da consulta e "nenhum exercício aberto" ficariam iguais, e a tela
  // travaria "Nova meta" num ano que tem exercício.
  let exerciciosLidos = false;

  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMetaPit,
    permitirOutroAno: false,
    onChange: () => {
      desenharExercicio();
      load();
    },
  });

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openMetaDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova meta']);

  // O AVISO DE EXERCÍCIO, e é o que tira o ano novo do beco sem saída.
  //
  // O seletor de ano SEMPRE oferece o ano corrente (filtro-ano.js), mesmo sem
  // meta nenhuma nele. Em janeiro, antes de o exercício ser aberto, "Nova meta"
  // levava ao 400 do servidor ("O exercício de AAAA não existe. Crie o ano antes
  // de cadastrar meta."), e nada nesta tela dizia onde se cria o ano. Quem abre
  // o exercício é a tela de revisões do PIT.
  const avisoExercicio = el('p', { className: 'page__subtitle hidden' });

  const table = createDataTable({
    columns: [
      { key: 'ano', label: 'Ano', sortable: true },
      {
        // `codigo` NÃO vem do servidor: quem o monta é `prepararLinha`. A busca
        // e a ordenação do data-table leem `row[col.key]`, então uma coluna que
        // só existia no `render` não ordenava (todo valor era `undefined`) nem
        // aparecia na busca: procurar "4.1" não achava a meta 4.1.
        key: 'codigo',
        label: 'Meta',
        sortable: true,
        render: (row) => row.codigo || '-',
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
      // O que o PIT promete, e o que faz a subseção 2.1 do RPCMTec ser
      // gerável. Vazio na linha de cabeçalho da meta é o certo:
      // quem promete são os itens que ela agrupa.
      {
        key: 'quantidade_prevista',
        label: 'Previsto',
        sortable: true,
        render: (row) => (row.quantidade_prevista == null
          ? '-'
          : `${row.quantidade_prevista}${row.unidade ? ` ${row.unidade}` : ''}`),
      },
      { key: 'demandante', label: 'Demandante', render: (row) => row.demandante || '-' },
      {
        key: 'prazo',
        label: 'Prazo',
        sortable: true,
        render: (row) => (row.prazo ? String(row.prazo).slice(0, 10).split('-').reverse().join('/') : '-'),
      },
      // O que FINANCIA a promessa: as duas colunas sao o caminho de volta do
      // orcamento para o PIT, porque a NC e o item do PDR apontam a meta.
      // NUMERIC chega como texto no JSON, entao a ordenacao passa por sortValue.
      {
        key: 'credito_nc',
        label: 'Crédito (NC)',
        sortable: true,
        sortValue: (row) => toNumber(row.credito_nc),
        render: (row) => formatCurrency(row.credito_nc),
      },
      {
        key: 'pdr_autorizado',
        label: 'PDR autorizado',
        sortable: true,
        // Nulo aqui e "nao informado", e nao zero: `valor_autorizado` e
        // anulavel. O sortValue devolve nulo para a linha cair no fim da
        // ordenacao, em vez de se misturar com as metas de valor zero.
        sortValue: (row) => (row.pdr_autorizado == null ? null : toNumber(row.pdr_autorizado)),
        render: (row) => formatCurrency(row.pdr_autorizado),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 50,
    loading: true,
    emptyMessage: 'Nenhuma meta cadastrada',
    actions: podeEscrever ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openMetaDialog({ meta: row, onSaved: load }),
      },
      // CORRIGIR A TRANSCRIÇÃO, e não alterar o PIT.
      //
      // "Editar" muda o que a DSG PROMETE, e o servidor só aceita isso dentro de
      // uma revisão aberta; a mensagem de recusa dele nomeia esta correção. Sem
      // a ação aqui, quem lia a mensagem procurava na tela um recurso que não
      // existia, e acabava abrindo uma revisão que a DSG não emitiu.
      //
      // SÓ NA META QUE JÁ TEM DECLARAÇÃO. `pit.meta_vigente.revisao_id` nulo
      // significa que revisão nenhuma declarou esta meta, e o servidor recusa
      // com "não há transcrição a corrigir". Oferecer o botão ali seria oferecer
      // um 400.
      {
        icon: ICONS.description,
        title: 'Corrigir transcrição',
        visible: (row) => Boolean(row.revisao_id),
        onClick: (row) => openTranscricaoDialog({ meta: row, onSaved: load }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ] : [],
  });

  // A tabela vive num no proprio para o estado de ERRO poder tomar o lugar dela
  // e devolve-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('h1', { className: 'page__title', textContent: 'Metas do PIT' }),
        avisoExercicio,
      ]),
      el('div', { className: 'page__actions' }, podeEscrever ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [filtroAno.element]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhuma meta cadastrada": a falha
   * da API lia-se como ano sem PIT, e as duas pedem acoes opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * no: uma segunda falha guardaria o proprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, load);
  }

  /** A linha do servidor mais o `codigo`, que a busca e a ordem leem. */
  function prepararLinha(meta) {
    return { ...meta, codigo: codigoMetaPit(meta) };
  }

  /**
   * O aviso do exercício do ano escolhido.
   *
   * Sem exercício, "Nova meta" só levaria ao 400 do servidor. O botão sai do
   * caminho e a frase diz o que fazer, em vez de deixar a pessoa descobrir pelo
   * erro. É o mesmo desenho da tela de revisões do PIT.
   */
  function desenharExercicio() {
    if (!exerciciosLidos) return;

    const ano = filtroAno.getAno();
    const ex = exercicios.find((e) => Number(e.ano) === Number(ano));

    newBtn.disabled = !ex;
    newBtn.title = ex ? '' : `Abra o exercício de ${ano} antes de cadastrar meta`;

    if (ex) {
      avisoExercicio.classList.add('hidden');
      avisoExercicio.replaceChildren();
      return;
    }

    avisoExercicio.classList.remove('hidden');
    avisoExercicio.replaceChildren(
      `${ano} ainda não tem exercício, e meta nenhuma se cadastra sem ele. `,
      el('a', { href: '#/revisoes_pit', textContent: 'Abrir o exercício' }),
      '.',
    );
  }

  async function carregarExercicios() {
    try {
      const lista = await listarExercicios();
      if (disposed) return;
      exercicios = lista || [];
      exerciciosLidos = true;
    } catch {
      // Sem a lista, a tela NÃO trava o cadastro: quem decide é o servidor, e
      // supor "não existe" esconderia o botão num ano que tem exercício.
      exercicios = [];
      exerciciosLidos = false;
      return;
    }
    desenharExercicio();
  }

  async function load() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

    table.update({ loading: true });
    try {
      const dados = await getMetasPit(filtroAno.getAno());
      if (disposed) return;
      table.update({ rows: (dados || []).map(prepararLinha), loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar as metas do PIT');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir meta',
      message: `Tem certeza que deseja excluir a meta ${codigoMetaPit(row)} de ${row.ano}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMetaPit(row.id);
      showSuccess('Meta excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir meta');
    }
  }

  await carregarExercicios();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
