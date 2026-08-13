import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createTextareaField, createDateField } from '@components/form-fields/form-fields.js';
import { formatNumber, toIsoDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { registrarImpressao } from '@modules/mapoteca/services/mapoteca-service.js';

/**
 * Id do item do pedido, venha ele de qual tela vier.
 *
 * A fila de atendimento le a rota '/pedido/:id/impressao', que chama o campo de
 * `produto_pedido_id`. O detalhe do pedido le '/pedido/:id', que traz o mesmo
 * item com o campo chamado `id`. Sem esta normalizacao, o dialogo compartilhado
 * mandaria `undefined` para o servidor numa das duas telas.
 * @param {object} item
 * @returns {number}
 */
function idDoItem(item) {
  return item.produto_pedido_id != null ? item.produto_pedido_id : item.id;
}

function nomeDoItem(item) {
  return item.produto_nome || item.mi || 'item';
}

/**
 * Quanto a linha do item propoe registrar.
 *
 * O padrao e o que FALTA: quem imprime o lote todo confirma sem digitar. Item
 * ja concluido (restante zero) nasce em 1, e nao em zero, porque selecionar um
 * item concluido so faz sentido para a REIMPRESSAO da folha rasgada -- nascer
 * em zero faria o item selecionado ser silenciosamente ignorado.
 * @param {object} item
 * @returns {number}
 */
function propostaDoItem(item) {
  const restante = Number(item.quantidade_restante) || 0;
  return restante > 0 ? restante : 1;
}

/**
 * Campo de quantidade da LINHA DA TABELA: o input cru, sem rotulo nem texto de
 * ajuda, com a mesma interface que `createNumberField` devolve.
 *
 * Numero de uma a tres casas nao precisa de um campo de largura inteira. O que
 * identifica a linha e a coluna Produto ao lado, e nao um rotulo por cima.
 * @param {number} valor
 */
function criarCampoCompacto(valor) {
  const input = el('input', {
    className: 'form-field__input',
    type: 'number',
    value: String(valor),
    min: '0',
    style: { width: '5.5rem', padding: '6px 8px', textAlign: 'right' },
  });
  return {
    element: input,
    input,
    getValue: () => {
      if (input.value === '') return null;
      const n = Number(input.value);
      return isNaN(n) ? null : n;
    },
    setValue: (v) => { input.value = (v === null || v === undefined) ? '' : String(v); },
    // A linha da tabela nao tem onde pendurar mensagem de erro sem empurrar a
    // tabela inteira. O erro do lote e sempre do CONJUNTO ("nenhum item com
    // quantidade"), e ele aparece no rodape; aqui basta a borda.
    setError: (msg) => {
      input.style.borderColor = msg ? 'var(--color-danger)' : '';
    },
  };
}

/**
 * Dialogo de REGISTRAR IMPRESSAO, de UM ou de VARIOS itens do mesmo pedido.
 *
 * A impressao e LIVRO-CAIXA: ninguem edita a quantidade impressa, quem imprimiu
 * ADICIONA uma sessao. E por isso que o chefe consegue ver que uma pessoa
 * imprimiu 40 e outra imprimiu 10. Nao existe rota de atualizacao de impressao,
 * so POST e DELETE.
 *
 * Dai o cuidado com o texto: o numero digitado SOMA ao que ja foi impresso, e
 * nunca substitui. Quem entender ao contrario lanca o total acumulado e dobra a
 * contagem do item, sem nenhum erro na tela.
 *
 * UMA CHAMADA SO PARA TODOS OS ITENS. `POST /mapoteca/impressao` sempre recebeu
 * `registros: [...]` e grava as N linhas numa transacao (era o que o plugin
 * QGIS ja usava), entao o lote nao precisou de rota nova. Meia gravacao nao
 * existe: ou entram todas, ou nenhuma.
 *
 * A OBSERVACAO E A DATA SAO DA SESSAO, e nao da linha. O servidor aceita uma
 * por item, e um campo por linha so encareceria a tela: e assim que a
 * observacao e usada de verdade ("Plotter 2", "papel Tyvek"). Mesma escolha do
 * dialogo do plugin.
 *
 * @param {object|object[]} itens - item, ou lista de itens do MESMO pedido
 *        (aceita `produto_pedido_id` ou `id`)
 * @param {Function} [onDone] - chamado depois do registro, para recarregar a tela
 */
export function openRegistrarImpressaoDialog(itens, onDone) {
  const lista = Array.isArray(itens) ? itens : [itens];
  if (!lista.length) return;

  const varios = lista.length > 1;

  // Uma linha por item, com o campo de quantidade proprio. A linha em ZERO e
  // ignorada no envio: e como se desmarca um item sem fechar o dialogo.
  //
  // COM VARIOS ITENS A LISTA E UMA TABELA, e nao um formulario empilhado. A
  // primeira versao usava `form-grid`, e com 10 itens virou uma parede de campos
  // de largura inteira, cada um com o MESMO texto de ajuda repetido embaixo
  // ("Pedidas 3, ja impressas 0..."). Numa tabela o rotulo vira CABECALHO e o
  // texto de ajuda vira COLUNA: diz-se uma vez o que se dizia dez.
  //
  // E a mesma forma do dialogo do plugin QGIS, que e uma QTableWidget. O que se
  // copiou de la na primeira versao foi so o comportamento.
  const linhas = lista.map((item) => {
    const jaImpressas = Number(item.quantidade_impressa) || 0;
    const campo = varios
      ? criarCampoCompacto(propostaDoItem(item))
      : createNumberField({
        label: 'Cópias que saíram AGORA',
        value: propostaDoItem(item),
        min: 0,
        required: true,
        helpText: `Pedidas ${formatNumber(item.quantidade)}, já impressas ${formatNumber(jaImpressas)}.`
          + ' Este número SOMA ao total; ele nunca substitui o que já foi lançado.',
      });
    return { item, campo, jaImpressas };
  });

  const observacao = createTextareaField({
    label: varios ? 'Observação da sessão (opcional)' : 'Observação (opcional)',
    rows: 2,
    helpText: varios
      ? 'Vale para todos os itens registrados agora. Ex.: plotter 2, papel novo.'
      : 'Ex.: plotter 2, papel novo, reimpressão da folha rasgada.',
  });

  // QUANDO a impressão saiu do plotter. O servidor sempre aceitou este campo
  // (`data_impressao` em POST /mapoteca/impressao), e a tela nunca o oferecia:
  // quem lançava na segunda o que imprimiu na sexta contava o papel no mês
  // errado, e o RPCMTec reporta por mês. Nasce em HOJE, que é o caso comum.
  //
  // `max` trava data futura: impressão que ainda não aconteceu não se registra.
  const hoje = toIsoDate(new Date()) || '';
  const dataImpressao = createDateField({
    label: 'Data da impressão',
    value: hoje,
    max: hoje,
    required: true,
    helpText: varios
      ? 'Vale para todos os itens. Mude só ao lançar uma impressão de outro dia.'
      : 'Mude só quando estiver lançando uma impressão de outro dia.',
  });

  // O aviso repetido em destaque, fora do texto de ajuda do campo: o erro que ele
  // evita (lancar o total acumulado) nao aparece como erro em tela nenhuma.
  const aviso = el('div', { className: 'detail-card__label' });

  function atualizarAviso() {
    const ativas = linhas.filter(l => (l.campo.getValue() || 0) > 0);
    const copias = ativas.reduce((s, l) => s + l.campo.getValue(), 0);

    if (!ativas.length) {
      aviso.textContent = varios
        ? 'Nenhum item com quantidade: informe ao menos um.'
        : 'Informe quantas cópias saíram agora.';
      return;
    }
    if (varios) {
      aviso.textContent = `Total a registrar: ${formatNumber(copias)} cópia(s)`
        + ` em ${formatNumber(ativas.length)} item(ns).`;
      return;
    }
    const l = ativas[0];
    aviso.textContent = `Depois de registrar ${formatNumber(copias)} cópia(s),`
      + ` o item passa a ter ${formatNumber(l.jaImpressas + copias)} impressa(s).`;
  }

  // Mantem o aviso coerente enquanto a pessoa digita: o total previsto muda com
  // o numero, e um aviso congelado no padrao mentiria a partir da primeira tecla.
  linhas.forEach(l => l.campo.input.addEventListener('input', atualizarAviso));
  atualizarAviso();

  // Os dois atalhos do dialogo do plugin, que so pagam o espaco quando ha muitas
  // linhas para mexer de uma vez.
  const atalhos = varios
    ? el('div', { className: 'flex gap-sm' }, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => {
          linhas.forEach(l => l.campo.setValue(propostaDoItem(l.item)));
          atualizarAviso();
        },
      }, ['Preencher com o restante']),
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => {
          linhas.forEach(l => l.campo.setValue(0));
          atualizarAviso();
        },
      }, ['Zerar tudo']),
    ])
    : null;

  const titulo = varios
    ? `Registrar impressão: ${lista.length} itens`
    : `Registrar impressão: ${nomeDoItem(lista[0])}`;

  // A lista de itens ROLA, e o resto do dialogo nao: com 132 itens selecionados
  // os campos de data e observacao sairiam da tela, e o botao de registrar junto.
  //
  // O CABECALHO GRUDA no topo da rolagem (`position: sticky`), senao quem desce
  // ate o item 40 perde de vista qual coluna e "Restante" e qual e "Cópias".
  const listaEl = varios
    ? el('div', {
      className: 'data-table-scroll',
      style: { maxHeight: '46vh', overflowY: 'auto' },
    }, [
      el('table', { className: 'data-table' }, [
        el('thead', { style: { position: 'sticky', top: '0', zIndex: '1' } }, [
          el('tr', {}, [
            el('th', { textContent: 'Produto' }),
            el('th', { textContent: 'MI' }),
            el('th', { textContent: 'Pedidas', style: { textAlign: 'right' } }),
            el('th', { textContent: 'Impressas', style: { textAlign: 'right' } }),
            el('th', { textContent: 'Restante', style: { textAlign: 'right' } }),
            el('th', { textContent: 'Cópias agora', style: { textAlign: 'right' } }),
          ]),
        ]),
        el('tbody', {}, linhas.map(l => el('tr', {}, [
          el('td', { textContent: nomeDoItem(l.item) }),
          el('td', { textContent: l.item.mi || '-' }),
          el('td', { textContent: formatNumber(l.item.quantidade), style: { textAlign: 'right' } }),
          el('td', { textContent: formatNumber(l.jaImpressas), style: { textAlign: 'right' } }),
          el('td', {
            textContent: formatNumber(Number(l.item.quantidade_restante) || 0),
            style: { textAlign: 'right' },
          }),
          el('td', { style: { textAlign: 'right' } }, [l.campo.element]),
        ]))),
      ]),
    ])
    : el('div', { className: 'form-grid' }, [linhas[0].campo.element]);

  let enviando = false;

  openModal({
    title: titulo,
    // PILHA VERTICAL, e nao `form-grid`. O `form-grid` e de DUAS colunas, e foi
    // ele que na primeira versao jogou os atalhos flutuando na coluna da direita,
    // ao lado da lista. Aqui cada bloco ocupa a largura inteira, e as duas
    // colunas ficam so onde elas fazem sentido: data ao lado da observacao.
    content: el('div', {
      style: { display: 'grid', gap: 'var(--space-md)' },
    }, [
      atalhos,
      listaEl,
      el('div', { className: 'form-grid' }, [
        dataImpressao.element,
        observacao.element,
      ]),
      aviso,
    ]),
    // 860px porque a tabela tem SEIS colunas. Em 640 o nome do produto
    // quebrava em duas linhas e a coluna de copias encostava na borda.
    width: varios ? '860px' : '520px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Registrar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (enviando) return;
          linhas.forEach(l => l.campo.setError(null));
          dataImpressao.setError(null);

          const ativas = linhas.filter(l => (l.campo.getValue() || 0) > 0);
          if (!ativas.length) {
            // NO LOTE a queixa e do CONJUNTO, e por isso ela vai no rodape e nao
            // numa linha: a linha compacta so tem borda, e apontar o erro na
            // primeira linha culparia um item que nao tem culpa nenhuma.
            if (varios) {
              aviso.textContent = 'Informe a quantidade de ao menos um item';
              aviso.style.color = 'var(--color-danger)';
            } else {
              linhas[0].campo.setError('Informe quantas cópias saíram');
            }
            return;
          }
          aviso.style.color = '';

          const data = dataImpressao.getValue();
          if (!data) {
            dataImpressao.setError('Informe a data da impressão');
            return;
          }
          if (data > hoje) {
            dataImpressao.setError('A data não pode ser futura');
            return;
          }

          enviando = true;
          try {
            await registrarImpressao(ativas.map(l => ({
              produto_pedido_id: idDoItem(l.item),
              quantidade: l.campo.getValue(),
              observacao: observacao.getValue() || undefined,
              // HOJE não vai no corpo: sem o campo o servidor grava o instante
              // exato, e duas impressões do mesmo dia mantêm a ordem entre si.
              // Mandar '2026-08-05' as jogaria as duas para a meia-noite.
              data_impressao: data === hoje ? undefined : data,
            })));
            showSuccess(ativas.length > 1
              ? `Impressão registrada em ${ativas.length} itens`
              : 'Impressão registrada');
            close();
            if (onDone) onDone();
          } catch (err) {
            enviando = false;
            showError(err.message || 'Erro ao registrar a impressão');
          }
        },
      },
    ],
  });
}
