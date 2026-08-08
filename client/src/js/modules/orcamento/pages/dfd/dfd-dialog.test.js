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
});
