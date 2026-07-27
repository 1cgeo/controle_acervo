import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { formatCurrency } from '@utils/format.js';
import {
  getNotaEmpenho,
  createNotaEmpenho,
  updateNotaEmpenho,
  getNotasCredito,
} from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';

/**
 * Abre o dialog de criar/editar Nota de Empenho.
 * A NE empenha contra uma OU MAIS NCs; o valor empenhado e dividido por NC
 * (a soma das linhas = valor empenhado da NE). A ND, o PI e o GND sao HERDADOS
 * da NC, entao a NE nao tem esses campos nem licitacao; por regra todas as NCs
 * de uma NE devem ter a mesma ND e classificacao. O ano vem do contexto global.
 * @param {Object} options
 * @param {number|null} [options.neId] - id da NE existente para editar (null cria nova)
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openNotaEmpenhoDialog({ neId = null, onSaved = null } = {}) {
  const isEdit = neId !== null && neId !== undefined;

  let notasCredito = [];
  let ne = null;

  try {
    notasCredito = await getNotasCredito({ ano: getAno() });
    if (isEdit) ne = await getNotaEmpenho(neId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados da nota de empenho');
    return;
  }

  // Mapa id -> NC para resolver a ND herdada ao trocar a selecao.
  const ncPorId = new Map((notasCredito || []).map(nc => [String(nc.id), nc]));

  // Label no formato "numero - ND" para distinguir NCs de mesmo numero com NDs
  // diferentes (o par NC/ND e unico).
  const ncOptions = (notasCredito || []).map(nc => ({
    value: nc.id,
    label: nc.cod_nd ? `${nc.numero ?? `NC ${nc.id}`} - ${nc.cod_nd}${nc.nd_nome ? ` (${nc.nd_nome})` : ''}` : (nc.numero ?? `NC ${nc.id}`),
  }));

  // ---- Campos simples ----
  const numeroField = createTextField({
    label: 'Número',
    required: true,
    maxLength: 30,
    placeholder: 'Ex.: 2025NE000110',
    value: ne?.numero ?? '',
  });
  const dataEmpenhoField = createDateField({
    label: 'Data do empenho',
    value: ne?.data_empenho ?? '',
  });
  const finalidadeField = createTextareaField({
    label: 'Finalidade',
    value: ne?.finalidade ?? '',
  });
  const valorAnuladoField = createNumberField({
    label: 'Valor anulado',
    min: 0,
    step: 0.01,
    value: ne?.valor_anulado ?? 0,
    helpText: 'Valor anulado do empenho (padrão 0).',
  });

  // ---- Rateio por NC (uma ou mais linhas {NC, valor}) ----
  // Cada linha tem uma NC e o valor empenhado contra ela; a soma vira o valor
  // empenhado da NE. Em edicao, popula do rateio (ne.notas_credito); se a NE for
  // antiga (sem rateio), cai na NC representativa com o valor empenhado cheio.
  const linhas = [];
  const linhasContainer = el('div', {});
  const totalDisplay = el('div', { className: 'form-field__help', style: { margin: '4px 0 0', fontWeight: '600' } });
  const ndHerdada = el('div', { className: 'form-field__help', style: { margin: '0' } });

  function totalEmpenhado() {
    return linhas.reduce((s, l) => s + (l.valorField.getValue() || 0), 0);
  }

  function recompute() {
    totalDisplay.textContent = `Valor empenhado (soma das NCs): ${formatCurrency(totalEmpenhado())}`;
    const cods = new Set();
    let primeira = null;
    for (const l of linhas) {
      const nc = ncPorId.get(String(l.ncField.getValue()));
      if (nc && nc.cod_nd) {
        cods.add(nc.cod_nd);
        if (primeira === null) primeira = nc;
      }
    }
    if (primeira) {
      ndHerdada.textContent = `ND herdada: ${primeira.cod_nd}${primeira.nd_nome ? ` - ${primeira.nd_nome}` : ''}`
        + (cods.size > 1 ? '  ⚠ as NCs têm NDs diferentes; devem ser iguais.' : '');
    } else {
      ndHerdada.textContent = 'A ND, o PI e o GND vêm da(s) NC(s). Use NCs de mesma ND e classificação.';
    }
  }

  function addLinha(ncId, valor) {
    const ncField = createSelectField({
      options: ncOptions,
      placeholder: 'Selecione a NC...',
      value: ncId ?? undefined,
      onChange: recompute,
    });
    const valorField = createNumberField({
      min: 0,
      step: 0.01,
      placeholder: 'Valor',
      value: valor ?? undefined,
    });
    valorField.input.addEventListener('input', recompute);
    ncField.element.style.flex = '1';
    valorField.element.style.width = '170px';

    const removeBtn = el('button', {
      className: 'btn btn--text btn--sm',
      type: 'button',
      title: 'Remover NC',
      onClick: () => removeLinha(linha),
    }, [svgIcon(ICONS.delete, 16)]);

    const wrapper = el('div', {
      style: { display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' },
    }, [ncField.element, valorField.element, removeBtn]);

    const linha = { wrapper, ncField, valorField };
    linhas.push(linha);
    linhasContainer.appendChild(wrapper);
    recompute();
  }

  function removeLinha(linha) {
    if (linhas.length <= 1) return; // mantem ao menos uma NC
    const idx = linhas.indexOf(linha);
    if (idx >= 0) {
      linhas.splice(idx, 1);
      linhasContainer.removeChild(linha.wrapper);
      recompute();
    }
  }

  // Alocacoes iniciais.
  const iniciais = isEdit && Array.isArray(ne?.notas_credito) && ne.notas_credito.length
    ? ne.notas_credito.map(a => ({ nota_credito_id: a.nota_credito_id, valor: Number(a.valor) }))
    : (isEdit && ne?.nota_credito_id != null
      ? [{ nota_credito_id: ne.nota_credito_id, valor: Number(ne.valor_empenhado) }]
      : [{ nota_credito_id: undefined, valor: undefined }]);
  for (const a of iniciais) addLinha(a.nota_credito_id, a.valor);

  const addBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => addLinha(),
  }, [svgIcon(ICONS.add, 14), 'Adicionar NC']);

  const ncSection = el('div', { className: 'form-grid__full' }, [
    el('label', { className: 'form-field__label' }, ['Notas de crédito (rateio do empenho)', el('span', { className: 'form-field__required', textContent: '*' })]),
    linhasContainer,
    addBtn,
    ndHerdada,
    totalDisplay,
  ]);

  const content = el('div', { className: 'form-grid' }, [
    numeroField.element,
    dataEmpenhoField.element,
    ncSection,
    el('div', { className: 'form-grid__full' }, [finalidadeField.element]),
    valorAnuladoField.element,
  ]);

  let saving = false;

  openModal({
    title: isEdit ? `Editar nota de empenho (${ne.ano})` : `Nova nota de empenho (${getAno()})`,
    content,
    width: '720px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          numeroField.setError(null);

          const numero = numeroField.getValue();
          let valid = true;
          if (!numero) {
            numeroField.setError('Informe o número da NE');
            valid = false;
          }

          // Coleta e valida as alocacoes por NC.
          const alocacoes = [];
          const idsUsados = new Set();
          for (const l of linhas) {
            l.ncField.setError(null);
            l.valorField.setError(null);
            const ncId = l.ncField.getValue();
            const valor = l.valorField.getValue();
            if (ncId === null || ncId === undefined) {
              l.ncField.setError('Selecione a NC');
              valid = false;
            } else if (idsUsados.has(String(ncId))) {
              l.ncField.setError('NC repetida');
              valid = false;
            } else {
              idsUsados.add(String(ncId));
            }
            if (valor === null || valor <= 0) {
              l.valorField.setError('Valor > 0');
              valid = false;
            }
            if (ncId != null && valor != null && valor > 0) {
              alocacoes.push({ nota_credito_id: ncId, valor });
            }
          }
          if (!alocacoes.length) valid = false;

          // Aviso (nao bloqueia o submit; o backend faz a validacao definitiva)
          // de NDs/classificacao divergentes entre as NCs.
          const cods = new Set();
          const classes = new Set();
          for (const a of alocacoes) {
            const nc = ncPorId.get(String(a.nota_credito_id));
            if (nc) {
              if (nc.cod_nd != null) cods.add(nc.cod_nd);
              if (nc.classificacao_id != null) classes.add(String(nc.classificacao_id));
            }
          }
          if (cods.size > 1 || classes.size > 1) {
            showError('As NCs de uma mesma NE devem ter a mesma ND e a mesma classificação.');
            valid = false;
          }

          const valorAnulado = valorAnuladoField.getValue() ?? 0;
          valorAnuladoField.setError(null);
          if (valorAnulado > totalEmpenhado()) {
            valorAnuladoField.setError('Não pode exceder o valor empenhado total');
            valid = false;
          }

          if (!valid) return;

          const body = {
            numero,
            ano: isEdit ? ne.ano : getAno(),
            data_empenho: dataEmpenhoField.getValue(),
            finalidade: finalidadeField.getValue() || null,
            valor_anulado: valorAnulado,
            notas_credito: alocacoes,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateNotaEmpenho(neId, body);
              showSuccess('Nota de empenho atualizada com sucesso');
            } else {
              await createNotaEmpenho(body);
              showSuccess('Nota de empenho criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar nota de empenho');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
