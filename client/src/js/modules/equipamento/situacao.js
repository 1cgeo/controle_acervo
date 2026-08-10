import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';

/**
 * A SITUAÇÃO DO BEM, e como ela se lê na tela.
 *
 * Os códigos são os de `equipamento.situacao` (er/equipamento.sql), espelhados
 * em `utils/domain_constants.js` no servidor. Aqui eles existem para DESENHAR,
 * nunca para decidir o que a pessoa pode fazer: quem barra escrita é o
 * `verifyPerfil` do servidor.
 *
 * A situação é DERIVADA (a função `equipamento.situacao_em(dia)` devolve o
 * degrau mais alto que se aplica no dia perguntado), então nenhuma tela a
 * escreve. Baixado, em particular, é `ativo = false`: dar baixa é editar o bem
 * e desmarcar "ativo", e não excluir a linha.
 */
export const SITUACAO = {
  DISPONIVEL: 1,
  AFASTADO: 2,
  EM_MANUTENCAO: 3,
  INDISPONIVEL: 4,
  BAIXADO: 5,
};

/**
 * A classe do chip de cada situação.
 *
 * As três primeiras usam as variantes que o sistema inteiro já tem
 * (`css/chips.css`), com fundo esmaecido. As DUAS ÚLTIMAS são sólidas, e isso é
 * deliberado: `Indisponível` e `Baixado` precisam ler à distância numa lista de
 * 105 linhas, e um tom pastel a mais no meio de outros quatro não lê. As classes
 * sólidas moram em `modules/equipamento/equipamento.css`.
 *
 * Código fora do mapa cai no chip neutro, em vez de sumir: situação nova
 * aparece na tela enquanto ninguém lhe deu cor.
 */
const CLASSE_SITUACAO = {
  [SITUACAO.DISPONIVEL]: 'chip--success',
  [SITUACAO.AFASTADO]: 'chip--info',
  [SITUACAO.EM_MANUTENCAO]: 'chip--warning',
  [SITUACAO.INDISPONIVEL]: 'chip--equip-indisponivel',
  [SITUACAO.BAIXADO]: 'chip--equip-baixado',
};

/**
 * Chip da situação do bem.
 * @param {number|string|null} situacaoId
 * @param {string} [nome] - o rótulo que veio do servidor
 * @returns {HTMLElement}
 */
export function chipSituacao(situacaoId, nome) {
  const classe = CLASSE_SITUACAO[Number(situacaoId)] || 'chip--default';
  return el('span', {
    className: `chip ${classe}`,
    textContent: nome || (situacaoId != null ? `Situação ${situacaoId}` : 'Sem situação'),
  });
}

/** `equipamento.situacao_transferencia`: o fluxo de uma transferência. */
export const SITUACAO_TRANSFERENCIA = {
  SOLICITADA: 1,
  AUTORIZADA: 2,
  CONCLUIDA: 3,
  CANCELADA: 4,
};

/** `equipamento.tipo_transferencia`. Descarga é um TIPO, e não uma tabela. */
export const TIPO_TRANSFERENCIA = {
  RECEBIMENTO: 1,
  CESSAO: 2,
  DESCARGA: 3,
};

const CLASSE_SITUACAO_TRANSFERENCIA = {
  [SITUACAO_TRANSFERENCIA.SOLICITADA]: 'chip--info',
  [SITUACAO_TRANSFERENCIA.AUTORIZADA]: 'chip--primary',
  [SITUACAO_TRANSFERENCIA.CONCLUIDA]: 'chip--success',
  // Cancelada é o chip NEUTRO, e não o vermelho: cancelar uma solicitação é um
  // desfecho normal, e o vermelho aqui já tem dono (o bem indisponível).
  [SITUACAO_TRANSFERENCIA.CANCELADA]: 'chip--default',
};

/**
 * Chip da situação de uma transferência.
 * @param {number|string|null} situacaoId
 * @param {string} [nome]
 * @returns {HTMLElement}
 */
export function chipSituacaoTransferencia(situacaoId, nome) {
  const classe = CLASSE_SITUACAO_TRANSFERENCIA[Number(situacaoId)] || 'chip--default';
  return el('span', {
    className: `chip ${classe}`,
    textContent: nome || (situacaoId != null ? `Situação ${situacaoId}` : '-'),
  });
}

