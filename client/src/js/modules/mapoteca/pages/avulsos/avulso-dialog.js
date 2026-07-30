import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createSelectField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { getTiposProduto, getTiposEscala } from '@modules/mapoteca/services/acervo-service.js';
import { createProdutoAvulso, updateProdutoAvulso } from '@modules/mapoteca/services/mapoteca-service.js';
import { showSuccess, showError } from '@utils/toast.js';

// Código da escala personalizada no domínio; só nela o denominador faz sentido.
const ESCALA_PERSONALIZADA = 5;

/**
 * Cadastro de produto avulso: o que a mapoteca imprime SEM ser produto do
 * acervo.
 *
 * Só o nome é obrigatório, e isso é de propósito. MI existe na carta de outro
 * CGEO e não existe no papel quadriculado; tipo e escala não cabem em nada do
 * domínio quando o impresso é uma folha quadriculada de 80 x 68 cm. Forçar
 * qualquer um deles mentiria no relatório.
 *
 * @param {{avulso?:Object, onSaved?:Function}} options
 */
export async function openAvulsoDialog({ avulso = null, onSaved } = {}) {
  let tiposProduto = [];
  let tiposEscala = [];
  try {
    [tiposProduto, tiposEscala] = await Promise.all([getTiposProduto(), getTiposEscala()]);
  } catch (err) {
    showError(err.message || 'Erro ao carregar os domínios');
    return;
  }

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    value: (avulso && avulso.nome) || '',
    placeholder: 'ex.: Papel quadriculado',
  });

  const miField = createTextField({
    label: 'MI (só se for carta)',
    value: (avulso && avulso.mi) || '',
    placeholder: 'ex.: 2758-3-NE',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: (avulso && avulso.descricao) || '',
    rows: 3,
    placeholder: 'ex.: 80 x 68 cm, quadrícula de 4 x 4 cm',
  });

  const tipoProdutoField = createSelectField({
    label: 'Tipo de produto (opcional)',
    options: tiposProduto.map(t => ({ value: t.code, label: t.nome })),
    placeholder: 'Nenhum',
    value: avulso ? avulso.tipo_produto_id : undefined,
  });

  const tipoEscalaField = createSelectField({
    label: 'Escala (opcional)',
    options: tiposEscala.map(t => ({ value: t.code, label: t.nome })),
    placeholder: 'Nenhuma',
    value: avulso ? avulso.tipo_escala_id : undefined,
  });

  const denominadorField = createNumberField({
    label: 'Denominador da escala personalizada',
    value: avulso ? avulso.denominador_escala_especial : null,
    min: 1,
  });

  const ativoField = createCheckboxField({
    label: 'Ativo',
    checked: avulso ? Boolean(avulso.ativo) : true,
  });

  function aplicarEscala() {
    const personalizada = tipoEscalaField.getValue() === ESCALA_PERSONALIZADA;
    denominadorField.element.classList.toggle('hidden', !personalizada);
    if (!personalizada) denominadorField.setValue(null);
  }
  tipoEscalaField.element.addEventListener('change', aplicarEscala);
  aplicarEscala();

  const aviso = el('p', {
    className: 'form-hint',
    textContent:
      'Use só para o que NÃO é produto do acervo: papel quadriculado, carta de outro ' +
      'CGEO, impresso de ocasião. Folha nossa ainda não catalogada não entra aqui: ' +
      'ela vira item de pedido quando entrar no acervo. A descrição SAI na consulta ' +
      'pública do cliente, então não escreva anotação interna nela.',
  });

  let submitting = false;

  openModal({
    title: avulso ? 'Editar produto avulso' : 'Novo produto avulso',
    content: el('div', {}, [
      aviso,
      el('div', { className: 'form-grid' }, [
        nomeField.element,
        miField.element,
        tipoProdutoField.element,
        tipoEscalaField.element,
        denominadorField.element,
        ativoField.element,
      ]),
      descricaoField.element,
    ]),
    width: '680px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: avulso ? 'Salvar' : 'Criar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (submitting) return;
          nomeField.setError(null);
          denominadorField.setError(null);

          const nome = nomeField.getValue();
          if (!nome) {
            nomeField.setError('Campo obrigatório');
            return;
          }
          if (tipoEscalaField.getValue() === ESCALA_PERSONALIZADA && !denominadorField.getValue()) {
            denominadorField.setError('Escala personalizada exige o denominador');
            return;
          }

          const corpo = {
            nome,
            mi: miField.getValue() || null,
            descricao: descricaoField.getValue() || null,
            tipo_produto_id: tipoProdutoField.getValue(),
            tipo_escala_id: tipoEscalaField.getValue(),
            denominador_escala_especial: denominadorField.getValue(),
            ativo: ativoField.getValue(),
          };

          submitting = true;
          try {
            if (avulso) {
              await updateProdutoAvulso({ ...corpo, id: avulso.id });
              showSuccess('Produto avulso atualizado com sucesso');
            } else {
              await createProdutoAvulso(corpo);
              showSuccess('Produto avulso criado com sucesso');
            }
            close();
            if (onSaved) await onSaved();
          } catch (err) {
            submitting = false;
            showError(err.message || 'Erro ao salvar o produto avulso');
          }
        },
      },
    ],
  });
}
