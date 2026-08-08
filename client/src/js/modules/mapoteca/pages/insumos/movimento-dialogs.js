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
 * OS QUATRO LANCAMENTOS DO LIVRO, um dialogo cada.
 *
 * Todos escrevem em `POST /mapoteca/movimento_material`, e a FORMA de cada tipo
 * e cobrada pelo Joi do servidor e pelo CHECK do banco. Cada dialogo abaixo
 * monta exatamente a forma do seu tipo, para o 400 ser impossivel de alcancar
 * pela tela: quem erra a forma erra por outra porta (CLI, carga), e ai o
 * servidor recusa.
 *
 * Ninguem edita saldo aqui. As rotas de escrita de estoque sairam em 2026-08-08:
 * o saldo e o acumulado do livro, aplicado por gatilho.
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

// ---------------------------------------------------------------------------
// Contagem (tipo 4) - a peca central
// ---------------------------------------------------------------------------

/**
 * A CONTAGEM DA PRATELEIRA, e por que ela e o centro desta tela.
 *
 * A SECAO CONTA A PRATELEIRA, NAO DECLARA CADA USO. A tabela antiga
 * `mapoteca.consumo_material` pedia o ato de lancar cada consumo, um a um, no
 * momento em que ele acontece -- e ficou com ZERO linhas em nove dias de
 * producao. A 7.2 do RPCMTec de julho saiu com "consumo 0" ao lado de 1.753
 * impressoes registradas. O sistema pedia um ato que ninguem pratica.
 *
 * O ato que a Secao PRATICA e outro: alguem olha a prateleira e conta quantos
 * rolos sobraram. Este dialogo pede esse numero, e nao o outro.
 *
 * A DIFERENCA VIRA A PERGUNTA. Contou menos do que o sistema diz? Entao alguma
 * coisa saiu, e a pergunta cabe numa frase: "o saldo cai de 14 para 12. Foram 2
 * consumidos?".
 *
 *   Sim  ->  lanca CONSUMO (tipo 3) com a data da contagem. ENTRA no RPCMTec,
 *            que e o ponto: o numero da 7.2 passa a existir sem ninguem ter
 *            declarado uso nenhum.
 *   Nao  ->  lanca CONTAGEM (tipo 4) com MOTIVO obrigatorio. NAO entra no
 *            RPCMTec: quebra, extravio e erro de lancamento anterior nao sao
 *            consumo, e reporta-los como tal inflaria o gasto da Divisao.
 *
 * Contou MAIS? E sempre Contagem, com motivo. Nao existe "consumo negativo": a
 * sobra veio de uma entrada que ninguem lancou ou de uma contagem anterior
 * errada, e as duas pedem explicacao.
 *
 * CONSUMO SO DA SECAO. Contando o Almoxarifado, a pergunta nem aparece: material
 * do almoxarifado nao e gasto la, ele e transferido para a Secao antes. A falta
 * ali e Contagem, sempre.
 *
 * @param {{material:Object, saldos:Map<number,number>, onSaved?:Function}} opcoes
 */
export function openContagemDialog({ material, saldos, onSaved = null }) {
  const localField = createSelectField({
    label: 'Contei em',
    required: true,
    options: opcoesLocalizacao(),
    value: TIPO_LOCALIZACAO.SECAO,
    placeholder: null,
  });
  const contadoField = createNumberField({
    label: 'Quantidade contada',
    required: true,
    // ZERO E VALIDO aqui, e nos outros dialogos nao: "contei e nao tem nenhum" e
    // uma contagem legitima, e a mais urgente delas.
    min: 0,
    step: 1,
  });
  const dataField = createDateField({
    label: 'Data da contagem',
    required: true,
    value: hoje(),
  });

  const saldoAtual = el('div', { className: 'form-grid__full form-field__help' });
  function pintarSaldo() {
    const local = localField.getValue();
    const nome = NOME_LOCALIZACAO[local] || 'localização';
    saldoAtual.textContent = `O sistema diz que há ${formatNumber(saldoDe(saldos, local))} em ${nome}.`;
  }
  localField.input.addEventListener('change', pintarSaldo);
  pintarSaldo();

  const content = el('div', { className: 'form-grid' }, [
    localField.element,
    contadoField.element,
    el('div', { className: 'form-grid__full' }, [dataField.element]),
    saldoAtual,
  ]);

  openModal({
    title: `Contagem — ${material.nome}`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Conferir',
        variant: 'primary',
        onClick: ({ close }) => {
          contadoField.setError(null);
          dataField.setError(null);
          localField.setError(null);

          const contado = contadoField.getValue();
          const data = dataField.getValue();
          const local = localField.getValue();

          let valid = true;
          if (contado === null || contado < 0 || !Number.isInteger(contado)) {
            contadoField.setError('Informe quantas unidades você contou (0 ou mais)');
            valid = false;
          }
          if (!data) {
            dataField.setError('Informe a data da contagem');
            valid = false;
          }
          if (local === null) {
            localField.setError('Escolha onde você contou');
            valid = false;
          }
          if (!valid) return;

          const saldo = saldoDe(saldos, local);
          if (contado === saldo) {
            // Nada a lancar: a prateleira e o sistema ja concordam. Gravar uma
            // Contagem de quantidade zero seria recusado pelo servidor (a
            // quantidade e positiva), e nao teria o que dizer.
            contadoField.setError(
              `O sistema já diz ${formatNumber(saldo)}. A contagem confere, e não há o que lançar.`
            );
            return;
          }

          close();
          abrirDecisaoDaContagem({
            material, local, saldo, contado, data, onSaved,
          });
        },
      },
    ],
  });
}

