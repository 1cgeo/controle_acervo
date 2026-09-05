import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showError, showSuccess } from '@utils/toast.js';
import {
  createNumberField, createSelectField, createComboBoxField, createDateField,
} from '@components/form-fields/form-fields.js';
import { criarEdicao, atualizarEdicao } from '@services/rpcmtec-service.js';

/**
 * O metadado da edicao mensal: ano, mes, quem assina e a data da assinatura.
 *
 * O ASSINANTE e o cadastro (`dgeo.usuario`), e nao um nome digitado: o bloco de
 * assinatura do PDF sai dali, e nome livre nao aponta pessoa. Ele e opcional na
 * criacao porque quem vai assinar nem sempre se sabe no dia 1o, e o FECHAMENTO
 * o cobra.
 *
 * A DATA DE ASSINATURA continua editavel com a edicao fechada, e e deliberado:
 * o documento e assinado DEPOIS de fechado, e e ai que essa informacao chega. O
 * que o fechamento congela e o que o relatorio afirma, nao quem o assinou.
 *
 * O ANO E O MES SAO A EXCECAO, e travam quando a edicao fecha. O par (ano, mes)
 * diz DE QUE MES sao as 33 subsecoes ja congeladas, e troca-lo faria a edicao
 * afirmar agosto com os numeros de julho. O servidor ja recusa
 * (`rpcmtec_edicao_ctrl.js:445`), mas recusa o CORPO INTEIRO: quem abriu o
 * dialogo so para preencher a data da assinatura e esbarrou no mes perdia
 * tambem a data, e tinha de desfazer o mes na mao para conseguir salvar.
 */

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function abrirDialogoEdicao({
  edicao = null, usuarios = [], onSaved = null,
} = {}) {
  const editando = Boolean(edicao);
  const hoje = new Date();

  // A EDIÇÃO FECHADA TRAVA O PERÍODO. Ver o cabeçalho: só o ano e o mês.
  const travado = Boolean(edicao?.fechada);
  const AVISO_TRAVADO = 'A edição está fechada, e o período dela diz de que mês '
    + 'são as subseções congeladas. Reabra-a para mudá-lo.';

  const anoField = createNumberField({
    label: 'Ano',
    required: true,
    min: 2000,
    max: 2100,
    step: 1,
    value: edicao?.ano ?? hoje.getFullYear(),
    helpText: travado ? AVISO_TRAVADO : undefined,
  });

  const mesField = createSelectField({
    label: 'Mês',
    required: true,
    options: MESES.map((nome, i) => ({ value: i + 1, label: nome })),
    value: edicao?.mes ?? (hoje.getMonth() + 1),
    helpText: travado ? AVISO_TRAVADO : undefined,
  });

  // `disabled` NO NÓ, e não uma opção nova de `form-fields.js`: o campo
  // desabilitado continua devolvendo o valor em `getValue()`, então o corpo do
  // PUT sai com o período que já estava e o servidor não vê mudança nenhuma.
  if (travado) {
    anoField.input.disabled = true;
    mesField.input.disabled = true;
  }

  const assinanteField = createComboBoxField({
    label: 'Assinante',
    placeholder: 'A definir',
    options: usuarios.map((u) => ({
      value: u.uuid,
      label: `${u.tipo_posto_grad || ''} ${u.nome_guerra}`.trim(),
    })),
    value: edicao?.assinante_uuid ?? undefined,
    helpText: 'Quem assina o relatório. Obrigatório para fechar a edição.',
  });

  const dataField = createDateField({
    label: 'Data da assinatura',
    value: edicao?.data_assinatura ? String(edicao.data_assinatura).slice(0, 10) : '',
    helpText: 'Preencha depois de o documento voltar assinado.',
  });

  const conteudo = el('div', { className: 'form-grid' }, [
    anoField.element,
    mesField.element,
    el('div', { className: 'form-grid__full' }, [assinanteField.element]),
    dataField.element,
  ]);

  let salvando = false;

  /** O formulario como texto, para saber se a pessoa mexeu em alguma coisa. */
  const instantaneo = () => JSON.stringify([
    anoField.getValue(), mesField.getValue(),
    assinanteField.getValue(), dataField.getValue(),
  ]);
  const inicial = instantaneo();

  /**
   * A GUARDA DO DESCARTE, para Escape, X, fundo e "Cancelar".
   *
   * Fechar o dialogo jogava fora o formulario sem dizer nada.
   */
  const podeFechar = async () => {
    if (instantaneo() === inicial) return true;
    return confirmDialog({
      title: 'Sair sem salvar',
      message: 'Você alterou este formulário e ainda não salvou. Fechar agora '
        + 'descarta o que está na tela.',
      confirmLabel: 'Descartar e fechar',
      cancelLabel: 'Continuar editando',
      danger: true,
    });
  };

  const modal = openModal({
    title: editando ? 'Editar edição do RPCMTec' : 'Nova edição do RPCMTec',
    content: conteudo,
    width: '620px',
    podeFechar,
    actions: [
      {
        label: 'Cancelar',
        variant: 'text',
        onClick: () => modal.fecharComGuarda(),
      },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close, setOcupado }) => {
          if (salvando) return;
          anoField.setError(null);
          mesField.setError(null);

          const ano = anoField.getValue();
          const mes = mesField.getValue();
          if (!ano) return anoField.setError('Informe o ano');
          // O ANO IMPOSSÍVEL PARA AQUI, e não no servidor. Um dígito a mais no
          // campo virava um 400 cru depois do clique, e a mensagem falava de
          // esquema, e não do RPCMTec.
          if (ano < 2000 || ano > 2100) {
            return anoField.setError('O ano do RPCMTec fica entre 2000 e 2100');
          }
          if (mes === null) return mesField.setError('Escolha o mês');

          const body = {
            ano: Number(ano),
            mes: Number(mes),
            assinante_uuid: assinanteField.getValue() || null,
            data_assinatura: dataField.getValue() || null,
          };

          salvando = true;
          // O diálogo não se fecha com a gravação em voo, e o botão diz que ela
          // começou.
          if (setOcupado) setOcupado(true);
          try {
            if (editando) {
              await atualizarEdicao(edicao.id, body);
              showSuccess('Edição atualizada com sucesso');
            } else {
              const criada = await criarEdicao(body);
              showSuccess('Edição criada com sucesso');
              close();
              if (onSaved) onSaved(criada);
              return;
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message
              || 'Não foi possível salvar a edição. Confira o ano e o mês e '
              + 'tente de novo.');
          } finally {
            salvando = false;
            if (setOcupado) setOcupado(false);
          }
        },
      },
    ],
  });
}
