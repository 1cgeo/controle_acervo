import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O QUE ESTA TELA DECIDE: agrupar por `bloco_id` e nunca pelo nome, preservar a
// ordem de prioridade que a consulta já deu, e mostrar a proporção SEM esconder
// os números absolutos.
const servico = vi.hoisted(() => ({ resposta: [], falha: null, chamadas: 0 }));

vi.mock('@services/producao-service.js', () => ({
  getSituacaoSubfase: () => {
    servico.chamadas += 1;
    if (servico.falha) return Promise.reject(servico.falha);
    return Promise.resolve(servico.resposta);
  },
}));

const { renderSituacaoSubfase, agruparPorBloco } = await import('./index.js');

const linha = (extra = {}) => ({
  bloco_id: 1,
  bloco: 'Bloco A',
  subfase: 'Edição',
  finalizadas: 6,
  nao_finalizadas: 4,
  ...extra,
});

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
  // O FILTRO VIVE NA URL, e a barra de endereço é estado compartilhado entre os
  // casos deste arquivo: sem zerar, a query que um caso escreveu chegaria ao
  // seguinte como se fosse a rota por onde a pessoa entrou.
  history.replaceState(null, '', '#/producao/situacao_subfase');
  servico.resposta = [];
  servico.falha = null;
  servico.chamadas = 0;
});

const abrir = async (busca = '') => {
  const cleanup = await renderSituacaoSubfase(container, { query: new URLSearchParams(busca) });
  await flush();
  return cleanup;
};

