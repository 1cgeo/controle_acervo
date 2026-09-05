import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@services/producao-service.js', () => ({
  getAtividadesEmExecucao: vi.fn(),
  getUltimasAtividadesFinalizadas: vi.fn(),
}));

import { renderAtividades, duracaoTexto, duracaoEntre } from './index.js';
import * as servico from '@services/producao-service.js';

const LINHA = {
  atividade_id: 41,
  projeto_id: 1,
  projeto_nome: 'Mapeamento Sistemático',
  lote_id: 3,
  lote: 'Lote 2023 A',
  linha_producao_nome: 'Carta Topográfica',
  fase_nome: 'Edição',
  subfase_nome: 'Edição Vetorial',
  etapa_nome: 'Revisão',
  bloco: 'Bloco 1',
  unidade_trabalho_id: 900,
  unidade_trabalho_nome: 'UT 2965-1',
  usuario_id: 5,
  usuario_uuid: 'abc',
  usuario: '1º Ten Silva',
  data_inicio: '2026-08-07T12:00:00.000Z',
  data_fim: null,
  duracao: { days: 1, hours: 3, minutes: 20, seconds: 5 },
};

// A seta de ordenacao (▲/▼) mora dentro do proprio <th>: sem tira-la, o
// cabecalho da coluna ordenada nao casaria com o rotulo escrito no codigo.
const cabecalhos = (container) =>
  Array.from(container.querySelectorAll('thead th'))
    .map(th => th.textContent.replace(/[▲▼]/g, '').trim());

const abas = (container) =>
  Array.from(container.querySelectorAll('.tabs > .tabs__item'));

beforeEach(() => {
  servico.getAtividadesEmExecucao.mockResolvedValue([LINHA]);
  servico.getUltimasAtividadesFinalizadas.mockResolvedValue([
    { ...LINHA, atividade_id: 40, data_fim: '2026-08-07T12:45:00.000Z' },
  ]);
});

describe('duracaoTexto', () => {
  test('o objeto de interval do pg vira texto de gente', () => {
    // `String(objeto)` viraria "[object Object]" na celula.
    expect(duracaoTexto({ days: 1, hours: 3, minutes: 20, seconds: 5 })).toBe('1 d 3 h 20 min');
  });

  test('segundos so aparecem quando sao a unica unidade', () => {
    expect(duracaoTexto({ seconds: 42 })).toBe('42 s');
    expect(duracaoTexto({ minutes: 2, seconds: 42 })).toBe('2 min');
  });

  test('anos e meses entram como dias, em vez de sumirem', () => {
    expect(duracaoTexto({ years: 1, days: 2 })).toBe('367 d');
    expect(duracaoTexto({ months: 2 })).toBe('60 d');
  });

  test('texto cru volta como veio, e ausencia vira travessao curto', () => {
    expect(duracaoTexto('P1DT3H')).toBe('P1DT3H');
    expect(duracaoTexto(null)).toBe('-');
    expect(duracaoTexto(undefined)).toBe('-');
  });
});

describe('duracaoEntre', () => {
  test('mede do inicio ao fim, e nao de agora', () => {
    // O `duracao` do servidor e CURRENT_TIMESTAMP - data_inicio nas DUAS listas.
    // Numa atividade fechada isso e "ha quanto tempo ela COMECOU", que numa
    // coluna chamada Duracao mentiria.
    expect(duracaoEntre('2026-08-07T12:00:00.000Z', '2026-08-07T12:45:00.000Z')).toBe('45 min');
    expect(duracaoEntre('2026-08-01T00:00:00.000Z', '2026-08-03T06:30:00.000Z')).toBe('2 d 6 h 30 min');
  });

  test('sem uma das pontas, ou com fim antes do inicio, nao inventa numero', () => {
    expect(duracaoEntre(null, '2026-08-07T12:00:00.000Z')).toBe('-');
    expect(duracaoEntre('2026-08-07T12:00:00.000Z', null)).toBe('-');
    expect(duracaoEntre('2026-08-07T12:00:00.000Z', '2026-08-07T11:00:00.000Z')).toBe('-');
  });
});

