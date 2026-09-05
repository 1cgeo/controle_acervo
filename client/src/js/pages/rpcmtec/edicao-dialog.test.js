import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O DIALOGO DE METADADOS DA EDICAO DO RPCMTEC.
//
// O que estes casos FIXAM: com a edicao FECHADA, o Ano e o Mes travam, e o
// assinante e a data da assinatura NAO. O par (ano, mes) diz de que mes sao as
// 33 subsecoes ja congeladas; troca-lo faria a edicao afirmar agosto com os
// numeros de julho, e reabrir para desfazer APAGA o congelado calculado.
//
// O servidor ja recusa a troca (`rpcmtec_edicao_ctrl.js:445`), mas recusa o
// CORPO INTEIRO: quem abriu o dialogo so para preencher a data da assinatura e
// esbarrou no mes perdia tambem a data, e tinha de desfazer o mes na mao. Por
// isso o campo trava ANTES, com o motivo escrito ao lado.

vi.mock('@services/rpcmtec-service.js', async () => {
  const real = await vi.importActual('@services/rpcmtec-service.js');
  return {
    ...real,
    criarEdicao: vi.fn(() => Promise.resolve({ id: 7 })),
    atualizarEdicao: vi.fn(() => Promise.resolve({ id: 7 })),
  };
});

vi.mock('@utils/toast.js', async () => {
  const real = await vi.importActual('@utils/toast.js');
  return { ...real, showError: vi.fn(), showSuccess: vi.fn() };
});

import { abrirDialogoEdicao } from '@pages/rpcmtec/edicao-dialog.js';
import { atualizarEdicao } from '@services/rpcmtec-service.js';

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
};

const ABERTA = {
  id: 7,
  ano: 2026,
  mes: 7,
  fechada: false,
  assinante_uuid: null,
  data_assinatura: null,
};

const campoAno = () => document.querySelector('.modal input[type="number"]');
const campoMes = () => document.querySelector('.modal select.form-field__select');
const campoData = () => document.querySelector('.modal input[type="date"]');
const ajudaDe = (input) => [...input.closest('.form-field').querySelectorAll('.form-field__help')]
  .map(no => no.textContent).join(' ');
const botao = (rotulo) => [...document.querySelectorAll('.modal button')]
  .find(b => b.textContent.trim() === rotulo);

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('abrirDialogoEdicao', () => {
  test('na edição ABERTA o ano e o mês são editáveis', () => {
    abrirDialogoEdicao({ edicao: ABERTA });

    expect(campoAno().disabled).toBe(false);
    expect(campoMes().disabled).toBe(false);
    expect(ajudaDe(campoAno())).not.toContain('Reabra-a');
  });

  test('na edição FECHADA o ano e o mês travam, e dizem por quê', () => {
    abrirDialogoEdicao({ edicao: { ...ABERTA, fechada: true } });

    expect(campoAno().disabled).toBe(true);
    expect(campoMes().disabled).toBe(true);
    expect(ajudaDe(campoAno())).toContain('Reabra-a para mudá-lo');
    expect(ajudaDe(campoMes())).toContain('Reabra-a para mudá-lo');
  });

  // O QUE NAO TRAVA, e e o motivo de abrir o dialogo com a edicao fechada: o
  // documento e assinado DEPOIS de fechado, e a data chega ai.
  test('a data da assinatura continua editável, e salva com o período de sempre', async () => {
    abrirDialogoEdicao({ edicao: { ...ABERTA, fechada: true } });

    expect(campoData().disabled).toBe(false);
    campoData().value = '2026-08-14';
    campoData().dispatchEvent(new Event('input', { bubbles: true }));

    botao('Salvar').click();
    await flush();

    expect(atualizarEdicao).toHaveBeenCalledTimes(1);
    const [, corpo] = atualizarEdicao.mock.calls[0];
    // O campo desabilitado continua devolvendo o valor: o corpo sai com o
    // período que já estava, e o servidor não vê mudança nenhuma.
    expect(corpo.ano).toBe(2026);
    expect(corpo.mes).toBe(7);
    expect(corpo.data_assinatura).toBe('2026-08-14');
  });
});
