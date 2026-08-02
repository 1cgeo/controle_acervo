import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField, createTextareaField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  getEfetivoMes,
  getEfetivoFaltantes,
  copiarEfetivoMesAnterior,
  createEfetivo,
  updateEfetivo,
  deleteEfetivo,
} from '@services/plataforma-service.js';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/**
 * Aproveitamento do efetivo (#/aproveitamento): a subseção 6.1 do RPCMTec.
 *
 * É um RETRATO MENSAL CONGELADO, e a tela precisa dizer isso: o posto que
 * aparece aqui é o DA ÉPOCA, e editar a linha de março não promove ninguém,
 * corrige o retrato de março. Sem a frase, a tabela se leria como o cadastro de
 * usuários com uma coluna a mais, e alguém a "corrigiria" para o posto de hoje.
 *
 * AS DUAS PARTIDAS RÁPIDAS são o que torna o preenchimento suportável: são
 * dezenas de linhas por mês, quase todas iguais às do anterior. Nenhuma das duas
 * sobrescreve quem já tem linha, e a resposta diz quantas entraram, senão não
 * haveria como distinguir "copiou 31" de "não copiou porque já estava lá".
 *
 * A TELA É DO ADMINISTRADOR GLOBAL, como o resto do RPCMTec: a rota é
 * `verifyAdmin` no servidor, e o item de menu leva a marca.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderAproveitamento(container, _ctx) {
  let disposed = false;

  const hoje = new Date();
  let anoSelecionado = hoje.getFullYear();
  let mesSelecionado = hoje.getMonth() + 1;

  const anoFilter = createSelectField({
    label: 'Ano',
    options: anosOferecidos().map(a => ({ value: a, label: String(a) })),
    placeholder: 'Ano',
    value: anoSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      anoSelecionado = Number(valor);
      load();
    },
  });

  const mesFilter = createSelectField({
    label: 'Mês',
    options: MESES.map((nome, i) => ({ value: i + 1, label: nome })),
    placeholder: 'Mês',
    value: mesSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      mesSelecionado = Number(valor);
      load();
    },
  });

  const copiarBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => partidaRapida(copiarEfetivoMesAnterior, 'Copiar o mês anterior'),
  }, [svgIcon(ICONS.contentCopy, 16), 'Copiar mês anterior']);

  const addBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirAcrescentar(),
  }, [svgIcon(ICONS.add, 16), 'Acrescentar militar']);

  /** Campo de atividades de UMA linha. Salva ao sair do campo. */
  function campoAtividades(row) {
    const input = el('input', {
      className: 'form-field__input',
      type: 'text',
      style: { width: '100%' },
      'aria-label': `Atividades de ${row.posto_abrev} ${row.nome_guerra}`,
      value: row.atividades || '',
    });

    input.addEventListener('change', async () => {
      const valor = input.value.trim();
      if (valor === (row.atividades || '')) return;
      try {
        await updateEfetivo(row.id, {
          tipo_posto_grad_id: row.tipo_posto_grad_id,
          atividades: valor || null,
        });
        if (disposed) return;
        row.atividades = valor;
        showSuccess('Atividades atualizadas');
      } catch (err) {
        if (disposed) return;
        input.value = row.atividades || '';
        showError(err.message || 'Erro ao salvar as atividades');
      }
    });

    return input;
  }

  const table = createDataTable({
    columns: [
      {
        key: 'militar',
        label: 'Militar',
        sortable: true,
        // O posto sai da LINHA, e não do cadastro: é o congelamento que esta
        // tabela existe para guardar.
        sortValue: (row) => -Number(row.tipo_posto_grad_id || 0),
        render: (row) => `${row.posto_abrev} ${row.nome_guerra}`.trim(),
      },
      { key: 'atividades', label: 'Atividades e encargos', render: campoAtividades },
      {
        key: 'ativo',
        label: 'No cadastro',
        // Quem saiu da Divisão depois do retrato continua no mês em que esteve,
        // e a coluna avisa que a linha é histórica.
        render: (row) => (row.ativo ? 'Ativo' : 'Desativado'),
      },
    ],
    rows: [],
    searchable: true,
    paginated: false,
    loading: true,
    emptyMessage: 'Nenhum militar lançado neste mês. Use uma das partidas rápidas acima.',
    actions: [
      {
        icon: ICONS.delete,
        title: 'Remover do mês',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Aproveitamento do efetivo' }),
      el('div', { className: 'page__actions' }, [copiarBtn, addBtn]),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [anoFilter.element, mesFilter.element]),
    table.element,
  ]);
  container.appendChild(page);

  // Do ano corrente para trás. Não vem do banco de propósito: o mês novo nasce
  // vazio, e uma lista tirada do que já existe nunca ofereceria o próximo.
  function anosOferecidos() {
    const corrente = new Date().getFullYear();
    return [corrente + 1, corrente, corrente - 1, corrente - 2];
  }

  async function partidaRapida(fn, rotulo) {
    try {
      const resposta = await fn({ ano: anoSelecionado, mes: mesSelecionado });
      if (disposed) return;
      const n = resposta?.inseridos ?? 0;
      if (n === 0) {
        showSuccess('Nada a acrescentar: todo o efetivo já está lançado neste mês');
      } else {
        showSuccess(`${rotulo}: ${n} militar(es) acrescentado(s)`);
      }
      await load();
    } catch (err) {
      if (disposed) return;
      showError(err.message || `Erro ao ${rotulo.toLowerCase()}`);
    }
  }

  async function abrirAcrescentar() {
    let faltantes = [];
    try {
      faltantes = await getEfetivoFaltantes(anoSelecionado, mesSelecionado);
    } catch (err) {
      showError(err.message || 'Erro ao carregar os militares fora do mês');
      return;
    }
    if (disposed) return;

    if (!faltantes || faltantes.length === 0) {
      showSuccess('Todo o efetivo ativo já está lançado neste mês');
      return;
    }

    // Só quem AINDA não está no mês: oferecer os demais só produziria o 409 da
    // chave única.
    const pessoaField = createSelectField({
      label: 'Militar',
      required: true,
      options: faltantes.map(f => ({
        value: f.usuario_uuid,
        label: `${f.posto_abrev} ${f.nome_guerra}`.trim(),
      })),
    });
    const atividadesField = createTextareaField({ label: 'Atividades e encargos' });

    let saving = false;

    openModal({
      title: `Acrescentar militar (${String(mesSelecionado).padStart(2, '0')}/${anoSelecionado})`,
      content: el('div', { className: 'form-grid' }, [
        el('div', { className: 'form-grid__full' }, [pessoaField.element]),
        el('div', { className: 'form-grid__full' }, [atividadesField.element]),
      ]),
      width: '520px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Acrescentar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;
            pessoaField.setError(null);
            const uuid = pessoaField.getValue();
            if (!uuid) return pessoaField.setError('Escolha o militar');

            saving = true;
            try {
              await createEfetivo({
                ano: anoSelecionado,
                mes: mesSelecionado,
                usuario_uuid: uuid,
                atividades: atividadesField.getValue() || null,
              });
              showSuccess('Militar acrescentado ao mês');
              close();
              await load();
            } catch (err) {
              showError(err.message || 'Erro ao acrescentar o militar');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Remover do mês',
      message: `Remover ${row.posto_abrev} ${row.nome_guerra} do retrato de `
        + `${String(mesSelecionado).padStart(2, '0')}/${anoSelecionado}? `
        + 'Isso não mexe no cadastro da pessoa, só neste mês.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEfetivo(row.id);
      showSuccess('Militar removido do mês');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao remover o militar');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getEfetivoMes(anoSelecionado, mesSelecionado);
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar o efetivo do mês');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