describe('renderAtividades', () => {
  test('abre na aba de execucao e busca SO ela', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividades(container, { params: {}, query: new URLSearchParams() });

    expect(container.querySelector('.page__title').textContent).toBe('Atividades');
    expect(abas(container).map(b => b.textContent)).toEqual(['Em execução', 'Últimas finalizadas']);

    expect(servico.getAtividadesEmExecucao).toHaveBeenCalled();
    // A aba fechada nao paga a viagem ao banco.
    expect(servico.getUltimasAtividadesFinalizadas).not.toHaveBeenCalled();

    expect(cabecalhos(container)).toEqual([
      'Projeto', 'Lote', 'Bloco', 'Fase', 'Subfase', 'Etapa',
      'Unidade de trabalho', 'Usuário', 'Início', 'Há',
    ]);
    expect(container.querySelector('.producao-atividades__resumo').textContent)
      .toBe('1 atividade em execução agora.');

    cleanup();
  });

  test('a aba de finalizadas troca "Há" por Fim e Duração', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividades(container);

    abas(container)[1].click();
    await flush();

    expect(servico.getUltimasAtividadesFinalizadas).toHaveBeenCalled();
    expect(cabecalhos(container).slice(-3)).toEqual(['Início', 'Fim', 'Duração']);

    const linha = Array.from(container.querySelectorAll('tbody tr td')).map(td => td.textContent.trim());
    // 45 minutos entre inicio e fim, e NAO o `duracao` de um dia que o servidor
    // manda por reusar o mesmo SQL das duas listas.
    expect(linha[linha.length - 1]).toBe('45 min');

    cleanup();
  });

  // O RESUMO NAO REPETE O ESTADO VAZIO. Ele fica dois centimetros acima do
  // `emptyMessage` da tabela, e a frase antiga repetia "Nenhuma atividade
  // finalizada recentemente" palavra por palavra, empilhada. O que so o resumo
  // diz e a regua do limite.
  test('sem finalizada nenhuma, o resumo diz o limite e nao repete a tabela', async () => {
    servico.getUltimasAtividadesFinalizadas.mockResolvedValue([]);

    const container = document.createElement('div');
    const cleanup = await renderAtividades(container);

    abas(container)[1].click();
    await flush();

    const resumo = container.querySelector('.producao-atividades__resumo').textContent;
    expect(resumo).toBe('A lista traz as 20 últimas finalizadas, e o limite é do servidor.');
    // A tabela continua dizendo o estado vazio, e ela sozinha.
    expect(container.textContent).toContain('Nenhuma atividade finalizada recentemente');
    expect(resumo).not.toContain('Nenhuma atividade finalizada recentemente');

    cleanup();
  });

  test('a falha de uma aba vira estado de erro dela, com a mensagem do servidor', async () => {
    servico.getAtividadesEmExecucao.mockRejectedValue(new Error('Falha ao consultar o banco'));

    const container = document.createElement('div');
    const cleanup = await renderAtividades(container);

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toContain('Falha ao consultar o banco');

    // A outra aba continua alcancavel, e nao herdou a falha.
    abas(container)[1].click();
    await flush();
    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);

    cleanup();
  });

  test('o "tentar de novo" do estado de erro devolve a tabela', async () => {
    servico.getAtividadesEmExecucao.mockRejectedValueOnce(new Error('sem rede'));

    const container = document.createElement('div');
    const cleanup = await renderAtividades(container);

    container.querySelector('.dashboard-erro .btn').click();
    await flush();

    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);

    cleanup();
  });

  test('Atualizar recarrega a aba ativa sem remontar a tabela', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividades(container);

    const antes = servico.getAtividadesEmExecucao.mock.calls.length;
    container.querySelector('.page__actions .btn').click();
    await flush();

    expect(servico.getAtividadesEmExecucao.mock.calls.length).toBe(antes + 1);
    // A aba inativa continua sem ser buscada.
    expect(servico.getUltimasAtividadesFinalizadas).not.toHaveBeenCalled();

    cleanup();
  });

  test('lista vazia diz que nao ha atividade, e nao que houve erro', async () => {
    servico.getAtividadesEmExecucao.mockResolvedValue([]);

    const container = document.createElement('div');
    const cleanup = await renderAtividades(container);

    expect(container.textContent).toContain('Não há atividade em execução no momento');
    expect(container.querySelector('.dashboard-erro')).toBeNull();

    cleanup();
  });
});
