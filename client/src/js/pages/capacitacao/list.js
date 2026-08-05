import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip } from '@components/status-chip.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getCapacitacoes,
  getAnosCapacitacao,
  deleteCapacitacao,
  getUsuarios,
} from '@services/plataforma-service.js';
import { openCapacitacaoDialog, MINISTRADA, RECEBIDA } from './capacitacao-dialog.js';

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : null);

/** Como a pessoa é chamada aqui: posto e nome de guerra. */
const etiqueta = (militar) => [militar.posto_abrev, militar.nome_guerra || militar.nome]
  .filter(Boolean)
  .join(' ');

/**
 * A linha do servidor mais o texto dos militares.
 *
 * O data-table busca e ordena por `row[key]`. A coluna `militares` é uma LISTA
 * DE OBJETOS, e `String(lista)` vira "[object Object]": buscar pelo nome de um
 * militar não achava nada. O texto entra como campo próprio da linha.
 */
function paraLinha(capacitacao) {
  const militares = capacitacao.militares || [];
  return { ...capacitacao, militares_texto: militares.map(etiqueta).join(', ') };
}

// Uma frase só para os dois estados vazios que a tela tem (ano sem registro,
// militar sem registro). Ela diz que o recorte não achou nada, e não que o
// cadastro está vazio.
const VAZIO = 'Nenhum registro para estes filtros';

/**
 * Capacitação, em DUAS telas.
 *
 * MINISTRADA fica em Produção: é serviço que a Divisão presta, e alimenta a
 * subseção 2.6. RECEBIDA fica em Efetivo: é gente nossa em curso, e alimenta a
 * 6.2. As duas partiam de uma tela só, com um filtro de tipo, e isso obrigava
 * quem cadastra a escolher de que lado está antes de saber o que ia digitar.
 *
 * A TABELA continua UMA no banco. O que muda entre os dois tipos são três
 * colunas, e uma tabela por tipo divergiria na primeira coluna nova.
 *
 * @param {number} tipoId - MINISTRADA ou RECEBIDA
 * @param {{titulo:string, rotuloNovo:string, coluna:Object}} textos
 * @returns {Function} o renderizador da página
 */
