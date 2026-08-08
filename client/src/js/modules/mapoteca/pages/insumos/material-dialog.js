import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createNumberField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  createTipoMaterial, updateTipoMaterial,
} from '@modules/mapoteca/services/mapoteca-service.js';

/**
 * O CADASTRO do insumo: quatro campos, e so.
 *
 * O QUE SAIU DAQUI em 2026-08-08, e por que nao volta:
 *
 *  - CATEGORIA (Papel/Tinta/Outro). Ela so escolhia entre a 7.2 e a 7.3 do
 *    RPCMTec, e o chefe fundiu as duas tabelas numa so. Uma coluna cuja unica
 *    funcao era escolher o lado de uma divisao que nao existe mais.
 *  - MIDIA QUE O CONSOME. Era a ponte impressao -> consumo, e a ponte morreu:
 *    produto impresso e rolo de papel sao coisas separadas, e nao ha como saber
 *    qual papel uma impressao gastou. Era essa a afirmacao que a ponte fazia e
 *    nao podia sustentar.
 *  - META ANUAL. Nunca teve leitor: nenhuma tela e nenhum relatorio a liam.
 *
 * A UNIDADE VAI NO NOME, e nao em campo proprio: "Papel Sulfite 120g (rolo 50 m)"
 * e "Cartucho MK - T730". Decisao do chefe.
 *
 * O NOME E UNICO no banco, porque a 7.2 do RPCMTec casa a linha do mes anterior
 * por ele. O servidor devolve 409 com a explicacao inteira, e ela sai literal no
 * toast.
 *
 * @param {Object} options
 * @param {Object|null} [options.material] - insumo a editar (nulo cria um novo)
 * @param {Function} [options.onSaved] - chamada apos gravar com sucesso
 */
export function openMaterialDialog({ material = null, onSaved = null } = {}) {
  const isEdit = Boolean(material);

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    maxLength: 100,
    value: material?.nome || '',
    helpText: 'A unidade faz parte do nome: "Papel Sulfite 120g (rolo 50 m)".',
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: material?.descricao || '',
  });

  // Inteiro: conta o MESMO material que o estoque e o livro, em unidade.
  const estoqueMinimoField = createNumberField({
    label: 'Estoque mínimo',
    min: 0,
    step: 1,
    value: material?.estoque_minimo ?? undefined,
    helpText: 'Limiar do alerta "Abaixo do mínimo", medido contra o disponível '
      + '(Seção + Almoxarifado). Vazio = sem alerta.',
  });
  const ativoField = createCheckboxField({
    label: 'Ativo',
    checked: material ? Boolean(material.ativo) : true,
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    estoqueMinimoField.element,
    el('div', { className: 'form-grid__full' }, [ativoField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar cadastro do insumo' : 'Novo insumo',
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close, setOcupado }) => {
          if (saving) return;

          nomeField.setError(null);
          estoqueMinimoField.setError(null);

          const nome = nomeField.getValue();
          const estoqueMinimo = estoqueMinimoField.getValue();

          let valid = true;
          if (!nome) {
            nomeField.setError('Informe o nome do insumo');
            valid = false;
          }
          if (estoqueMinimo !== null && estoqueMinimo < 0) {
            estoqueMinimoField.setError('O estoque mínimo não pode ser negativo');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            nome,
            descricao: descricaoField.getValue() || null,
            estoque_minimo: estoqueMinimo,
            ativo: ativoField.getValue(),
          };

          saving = true;
          setOcupado(true);
          try {
            if (isEdit) {
              await updateTipoMaterial({ id: material.id, ...payload });
              showSuccess('Cadastro do insumo atualizado com sucesso');
            } else {
              await createTipoMaterial(payload);
              showSuccess('Insumo criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            // O 409 de nome repetido chega com a explicacao inteira do servidor.
            showError(err.message || 'Erro ao salvar o insumo');
          } finally {
            saving = false;
            setOcupado(false);
          }
        },
      },
    ],
  });
}
