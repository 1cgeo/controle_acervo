import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createNumberField,
  createCheckboxField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  createTipoMaterial, updateTipoMaterial, getDominioTipoMidia,
} from '@modules/mapoteca/services/mapoteca-service.js';

/**
 * Open the create/edit dialog for a tipo de material.
 *
 * DOIS CAMPOS ENTRARAM EM 2026-08-04, e os dois consertam defeito medido:
 *
 *  - CATEGORIA. Ela existe no banco desde 2026-08-01 e este formulario nunca a
 *    mandava, entao todo material criado pela tela caia no default 3 (Outro) e
 *    sumia das DUAS tabelas de insumo do RPCMTec. Os 21 materiais de hoje so
 *    tem categoria porque a migracao a preencheu.
 *  - MIDIA QUE O CONSOME. E o que faz o consumo de papel sair da IMPRESSAO. Sem
 *    ela, o consumo saia so de lancamento manual, que ninguem faz: as 7.2 e 7.3
 *    imprimiam "Consumo no mes = 0" nas dezessete linhas com 1.753 impressoes
 *    registradas.
 *
 * A midia SO vale para papel, e a tela cobra isso antes do banco: quanto de
 * cartucho uma folha gasta depende do que esta desenhado nela, e derivar tinta
 * de folha impressa daria um numero inventado. O CHECK `midia_so_para_papel`
 * recusa de qualquer forma; aqui a recusa vira campo desabilitado, que explica
 * em vez de errar.
 *
 * @param {Object} options
 * @param {Object|null} [options.material] - existing material to edit (null creates a new one)
 * @param {Function} [options.onSaved] - called after a successful save
 */
export async function openMaterialDialog({ material = null, onSaved = null } = {}) {
  const isEdit = Boolean(material);

  let midias = [];
  try {
    midias = await getDominioTipoMidia();
  } catch {
    midias = [];
  }

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    maxLength: 100,
    value: material?.nome || '',
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: material?.descricao || '',
  });

  // Papel (1), Tinta (2) e Outro (3), de dominio.categoria_material. Sem ela o
  // material fica fora da 7.2 e da 7.3 do RPCMTec.
  const categoriaField = createSelectField({
    label: 'Categoria',
    required: true,
    options: [
      { value: 1, label: 'Papel' },
      { value: 2, label: 'Tinta' },
      { value: 3, label: 'Outro' },
    ],
    value: material?.categoria_id ?? 3,
    helpText: 'Papel sai na 7.2 do RPCMTec e tinta na 7.3. "Outro" fica fora das duas.',
    onChange: () => aplicarCoerencia(),
  });

  const midiaField = createSelectField({
    label: 'Mídia que o consome',
    placeholder: 'Nenhuma',
    options: (midias || []).map((m) => ({ value: m.code, label: m.nome })),
    value: material?.tipo_midia_id ?? undefined,
    helpText: 'Cada exemplar impresso nesta mídia baixa uma unidade deste material.',
  });

  // Inteiros: contam unidade de material, como o estoque e o consumo.
  const estoqueMinimoField = createNumberField({
    label: 'Estoque mínimo',
    min: 0,
    step: 1,
    value: material?.estoque_minimo ?? undefined,
    helpText: 'Limiar do alerta "Abaixo do mínimo" (vazio = sem alerta)',
  });
  const metaAnualField = createNumberField({
    label: 'Meta anual',
    min: 0,
    step: 1,
    value: material?.meta_anual ?? undefined,
    helpText: 'Consumo anual previsto',
  });
  const ativoField = createCheckboxField({
    label: 'Ativo',
    checked: material ? Boolean(material.ativo) : true,
  });

  /** A mídia só existe para papel. Fora dele, o campo desliga e zera. */
  function aplicarCoerencia() {
    const ehPapel = Number(categoriaField.getValue()) === 1;
    const select = midiaField.element.querySelector('select');
    if (select) select.disabled = !ehPapel;
    midiaField.element.classList.toggle('form-field--disabled', !ehPapel);
    if (!ehPapel) midiaField.setValue(undefined);
  }
  aplicarCoerencia();

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    categoriaField.element,
    midiaField.element,
    estoqueMinimoField.element,
    metaAnualField.element,
    el('div', { className: 'form-grid__full' }, [ativoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar tipo de material' : 'Novo tipo de material',
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nomeField.setError(null);
          categoriaField.setError(null);
          estoqueMinimoField.setError(null);
          metaAnualField.setError(null);

          const nome = nomeField.getValue();
          const categoria = categoriaField.getValue();
          const estoqueMinimo = estoqueMinimoField.getValue();
          const metaAnual = metaAnualField.getValue();

          let valid = true;
          if (!nome) {
            nomeField.setError('Informe o nome do material');
            valid = false;
          }
          if (categoria === null) {
            categoriaField.setError('Escolha a categoria');
            valid = false;
          }
          if (estoqueMinimo !== null && estoqueMinimo < 0) {
            estoqueMinimoField.setError('O estoque mínimo não pode ser negativo');
            valid = false;
          }
          if (metaAnual !== null && metaAnual < 0) {
            metaAnualField.setError('A meta anual não pode ser negativa');
            valid = false;
          }
          if (!valid) return;

          const ehPapel = Number(categoria) === 1;
          const payload = {
            nome,
            descricao: descricaoField.getValue() || null,
            categoria_id: Number(categoria),
            // Só papel manda mídia. O CHECK do banco recusa o resto.
            tipo_midia_id: ehPapel ? (midiaField.getValue() ?? null) : null,
            estoque_minimo: estoqueMinimo,
            meta_anual: metaAnual,
            ativo: ativoField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await updateTipoMaterial({ id: material.id, ...payload });
              showSuccess('Tipo de material atualizado com sucesso');
            } else {
              await createTipoMaterial(payload);
              showSuccess('Tipo de material criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar tipo de material');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
