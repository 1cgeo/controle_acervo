import { el } from '@utils/dom.js';
import { paraId } from '@utils/format.js';
import { showSuccess, showWarning } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createDateField,
  createSelectField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import {
  createTransferencia,
  updateTransferencia,
} from '@modules/equipamento/services/equipamento-service.js';
import { gravarNoModal } from '@modules/equipamento/dialogo-comum.js';
import { SITUACAO_TRANSFERENCIA, TIPO_TRANSFERENCIA } from '@modules/equipamento/situacao.js';

/**
 * Lançamento de TRANSFERÊNCIA e de DESCARGA (do GERENTE).
 *
 * É o único dos quatro históricos que não é do operador, e a razão é que ele
 * move o bem para fora da carga: `POST`, `PUT` e `DELETE` de
 * `/equipamento/transferencia` são `verifyPerfil('gerente', 'equipamento')`.
 *
 * DESCARGA É UM TIPO DE TRANSFERÊNCIA (`tipo_id = 3`), e não uma tabela à
 * parte. As 10 descargas que vieram da planilha são linhas com tipo 3, situação
 * `Solicitada` (1) e nada mais preenchido: nem OM, nem documento, nem data. É
 * assim que elas devem continuar até alguém autorizá-las.
 *
 * OS DOIS `siafi` SÃO ETAPAS, e não sinônimos: `transferido_siafi` diz que a
 * transferência foi lançada no sistema; `apropriado_siafi` diz que o destino a
 * assumiu. Um sem o outro é o estado normal do meio do caminho.
 *
 * @param {Object} opcoes
 * @param {number} opcoes.equipamentoId
 * @param {Object|null} [opcoes.registro]
 * @param {Object} opcoes.dominio - o objeto de `GET /equipamento/dominio`
 * @param {Function} [opcoes.onSaved]
 */
export function abrirTransferenciaDialog({
  equipamentoId,
  registro = null,
  dominio = {},
  onSaved,
} = {}) {
  const edicao = Boolean(registro);

  const tipoField = createSelectField({
    label: 'Tipo',
    required: true,
    options: (dominio.tipo_transferencia || []).map(t => ({ value: t.code, label: t.nome })),
    value: registro?.tipo_id ?? undefined,
  });
  const situacaoField = createSelectField({
    label: 'Situação',
    required: true,
    // `ordenar: false` não existe no select nativo, e nem precisa: o domínio já
    // vem na ordem do fluxo (Solicitada, Autorizada, Concluída, Cancelada), e é
    // essa a ordem que se quer ler.
    options: (dominio.situacao_transferencia || []).map(s => ({ value: s.code, label: s.nome })),
    value: registro?.situacao_id ?? undefined,
  });

  const omField = createTextField({
    label: 'OM',
    maxLength: 255,
    value: registro?.om ?? '',
  });
  const documentoField = createTextField({
    label: 'Documento de solicitação',
    maxLength: 255,
    value: registro?.documento_solicitacao ?? '',
  });
  const dataSolicitacaoField = createDateField({
    label: 'Data da solicitação',
    value: registro?.data_solicitacao ?? '',
  });
  const dataTransferenciaField = createDateField({
    label: 'Data da transferência',
    value: registro?.data_transferencia ?? '',
  });
  const publicacaoField = createTextField({
    label: 'Publicação da autorização',
    maxLength: 255,
    value: registro?.publicacao_autorizacao ?? '',
  });
  const transferidoField = createCheckboxField({
    label: 'Transferido no SIAFI',
    checked: registro?.transferido_siafi === true,
  });
  const apropriadoField = createCheckboxField({
    label: 'Apropriado no SIAFI',
    checked: registro?.apropriado_siafi === true,
  });
  const descricaoField = createTextareaField({
    label: 'Descrição',
    rows: 3,
    value: registro?.descricao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    tipoField.element,
    situacaoField.element,
    omField.element,
    documentoField.element,
    dataSolicitacaoField.element,
    dataTransferenciaField.element,
    el('div', { className: 'form-grid__full' }, [publicacaoField.element]),
    transferidoField.element,
    apropriadoField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  /**
   * A TRANSFERÊNCIA NÃO TIRA O BEM DE CARGA, e o cabeçalho deste diálogo diz que
   * tira.
   *
   * `equipamento.situacao_em(dia)` só olha afastamento, manutenção,
   * indisponibilidade e `e.ativo`: a tabela `equipamento.transferencia` não entra
   * na função, e o servidor não toca em `ativo` ao gravar uma. Concluída a
   * descarga, o chip do cabeçalho continuava "Disponível", o cartão "Em carga"
   * continuava "Sim" e o bem continuava aparecendo em "Somente ativos", sem nada
   * na tela dizer que faltava um passo. Dar baixa é editar o equipamento e
   * desmarcar "Ativo"; fazer o servidor virar o `ativo` sozinho seria mudança de
   * REGRA, e regra se decide com o chefe.
   */
  function avisarQueNaoDaBaixa(tipoId, situacaoId) {
    const saiDaCarga = tipoId === TIPO_TRANSFERENCIA.DESCARGA
      || tipoId === TIPO_TRANSFERENCIA.CESSAO;
    if (!saiDaCarga || situacaoId !== SITUACAO_TRANSFERENCIA.CONCLUIDA) return;
    showWarning('O bem CONTINUA em carga: dar baixa é editar o equipamento e desmarcar "Ativo".');
  }

  openModal({
    title: edicao ? 'Editar transferência' : 'Nova transferência',
    content,
    width: '720px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => {
          tipoField.setError(null);
          situacaoField.setError(null);

          const tipoId = paraId(tipoField.getValue());
          const situacaoId = paraId(situacaoField.getValue());

          if (tipoId === null) {
            tipoField.setError('Escolha o tipo de transferência');
            return;
          }
          if (situacaoId === null) {
            situacaoField.setError('Escolha a situação');
            return;
          }

          const body = {
            equipamento_id: equipamentoId,
            tipo_id: tipoId,
            situacao_id: situacaoId,
            om: omField.getValue() || null,
            documento_solicitacao: documentoField.getValue() || null,
            data_solicitacao: dataSolicitacaoField.getValue(),
            data_transferencia: dataTransferenciaField.getValue(),
            transferido_siafi: transferidoField.getValue(),
            apropriado_siafi: apropriadoField.getValue(),
            publicacao_autorizacao: publicacaoField.getValue() || null,
            descricao: descricaoField.getValue() || null,
          };

          gravarNoModal({
            gravar: async () => {
              if (edicao) {
                await updateTransferencia(registro.id, body);
                showSuccess('Transferência atualizada com sucesso');
              } else {
                await createTransferencia(body);
                showSuccess('Transferência registrada com sucesso');
              }
              avisarQueNaoDaBaixa(tipoId, situacaoId);
            },
            close,
            setOcupado,
            aoGravar: onSaved,
            erroPadrao: 'Erro ao salvar a transferência',
          });
        },
      },
    ],
  });
}
