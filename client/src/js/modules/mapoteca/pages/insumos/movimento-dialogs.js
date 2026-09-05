import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createSelectField,
  createDateField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { formatNumber, toIsoDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createMovimentoMaterial } from '@modules/mapoteca/services/mapoteca-service.js';
import {
  TIPO_MOVIMENTO,
  TIPO_LOCALIZACAO,
  NOME_LOCALIZACAO,
  opcoesLocalizacao,
} from '@modules/mapoteca/movimento-material.js';

/**
 * OS TRES LANCAMENTOS DO LIVRO, um dialogo cada.
 *
 * Todos escrevem em `POST /mapoteca/movimento_material`, e a FORMA de cada tipo
 * e cobrada pelo Joi do servidor e pelo CHECK do banco. Cada dialogo abaixo
 * monta exatamente a forma do seu tipo, para o 400 ser impossivel de alcancar
 * pela tela: quem erra a forma erra por outra porta (CLI, carga), e ai o
 * servidor recusa.
 *
 * NINGUEM AJUSTA SALDO AQUI, e nao e por falta de tela. As rotas de escrita de
 * estoque sairam em 2026-08-08, e no mesmo dia saiu a CONTAGEM, que era o quarto
 * dialogo: ela perguntava quanto havia na prateleira e lancava a diferenca.
 *
 * O saldo passa a estar certo por estes tres, e nada mais. Faltou material que
 * de fato saiu, e o lancamento e o Consumo; sobrou material que de fato chegou,
 * e o lancamento e a Entrada. Se a diferenca veio de um LANCAMENTO ERRADO, o
 * conserto e editar ou apagar aquela linha do livro, na propria ficha: o gatilho
 * desfaz o efeito dela e o saldo volta exato, sem acrescentar ao livro um evento
 * que nunca aconteceu.
 */

/** Hoje em 'AAAA-MM-DD', que e o que o campo de data e o Joi esperam. */
const hoje = () => toIsoDate(new Date()) || '';

/** O saldo de uma localizacao, com zero para a linha que ainda nao existe. */
const saldoDe = (saldos, localizacaoId) => Number(saldos?.get?.(localizacaoId) || 0);

/**
 * Grava o movimento e cuida do toast, do botao ocupado e do recarregar.
 *
 * O erro do GATILHO ("Estoque insuficiente na Seção...") sai LITERAL: ele diz o
 * que falta e onde, e reescrever isso aqui daria uma frase mais pobre do que a
 * que o banco ja escreve.
 *
 * @param {Object} ctx - o `{ close, setOcupado }` da acao do modal
 * @param {Object} payload - o corpo de POST /movimento_material
 * @param {string} sucesso - a mensagem do toast
 * @param {Function|null} onSaved
 */
async function lancar(ctx, payload, sucesso, onSaved) {
  ctx.setOcupado(true);
  try {
    await createMovimentoMaterial(payload);
    showSuccess(sucesso);
    ctx.close();
    if (onSaved) onSaved();
  } catch (err) {
    showError(err.message || 'Erro ao lançar o movimento');
  } finally {
    ctx.setOcupado(false);
  }
}

/** Campos que os quatro dialogos repetem: quantidade e data. */
function camposComuns({ rotuloQuantidade = 'Quantidade', ajudaQuantidade } = {}) {
  const quantidadeField = createNumberField({
    label: rotuloQuantidade,
    required: true,
    // INTEIRO e POSITIVO, como a coluna do banco: material se conta em unidade,
    // e meia folha nao existe.
    min: 1,
    step: 1,
    helpText: ajudaQuantidade,
  });
  const dataField = createDateField({
    label: 'Data',
    required: true,
    value: hoje(),
    // `max` trava data FUTURA, pela mesma frase do diálogo de impressão:
    // movimento que ainda não aconteceu não se lança. O erro barato é o ano
    // trocado (2027 no lugar de 2026) num campo que nasce preenchido e que só se
    // edita a mão quando o lançamento é de outro dia; a linha entraria no livro,
    // o gatilho baixaria o saldo HOJE (ele não olha `data_movimento`), e a
    // coluna "Consumo no mês" e a 7.2 do RPCMTec seguiriam sem contar nada. O
    // saldo e o relatório passariam a discordar sem uma linha de erro.
    max: hoje(),
    // A data e o que joga o lancamento no mes certo do RPCMTec. Registrar na
    // segunda o que saiu na sexta ainda e sexta.
    helpText: 'É o dia em que aconteceu, e não o dia do lançamento.',
  });
  return { quantidadeField, dataField };
}

