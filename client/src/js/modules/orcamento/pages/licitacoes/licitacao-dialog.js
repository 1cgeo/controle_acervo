import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createSelectField,
  createNumberField,
  createTextField,
  createDateField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getLicitacao,
  createLicitacao,
  updateLicitacao,
  getTipoLicitacao,
  getFaseLicitacao,
} from '@modules/orcamento/services/orcamento-service.js';
import { paraId } from '@utils/format.js';
import { criarHistorico } from '@components/historico/historico.js';

// Codigo do tipo Participante: so nesse tipo a OM gestora pode ser outra OM.
const TIPO_PARTICIPANTE = 3;

/**
 * Abre o dialog de criar/editar Licitacao.
 * O tipo da licitacao decide a subsecao do RPCMTec: tipo 1 (GCALC DSG) alimenta
 * a 4.4, e os tipos 2 (Própria) e 3 (Participante) alimentam a 4.5 (decisao do
 * ver `gerarLicitacoes` em rpcmtec_ctrl.js). Uma licitacao
 * pode cobrir varios DFDs, entao nao ha vinculo direto a um DFD. Em GCALC DSG
 * e Própria a OM gestora e a propria OM; so em Participante a OM gestora pode
 * ser outra.
 * @param {Object} options
 * @param {number|null} [options.licId] - id da licitacao existente para editar (null cria nova)
 * @param {number} [options.ano] - ano da TELA que abriu o dialog. O dialog nao
 *   tem barra de filtros, entao quem o abre passa o ano; ele nunca le um store
 *   global. Sem o parametro vale o ano atual, o mesmo padrao do filtro da tela.
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openLicitacaoDialog({
  licId = null,
  ano = new Date().getFullYear(),
  onSaved = null,
} = {}) {
  const isEdit = licId !== null && licId !== undefined;

  let tipos = [];
  let fases = [];
  let lic = null;

  try {
    [tipos, fases] = await Promise.all([getTipoLicitacao(), getFaseLicitacao()]);
    if (isEdit) lic = await getLicitacao(licId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados da licitação');
    return;
  }

  const tipoOptions = (tipos || []).map(t => ({ value: t.code, label: t.nome }));
  const faseOptions = (fases || []).map(f => ({ value: f.code, label: f.nome }));

  // ---- Campos ----
  const tipoField = createSelectField({
    label: 'Tipo',
    required: true,
    options: tipoOptions,
    value: lic?.tipo_id ?? undefined,
    // Os TRES tipos saem no RPCMTec. O aviso anterior dizia que Participante
    // ficaria de fora do relatorio.
    helpText: 'Os três tipos entram no RPCMTec. GCALC DSG vai para a subseção 4.4. Própria e Participante vão para a 4.5, "Demais Licitações da atividade-fim".',
    onChange: (v) => updateOmVisibility(v),
  });
  const numeroPregaoField = createTextField({
    label: 'Número do pregão',
    // 20 e o limite da coluna (er/orcamento.sql, orcamento.licitacao).
    maxLength: 20,
    value: lic?.numero_pregao ?? '',
    helpText: 'Identifica o processo para quem o acompanha fora do sistema.',
  });
  // NAO HA CAMPO "NUP" NEM "Fornecedor" AQUI. As duas colunas nasceram em
  // 2026-08-04 e sairam do banco em 2026-08-08, com 0 de 11 licitacoes
  // preenchidas nas duas. O numero do pregao continua sendo o que identifica o
  // processo na tela e na lista.
  const objetoField = createTextareaField({
    label: 'Objeto',
    required: true,
    value: lic?.objeto ?? '',
  });
  // A fase CLASSIFICA (serve para filtrar e agrupar) e o texto NARRA. Os dois
  // convivem: um pregão fracassado é o code 4, e o porquê ("vencedor não
  // entregou os softwares licitados") só cabe em texto livre.
  const faseField = createSelectField({
    label: 'Fase',
    options: faseOptions,
    value: lic?.fase_id ?? undefined,
    helpText: 'Classifica a licitação. O texto abaixo conta a história.',
  });
  const faseAtualField = createTextareaField({
    label: 'Fase atual',
    value: lic?.fase_atual ?? '',
    helpText: 'Texto livre. Guarda a história do processo, e não só em que pé ele está.',
  });
  const valorEstimadoField = createNumberField({
    label: 'Valor total estimado',
    min: 0,
    step: 0.01,
    value: lic?.valor_total_estimado ?? undefined,
  });
  const valorHomologadoField = createNumberField({
    label: 'Valor final homologado',
    min: 0,
    step: 0.01,
    value: lic?.valor_final_homologado ?? undefined,
  });
  const dataHomologacaoField = createDateField({
    label: 'Data de homologação',
    value: lic?.data_homologacao ?? '',
  });
  const omGestoraField = createTextField({
    label: 'OM gestora',
    // 60 e o limite da coluna (er/orcamento.sql:84, VARCHAR(60)).
    maxLength: 60,
    value: lic?.om_gestora ?? '',
    helpText: 'Só em Participante (a OM que conduz a licitação). Em GCALC DSG e Própria é a própria OM.',
  });

  // A OM gestora so aparece quando o tipo e Participante; em GCALC DSG/Própria a
  // gestora e a propria OM (campo oculto e gravado como null).
  const omWrapper = el('div', {}, [omGestoraField.element]);
  function updateOmVisibility(tipoId) {
    if (Number(tipoId) === TIPO_PARTICIPANTE) {
      omWrapper.classList.remove('hidden');
    } else {
      omWrapper.classList.add('hidden');
      omGestoraField.setValue('');
    }
  }
  updateOmVisibility(lic?.tipo_id);

  const historico = isEdit
    ? criarHistorico({
      modulo: 'orcamento',
      entidade: 'licitacao',
      id: licId,
      titulo: 'Histórico da licitação',
      subtitulo: 'Objeto, fase e valores',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    tipoField.element,
    numeroPregaoField.element,
    el('div', { className: 'form-grid__full' }, [objetoField.element]),
    faseField.element,
    el('div', { className: 'form-grid__full' }, [faseAtualField.element]),
    valorEstimadoField.element,
    valorHomologadoField.element,
    dataHomologacaoField.element,
    omWrapper,
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let saving = false;

  openModal({
    // Na edicao o ano do REGISTRO manda, e nao o da tela.
    title: isEdit ? `Editar licitação (${lic.ano})` : `Nova licitação (${ano})`,
    content,
    width: '760px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          tipoField.setError(null);
          objetoField.setError(null);

          const tipoId = tipoField.getValue();
          const objeto = objetoField.getValue();

          let valid = true;
          if (tipoId === null || tipoId === undefined) {
            tipoField.setError('Selecione o tipo');
            valid = false;
          }
          if (!objeto) {
            objetoField.setError('Informe o objeto da licitação');
            valid = false;
          }
          if (!valid) return;

          const body = {
            ano: isEdit ? lic.ano : ano,
            tipo_id: tipoId,
            objeto,
            numero_pregao: numeroPregaoField.getValue() || null,
            fase_id: paraId(faseField.getValue()),
            fase_atual: faseAtualField.getValue() || null,
            valor_total_estimado: valorEstimadoField.getValue(),
            valor_final_homologado: valorHomologadoField.getValue(),
            data_homologacao: dataHomologacaoField.getValue() || null,
            // SEM `nup` nem `fornecedor`: as duas colunas sairam do banco em
            // 2026-08-08, e o validador estrito do módulo devolve 400 para chave
            // desconhecida.
            // OM gestora so vale para Participante; nos demais e a propria OM (null).
            om_gestora: Number(tipoId) === TIPO_PARTICIPANTE ? (omGestoraField.getValue() || null) : null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateLicitacao(licId, body);
              showSuccess('Licitação atualizada com sucesso');
            } else {
              await createLicitacao(body);
              showSuccess('Licitação criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar licitação');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
