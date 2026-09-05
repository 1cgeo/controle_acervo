import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// PIT DA PRODUÇÃO (#/producao/pit).
//
// O que estes casos prendem:
//  - a FRASE DA PROCEDÊNCIA está na TELA, e não só no comentário do arquivo.
//    Existem duas telas de PIT neste sistema, com fontes diferentes por
//    desenho, e quem as abre no mesmo dia precisa ler ali por que os dois
//    números não batem e por que NÃO SE SOMAM;
//  - `·` é mês fora da grade e `0` é mês fechado sem entrega. A grade do ano
//    CORRENTE para no mês atual, então dezembro não vem em agosto: pintá-lo
//    como zero afirmaria que se conferiu dezembro;
//  - o servidor manda o produto cartesiano (lote x mês), e a tela agrupa por
//    lote dentro do projeto;
//  - as duas seções carregam SEPARADAS, cada uma com o próprio `catch`.

vi.mock('@services/producao-service.js', async () => {
  const real = await vi.importActual('@services/producao-service.js');
  return {
    ...real,
    getPitProducao: vi.fn(() => Promise.resolve([])),
    getPitSubfaseProducao: vi.fn(() => Promise.resolve([])),
  };
});

import { renderPitProducao, agruparPitPorProjeto, agruparPitPorSubfase } from './index.js';
import { getPitProducao, getPitSubfaseProducao } from '@services/producao-service.js';

// Um projeto, um lote, meta 12, com a grade parando em março: é o retrato do
// ano corrente consultado em março.
const POR_LOTE = [
  { projeto: 'Mapeamento RS', lote_id: '3', lote: 'Lote 1', meta: 12, mes: 1, finalizadas: 2 },
  { projeto: 'Mapeamento RS', lote_id: '3', lote: 'Lote 1', meta: 12, mes: 2, finalizadas: 0 },
  { projeto: 'Mapeamento RS', lote_id: '3', lote: 'Lote 1', meta: 12, mes: 3, finalizadas: 1 },
];

const POR_SUBFASE = [
  { lote_id: '3', lote: 'Lote 1', subfase_id: '11', subfase: 'Extração', mes: 1, quantidade: 2 },
  { lote_id: '3', lote: 'Lote 1', subfase_id: '12', subfase: 'Validação', mes: 3, quantidade: 1 },
];

async function montar() {
  const container = document.createElement('div');
  const cleanup = renderPitProducao(container);
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  getPitProducao.mockResolvedValue(POR_LOTE);
  getPitSubfaseProducao.mockResolvedValue(POR_SUBFASE);
});

describe('agruparPitPorProjeto', () => {
  test('junta os meses do lote numa linha só, e soma o total', () => {
    const [grupo] = agruparPitPorProjeto(POR_LOTE);
    expect(grupo.projeto).toBe('Mapeamento RS');
    expect(grupo.lotes).toHaveLength(1);
    expect(grupo.lotes[0].total).toBe(3);
    expect(grupo.lotes[0].meta).toBe(12);
  });

  // O CASO QUE DECIDE A COLUNA: mês ausente é `null`, e mês com zero é `0`.
  test('mês fora da grade fica nulo, e mês zerado fica zero', () => {
    const [grupo] = agruparPitPorProjeto(POR_LOTE);
    expect(grupo.lotes[0].meses[1]).toBe(0);   // fevereiro veio zerado
    expect(grupo.lotes[0].meses[11]).toBeNull(); // dezembro não veio
  });

  test('lotes de projetos diferentes não se misturam', () => {
    const grupos = agruparPitPorProjeto([
      ...POR_LOTE,
      { projeto: 'Outro', lote_id: '9', lote: 'Lote 9', meta: 4, mes: 1, finalizadas: 1 },
    ]);
    expect(grupos).toHaveLength(2);
  });
});