function criarTela(tipoId, textos) {
  return async function render(container, ctx) {
    let disposed = false;

    // A ROTA MANDA. Outra tela aponta para uma PESSOA
    // (#/capacitacao_recebida?usuario_uuid=...), e a tela chega filtrada nela.
    const query = ctx && ctx.query ? ctx.query : new URLSearchParams();
    const militarDaRota = query.get('usuario_uuid');

    // O link aponta a pessoa, e não o ano: preso ao ano corrente ele esconderia
    // a capacitação dela dos anos anteriores, que é metade da resposta.
    let anoSelecionado = militarDaRota ? null : new Date().getFullYear();
    let militarSelecionado = militarDaRota || null;

    // O que o servidor devolveu na última carga BEM-SUCEDIDA, e o erro da
    // última que falhou. Os dois estados são distintos: lista vazia é uma
    // afirmação sobre o banco, erro é a ausência de resposta.
    let linhas = [];
    let erro = null;

    // O cadastro alimenta o seletor de militares do formulário. Carregado UMA
    // vez: ele não muda entre uma capacitação e outra.
    let usuarios = [];

    // uuid -> "Cap Fulano", do cadastro E das linhas. A união cobre os dois
    // buracos: quem está no cadastro sem capacitação no ano, e quem participou
    // de uma e já saiu da Divisão.
    const nomePorUuid = new Map();

    const newBtn = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => openCapacitacaoDialog({
        ano: anoSelecionado, tipoId, usuarios, onSaved: load,
      }),
    }, [svgIcon(ICONS.add, 16), textos.rotuloNovo]);

    const anoFilter = createSelectField({
      label: 'Ano',
      options: [],
      placeholder: 'Todos os anos',
      value: anoSelecionado,
      onChange: (valor) => {
        anoSelecionado = valor === null ? null : Number(valor);
        load();
      },
    });

    // O FILTRO POR PESSOA, que é a pergunta desta tela ("de que capacitações o
    // Fulano participou"). Ele filtra as linhas JÁ CARREGADAS, e não o servidor:
    // a rota devolve o ano inteiro, e uma ida a mais ao banco para recortar 40
    // linhas em memória não se paga.
    const militarFilter = createSelectField({
      label: textos.rotuloMilitar,
      options: [],
      placeholder: textos.todosMilitares,
      onChange: (valor) => {
        militarSelecionado = valor === null ? null : String(valor);
        mostrar();
      },
    });

    const table = createDataTable({
      columns: [
        { key: 'nome', label: 'Capacitação', sortable: true },
        // O ANO separa duas edições do mesmo curso. O período não serve para
        // isso: ele é anulável, e duas edições sem data ficariam iguais.
        { key: 'ano', label: 'Ano', sortable: true },
        {
          key: 'situacao',
          label: 'Situação',
          sortable: true,
          // Ordena pelo CÓDIGO do domínio, que é o ciclo de vida: 1 Prevista,
          // 2 Em execução, 3 Concluída, 4 Cancelada (dominio.situacao_capacitacao).
          // Pelo texto, a lista começa em "Cancelada".
          sortValue: (row) => (row.situacao_id == null ? null : Number(row.situacao_id)),
        },
        {
          key: 'data_inicio',
          label: 'Período',
          sortable: true,
          render: (row) => {
            const a = dia(row.data_inicio);
            const b = dia(row.data_fim);
            if (!a) return '-';
            return !b || b === a ? a : `${a} a ${b}`;
          },
        },
        {
          key: 'instituicoes',
          label: 'Instituições',
          sortable: true,
          render: (row) => row.instituicoes || '-',
        },
        {
          key: 'local_realizacao',
          label: 'Local',
          sortable: true,
          render: (row) => row.local_realizacao || '-',
        },
        textos.coluna,
        // A coluna da META so existe onde ela significa alguma coisa (ver a
        // configuracao da ministrada, no fim do arquivo).
        ...(textos.colunaMeta ? [textos.colunaMeta] : []),
        // Os militares vêm do CADASTRO, e a célula mostra o
        // texto que `paraLinha` montou: quem monta a frase do relatório é o
        // gerador, e a busca da tabela só enxerga texto.
        {
          key: 'militares_texto',
          label: textos.colunaMilitares,
          render: (row) => row.militares_texto || '-',
        },
      ],
      rows: [],
      searchable: true,
      pageSize: 25,
      loading: true,
      emptyMessage: VAZIO,
      actions: [
        {
          icon: ICONS.edit,
          title: 'Editar',
          onClick: (row) => openCapacitacaoDialog({
            capacitacao: row, tipoId, usuarios, onSaved: load,
          }),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir',
          variant: 'danger',
          onClick: (row) => handleDelete(row),
        },
      ],
    });

    // A tabela OU o painel de erro, no mesmo lugar. Ver `mostrar()`.
    const areaTabela = el('div', {}, [table.element]);
    let painelErro = null;

    const page = el('div', { className: 'page' }, [
      el('div', { className: 'page__header' }, [
        el('h1', { className: 'page__title', textContent: textos.titulo }),
        el('div', { className: 'page__actions' }, [newBtn]),
      ]),
      el('div', { className: 'page__filters' }, [anoFilter.element, militarFilter.element]),
      areaTabela,
    ]);
    container.appendChild(page);

    async function loadUsuarios() {
      try {
        const lista = await getUsuarios();
        if (disposed) return;
        // `GET /usuarios` chama a abreviatura do posto de `tipo_posto_grad`, e o
        // seletor a chama de `posto_abrev`. A tradução mora aqui, num lugar só.
        usuarios = (lista || [])
          .filter(u => u.ativo)
          .map(u => ({
            uuid: u.uuid,
            nome: u.nome,
            nome_guerra: u.nome_guerra,
            posto_abrev: u.tipo_posto_grad,
            tipo_posto_grad_id: u.tipo_posto_grad_id,
            ativo: true,
          }))
          .sort((a, b) => (b.tipo_posto_grad_id - a.tipo_posto_grad_id)
            || a.nome_guerra.localeCompare(b.nome_guerra));
      } catch (err) {
        // Sem o cadastro a tela continua listando; só o seletor do formulário
        // nasce vazio. Não vale interromper a leitura por isto.
        usuarios = [];
      }
    }

    async function loadAnos() {
      let anos = [];
      try {
        anos = await getAnosCapacitacao();
      } catch (err) {
        anos = [];
      }
      if (disposed) return;
      const corrente = new Date().getFullYear();
      const todos = [...new Set([corrente, ...(anos || []).map(Number)])].sort((a, b) => b - a);
      anoFilter.setOptions(todos.map(a => ({ value: a, label: String(a) })));
      anoFilter.setValue(anoSelecionado);
    }

    /** Guarda o nome de quem apareceu, para o filtro poder oferecê-lo. */
    function lembrarMilitares() {
      for (const u of usuarios) nomePorUuid.set(u.uuid, etiqueta(u));
      for (const linha of linhas) {
        for (const m of linha.militares || []) nomePorUuid.set(m.usuario_uuid, etiqueta(m));
      }
      // O militar que veio no link e que ninguém conhece continua NO COMBO. Sem
      // a opção, o seletor voltaria para "todos" e a tela mostraria a lista
      // inteira a quem pediu uma pessoa.
      if (militarSelecionado && !nomePorUuid.has(militarSelecionado)) {
        nomePorUuid.set(militarSelecionado, `Militar ${String(militarSelecionado).slice(0, 8)}`);
      }
    }

    function atualizarFiltroMilitar() {
      lembrarMilitares();
      const opcoes = [...nomePorUuid.entries()]
        .map(([uuid, nome]) => ({ value: uuid, label: nome }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
      militarFilter.setOptions(opcoes);
      militarFilter.setValue(militarSelecionado);
    }

    function linhasVisiveis() {
      if (!militarSelecionado) return linhas;
      return linhas.filter(linha => (linha.militares || [])
        .some(m => m.usuario_uuid === militarSelecionado));
    }

    /**
     * O painel que SUBSTITUI a tabela quando a carga falha.
     *
     * A tabela com zero linhas diz "nenhum registro", que é uma afirmação sobre
     * o banco. O que aconteceu foi outra coisa: a pergunta não foi respondida.
     */
    function painelDeErro() {
      return el('div', { className: 'data-table__empty' }, [
        el('p', { textContent: erro }),
        el('p', {
          textContent: 'A lista não foi carregada. Isto não quer dizer que ela está vazia.',
        }),
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          textContent: 'Tentar de novo',
          onClick: () => load(),
        }),
      ]);
    }

    /** Põe na tela o estado atual: o erro, ou as linhas que o filtro deixou. */
    function mostrar() {
      atualizarFiltroMilitar();

      if (erro) {
        const novo = painelDeErro();
        clearChildren(areaTabela);
        areaTabela.appendChild(novo);
        painelErro = novo;
        return;
      }

      if (painelErro) {
        clearChildren(areaTabela);
        areaTabela.appendChild(table.element);
        painelErro = null;
      }
      table.update({ rows: linhasVisiveis(), loading: false });
    }

    async function load() {
      table.update({ loading: true });
      try {
        const dados = await getCapacitacoes(anoSelecionado, tipoId);
        if (disposed) return;
        erro = null;
        linhas = (dados || []).map(paraLinha);
        mostrar();
      } catch (err) {
        if (disposed) return;
        erro = err.message || 'Erro ao carregar as capacitações';
        linhas = [];
        mostrar();
        showError(erro);
      }
    }

    async function handleDelete(row) {
      const ok = await confirmDialog({
        title: 'Excluir capacitação',
        message: `Excluir "${row.nome}"? Se ela foi cancelada, prefira mudar a `
          + 'situação para "Cancelada".',
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteCapacitacao(row.id);
        showSuccess('Capacitação excluída com sucesso');
        await load();
      } catch (err) {
        showError(err.message || 'Erro ao excluir a capacitação');
      }
    }

    await loadUsuarios();
    await loadAnos();
    await load();

    return () => {
      disposed = true;
      table._cleanup();
    };
  };
}