/**
 * Classe extra da LINHA da tabela, para a lista mostrar a severidade sem
 * depender só da cor do chip: uma faixa na borda esquerda.
 *
 * Existe porque a situação é UMA coluna entre seis, e quem varre a lista
 * procurando o que está parado não deveria ter de ler coluna por coluna.
 *
 * @param {Object} bem
 * @returns {string} '' quando a linha não pede destaque
 */
export function classeDaLinha(bem) {
  const id = Number(bem && bem.situacao_id);
  if (id === SITUACAO.INDISPONIVEL) return 'equip-linha--indisponivel';
  if (id === SITUACAO.BAIXADO) return 'equip-linha--baixado';
  if (id === SITUACAO.EM_MANUTENCAO) return 'equip-linha--manutencao';
  return '';
}

/**
 * Quanto tempo o bem está parado, como chip de severidade.
 *
 * A escala nasce do dado real: há bem parado desde 22/07/2019, e o número de
 * dias é o que faz alguém agir. Um ano é o corte do vermelho porque nenhuma
 * manutenção legítima leva isso; três meses é o do laranja, que é quando a
 * espera deixa de ser rotina.
 *
 * @param {number|string|null} dias
 * @returns {HTMLElement|string}
 */
export function chipDias(dias) {
  if (dias === null || dias === undefined || dias === '') return '-';
  const n = Number(dias);
  if (Number.isNaN(n)) return '-';
  let variante = 'chip--default';
  if (n >= 365) variante = 'chip--equip-indisponivel';
  else if (n >= 90) variante = 'chip--warning';
  else variante = 'chip--info';
  return el('span', {
    className: `chip ${variante} equip-dias`,
    textContent: n === 1 ? '1 dia' : `${formatNumber(n)} dias`,
  });
}

/** O texto que explica a marca, num lugar só: ele sai na lista e na ficha. */
export const AVISO_PATRIMONIO_PENDENTE =
  'Número de patrimônio por conferir: ele é provisório e não vale como '
  + 'identidade do bem no SIAFI. Confira a etiqueta colada no equipamento, grave '
  + 'o número certo e desmarque a caixa na edição.';

/**
 * A célula do número de patrimônio, com o aviso quando ele está por conferir.
 *
 * A MARCA É ÍCONE MAIS COR, e não só cor: o número provisório tem a mesma cara de
 * um verdadeiro, e quem varre a lista não tem como saber que aquela linha pede
 * conferência. O `title` carrega a frase inteira, para quem parar o ponteiro.
 *
 * `equip-patrimonio` é a classe monoespaçada que já alinha os 15 dígitos de uma
 * linha para a outra.
 *
 * @param {Object} bem - a linha, com `nr_patrimonio` e `patrimonio_pendente`
 * @returns {HTMLElement}
 */
export function celulaPatrimonio(bem) {
  const numero = (bem && bem.nr_patrimonio) || '-';
  if (!bem || bem.patrimonio_pendente !== true) {
    return el('span', { className: 'equip-patrimonio', textContent: numero });
  }
  return el('span', {
    className: 'equip-patrimonio equip-patrimonio--pendente',
    title: AVISO_PATRIMONIO_PENDENTE,
  }, [
    svgIcon(ICONS.warning, 14),
    el('span', { textContent: numero }),
  ]);
}

/**
 * A vida útil, SEMPRE EM MESES, que é como a coluna guarda o dado
 * (`vida_util_meses SMALLINT`). Converter para anos aqui esconderia o valor que
 * se digita no formulário; quem converte é o documento.
 *
 * `vida_util_herdada` diz que o número veio do TIPO, e não do bem: o servidor já
 * resolve o `COALESCE(e.vida_util_meses, t.vida_util_meses)`, e sem esta marca
 * ninguém sabe se editar o bem muda alguma coisa.
 *
 * @param {number|null} meses
 * @param {boolean} [herdada]
 * @returns {HTMLElement|string}
 */
export function textoVidaUtil(meses, herdada) {
  if (meses === null || meses === undefined || meses === '') return '-';
  const texto = `${formatNumber(meses)} meses`;
  if (!herdada) return texto;
  return el('span', { className: 'equip-vida-util', title: 'Valor herdado do tipo de equipamento' }, [
    texto,
    el('span', { className: 'equip-vida-util__origem', textContent: 'do tipo' }),
  ]);
}
