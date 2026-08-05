// O ESTADO DE ERRO do painel de historico.
//
// O defeito que este arquivo prende: falhando a PRIMEIRA carga, o painel escrevia
// a mensagem crua na mesma classe do estado VAZIO (`data-table__empty`), sem
// botao nenhum. "Nao consegui perguntar" saia com a cara de "este registro nunca
// mudou", e a unica saida era recarregar a pagina inteira. O padrao da casa e o
// `estado-erro.js`, com "Tentar de novo".

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const getHistorico = vi.fn();

vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: (...args) => getHistorico(...args),
}));

const { criarHistorico } = await import('./historico.js');

function eventos() {
  return [
    { id: 1, data_evento: '2026-08-01T10:00:00Z', usuario_nome: 'Cap Fulano', operacao: 'I', mudancas: [] },
  ];
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

const erroNaTela = (painel) => painel.element.querySelector('.dashboard-erro');
const botaoTentar = (painel) =>
  [...painel.element.querySelectorAll('button')].find(b => b.textContent.includes('Tentar de novo'));

beforeEach(() => {
  getHistorico.mockReset();
});

afterEach(() => {
  document.body.textContent = '';
});

describe('criarHistorico: a falha da primeira carga', () => {
  test('vira o estado de erro padrao, com a mensagem do servidor', async () => {
    getHistorico.mockRejectedValue(new Error('Banco indisponível'));

    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    const erro = erroNaTela(painel);
    expect(erro).not.toBeNull();
    expect(erro.getAttribute('role')).toBe('alert');
    expect(erro.textContent).toContain('Banco indisponível');
    // NAO pode sair como estado vazio: "nao houve" e "nao sei" sao respostas
    // opostas, e so uma delas pede acao.
    expect(painel.element.querySelector('.data-table__empty')).toBeNull();
  });

  test('"Tentar de novo" refaz a busca e monta a tabela', async () => {
    getHistorico.mockRejectedValueOnce(new Error('Banco indisponível'));

    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    const botao = botaoTentar(painel);
    expect(botao).toBeDefined();

    getHistorico.mockResolvedValue(eventos());
    botao.click();
    await esperar();

    expect(getHistorico).toHaveBeenCalledTimes(2);
    expect(erroNaTela(painel)).toBeNull();
    expect(painel.element.querySelector('.data-table-wrapper')).not.toBeNull();
  });

  // CONTROLE NEGATIVO: a carga que da certo nao pode pintar erro nenhum. Sem
  // esta metade, um painel que mostrasse o estado de erro SEMPRE passaria nos
  // dois testes acima.
  test('a carga que da certo NAO mostra estado de erro', async () => {
    getHistorico.mockResolvedValue(eventos());

    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    expect(erroNaTela(painel)).toBeNull();
    expect(painel.element.querySelector('.data-table-wrapper')).not.toBeNull();
  });
});

describe('criarHistorico: duas cargas ao mesmo tempo', () => {
  test('a resposta LENTA que chega tarde nao repoe a lista anterior', async () => {
    const antiga = [{ id: 1, data_evento: '2026-08-01T10:00:00Z', usuario_nome: 'ANTIGA', operacao: 'I', mudancas: [] }];
    const nova = [{ id: 2, data_evento: '2026-08-02T10:00:00Z', usuario_nome: 'NOVA', operacao: 'I', mudancas: [] }];

    // A primeira chamada demora; a segunda responde na hora.
    getHistorico
      .mockImplementationOnce(() => new Promise(r => setTimeout(() => r(antiga), 30)))
      .mockImplementationOnce(() => Promise.resolve(nova));

    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);

    painel.recarregar();
    await esperar();
    await new Promise(r => setTimeout(r, 50));

    const texto = painel.element.textContent;
    expect(texto).toContain('NOVA');
    expect(texto).not.toContain('ANTIGA');
  });
});