/** Capacitação MINISTRADA (#/capacitacao_ministrada), em Produção. Subseção 2.6. */
export const renderCapacitacaoMinistrada = criarTela(MINISTRADA, {
  titulo: 'Capacitação ministrada',
  rotuloNovo: 'Nova capacitação',
  // Quantas pessoas DE FORA nós treinamos. Quem MINISTROU é gente nossa, e sai
  // na coluna ao lado.
  coluna: {
    key: 'efetivo_capacitado',
    label: 'Efetivo capacitado',
    sortable: true,
    render: (row) => (row.efetivo_capacitado == null ? '-' : String(row.efetivo_capacitado)),
  },
  // ESTA CAPACITAÇÃO CONTA NO PIT?
  //
  // A coluna existe porque a resposta muda o que a capacitação é. Com meta
  // ligada e a meta declarando origem Capacitação, e daqui que sai o numero da
  // grade do PIT: Prevista e Em execução alimentam o planejado, Concluída
  // alimenta o realizado, e o mês vem de `data_fim` (er/rpcmtec.sql, na coluna
  // `meta_pit_id`). Sem meta, ela e trabalho real que o plano nao promete.
  //
  // So na MINISTRADA. A recebida quase nunca tem meta, e em 2026 nenhuma tem: o
  // PIT so promete capacitação ministrada, e por isso a coluna ali seria uma
  // fila de traços.
  colunaMeta: {
    key: 'meta_pit_item',
    label: 'Meta do PIT',
    sortable: true,
    // Ordena por quem TEM meta primeiro, e depois pelo codigo dela. Pelo texto
    // cru, as sem meta se misturariam no meio.
    sortValue: (row) => (row.meta_pit_id == null ? null : String(row.meta_pit_item || '')),
    render: (row) => (row.meta_pit_id == null
      // "Fora do PIT" e nao um traço: traço se le como "campo nao preenchido", e
      // aqui a ausência e um FATO sobre a capacitação, nao um dado que falta.
      ? chip('Fora do PIT', 'default')
      : chip(`Meta ${row.meta_pit_item || row.meta_pit_id}`, 'success')),
  },
  colunaMilitares: 'Instrutores',
  // Aqui a pessoa da Divisão é quem ENSINOU. O filtro tem o mesmo nome da
  // coluna: dois nomes para a mesma coisa fazem procurar duas.
  rotuloMilitar: 'Instrutor',
  todosMilitares: 'Todos os instrutores',
});

/** Capacitação RECEBIDA (#/capacitacao_recebida), em Efetivo. Subseção 6.2. */
export const renderCapacitacaoRecebida = criarTela(RECEBIDA, {
  titulo: 'Capacitação recebida',
  rotuloNovo: 'Nova capacitação',
  // Sob que Plano/Código. Quem foi sai na coluna ao lado.
  coluna: {
    key: 'plano_codigo',
    label: 'Plano / Código',
    sortable: true,
    render: (row) => row.plano_codigo || '-',
  },
  colunaMilitares: 'Militares',
  rotuloMilitar: 'Militar',
  todosMilitares: 'Todos os militares',
});
