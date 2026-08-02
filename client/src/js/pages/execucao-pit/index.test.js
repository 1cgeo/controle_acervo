import { describe, test, expect, vi, beforeEach } from 'vitest';

// Execucao do PIT (#/execucao_pit), absorvida do SAP em 2026-08-02.
//
// O que estes casos FIXAM, e que nao se ve olhando a tela:
//  - a grade traz TODA meta-folha do mes, com ou sem lancamento (senao ela nao
//    diria o que falta, que e a pergunta de quem abre isto no fim do mes);
//  - o acumulado sai do RESUMO, e nao de somar o que a grade carregou;
//  - salvar NAO recarrega a tabela, e corrige o acumulado pelo DELTA -- e o que
//    mantem o foco de quem desce a grade com Tab;
//  - campo esvaziado nao apaga o lancamento.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getExecucaoMes: vi.fn(() => Promise.resolve([])),
    getResumoPit: vi.fn(() => Promise.resolve([])),
    getAnosMetaPit: vi.fn(() => Promise.resolve([2026])),
    salvarExecucaoPit: vi.fn(() => Promise.resolve({ id: 1 })),
  };
});

import { renderExecucaoPit } from '@pages/execucao-pit/index.js';
import {
  getExecucaoMes,
  getResumoPit,
  salvarExecucaoPit,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderExecucaoPit(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const GRADE = [
  {
    meta_id: '16', numero_meta: 4, item: '4.2', descricao: 'Tyvek',
    unidade: 'carta', quantidade_prevista: 252, prazo: null,
    execucao_id: '1', quantidade: 30, data_conclusao: null, observacao: null,
  },
  {
    meta_id: '17', numero_meta: 4, item: '4.3', descricao: 'Glossy',
    unidade: null, quantidade_prevista: null, prazo: null,
    execucao_id: null, quantidade: null, data_conclusao: null, observacao: null,
  },
];

// O acumulado de 4.2 e MAIOR do que o do mes: 30 em julho e 100 no ano. E o
// caso que prova que a coluna nao sai de somar a grade.
const RESUMO = [
  { meta_id: '16', realizado: 100, realizado_mes: 30 },
  { meta_id: '17', realizado: 0, realizado_mes: 0 },
];

const linhas = (container) => [...container.querySelectorAll('tbody tr')];
const celulas = (tr) => [...tr.querySelectorAll('td')].map(td => td.textContent);

describe('renderExecucaoPit', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('mostra toda meta-folha, inclusive a que ainda nao tem lancamento', async () => {
    logar({ administrador: true });
    getExecucaoMes.mockResolvedValueOnce(GRADE);
    getResumoPit.mockResolvedValueOnce(RESUMO);

    const { container, cleanup } = await montar();

    expect(linhas(container).length).toBe(2);
    // A segunda meta nao tem lancamento nenhum e mesmo assim aparece.
    const campos = container.querySelectorAll('tbody input[type="number"]');
    expect(campos.length).toBe(2);
    expect(campos[0].value).toBe('30');
    expect(campos[1].value).toBe('');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o acumulado vem do resumo, e nao da soma da grade do mes', async () => {
    logar({ administrador: true });
    getExecucaoMes.mockResolvedValueOnce(GRADE);
    getResumoPit.mockResolvedValueOnce(RESUMO);

    const { container, cleanup } = await montar();

    const primeira = celulas(linhas(container)[0]);
    // [Meta, Produto, Previsto, Realizado(input), Acumulado, %]
    expect(primeira[2]).toBe('252 carta');
    expect(primeira[4]).toBe('100');
    // 100 de 252 = 39,7%.
    expect(primeira[5]).toBe('39,7%');

    if (typeof cleanup === 'function') cleanup();
  });

  test('salvar corrige o acumulado pelo DELTA, sem recarregar a tabela', async () => {
    logar({ administrador: true });
    getExecucaoMes.mockResolvedValueOnce(GRADE);
    getResumoPit.mockResolvedValueOnce(RESUMO);

    const { container, cleanup } = await montar();

    const campo = container.querySelectorAll('tbody input[type="number"]')[0];
    campo.value = '45';
    campo.dispatchEvent(new Event('change'));
    await flush();

    expect(salvarExecucaoPit).toHaveBeenCalledWith(
      expect.objectContaining({ meta_id: '16', quantidade: 45 })
    );
    // Nenhuma consulta a mais: recarregar redesenharia os campos e tiraria o
    // foco de quem esta descendo a grade com Tab.
    expect(getExecucaoMes).toHaveBeenCalledTimes(1);
    // 100 - 30 + 45 = 115, que e a mesma conta que o servidor fez.
    expect(celulas(linhas(container)[0])[4]).toBe('115');

    if (typeof cleanup === 'function') cleanup();
  });

  test('campo esvaziado NAO apaga o lancamento: volta ao valor de antes', async () => {
    logar({ administrador: true });
    getExecucaoMes.mockResolvedValueOnce(GRADE);
    getResumoPit.mockResolvedValueOnce(RESUMO);

    const { container, cleanup } = await montar();

    const campo = container.querySelectorAll('tbody input[type="number"]')[0];
    campo.value = '';
    campo.dispatchEvent(new Event('change'));
    await flush();

    expect(salvarExecucaoPit).not.toHaveBeenCalled();
    expect(campo.value).toBe('30');

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem nao e administrador ve o numero, e nao o campo', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getExecucaoMes.mockResolvedValueOnce(GRADE);
    getResumoPit.mockResolvedValueOnce(RESUMO);

    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('tbody input[type="number"]').length).toBe(0);
    expect(celulas(linhas(container)[0])[3]).toBe('30');

    if (typeof cleanup === 'function') cleanup();
  });
});