/** Valida quantidade e data. Devolve `null` quando alguma falhou. */
function lerQuantidadeEData(quantidadeField, dataField) {
  quantidadeField.setError(null);
  dataField.setError(null);

  const quantidade = quantidadeField.getValue();
  const data = dataField.getValue();

  let valid = true;
  if (quantidade === null || quantidade <= 0 || !Number.isInteger(quantidade)) {
    quantidadeField.setError('Informe uma quantidade inteira maior que zero');
    valid = false;
  }
  if (!data) {
    dataField.setError('Informe a data');
    valid = false;
  } else if (data > hoje()) {
    // O `max` do input trava o seletor, e nao o que se digita: as duas datas
    // sao 'AAAA-MM-DD', entao a comparacao de texto ja e cronologica.
    dataField.setError('A data não pode ser futura');
    valid = false;
  }
  return valid ? { quantidade, data } : null;
}

// ---------------------------------------------------------------------------
// Consumir (tipo 3)
// ---------------------------------------------------------------------------

/**
 * CONSUMO SO SAI DA SECAO, e o dialogo nem oferece escolha de origem.
 *
 * As quatro localizacoes sao ETAPAS da vida do material, e nao prateleiras:
 * consumir de 'Saldo no empenho' seria gastar, no papel, o que ainda esta com o
 * fornecedor. O Joi do servidor recusa qualquer outra origem, e um select que
 * oferecesse as quatro so produziria 400.
 *
 * @param {{material:Object, saldos:Map<number,number>, onSaved?:Function}} opcoes
 */
