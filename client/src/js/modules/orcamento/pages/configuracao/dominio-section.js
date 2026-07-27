import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createSelectField,
} from '@components/form-fields/form-fields.js';

/**
 * Secao generica de gestao de um dominio editavel (natureza de despesa, plano
 * interno, UG) dentro da pagina Configuracao. Cada dominio e descrito por uma
 * config declarativa; este componente monta a tabela (com editar/excluir) e o
 * dialog de criar/editar a partir dela.
 *
 * @param {Object} config
 * @param {string} config.title - titulo da secao (ex.: 'Naturezas de despesa')
 * @param {string} config.singular - nome no singular para mensagens (ex.: 'natureza de despesa')
 * @param {string} config.novoLabel - rotulo do botao novo (ex.: 'Nova natureza')
 * @param {string} [config.keyField='code'] - campo chave do registro
 * @param {string} [config.labelField='nome'] - campo usado nas mensagens de confirmacao
 * @param {string} config.emptyMessage - mensagem de tabela vazia
 * @param {Array} config.columns - colunas do createDataTable
 * @param {Array} config.fields - descritores dos campos do formulario
 * @param {Function} config.list - service: lista os registros
 * @param {Function} config.create - service: cria (body)
 * @param {Function} config.update - service: atualiza (code, body)
 * @param {Function} config.remove - service: exclui (code)
 * @returns {{element:HTMLElement, load:Function, cleanup:Function}}
 */
export function createDominioSection(config) {
  const keyField = config.keyField || 'code';
  const labelField = config.labelField || 'nome';

  const newBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => openDominioDialog(config, null, load),
  }, [svgIcon(ICONS.add, 16), config.novoLabel]);

  const table = createDataTable({
    columns: config.columns,
    rows: [],
    searchable: true,
    pageSize: 10,
    loading: true,
    emptyMessage: config.emptyMessage,
    actions: [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openDominioDialog(config, row, load),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ],
  });

  const section = el('section', { className: 'config-section' }, [
    el('div', { className: 'page__header' }, [
      el('h2', { className: 'config-section__title', textContent: config.title }),
      el('div', { className: 'page__actions' }, [newBtn]),
    ]),
    table.element,
  ]);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await config.list();
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      table.update({ rows: [], loading: false });
      showError(err.message || `Erro ao carregar ${config.title}`);
    }
  }

  async function handleDelete(row) {
    const id = row[keyField];
    const rotulo = row[labelField] || id;
    const ok = await confirmDialog({
      title: `Excluir ${config.singular}`,
      message: `Tem certeza que deseja excluir "${rotulo}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await config.remove(id);
      showSuccess(`${capitalize(config.singular)} excluída com sucesso`);
      await load();
    } catch (err) {
      // O backend bloqueia com 409 quando ha lancamento vinculado; mostra a mensagem.
      showError(err.message || `Erro ao excluir ${config.singular}`);
    }
  }

  return { element: section, load, cleanup: () => table._cleanup() };
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Dialog de criar/editar um registro de dominio, montado a partir de
 * config.fields. No edit, o campo chave (isKey) fica desabilitado.
 */
function openDominioDialog(config, entry, onSaved) {
  const keyField = config.keyField || 'code';
  const isEdit = entry !== null && entry !== undefined;

  const built = config.fields.map((def) => {
    const common = { label: def.label, required: def.required, helpText: def.helpText };
    let field;
    if (def.type === 'select') {
      field = createSelectField({ ...common, options: def.options, value: entry?.[def.key] ?? undefined });
    } else if (def.type === 'number') {
      field = createNumberField({
        ...common, min: def.min, max: def.max, step: def.step,
        value: entry?.[def.key] ?? undefined,
      });
    } else {
      field = createTextField({
        ...common, maxLength: def.maxLength, placeholder: def.placeholder,
        value: entry?.[def.key] ?? '',
        disabled: Boolean(def.isKey && isEdit),
      });
    }
    return { def, field };
  });

  const content = el('div', { className: 'form-grid' }, built.map((b) => b.field.element));

  let saving = false;

  openModal({
    title: isEdit ? `Editar ${config.singular}` : config.novoLabel,
    content,
    width: '520px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          let hasError = false;
          for (const { def, field } of built) {
            field.setError(null);
            if (def.required) {
              const v = field.getValue();
              if (v === null || v === undefined || v === '') {
                field.setError('Campo obrigatório');
                hasError = true;
              }
            }
          }
          if (hasError) return;

          const body = {};
          for (const { def, field } of built) {
            if (def.isKey && isEdit) continue; // a chave nao vai no corpo do update
            let v = field.getValue();
            if (def.type === 'text' && v === '' && !def.required) v = null;
            body[def.key] = v;
          }

          saving = true;
          try {
            if (isEdit) {
              await config.update(entry[keyField], body);
              showSuccess(`${capitalize(config.singular)} atualizada com sucesso`);
            } else {
              await config.create(body);
              showSuccess(`${capitalize(config.singular)} criada com sucesso`);
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || `Erro ao salvar ${config.singular}`);
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