/**
 * O segundo passo da contagem: a frase e as saidas.
 *
 * E um modal NOVO, e nao o primeiro reescrito, porque o rodape do modal e fixo
 * na criacao: as acoes daqui ("Sim, foram consumidos" e "Não, foi outra coisa")
 * nao sao as do passo anterior. Escape fecha so o do topo, pela pilha de
 * `modal-base.js`.
 */
function abrirDecisaoDaContagem({ material, local, saldo, contado, data, onSaved }) {
  const nomeLocal = NOME_LOCALIZACAO[local] || 'localização';
  const diferenca = Math.abs(contado - saldo);
  const faltou = contado < saldo;
  // A pergunta sobre consumo so cabe na Secao: e de la, e so de la, que material
  // e gasto.
  const podeSerConsumo = faltou && local === TIPO_LOCALIZACAO.SECAO;

  const motivoField = createTextareaField({
    label: 'Motivo',
    rows: 2,
    required: !podeSerConsumo,
    helpText: podeSerConsumo
      ? 'Obrigatório se a diferença NÃO foi consumo: quebra, extravio, '
        + 'erro em lançamento anterior.'
      : 'Diga o que explica a diferença. A contagem é o único movimento que '
        + 'ninguém viu acontecer, e sem o porquê ela vira um ajuste mudo do saldo.',
  });

  const frase = faltou
    ? `O saldo de ${material.nome} em ${nomeLocal} cai de ${formatNumber(saldo)} `
      + `para ${formatNumber(contado)}.`
    : `O saldo de ${material.nome} em ${nomeLocal} sobe de ${formatNumber(saldo)} `
      + `para ${formatNumber(contado)}.`;

  const pergunta = podeSerConsumo
    ? ` Foram ${formatNumber(diferenca)} consumidos?`
    : '';

  const content = el('div', { className: 'form-grid' }, [
    el('p', { className: 'form-grid__full', textContent: frase + pergunta }),
    el('div', { className: 'form-grid__full' }, [motivoField.element]),
  ]);

  /** Lanca a Contagem: a diferenca SAI (origem) ou ENTRA (destino), nunca os dois. */
  const lancarContagem = async (ctx) => {
    motivoField.setError(null);
    const motivo = motivoField.getValue();
    if (!motivo) {
      motivoField.setError('Informe o motivo da diferença');
      return;
    }
    await lancar(ctx, {
      tipo_material_id: material.id,
      tipo_movimento_id: TIPO_MOVIMENTO.CONTAGEM,
      quantidade: diferenca,
      data_movimento: data,
      localizacao_origem_id: faltou ? local : null,
      localizacao_destino_id: faltou ? null : local,
      motivo,
    }, 'Contagem lançada com sucesso', onSaved);
  };

  const acoes = [
    { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
  ];

  if (podeSerConsumo) {
    acoes.push({
      label: 'Não, foi outra coisa',
      variant: 'secondary',
      onClick: lancarContagem,
    });
    acoes.push({
      label: 'Sim, foram consumidos',
      variant: 'primary',
      onClick: async (ctx) => {
        // CONSUMO com a DATA DA CONTAGEM, e nao a de hoje: e o mes da contagem
        // que o RPCMTec reporta.
        await lancar(ctx, {
          tipo_material_id: material.id,
          tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
          quantidade: diferenca,
          data_movimento: data,
          localizacao_origem_id: TIPO_LOCALIZACAO.SECAO,
          localizacao_destino_id: null,
          motivo: motivoField.getValue() || null,
        }, 'Consumo lançado com sucesso', onSaved);
      },
    });
  } else {
    acoes.push({
      label: 'Registrar contagem',
      variant: 'primary',
      onClick: lancarContagem,
    });
  }

  openModal({
    title: faltou ? 'Faltou na prateleira' : 'Sobrou na prateleira',
    content,
    width: '560px',
    actions: acoes,
  });
}