const campoDeBusca = () => container.querySelector('.page__filters input');
const urlDaTela = () => window.location.hash.replace(/^#/, '');

const quadros = () => [...container.querySelectorAll('.situacao-sub__quadro')];

describe('agruparPorBloco: a chave é o id, e nunca o nome', () => {
  test('dois blocos HOMÔNIMOS de lotes diferentes ficam separados', async () => {
    // Bloco é de lote. Agrupar por nome somaria trabalho de projetos distintos
    // num quadro só, sem que nada acusasse.
    const grupos = agruparPorBloco([
      linha({ bloco_id: 1, bloco: 'Bloco 1', subfase: 'Edição' }),
      linha({ bloco_id: 2, bloco: 'Bloco 1', subfase: 'Edição' }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map(g => g.bloco_id)).toEqual([1, 2]);
  });

  test('a ordem é a da resposta, que já vem por prioridade do bloco', async () => {
    const grupos = agruparPorBloco([
      linha({ bloco_id: 9, bloco: 'Z' }),
      linha({ bloco_id: 3, bloco: 'A' }),
      linha({ bloco_id: 9, bloco: 'Z', subfase: 'Validação' }),
    ]);
    // Nem alfabética nem por id: a primeira linha manda.
    expect(grupos.map(g => g.bloco)).toEqual(['Z', 'A']);
    expect(grupos[0].subfases).toHaveLength(2);
  });

  test('lista vazia dá nenhum grupo', async () => {
    expect(agruparPorBloco([])).toEqual([]);
    expect(agruparPorBloco(null)).toEqual([]);
  });
});

describe('situação da subfase: a leitura', () => {
  test('um quadro por bloco, com uma linha por subfase', async () => {
    servico.resposta = [
      linha({ bloco_id: 1, bloco: 'Bloco A', subfase: 'Edição' }),
      linha({ bloco_id: 1, bloco: 'Bloco A', subfase: 'Validação' }),
      linha({ bloco_id: 2, bloco: 'Bloco B', subfase: 'Edição' }),
    ];
    await abrir();

    expect(quadros()).toHaveLength(2);
    expect(quadros()[0].querySelectorAll('.situacao-sub__linha')).toHaveLength(2);
  });

  test('a barra é PROPORCIONAL e os números absolutos ficam ao lado', async () => {
    // "90% de 10" e "90% de 400" pedem decisões diferentes: a barra sozinha não
    // separa as duas.
    servico.resposta = [linha({ finalizadas: 6, nao_finalizadas: 4 })];
    await abrir();

    expect(container.querySelector('.situacao-sub__barra-feita').style.width).toBe('60%');
    expect(container.querySelector('.situacao-sub__pct').textContent).toBe('60%');
    expect(container.querySelector('.situacao-sub__contagem').textContent).toBe('6 de 10');
  });

  test('subfase sem atividade nenhuma não vira divisão por zero', async () => {
    servico.resposta = [linha({ finalizadas: 0, nao_finalizadas: 0 })];
    await abrir();

    expect(container.querySelector('.situacao-sub__pct').textContent).toBe('·');
    expect(container.querySelector('.situacao-sub__barra-feita').style.width).toBe('0%');
  });

  test('o cabeçalho do bloco soma as subfases dele', async () => {
    servico.resposta = [
      linha({ subfase: 'Edição', finalizadas: 6, nao_finalizadas: 4 }),
      linha({ subfase: 'Validação', finalizadas: 2, nao_finalizadas: 8 }),
    ];
    await abrir();

    const total = container.querySelector('.situacao-sub__total').textContent;
    expect(total).toContain('8 de 20');
    expect(total).toContain('40%');
    expect(total).toContain('2 subfase(s)');
  });

  test('a legenda diz o recorte do servidor: só projeto não encerrado', async () => {
    servico.resposta = [linha()];
    await abrir();
    expect(container.textContent).toContain('Só os projetos que ainda não encerraram');
  });

  test('o resumo conta blocos, subfases e atividades', async () => {
    servico.resposta = [
      linha({ bloco_id: 1, finalizadas: 1, nao_finalizadas: 1 }),
      linha({ bloco_id: 2, bloco: 'Bloco B', finalizadas: 3, nao_finalizadas: 0 }),
    ];
    await abrir();

    const texto = container.querySelector('.situacao-sub__resumo').textContent;
    expect(texto).toContain('2 bloco(s)');
    expect(texto).toContain('2 subfase(s)');
    expect(texto).toContain('4 de 5');
  });
});

describe('situação da subfase: filtro, vazio e falha', () => {
  test('a busca filtra por bloco ou por subfase, sem acento', async () => {
    servico.resposta = [
      linha({ bloco_id: 1, bloco: 'Bloco A', subfase: 'Edição' }),
      linha({ bloco_id: 2, bloco: 'Bloco B', subfase: 'Validação' }),
    ];
    await abrir();

    const input = container.querySelector('.page__filters input');
    input.value = 'edicao';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));

    expect(quadros()).toHaveLength(1);
    expect(container.textContent).toContain('Bloco A');
  });

  test('busca sem resultado diz que o texto não achou nada, e não que não há dado', async () => {
    servico.resposta = [linha()];
    await abrir();

    const input = container.querySelector('.page__filters input');
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));

    expect(container.textContent).toContain('Nenhum bloco ou subfase com este texto');
  });

  test('resposta vazia é uma AFIRMAÇÃO sobre o banco, e tem frase própria', async () => {
    servico.resposta = [];
    await abrir();
    expect(container.textContent).toContain('Nenhuma atividade em bloco de projeto em andamento');
  });

  test('erro troca a área pelo estado de erro, e "tentar de novo" repete', async () => {
    servico.falha = new Error('situação indisponível');
    await abrir();
    expect(container.textContent).toContain('situação indisponível');
    expect(container.querySelector('.situacao-sub__resumo').textContent).toBe('');

    servico.falha = null;
    servico.resposta = [linha()];
    container.querySelector('.dashboard-erro button').click();
    await flush();

    expect(servico.chamadas).toBe(2);
    expect(quadros()).toHaveLength(1);
  });
});

// A BUSCA VIVE NA URL: sair da tela para conferir outra coisa e voltar apagava o
// texto digitado, e sem nada na barra de endereço não havia como mandar o
// recorte para outra pessoa.
describe('situação da subfase: a busca vive na URL', () => {
  test('abre já filtrada, e o campo nasce escrito', async () => {
    servico.resposta = [
      linha(),
      linha({ bloco_id: 2, bloco: 'Bloco B', subfase: 'Validação' }),
    ];
    await abrir('busca=validacao');

    expect(campoDeBusca().value).toBe('validacao');
    expect(container.textContent).toContain('Validação');
    expect(container.textContent).not.toContain('Bloco A');
  });

  test('a tela pelada não leva query nenhuma', async () => {
    servico.resposta = [linha()];
    await abrir();
    expect(urlDaTela()).toBe('/producao/situacao_subfase');
  });
});
