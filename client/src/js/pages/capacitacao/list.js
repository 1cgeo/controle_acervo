import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
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

/**
 * Capacitação, em DUAS telas (chefe, 2026-08-02).
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
 * @param {{titulo:string, rotuloNovo:string, vazio:string, coluna:Object}} textos
 * @returns {Function} o renderizador da página
 */
function criarTela(tipoId, textos) {
  return async function render(container, _ctx) {
    let disposed = false;
    let anoSelecionado = new Date().getFullYear();
    // O cadastro alimenta o seletor de militares do formulário. Carregado UMA
    // vez: ele não muda entre uma capacitação e outra.
    let usuarios = [];

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

    const table = createDataTable({
      columns: [
        { key: 'nome', label: 'Capacitação', sortable: true },
        { key: 'situacao', label: 'Situação', sortable: true },
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
        { key: 'instituicoes', label: 'Instituições', render: (row) => row.instituicoes || '-' },
        { key: 'local_realizacao', label: 'Local', render: (row) => row.local_realizacao || '-' },
        textos.coluna,
        // Os militares vêm do CADASTRO desde 2026-08-02, e a célula os junta
        // aqui: quem monta a frase do relatório é o gerador.
        {
          key: 'militares',
          label: textos.colunaMilitares,
          render: (row) => ((row.militares || []).length
            ? row.militares.map(m => `${m.posto_abrev} ${m.nome_guerra}`.trim()).join(', ')
            : '-'),
        },
      ],
      rows: [],
      searchable: true,
      pageSize: 25,
      loading: true,
      emptyMessage: textos.vazio,
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

    const page = el('div', { className: 'page' }, [
      el('div', { className: 'page__header' }, [
        el('h1', { className: 'page__title', textContent: textos.titulo }),
        el('div', { className: 'page__actions' }, [newBtn]),
      ]),
      el('div', {
        className: 'page__filters',
        style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
      }, [anoFilter.element]),
      table.element,
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

    async function load() {
      table.update({ loading: true });
      try {
        const dados = await getCapacitacoes(anoSelecionado, tipoId);
        if (disposed) return;
        table.update({ rows: dados || [], loading: false });
      } catch (err) {
        if (disposed) return;
        table.update({ rows: [], loading: false });
        showError(err.message || 'Erro ao carregar as capacitações');
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
  vazio: 'Nenhuma capacitação ministrada cadastrada',
  // Quantas pessoas DE FORA nós treinamos. Quem MINISTROU é gente nossa, e sai
  // na coluna ao lado.
  coluna: {
    key: 'efetivo_capacitado',
    label: 'Efetivo capacitado',
    sortable: true,
    render: (row) => (row.efetivo_capacitado == null ? '-' : String(row.efetivo_capacitado)),
  },
  colunaMilitares: 'Instrutores',
});

/** Capacitação RECEBIDA (#/capacitacao_recebida), em Efetivo. Subseção 6.2. */
export const renderCapacitacaoRecebida = criarTela(RECEBIDA, {
  titulo: 'Capacitação recebida',
  rotuloNovo: 'Nova capacitação',
  vazio: 'Nenhuma capacitação recebida cadastrada',
  // Sob que Plano/Código. Quem foi sai na coluna ao lado.
  coluna: {
    key: 'plano_codigo',
    label: 'Plano / Código',
    render: (row) => row.plano_codigo || '-',
  },
  colunaMilitares: 'Militares',
});
