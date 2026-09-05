import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O VALOR ESTIMADO DO DFD, DEPOIS DA PODA DE 2026-08-08.
//
// A historia deste arquivo em duas voltas. Na primeira, a coluna existia, nenhuma
// tela permitia informa-la, e o servidor caia em resolveValorEstimado(undefined,
// itens): abrir um DFD sem itens so para corrigir o objeto ZERAVA o valor que vai
// ao PCA. A correcao foi por o campo no formulario.
//
// Na segunda, a medicao contra a producao respondeu a pergunta que ninguem tinha
// feito: em 8 de 8 DFDs o valor estimado era EXATAMENTE a soma dos valores totais
// dos itens. Um campo cujo unico estado diferente do calculo seria um erro de
// digitacao. Agora quem calcula e o servidor, sempre, e a tela so MOSTRA.
//
// O que este arquivo protege e a segunda volta sem perder a primeira: o numero
// continua visivel (era essa a lacuna original), e o corpo nao o leva mais (e essa
// a poda). Mandar `valor_estimado` hoje e 400 no validador estrito do modulo.

const { createDfd, updateDfd } = vi.hoisted(() => ({
  createDfd: vi.fn(() => Promise.resolve({ id: 9 })),
  updateDfd: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  createDfd,
  updateDfd,
  getDfd: vi.fn(() => Promise.resolve({})),
  getTipoItemDfd: vi.fn(() => Promise.resolve([{ code: 1, nome: 'Material' }])),
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({ element: document.createElement('div'), recarregar: vi.fn() })),
}));

import { openDfdDialog } from '@modules/orcamento/pages/dfd/dfd-dialog.js';