export function openConsumoDialog({ material, saldos, onSaved = null }) {
  const naSecao = saldoDe(saldos, TIPO_LOCALIZACAO.SECAO);

  const { quantidadeField, dataField } = camposComuns({
    rotuloQuantidade: 'Quantidade consumida',
  });
  const motivoField = createTextareaField({
    label: 'Motivo',
    rows: 2,
    helpText: 'Opcional: o trabalho que gastou o material.',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', {
      className: 'form-grid__full form-field__help',
      textContent: `Sai do saldo da Seção, que hoje é ${formatNumber(naSecao)}. `
        + 'Material que está no Almoxarifado precisa ser transferido para a Seção antes.',
    }),
    quantidadeField.element,
    dataField.element,
    el('div', { className: 'form-grid__full' }, [motivoField.element]),
  ]);

  openModal({
    title: `Consumir — ${material.nome}`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Lançar consumo',
        variant: 'primary',
        onClick: async (ctx) => {
          const lido = lerQuantidadeEData(quantidadeField, dataField);
          if (!lido) return;
          await lancar(ctx, {
            tipo_material_id: material.id,
            tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
            quantidade: lido.quantidade,
            data_movimento: lido.data,
            localizacao_origem_id: TIPO_LOCALIZACAO.SECAO,
            localizacao_destino_id: null,
            motivo: motivoField.getValue() || null,
          }, 'Consumo lançado com sucesso', onSaved);
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Entrada (tipo 1)
// ---------------------------------------------------------------------------

/**
 * O material CHEGA de fora, entao a entrada nao tem origem: so destino.
 * @param {{material:Object, onSaved?:Function}} opcoes
 */
export function openEntradaDialog({ material, onSaved = null }) {
  const { quantidadeField, dataField } = camposComuns({
    rotuloQuantidade: 'Quantidade recebida',
  });
  const destinoField = createSelectField({
    label: 'Entra em',
    required: true,
    options: opcoesLocalizacao(),
    value: TIPO_LOCALIZACAO.ALMOXARIFADO,
    placeholder: null,
    helpText: 'Compra ainda não entregue entra em "Aquisição realizada" ou '
      + '"Saldo no empenho", e não conta como disponível.',
  });
  const motivoField = createTextareaField({
    label: 'Motivo',
    rows: 2,
    helpText: 'Opcional: a nota fiscal, o empenho ou quem entregou.',
  });

  const content = el('div', { className: 'form-grid' }, [
    quantidadeField.element,
    dataField.element,
    el('div', { className: 'form-grid__full' }, [destinoField.element]),
    el('div', { className: 'form-grid__full' }, [motivoField.element]),
  ]);

  openModal({
    title: `Entrada — ${material.nome}`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Lançar entrada',
        variant: 'primary',
        onClick: async (ctx) => {
          const lido = lerQuantidadeEData(quantidadeField, dataField);
          destinoField.setError(null);
          const destino = destinoField.getValue();
          if (destino === null) destinoField.setError('Escolha onde o material entra');
          if (!lido || destino === null) return;

          await lancar(ctx, {
            tipo_material_id: material.id,
            tipo_movimento_id: TIPO_MOVIMENTO.ENTRADA,
            quantidade: lido.quantidade,
            data_movimento: lido.data,
            localizacao_origem_id: null,
            localizacao_destino_id: destino,
            motivo: motivoField.getValue() || null,
          }, 'Entrada lançada com sucesso', onSaved);
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Transferir (tipo 2)
// ---------------------------------------------------------------------------

/**
 * Muda o material de lugar. Origem e destino DIFERENTES: de A para A somaria e
 * subtrairia o mesmo saldo e passaria por lancamento valido. O servidor tambem
 * recusa, e a recusa daqui explica em vez de errar.
 * @param {{material:Object, saldos:Map<number,number>, onSaved?:Function}} opcoes
 */
export function openTransferenciaDialog({ material, saldos, onSaved = null }) {
  const { quantidadeField, dataField } = camposComuns();
  const origemField = createSelectField({
    label: 'Sai de',
    required: true,
    options: opcoesLocalizacao(),
    value: TIPO_LOCALIZACAO.ALMOXARIFADO,
    placeholder: null,
  });
  const destinoField = createSelectField({
    label: 'Vai para',
    required: true,
    options: opcoesLocalizacao(),
    value: TIPO_LOCALIZACAO.SECAO,
    placeholder: null,
  });
  const motivoField = createTextareaField({ label: 'Motivo', rows: 2 });

  const saldoAtual = el('div', { className: 'form-grid__full form-field__help' });
  function pintarSaldo() {
    const origem = origemField.getValue();
    const nome = NOME_LOCALIZACAO[origem] || 'origem';
    saldoAtual.textContent = `Saldo em ${nome} hoje: ${formatNumber(saldoDe(saldos, origem))}.`;
  }
  origemField.input.addEventListener('change', pintarSaldo);
  pintarSaldo();

  const content = el('div', { className: 'form-grid' }, [
    origemField.element,
    destinoField.element,
    quantidadeField.element,
    dataField.element,
    saldoAtual,
    el('div', { className: 'form-grid__full' }, [motivoField.element]),
  ]);

  openModal({
    title: `Transferir — ${material.nome}`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Lançar transferência',
        variant: 'primary',
        onClick: async (ctx) => {
          const lido = lerQuantidadeEData(quantidadeField, dataField);
          origemField.setError(null);
          destinoField.setError(null);

          const origem = origemField.getValue();
          const destino = destinoField.getValue();

          let valid = Boolean(lido);
          if (origem === null) {
            origemField.setError('Escolha de onde o material sai');
            valid = false;
          }
          if (destino === null) {
            destinoField.setError('Escolha para onde o material vai');
            valid = false;
          }
          if (origem !== null && origem === destino) {
            destinoField.setError('O destino deve ser diferente da origem');
            valid = false;
          }
          if (!valid) return;

          await lancar(ctx, {
            tipo_material_id: material.id,
            tipo_movimento_id: TIPO_MOVIMENTO.TRANSFERENCIA,
            quantidade: lido.quantidade,
            data_movimento: lido.data,
            localizacao_origem_id: origem,
            localizacao_destino_id: destino,
            motivo: motivoField.getValue() || null,
          }, 'Transferência lançada com sucesso', onSaved);
        },
      },
    ],
  });
}
