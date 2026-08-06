import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createTextField,
  createSelectField,
  createDateField,
} from '@components/form-fields/form-fields.js';
import { createSeletorMilitares } from '@components/form-fields/seletor-militares.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  createCapacitacao, updateCapacitacao, rotuloMetaPit, ehFolhaMetaPit,
} from '@services/plataforma-service.js';
import { criarHistorico } from '@components/historico/historico.js';
import { isAdmin } from '@store/auth-store.js';

// dominio.tipo_capacitacao e dominio.situacao_capacitacao. Códigos iguais aos do
// SAP, de propósito: na fusão a linha migrada não precisa de tradução.
export const MINISTRADA = 1;
export const RECEBIDA = 2;

const SITUACOES = [
  { value: 1, label: 'Prevista' },
  { value: 2, label: 'Em execução' },
  { value: 3, label: 'Concluída' },
  { value: 4, label: 'Cancelada' },
];

/**
 * Criar ou editar uma capacitação.
 *
 * O TIPO vem da TELA, e não de um campo. Ministrada e
 * recebida viraram duas telas, em dois lugares do menu, e quem abre este
 * formulário já decidiu qual das duas está cadastrando. Com o tipo como campo, a
 * pessoa escolhia de que lado estava antes de saber o que ia digitar, e trocá-lo
 * no meio limparia três campos já preenchidos.
 *
 * O tipo decide QUAIS campos existem: ministrada pergunta quantos de fora nós
 * treinamos, recebida pergunta sob que Plano/Código.
 *
 * OS MILITARES DA DIVISÃO valem para os DOIS tipos, e o rótulo é o que muda: na
 * ministrada são os instrutores e monitores, na recebida são os capacitados.
 * Eles vêm do CADASTRO, e não de um texto: "Cap Fulano" e
 * "Fulano" eram a mesma pessoa e duas strings, e nenhuma das duas respondia "de
 * quais capacitações o Fulano participou".
 *
 * @param {Object} options
 * @param {Object|null} [options.capacitacao]
 * @param {number} [options.ano]
 * @param {number} options.tipoId - MINISTRADA ou RECEBIDA, fixo pela tela
 * A META DO PIT e o MÊS PROMETIDO são um par, e por isso ficam juntos no
 * formulário. Quando a meta declara origem Capacitação, é daqui que sai o número
 * da grade: a data prevista dá o mês do PLANEJADO e a conclusão dá o mês do
 * REALIZADO. Ligar à meta sem dizer o mês faz a capacitação contar zero no
 * plano, sem erro nenhum, e é isso que o diagnóstico do PIT acusa.
 *
 * @param {Array<Object>} [options.usuarios] - o cadastro, para o seletor
 * @param {Array<Object>} [options.metas] - as metas do PIT do ano
 * @param {Function} [options.onSaved]
 */
