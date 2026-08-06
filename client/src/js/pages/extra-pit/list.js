import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import {
  getExtraPit,
  getAnosExtraPit,
  deleteExtraPit,
} from '@services/plataforma-service.js';
import { temPerfil } from '@store/auth-store.js';
import { openExtraPitDialog } from './extra-dialog.js';
import { openVersoesDialog } from './versoes-dialog.js';

/**
 * Extra-PIT (#/extra_pit): a subseção 3.3 do RPCMTec.
 *
 * O QUE ENTRA AQUI é a exceção AUTORIZADA ao plano anual, e não todo trabalho
 * fora do PIT. A diferença tem consequência: o SCA já tentou derivar esta tabela
 * de `mapoteca.pedido.previsto_pit` e deu 23 linhas onde a edição real de
 * julho/2026 traz 1, porque aquele campo é falso por omissão. Por isso o
 * documento de autorização é obrigatório no cadastro, e a tela diz o porquê.
 *
 * A LISTA É DO ANO, e não do mês, ao contrário das vizinhas 3.1, 3.2 e 3.4: a
 * autorização atravessa o ano e muda de situação.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderExtraPitList(container, _ctx) {
  let disposed = false;
  // CADASTRAR a demanda Extra-PIT é do OPERADOR DE PRODUÇÃO desde a 1.33.0, e
  // era do administrador global. O servidor cobra o mesmo em POST, PUT e DELETE
  // /metas/extra. LIGAR uma VERSÃO do acervo à demanda continua do
  // administrador, e por isso `versoes-dialog.js` segue com `isAdmin`: aquilo
  // grava em `acervo.versao`, e quem manda no acervo é o módulo acervo.
  const podeEscrever = temPerfil('operador', 'producao');
  let anoSelecionado = new Date().getFullYear();

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openExtraPitDialog({ ano: anoSelecionado, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova demanda']);

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

  const table = createDataTable({
    columns: [
      { key: 'demandante', label: 'Demandante', sortable: true },
      { key: 'tipo_produto', label: 'Tipo de produto', sortable: true },
      { key: 'quantidade', label: 'Qtd', sortable: true },
      // O QUE JÁ MATERIALIZOU, ao lado do que a demanda promete. O Extra-PIT é
      // produção: a demanda só fecha quando existe versão no acervo apontando
      // para ela, e o servidor recusa fechar uma de origem Produção sem nenhuma.
      // O número é calculado na leitura (`quantidade_materializada`), nunca
      // gravado.
      //
      // A régua do servidor é "pelo menos uma", e NÃO materializada >=
      // quantidade: a quantidade da 3.3 muda de unidade por linha. Por isso a
      // coluna mostra o par e quem lê decide, em vez de pintar um veredito.
      {
        key: 'quantidade_materializada',
        label: 'No acervo',
        sortable: true,
        render: (row) => String(row.quantidade_materializada ?? 0),
      },
      { key: 'situacao', label: 'Situação', sortable: true },
      { key: 'documento_autorizacao', label: 'Documento autorização' },
      {
        key: 'data_entrega',
        label: 'Entrega',
        sortable: true,
        render: (row) => (row.data_entrega
          ? String(row.data_entrega).slice(0, 10).split('-').reverse().join('/')
          : '-'),
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma demanda Extra-PIT cadastrada',
    // O ACERVO DA DEMANDA abre para QUALQUER pessoa logada, e não só para quem
    // escreve: ler as versões é `verifyLogin` no servidor, e a pergunta "quais
    // folhas cumpriram esta demanda" é de quem monta o relatório. O diálogo é
    // que esconde os botões de ligar e desligar de quem não é administrador.
    actions: [
      {
        icon: ICONS.layers,
        title: 'Versões do acervo',
        onClick: (row) => openVersoesDialog({ demanda: row, onChanged: load }),
      },
      ...(podeEscrever ? [
        {
          icon: ICONS.edit,
          title: 'Editar',
          onClick: (row) => openExtraPitDialog({ demanda: row, onSaved: load }),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir',
          variant: 'danger',
          onClick: (row) => handleDelete(row),
        },
      ] : []),
    ],
  });

  // A tabela vive num nó próprio para o estado de ERRO poder tomar o lugar dela
  // e devolvê-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Extra-PIT' }),
      el('div', { className: 'page__actions' }, podeEscrever ? [newBtn] : []),
    ]),
    el('div', { className: 'page__filters' }, [anoFilter.element]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhuma demanda Extra-PIT
   * cadastrada": a falha da API lia-se como ano sem exceção autorizada, e as
   * duas pedem ações opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * nó: uma segunda falha guardaria o próprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, load);
  }

  async function loadAnos() {
    let anos = [];
    try {
      anos = await getAnosExtraPit();
    } catch (err) {
      anos = [];
    }
    if (disposed) return;
    const corrente = new Date().getFullYear();
    const todos = [...new Set([corrente, ...(anos || []).map(Number)])].sort((a, b) => b - a);
    anoFilter.setOptions(todos.map(a => ({ value: a, label: String(a) })));
    anoFilter.setValue(anoSelecionado);
  }

  async function load() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

    table.update({ loading: true });
    try {
      const dados = await getExtraPit(anoSelecionado);
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar as demandas Extra-PIT');
    }
  }

  async function handleDelete(row) {
    // A demanda CANCELADA tem situação própria: o DELETE fica para o cadastro
    // errado, e a mensagem diz isso para ninguém apagar o histórico de uma
    // demanda que existiu.
    const ok = await confirmDialog({
      title: 'Excluir demanda Extra-PIT',
      message: `Excluir a demanda de ${row.quantidade} ${row.tipo_produto} para ${row.demandante}? `
        + 'Se ela foi cancelada, prefira mudar a situação para "Cancelado": a exclusão '
        + 'apaga a demanda do relatório de todos os meses.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteExtraPit(row.id);
      showSuccess('Demanda excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir a demanda');
    }
  }

  await loadAnos();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
