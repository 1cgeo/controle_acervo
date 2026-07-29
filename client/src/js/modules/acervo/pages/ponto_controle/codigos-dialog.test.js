import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  getCodigosDisponiveis: vi.fn(),
}));

import { abrirCodigosDisponiveis } from './codigos-dialog.js';
import { getCodigosDisponiveis } from '@modules/acervo/services/ponto-controle-service.js';

const RESUMO = {
  grupos: [
    { uf: 'RS', tipo: 'HV', usados: 3392, maior_usado: 4019 },
    { uf: 'RS', tipo: 'BASE', usados: 12, maior_usado: 12 },
    { uf: 'SC', tipo: 'HV', usados: 72, maior_usado: 159 },
  ],
};

const RS_HV = {
  uf: 'RS',
  tipo: 'HV',
  usados: 3392,
  maior_usado: 4019,
  total_buracos: 627,
  buracos: ['RS-HV-7', 'RS-HV-9'],
  proximos: ['RS-HV-4020', 'RS-HV-4021'],
  grupos: RESUMO.grupos,
};

/** Espera a fila de microtarefas: o diálogo carrega em promessa solta. */
const assentar = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  document.body.replaceChildren();
  getCodigosDisponiveis.mockReset();
  getCodigosDisponiveis.mockImplementation(params =>
    Promise.resolve(params && params.uf ? RS_HV : RESUMO));
});

describe('diálogo de códigos disponíveis', () => {
  test('lista as UFs que TÊM ponto, e não as 27 do país', async () => {
    abrirCodigosDisponiveis();
    await assentar();

    const opcoes = [...document.querySelectorAll('select')][0].options;
    expect([...opcoes].map(o => o.value)).toEqual(['RS', 'SC']);
  });

  test('separa buraco de próximo, e diz quantos buracos existem ao todo', async () => {
    abrirCodigosDisponiveis();
    await assentar();

    const texto = document.body.textContent;
    expect(texto).toContain('Buracos na numeração (2)');
    expect(texto).toContain('Próximos da sequência (2)');
    // O total do servidor (627) tem de aparecer, senão a tela diria que são 2.
    expect(texto).toContain('627');
    expect(texto).toContain('RS-HV-7');
    expect(texto).toContain('RS-HV-4020');
  });

  test('o resumo diz quantos pontos há e qual é o maior', async () => {
    abrirCodigosDisponiveis();
    await assentar();
    expect(document.body.textContent).toContain('o maior é RS-HV-4019');
  });

  test('trocar de tipo consulta de novo, com o tipo escolhido', async () => {
    abrirCodigosDisponiveis();
    await assentar();
    getCodigosDisponiveis.mockClear();

    const tipoSelect = [...document.querySelectorAll('select')][1];
    tipoSelect.value = 'BASE';
    tipoSelect.dispatchEvent(new Event('change'));
    await assentar();

    expect(getCodigosDisponiveis).toHaveBeenCalledWith(
      expect.objectContaining({ uf: 'RS', tipo: 'BASE' })
    );
  });

  test('UF sem ponto nenhum não quebra a tela', async () => {
    getCodigosDisponiveis.mockResolvedValue({ grupos: [] });
    abrirCodigosDisponiveis();
    await assentar();
    expect(document.body.textContent).toContain('ainda não tem ponto de controle');
  });

  test('erro do servidor aparece no corpo, sem derrubar o diálogo', async () => {
    getCodigosDisponiveis.mockImplementation(params => (params && params.uf
      ? Promise.reject(new Error('banco fora'))
      : Promise.resolve(RESUMO)));

    abrirCodigosDisponiveis();
    await assentar();

    expect(document.body.textContent).toContain('banco fora');
    expect(document.querySelectorAll('select').length).toBe(2);
  });
});