describe('agruparPitPorSubfase', () => {
  // A CHAVE É O PAR (lote_id, subfase_id): a mesma subfase existe em lotes
  // diferentes, e juntá-los somaria trabalho de lotes que não se falam.
  test('a mesma subfase em lotes diferentes fica em linhas diferentes', () => {
    const linhas = agruparPitPorSubfase([
      { lote_id: '3', lote: 'Lote 1', subfase_id: '11', subfase: 'Extração', mes: 1, quantidade: 2 },
      { lote_id: '4', lote: 'Lote 2', subfase_id: '11', subfase: 'Extração', mes: 1, quantidade: 5 },
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map(l => l.total)).toEqual([2, 5]);
  });

  // O CASO QUE DECIDE A CHAVE. Os RÓTULOS não são únicos: `acervo.lote` só é
  // UNIQUE em `(projeto_id, pit)`, então dois projetos têm um "Lote 1" cada, e
  // `producao.subfase` é UNIQUE em `(nome, fase_id)`, então "Edição" existe em
  // mais de uma linha de produção. Agrupando por nome, as entregas dos dois
  // caem numa linha só e a tela mostra um lote com o dobro do que ele entregou,
  // enquanto a seção "Por lote" logo acima, que agrupa por `lote_id`, mostra os
  // dois separados.
  test('lotes HOMÔNIMOS de projetos diferentes não se fundem', () => {
    const linhas = agruparPitPorSubfase([
      { lote_id: '3', lote: 'Lote 1', subfase_id: '11', subfase: 'Edição', mes: 1, quantidade: 2 },
      { lote_id: '9', lote: 'Lote 1', subfase_id: '11', subfase: 'Edição', mes: 1, quantidade: 5 },
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map(l => l.total)).toEqual([2, 5]);
    // E os dois continuam se chamando "Lote 1" na tela: o que mudou foi a
    // chave, e não o rótulo.
    expect(linhas.map(l => l.lote)).toEqual(['Lote 1', 'Lote 1']);
  });

  // O GÊMEO PELO OUTRO LADO: mesmo lote, mesmo NOME de subfase, subfases
  // diferentes (a "Edição" da Carta Topográfica e a do CDGV).
  test('subfases HOMÔNIMAS do mesmo lote não se fundem', () => {
    const linhas = agruparPitPorSubfase([
      { lote_id: '3', lote: 'Lote 1', subfase_id: '11', subfase: 'Edição', mes: 2, quantidade: 4 },
      { lote_id: '3', lote: 'Lote 1', subfase_id: '27', subfase: 'Edição', mes: 2, quantidade: 7 },
    ]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map(l => l.total)).toEqual([4, 7]);
  });
});

describe('a tela', () => {
  test('escreve de onde vem o número e aponta a outra tela de PIT', async () => {
    const { container, cleanup } = await montar();
    const nota = container.querySelector('.pit-producao__procedencia');

    expect(nota.textContent).toMatch(/da PRODUÇÃO/);
    expect(nota.textContent).toMatch(/não se somam/);
    // O caminho para a outra conta fica clicável: quem chegou aqui procurando o
    // número do relatório tem de encontrar a tela que o produz.
    expect(nota.querySelector('a').getAttribute('href')).toBe('#/execucao_pit');
    cleanup();
  });

  test('desenha uma tabela por projeto, com meta, total e percentual', async () => {
    const { container, cleanup } = await montar();

    const projetos = container.querySelectorAll('.pit-producao__projeto');
    expect(projetos).toHaveLength(1);
    expect(projetos[0].querySelector('.pit-producao__projeto-nome').textContent)
      .toBe('Mapeamento RS');

    const totais = [...projetos[0].querySelectorAll('tbody .pit-producao__total')]
      .map(td => td.textContent);
    // meta, total, percentual
    expect(totais).toEqual(['12', '3', '25%']);
    cleanup();
  });

  test('mês fora da grade sai como · e mês zerado sai como 0', async () => {
    const { container, cleanup } = await montar();
    const celulas = [...container.querySelectorAll('.pit-producao__projeto tbody .pit-producao__celula')];

    expect(celulas).toHaveLength(12);
    expect(celulas[1].textContent).toBe('0');
    expect(celulas[11].textContent).toBe('·');
    // E o mês que não veio se distingue no olho, e não só no texto.
    expect(celulas[11].className).toMatch(/--fora/);
    expect(celulas[1].className).not.toMatch(/--fora/);
    cleanup();
  });

  test('a seção por subfase abre a mesma entrega pela subfase', async () => {
    const { container, cleanup } = await montar();
    const secoes = container.querySelectorAll('.pit-producao__secao');
    const subfase = secoes[1];

    const linhas = subfase.querySelectorAll('tbody tr');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain('Extração');
    cleanup();
  });

  // A REGRA DA CASA: a chamada que falha carrega SOZINHA.
  test('a falha do detalhe por subfase não apaga a tabela por lote', async () => {
    getPitSubfaseProducao.mockRejectedValue(new Error('Falha no banco'));
    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('.pit-producao__projeto')).toHaveLength(1);
    expect(container.querySelector('.dashboard-erro')).toBeTruthy();
    cleanup();
  });

  test('ano sem meta explica o vazio, e não fica em branco', async () => {
    getPitProducao.mockResolvedValue([]);
    const { container, cleanup } = await montar();
    expect(container.textContent).toMatch(/Nenhum lote com meta do PIT em/);
    cleanup();
  });

  test('trocar o ano refaz as DUAS consultas', async () => {
    const { container, cleanup } = await montar();
    getPitProducao.mockClear();
    getPitSubfaseProducao.mockClear();

    const seletor = container.querySelector('.page__filters select');
    // O filtro começa no ano corrente e oferece "+ Outro ano…"; aqui o ano
    // anterior entra à mão, que é o caminho de quem consulta um ano fechado.
    const anterior = new Date().getFullYear() - 1;
    seletor.appendChild(Object.assign(document.createElement('option'), {
      value: String(anterior), textContent: String(anterior),
    }));
    seletor.value = String(anterior);
    seletor.dispatchEvent(new Event('change'));
    await flush();

    expect(getPitProducao).toHaveBeenCalledWith(anterior);
    expect(getPitSubfaseProducao).toHaveBeenCalledWith(anterior);
    cleanup();
  });
});
