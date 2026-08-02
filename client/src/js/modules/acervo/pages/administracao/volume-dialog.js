import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  criarVolumeArmazenamento,
  atualizarVolumeArmazenamento,
} from '@modules/acervo/services/admin-service.js';

/**
 * Formulario de volume de armazenamento.
 *
 * O CAMPO `volume` E O CAMINHO REAL no servidor, e nao um rotulo. E o unico
 * campo desta tela cujo valor errado nao aparece como erro na hora: o volume so
 * e tocado quando alguem carrega arquivo nele, e um caminho digitado errado vira
 * falha de escrita muito depois, para outra pessoa. Por isso ele e o unico com
 * texto de ajuda dizendo de onde o valor sai.
 *
 * @param {Object} options
 * @param {Object|null} [options.volume] - volume existente (null cria um novo)
 * @param {Function} [options.onSaved] - chamado apos gravar com sucesso
 */
export function openVolumeDialog({ volume = null, onSaved = null } = {}) {
  const isEdit = Boolean(volume);

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    maxLength: 255,
    value: volume?.nome || '',
    helpText: 'Como o volume aparece nas telas e nos relatórios',
  });

  const caminhoField = createTextField({
    label: 'Caminho',
    required: true,
    maxLength: 255,
    value: volume?.volume || '',
    helpText: 'Caminho do volume como o SERVIDOR o enxerga, não como a sua máquina',
  });

  const capacidadeField = createNumberField({
    label: 'Capacidade (GB)',
    required: true,
    min: 0,
    step: 'any',
    value: volume?.capacidade_gb ?? undefined,
  });

  // `layout_origem` NAO e uma preferencia de organizacao: e a porta do
  // POST /api/arquivo/catalogar/product, a unica rota que registra arquivo que
  // ja esta no disco sem passar pela validacao de transferencia. Marcada por
  // engano num volume do acervo comum, ela abre um atalho que ninguem procuraria
  // depois. O texto abaixo existe para a marca nao ser so uma caixinha.
  const layoutOrigemField = createCheckboxField({
    label: 'Layout de origem (volume de fornecedor)',
    checked: volume ? Boolean(volume.layout_origem) : false,
    helpText: 'Somente volume marcado aceita catalogar produto que já está no disco, '
      + 'sem cópia. Deixe desmarcado para volume do acervo comum.',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    el('div', { className: 'form-grid__full' }, [caminhoField.element]),
    capacidadeField.element,
    el('div', { className: 'form-grid__full' }, [layoutOrigemField.element]),
  ]);

  let saving = false;

  openModal({
    title: isEdit ? 'Editar volume de armazenamento' : 'Novo volume de armazenamento',
    content,
    width: '600px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nomeField.setError(null);
          caminhoField.setError(null);
          capacidadeField.setError(null);

          const nome = nomeField.getValue();
          const caminho = caminhoField.getValue();
          const capacidade = capacidadeField.getValue();

          let valid = true;
          if (!nome) {
            nomeField.setError('Informe o nome do volume');
            valid = false;
          }
          if (!caminho) {
            caminhoField.setError('Informe o caminho do volume');
            valid = false;
          }
          // O servidor exige `capacidade_gb` (Joi `.required()`), entao vazio
          // aqui viraria 400 com a mensagem crua do Joi.
          if (capacidade === null) {
            capacidadeField.setError('Informe a capacidade em GB');
            valid = false;
          } else if (capacidade < 0) {
            capacidadeField.setError('A capacidade não pode ser negativa');
            valid = false;
          }
          if (!valid) return;

          const payload = {
            nome,
            volume: caminho,
            capacidade_gb: capacidade,
            layout_origem: layoutOrigemField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await atualizarVolumeArmazenamento({ id: volume.id, ...payload });
              showSuccess('Volume atualizado com sucesso');
            } else {
              await criarVolumeArmazenamento(payload);
              showSuccess('Volume criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            // O servidor traduz a UNIQUE do caminho em 409 com frase propria
            // ("Ja existe volume de armazenamento com o caminho: ..."), entao a
            // mensagem dele e melhor do que qualquer texto generico daqui.
            showError(err.message || 'Erro ao salvar o volume');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
