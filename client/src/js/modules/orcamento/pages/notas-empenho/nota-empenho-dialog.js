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

/**
 * Abre o dialog de criar/editar Nota de Empenho.
 * A NE empenha contra uma OU MAIS NCs; o valor empenhado e dividido por NC
 * (a soma das linhas = valor empenhado da NE). A ND, o PI e o GND sao HERDADOS
 * da NC, entao a NE nao tem esses campos nem licitacao; por regra todas as NCs
 * de uma NE devem ter a mesma ND e classificacao.
 * @param {Object} options
 * @param {number|null} [options.neId] - id da NE existente para editar (null cria nova)
 * @param {number} [options.ano] - ano da TELA que abriu o dialog. O dialog nao
 *   tem barra de filtros, entao quem o abre passa o ano; ele nunca le um store
 *   global. Sem o parametro vale o ano atual, o mesmo padrao do filtro da tela.
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openNotaEmpenhoDialog({
  neId = null,
  ano = new Date().getFullYear(),
  onSaved = null,
} = {}) {
  const isEdit = neId !== null && neId !== undefined;

  let notasCredito = [];
  let ne = null;

  try {
    notasCredito = await getNotasCredito({ ano });
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
    // 20: o limite da coluna (orcamento.nota_empenho.numero VARCHAR(20)). A tela
    // aceitava 30 e o banco recusava na gravacao.
    maxLength: 20,
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
  // Aviso de ND ou classificacao divergente, na classe de ERRO do design system
  // e com o MESMO texto do toast que sai ao salvar. Antes era um emoji cru
  // concatenado no texto de ajuda, e o usuario via a mesma falha escrita de dois
  // jeitos diferentes, em dois momentos.
  const ndErro = el('div', { className: 'form-field__error', style: { margin: '0' } });
  const ERRO_ND_DIVERGENTE =
    'As NCs de uma mesma NE devem ter a mesma ND e a mesma classificação.';

  function totalEmpenhado() {
    return linhas.reduce((s, l) => s + (l.valorField.getValue() || 0), 0);
  }

  /**
   * O valor da NC ao lado da linha do rateio, e o aviso de estouro.
   *
   * O servidor recusa a NE cujos empenhos passam do valor da NC. Sem o numero em
   * tela, o usuario so descobre o teto pela mensagem de erro depois de salvar.
   *
   * O que a tela mostra e o VALOR da NC, nao o saldo: o que outras NEs ja
   * empenharam contra ela nao vem na rota de listagem das NCs. O aviso daqui
   * pega o estouro grosso; o teto exato continua com o servidor, que soma tudo
   * dentro da transacao.
   */
  /**
   * Quanto ESTA NE (a que se edita) ja pesa no `empenhado` da NC.
   *
   * O `empenhado` que a listagem devolve inclui a propria NE quando ela ja esta
   * gravada. Sem descontar, editar uma NE sem mudar valor mostraria saldo zero e
   * acusaria estouro no que ja esta certo. E o mesmo motivo do `ignorarNeId` na
   * validacao do servidor.
   * @param {number|string} ncId
   * @returns {number}
   */
  function empenhadoDestaNe(ncId) {
    if (!isEdit || !Array.isArray(ne?.notas_credito)) return 0;
    const bruto = ne.notas_credito
      .filter(a => String(a.nota_credito_id) === String(ncId))
      .reduce((s, a) => s + Number(a.valor || 0), 0);
    if (!bruto) return 0;
    // A anulacao da NE e proporcional a fatia de cada NC, como no servidor.
    const total = ne.notas_credito.reduce((s, a) => s + Number(a.valor || 0), 0);
    const anulado = Number(ne.valor_anulado || 0);
    return total ? bruto - anulado * (bruto / total) : bruto;
  }

  function pintarInfoNc(linha) {
    const nc = ncPorId.get(String(linha.ncField.getValue()));
    if (!nc || nc.valor_nc == null) {
      linha.infoNc.textContent = '';
      linha.infoNc.className = 'form-field__help';
      return;
    }
    const teto = Number(nc.valor_nc);
    const recolhido = Number(nc.valor_recolhido || 0);
    const valor = linha.valorField.getValue() || 0;

    // O SALDO, e nao so o valor da NC: e o numero que decide se cabe empenhar.
    // `empenhado` vem liquido da listagem (a anulacao devolve o valor a NC), e
    // desconta a propria NE quando se edita, senao o saldo apareceria zerado.
    // Sem o campo (NE antiga em cache), volta a mostrar so o valor da NC.
    const empenhadoOutras = nc.empenhado == null
      ? null
      : Number(nc.empenhado) - empenhadoDestaNe(nc.id);
    const partes = [`Valor da NC: ${formatCurrency(teto)}`];
    if (empenhadoOutras !== null) {
      partes.push(`saldo: ${formatCurrency(teto - empenhadoOutras)}`);
    }
    if (recolhido > 0) partes.push(`recolhido: ${formatCurrency(recolhido)}`);

    const estoura = empenhadoOutras === null
      ? valor > teto
      : empenhadoOutras + valor > teto + 0.005;
    if (estoura) {
      linha.infoNc.className = 'form-field__error';
      partes.push('esta linha passa do saldo da NC');
    } else {
      linha.infoNc.className = 'form-field__help';
    }
    linha.infoNc.textContent = partes.join('; ');
  }

  function recompute() {
    totalDisplay.textContent = `Valor empenhado (soma das NCs): ${formatCurrency(totalEmpenhado())}`;
    const cods = new Set();
    const classes = new Set();
    let primeira = null;
    for (const l of linhas) {
      const nc = ncPorId.get(String(l.ncField.getValue()));
      if (nc && nc.cod_nd) {
        cods.add(nc.cod_nd);
        if (primeira === null) primeira = nc;
      }
      if (nc && nc.classificacao_id != null) classes.add(String(nc.classificacao_id));
      pintarInfoNc(l);
    }
    if (primeira) {
      ndHerdada.textContent = `ND herdada: ${primeira.cod_nd}${primeira.nd_nome ? ` - ${primeira.nd_nome}` : ''}`;
    } else {
      ndHerdada.textContent = 'A ND, o PI e o GND vêm da(s) NC(s). Use NCs de mesma ND e classificação.';
    }
    // A MESMA condição do bloqueio ao salvar: o aviso não pode aparecer num
    // caso que passa, nem faltar num caso que o servidor recusa.
    ndErro.textContent = (cods.size > 1 || classes.size > 1) ? ERRO_ND_DIVERGENTE : '';
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

    const infoNc = el('div', { className: 'form-field__help', style: { margin: '0 0 8px' } });

    // O wrapper e a linha INTEIRA (campos e informacao da NC): `removeLinha`
    // tira um no so do container.
    const wrapper = el('div', {}, [
      el('div', {
        style: { display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '4px' },
      }, [ncField.element, valorField.element, removeBtn]),
      infoNc,
    ]);

    const linha = { wrapper, ncField, valorField, infoNc };
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
    ndErro,
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
    title: isEdit ? `Editar nota de empenho (${ne.ano})` : `Nova nota de empenho (${ano})`,
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
              // Number: o select devolve o valor da opcao com o tipo original, e
              // o id vem da API como TEXTO (BIGINT do Postgres). O schema cobra
              // Joi.number().integer().strict(), que recusa texto.
              alocacoes.push({ nota_credito_id: Number(ncId), valor });
            }
          }
          if (!alocacoes.length) valid = false;

          // NDs ou classificacoes divergentes entre as NCs. Barra o submit, com o
          // MESMO texto que o `ndErro` ja mostra na secao do rateio. O backend
          // repete a checagem dentro da transacao, que e a definitiva.
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
            showError(ERRO_ND_DIVERGENTE);
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
            ano: isEdit ? ne.ano : ano,
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