export function openCapacitacaoDialog({
  capacitacao = null, ano = null, tipoId = MINISTRADA, usuarios = [], metas = [],
  onSaved = null,
} = {}) {
  const isEdit = Boolean(capacitacao);
  const anoAlvo = isEdit ? capacitacao.ano : (ano || new Date().getFullYear());
  const tipo = capacitacao?.tipo_id ?? tipoId;
  const ministrada = Number(tipo) === MINISTRADA;

  const nomeField = createTextField({
    label: 'Capacitação',
    required: true,
    maxLength: 255,
    value: capacitacao?.nome ?? '',
  });
  const situacaoField = createSelectField({
    label: 'Situação',
    required: true,
    options: SITUACOES,
    value: capacitacao?.situacao_id ?? 1,
  });
  const instituicoesField = createTextField({
    label: 'Instituições',
    value: capacitacao?.instituicoes ?? '',
  });
  const localField = createTextField({
    label: 'Local',
    maxLength: 255,
    value: capacitacao?.local_realizacao ?? '',
  });
  const inicioField = createDateField({
    label: 'Início',
    value: capacitacao?.data_inicio ?? '',
  });
  const fimField = createDateField({
    label: 'Término',
    value: capacitacao?.data_fim ?? '',
  });
  const documentoField = createTextField({
    label: 'Documento',
    maxLength: 255,
    value: capacitacao?.documento ?? '',
  });

  // O VÍNCULO COM O PIT: a meta que esta capacitação cumpre e o mês em que ela
  // promete terminar.
  //
  // SÓ A FOLHA entra na lista. O cabeçalho de meta subdividida não recebe
  // lançamento nem cadastro: o que ele agrupa é que conta, e ligar a ele somaria
  // o mesmo trabalho duas vezes.
  //
  // A meta CANCELADA também sai: ela deixou de ser trabalho a fazer, e oferecê-la
  // convidaria a cadastrar contra um plano que a DSG revogou.
  const metasOferecidas = (metas || [])
    .filter(m => !m.cancelada && ehFolhaMetaPit(m));
  const metaField = createSelectField({
    label: 'Meta do PIT',
    placeholder: 'Não cumpre meta do PIT',
    options: metasOferecidas.map(m => ({ value: m.id, label: rotuloMetaPit(m) })),
    value: capacitacao?.meta_pit_id ?? null,
    helpText: 'A maioria das capacitações não cumpre meta. Em 2026 o PIT só promete as ministradas.',
  });
  const previstaField = createDateField({
    label: 'Data prevista',
    value: capacitacao?.data_prevista ?? '',
    helpText: 'O mês em que ela PROMETE terminar. É daqui que sai o planejado do PIT.',
  });

  // Só da MINISTRADA.
  const efetivoField = createNumberField({
    label: 'Efetivo capacitado',
    min: 0,
    step: 1,
    value: capacitacao?.efetivo_capacitado ?? undefined,
    helpText: 'Quantas pessoas DE FORA foram treinadas.',
  });

  // Só da RECEBIDA.
  const planoField = createTextField({
    label: 'Plano / Código',
    maxLength: 255,
    placeholder: 'Ex.: C25/DCT003 PCE-EECN',
    value: capacitacao?.plano_codigo ?? '',
  });
  // OS MILITARES DA DIVISÃO valem para os DOIS tipos, e só o rótulo muda: na
  // ministrada são quem ensinou, na recebida quem aprendeu. Vêm do CADASTRO, e
  // não de um texto digitado.
  //
  // Quem já está marcado continua na lista mesmo se tiver sido desativado no
  // cadastro: quem participou em março e saiu da Divisão em julho não pode sumir
  // da linha de março só porque a lista de escolha filtra os ativos.
  const jaMarcados = (capacitacao?.militares || []).map(m => m.usuario_uuid);
  const doCadastro = new Set(usuarios.map(u => u.uuid));
  const paraOSeletor = [
    ...usuarios,
    ...(capacitacao?.militares || [])
      .filter(m => !doCadastro.has(m.usuario_uuid))
      .map(m => ({
        uuid: m.usuario_uuid,
        nome: m.nome,
        nome_guerra: m.nome_guerra,
        posto_abrev: m.posto_abrev,
        ativo: false,
      })),
  ];

  const militaresField = createSeletorMilitares({
    label: ministrada ? 'Instrutores e monitores' : 'Militares em capacitação',
    usuarios: paraOSeletor,
    selecionados: jaMarcados,
    helpText: ministrada
      ? 'Quem da Divisão ministrou. Não se confunde com o efetivo capacitado, que é gente de fora.'
      : 'Quem da Divisão foi capacitado.',
  });

  // Só os campos do tipo desta tela entram no formulário. Os do outro nem são
  // montados: escondê-los por CSS deixaria valor pendurado num campo invisível.
  const especificos = ministrada
    ? [el('div', { className: 'form-grid__full' }, [efetivoField.element])]
    : [planoField.element];

  // SÓ PARA ADMINISTRADOR: a rota do histórico de 'plataforma' é
  // verifyAdmin, e esta tela abre para qualquer pessoa logada. Painel que
  // entrega 403 no meio do formulário é pior que painel nenhum.
  const historico = isEdit && isAdmin()
    ? criarHistorico({
      modulo: 'plataforma',
      entidade: 'capacitacao',
      id: capacitacao.id,
      titulo: 'Histórico da capacitação',
      subtitulo: 'Cadastro e quem da Divisão participou',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    situacaoField.element,
    documentoField.element,
    inicioField.element,
    fimField.element,
    instituicoesField.element,
    localField.element,
    // O par do PIT fica JUNTO, e logo depois das datas do fato: a data prevista
    // só faz sentido ao lado da meta que ela promete cumprir.
    metaField.element,
    previstaField.element,
    ...especificos,
    el('div', { className: 'form-grid__full' }, [militaresField.element]),
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let saving = false;

  const nomeTipo = ministrada ? 'ministrada' : 'recebida';

  openModal({
    title: isEdit
      ? `Editar capacitação ${nomeTipo} (${anoAlvo})`
      : `Nova capacitação ${nomeTipo} (${anoAlvo})`,
    content,
    width: '680px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          nomeField.setError(null);
          situacaoField.setError(null);
          fimField.setError(null);

          const nome = nomeField.getValue();
          const situacao = situacaoField.getValue();
          const inicio = inicioField.getValue();
          const fim = fimField.getValue();

          if (!nome) return nomeField.setError('Informe o nome da capacitação');
          if (situacao === null) return situacaoField.setError('Escolha a situação');
          // O banco tem o mesmo CHECK. Cobrar aqui evita o 500 cru da restrição.
          if (inicio && fim && fim < inicio) {
            return fimField.setError('O término não pode ser antes do início');
          }

          const payload = {
            ano: anoAlvo,
            nome,
            tipo_id: Number(tipo),
            situacao_id: Number(situacao),
            instituicoes: instituicoesField.getValue() || null,
            local_realizacao: localField.getValue() || null,
            data_inicio: inicio,
            data_fim: fim,
            // O campo do OUTRO tipo vai NULO, e não é só cosmético: ele sai numa
            // subseção diferente do relatório, e um valor esquecido apareceria lá.
            efetivo_capacitado: ministrada ? efetivoField.getValue() : null,
            plano_codigo: ministrada ? null : (planoField.getValue() || null),
            // A lista vale para os DOIS tipos, ao contrário dos dois acima.
            militares: militaresField.getValue(),
            documento: documentoField.getValue() || null,
            // O PAR DO PIT. Agora o formulário TEM os dois campos, então
            // mandá-los é correto: o que a pessoa vê na tela é o que fica
            // gravado, inclusive quando ela limpa a meta de propósito.
            //
            // Enquanto o formulário não os tinha, eles eram OMITIDOS, porque a
            // chave ausente manda o servidor preservar o gravado e mandar null
            // desligaria o vínculo a cada salvamento. Essa preservação continua
            // valendo para quem edita por outra porta (CLI, importação), e é por
            // isso que o servidor ainda distingue ausente de nulo.
            meta_pit_id: metaField.getValue() === null
              ? null
              : Number(metaField.getValue()),
            data_prevista: previstaField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updateCapacitacao(capacitacao.id, payload);
              showSuccess('Capacitação atualizada com sucesso');
            } else {
              await createCapacitacao(payload);
              showSuccess('Capacitação criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar a capacitação');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