function botao(rotulo) {
  return [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

function campoPorRotulo(rotulo) {
  const campos = [...document.querySelectorAll('.modal__body .form-field')];
  const campo = campos.find(f => f.querySelector('.form-field__label')?.textContent.includes(rotulo));
  return campo ? campo.querySelector('select, input, textarea') : null;
}

const DFD = {
  id: 4,
  ano: 2026,
  numero: '103/2025',
  rotulo: 'Impressoras',
  objeto: 'Aquisição de suprimentos',
  valor_estimado: '187800.00',
  consta_pca: true,
  itens: [],
};

const DOMINIOS = { tipoItem: [{ code: 1, nome: 'Material' }] };

/** O mesmo DFD com três itens, e o valor estimado que o servidor calculou. */
const DFD_COM_ITENS = {
  ...DFD,
  valor_estimado: '600.00',
  itens: [
    { id: 1, tipo_item_id: 1, descricao: 'Toner preto', quantidade: 2, valor_unitario: 100, valor_total: '200.00' },
    { id: 2, tipo_item_id: 1, descricao: 'Papel A0', quantidade: 1, valor_unitario: 100, valor_total: '100.00' },
    { id: 3, tipo_item_id: 1, descricao: 'Cabeça de impressão', quantidade: 3, valor_unitario: 100, valor_total: '300.00' },
  ],
};

const linhasDeItem = () => [...document.querySelectorAll('.dfd-itens-table tbody tr')];
const botaoDaLinha = (i, classe) => linhasDeItem()[i]
  .querySelector(`.dfd-itens-table__actions .data-table__action-btn${classe}`);
const botaoRemover = (i) => botaoDaLinha(i, '--danger');
const botaoEditar = (i) => botaoDaLinha(i, ':not(.data-table__action-btn--danger)');
const botaoDoEditor = (rotulo) => [...document.querySelectorAll('.dfd-item-editor__actions .btn')]
  .find(b => b.textContent.trim() === rotulo);
const botaoAdicionarItem = () => [...document.querySelectorAll('.dfd-itens-section__header .btn')]
  .find(b => b.textContent.includes('Adicionar item'));
const valorEstimado = () => Number(campoPorRotulo('Valor estimado').value);

describe('openDfdDialog: valor estimado, agora calculado', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // A metade que sobrou da primeira volta: o numero CONTINUA na tela. Tira-lo
  // devolveria a lacuna que fez o campo nascer.
  test('o formulario mostra o valor estimado, e ele nao se digita', async () => {
    await openDfdDialog({ dfd: DFD });
    await flush();

    const campo = campoPorRotulo('Valor estimado');
    expect(campo).not.toBeNull();
    expect(Number(campo.value)).toBe(187800);
    expect(campo.disabled).toBe(true);
  });

  test('salvar NAO manda valor_estimado: quem soma os itens e o servidor', async () => {
    await openDfdDialog({ dfd: DFD });
    await flush();

    botao('Salvar').click();
    await flush();

    expect(updateDfd).toHaveBeenCalledTimes(1);
    const corpo = updateDfd.mock.calls[0][1];
    expect('valor_estimado' in corpo).toBe(false);
    // O resto do DFD continua indo: a poda tirou seis campos, e nao o formulario.
    expect(corpo.numero).toBe('103/2025');
    expect(corpo.objeto).toBe('Aquisição de suprimentos');
  });

  // A METADE QUE FALTAVA: o campo dizia "Calculado: soma dos itens" e nao
  // acompanhava item nenhum. Ele nascia com o numero do servidor e ficava parado
  // nele -- quem removesse um item de R$ 300 continuava lendo R$ 600 ate salvar e
  // reabrir, e o DFD NOVO mostrava campo vazio depois de dez itens lancados.
  test('remover um item ATUALIZA o valor estimado na hora', async () => {
    await openDfdDialog({ dfd: DFD_COM_ITENS, dominios: DOMINIOS });
    await flush();

    // Abre com o numero que o servidor calculou, e nao com uma conta da tela.
    expect(valorEstimado()).toBe(600);

    botaoRemover(2).click();
    await flush();

    expect(linhasDeItem()).toHaveLength(2);
    expect(valorEstimado()).toBe(300);
  });

  test('o item ACRESCENTADO entra no valor estimado do DFD novo', async () => {
    await openDfdDialog({ ano: 2026, dominios: DOMINIOS });
    await flush();

    botaoAdicionarItem().click();
    await flush();

    campoPorRotulo('Tipo do item').value = '1';
    campoPorRotulo('Descrição').value = 'Toner preto';
    campoPorRotulo('Quantidade').value = '3';
    campoPorRotulo('Valor unitário').value = '12.5';
    botaoDoEditor('Adicionar').click();
    await flush();

    // 3 x 12,50 = 37,50, a mesma conta (com o mesmo arredondamento) que o
    // servidor refaz ao gravar.
    expect(valorEstimado()).toBe(37.5);
  });

  // O ARREDONDAMENTO E DA SOMA, e nao de cada parcela.
  //
  // O servidor grava `ROUND(SUM(i.quantidade * i.valor_unitario), 2)`, uma vez
  // so. Somando parcelas ja arredondadas, dois itens de 0,005 a R$ 1,00 (a
  // `quantidade` e NUMERIC(15,3), e e isso que permite a divergencia) dariam
  // R$ 0,02 na tela contra os R$ 0,01 gravados, e o campo e justamente o que a
  // tela promete ser o numero que vai valer.
  test('a tela arredonda a SOMA, como o servidor, e nao cada item', async () => {
    await openDfdDialog({
      dfd: {
        ...DFD,
        valor_estimado: '0.01',
        itens: [
          { id: 1, tipo_item_id: 1, descricao: 'Meio milesimo A', quantidade: 0.005, valor_unitario: 1, valor_total: '0.01' },
          { id: 2, tipo_item_id: 1, descricao: 'Meio milesimo B', quantidade: 0.005, valor_unitario: 1, valor_total: '0.01' },
          { id: 3, tipo_item_id: 1, descricao: 'Item sem valor', quantidade: 0, valor_unitario: 0, valor_total: '0.00' },
        ],
      },
      dominios: DOMINIOS,
    });
    await flush();

    botaoRemover(2).click();
    await flush();

    expect(linhasDeItem()).toHaveLength(2);
    expect(valorEstimado()).toBe(0.01);
  });
});

// O EDITOR EDITA POR INDICE, e a lista nao pode mudar debaixo dele.
//
// Com o editor aberto na linha 3 e a linha 1 removida, o `onSave` escrevia em
// `itens[2]`, que ja era outro item: editando o ULTIMO, o indice caia fora da
// lista e o salvamento ACRESCENTAVA um item repetido em vez de alterar o
// escolhido; editando um do meio, a edicao caia sobre o item errado. Os dois
// casos gravam o DFD com itens que ninguem digitou, e nada na tela acusa.
describe('openDfdDialog: a lista de itens fica parada enquanto o editor esta aberto', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('com o editor aberto, os botoes da linha ficam desabilitados', async () => {
    await openDfdDialog({ dfd: DFD_COM_ITENS, dominios: DOMINIOS });
    await flush();

    expect(botaoRemover(0).disabled).toBe(false);

    botaoEditar(2).click();
    await flush();

    expect(botaoRemover(0).disabled).toBe(true);
    expect(botaoEditar(0).disabled).toBe(true);
    // O "Adicionar item" ja se comportava assim, e continua.
    expect(botaoAdicionarItem().disabled).toBe(true);
  });

  test('a edicao do ULTIMO item o ALTERA, e nao acrescenta um quarto', async () => {
    await openDfdDialog({ dfd: DFD_COM_ITENS, dominios: DOMINIOS });
    await flush();

    botaoEditar(2).click();
    await flush();

    // A tentativa de remover a primeira linha com o editor aberto nao move nada.
    botaoRemover(0).click();
    await flush();
    expect(linhasDeItem()).toHaveLength(3);

    campoPorRotulo('Descrição').value = 'Cabeça de impressão (nova)';
    botaoDoEditor('Salvar item').click();
    await flush();

    botao('Salvar').click();
    await flush();

    const corpo = updateDfd.mock.calls[0][1];
    expect(corpo.itens).toHaveLength(3);
    expect(corpo.itens[0].descricao).toBe('Toner preto');
    expect(corpo.itens[2].descricao).toBe('Cabeça de impressão (nova)');
  });

  test('fechado o editor, os botoes da linha voltam', async () => {
    await openDfdDialog({ dfd: DFD_COM_ITENS, dominios: DOMINIOS });
    await flush();

    botaoEditar(1).click();
    await flush();
    botaoDoEditor('Cancelar').click();
    await flush();

    expect(botaoRemover(0).disabled).toBe(false);
    expect(botaoEditar(0).disabled).toBe(false);
  });
});
