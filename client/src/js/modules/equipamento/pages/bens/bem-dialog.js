import { el } from '@utils/dom.js';
import { paraId } from '@utils/format.js';
import { showSuccess } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createComboBoxField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import {
  createEquipamento,
  updateEquipamento,
} from '@modules/equipamento/services/equipamento-service.js';
import { gravarNoModal } from '@modules/equipamento/dialogo-comum.js';

/**
 * Cadastro e alteração do BEM.
 *
 * Do GERENTE, tanto para criar quanto para alterar (`POST /` e `PUT /:id` são
 * `verifyPerfil('gerente', 'equipamento')`). O botão que abre este diálogo só
 * aparece para quem tem o perfil, e isso é CORTESIA: quem barra é o servidor.
 *
 * DAR BAIXA É AQUI, na caixa "Ativo". A situação `Baixado` é derivada de
 * `ativo = false` pela função `equipamento.situacao_em(dia)`, e não existe campo
 * de situação para digitar. Excluir a linha é outra coisa, e apaga o histórico
 * junto.
 *
 * OS DOMÍNIOS E OS TIPOS VÊM DE FORA. A tela que abre o diálogo já os carregou
 * para os próprios filtros, e buscá-los de novo aqui faria duas chamadas a cada
 * abertura, com a chance de uma delas falhar depois do formulário na tela.
 *
 * @param {Object} opcoes
 * @param {Object|null} [opcoes.bem] - a linha a editar; ausente cria
 * @param {Object} opcoes.dominio - o objeto de `GET /equipamento/dominio`
 * @param {Array<Object>} opcoes.tipos - de `GET /equipamento/tipo`
 * @param {Function} [opcoes.onSaved]
 */
export function abrirBemDialog({ bem = null, dominio = {}, tipos = [], onSaved } = {}) {
  const edicao = Boolean(bem);

  const patrimonioField = createTextField({
    label: 'Número de patrimônio',
    required: true,
    // 30: o limite da coluna (`nr_patrimonio VARCHAR(30)`). Os números reais têm
    // 15 dígitos; a folga é do banco, e a tela não pode prometer mais que ela.
    maxLength: 30,
    placeholder: 'Ex.: 104820700014462',
    value: bem?.nr_patrimonio ?? '',
  });

  const classeField = createSelectField({
    label: 'Classe de suprimento',
    required: true,
    options: (dominio.classe_suprimento || []).map(c => ({ value: c.code, label: c.nome })),
    value: bem?.classe_id ?? undefined,
  });

  // COMBO BUSCÁVEL, e não `<select>`: são nove tipos hoje, e os nomes são longos
  // ("Rastreador Satelital para Navegação (GPS) veicular"). A busca por
  // substring acha "GPS" no meio do rótulo, o que o `<select>` nativo não faz.
  const tipoField = createComboBoxField({
    label: 'Tipo de equipamento',
    required: true,
    options: (tipos || []).map(t => ({
      value: t.id,
      label: t.ativo === false ? `${t.nome} (inativo)` : t.nome,
    })),
    value: bem?.tipo_id ?? undefined,
    helpText: 'A vida útil do tipo vale para o bem que não declarar a própria.',
  });

  const modeloField = createTextField({
    label: 'Modelo',
    required: true,
    maxLength: 255,
    placeholder: 'Ex.: TOPCON CTS-3007',
    value: bem?.modelo ?? '',
  });

  const serieField = createTextField({
    label: 'Número de série',
    maxLength: 255,
    value: bem?.nr_serie ?? '',
  });

  const entradaField = createDateField({
    label: 'Entrada em carga',
    value: bem?.data_entrada_carga ?? '',
  });

  // A VIDA ÚTIL APARECE EM MESES, que é como a coluna guarda o dado
  // (`vida_util_meses SMALLINT`). Oferecer anos aqui obrigaria a converter na
  // gravação, e 180 meses não é um número redondo de anos em toda cabeça.
  //
  // Em branco NÃO é zero: é "herda do tipo". Por isso o campo não tem valor
  // padrão, e a ajuda diz o que o branco significa.
  const vidaUtilField = createNumberField({
    label: 'Vida útil própria (meses)',
    min: 1,
    step: 1,
    // `vida_util_herdada` marca o valor que veio do TIPO. Repeti-lo no campo
    // faria a edição gravá-lo como valor PRÓPRIO do bem, e a partir daí mudar o
    // tipo não mudaria mais este bem, sem ninguém ter pedido isso.
    value: (bem && bem.vida_util_herdada === false) ? (bem.vida_util_meses ?? undefined) : undefined,
    helpText: 'Em branco, vale a vida útil do tipo de equipamento.',
  });

  const secaoField = createSelectField({
    label: 'Seção detentora',
    required: true,
    options: (dominio.secao_detentora || []).map(s => ({ value: s.code, label: s.nome })),
    value: bem?.secao_detentora_id ?? undefined,
  });

  const ativoField = createCheckboxField({
    label: 'Ativo (em carga)',
    checked: bem ? bem.ativo !== false : true,
    helpText: 'Desmarcar dá baixa: o bem passa a constar como Baixado e sai do que está em uso.',
  });

  const observacaoField = createTextareaField({
    label: 'Observação',
    rows: 3,
    value: bem?.observacao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    patrimonioField.element,
    classeField.element,
    el('div', { className: 'form-grid__full' }, [tipoField.element]),
    modeloField.element,
    serieField.element,
    entradaField.element,
    vidaUtilField.element,
    secaoField.element,
    ativoField.element,
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
  ]);

  openModal({
    title: edicao ? 'Editar equipamento' : 'Novo equipamento',
    content,
    width: '720px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => {
          patrimonioField.setError(null);
          classeField.setError(null);
          tipoField.setError(null);
          modeloField.setError(null);
          secaoField.setError(null);

          const nrPatrimonio = patrimonioField.getValue();
          const classeId = paraId(classeField.getValue());
          const tipoId = paraId(tipoField.getValue());
          const modelo = modeloField.getValue();
          const secaoId = paraId(secaoField.getValue());

          if (!nrPatrimonio) {
            patrimonioField.setError('Informe o número de patrimônio');
            return;
          }
          if (classeId === null) {
            classeField.setError('Escolha a classe de suprimento');
            return;
          }
          if (tipoId === null) {
            tipoField.setError('Escolha o tipo de equipamento');
            return;
          }
          if (!modelo) {
            modeloField.setError('Informe o modelo');
            return;
          }
          if (secaoId === null) {
            secaoField.setError('Escolha a seção detentora');
            return;
          }

          const body = {
            nr_patrimonio: nrPatrimonio,
            classe_id: classeId,
            tipo_id: tipoId,
            modelo,
            nr_serie: serieField.getValue() || null,
            data_entrada_carga: entradaField.getValue(),
            vida_util_meses: vidaUtilField.getValue(),
            secao_detentora_id: secaoId,
            ativo: ativoField.getValue(),
            observacao: observacaoField.getValue() || null,
          };

          gravarNoModal({
            gravar: async () => {
              if (edicao) {
                await updateEquipamento(bem.id, body);
                showSuccess('Equipamento atualizado com sucesso');
              } else {
                await createEquipamento(body);
                showSuccess('Equipamento cadastrado com sucesso');
              }
            },
            close,
            setOcupado,
            aoGravar: onSaved,
            erroPadrao: 'Erro ao salvar o equipamento',
          });
        },
      },
    ],
  });
}
