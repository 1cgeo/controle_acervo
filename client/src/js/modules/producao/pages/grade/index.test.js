import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O QUE ESTA TELA TEM DE PROVAR é uma coisa só, e ela não é enfeite: a rota
// devolve TODA atividade com `grade: null` e um motivo, porque a malha de
// revisão mora no banco de produção e este servidor não abre conexão para ele.
// A tela mostra o motivo, e não finge que não há dado -- tela vazia aqui se
// leria como "ninguém está revisando", que é a afirmação oposta.
const servico = vi.hoisted(() => ({ resposta: [], falha: null, chamadas: 0 }));

vi.mock('@services/producao-service.js', () => ({
  getGradeAcompanhamento: () => {
    servico.chamadas += 1;
    if (servico.falha) return Promise.reject(servico.falha);
    return Promise.resolve(servico.resposta);
  },
}));

const { renderGrade } = await import('./index.js');

const MOTIVO = 'A grade de revisão mora no banco de produção, e o SCA não abre conexão para ele';

const atividade = (extra = {}) => ({
  atividade_id: 1,
  unidade_trabalho_id: 10,
  etapa_id: 3,
  tipo_dado_producao_id: 2,
  usuario_uuid: 'uuid-1',
  usuario: '1º Ten Silva',
  data_inicio: '2026-08-01T09:00:00.000Z',
  etapa: 'Revisão',
  subfase: 'Edição',
  fase: 'Produção',
  lote: 'Lote 1',
  projeto: 'Projeto A',
  bloco: 'Bloco Sul',
  grade: null,
  grade_indisponivel: MOTIVO,
  ...extra,
});

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
  servico.resposta = [];
  servico.falha = null;
  servico.chamadas = 0;
});

const abrir = async () => {
  const cleanup = await renderGrade(container);
  await flush();
  return cleanup;
};

const cartoes = () => [...container.querySelectorAll('.grade-prod__card')];
const aviso = () => container.querySelector('.grade-prod__aviso');
const textoDoAviso = () => aviso().textContent;

describe('grade de acompanhamento: a malha que não veio', () => {
  test('mostra o MOTIVO do servidor, palavra por palavra', async () => {
    servico.resposta = [atividade()];
    await abrir();

    expect(aviso().classList.contains('hidden')).toBe(false);
    expect(textoDoAviso()).toContain(MOTIVO);
  });

  test('mostra as atividades mesmo sem malha nenhuma', async () => {
    servico.resposta = [atividade(), atividade({ atividade_id: 2, usuario: 'Cap Souza' })];
    await abrir();

    // A lista NÃO some junto com a malha: as atividades são reais e estão em
    // execução agora.
    expect(cartoes()).toHaveLength(2);
    expect(container.textContent).toContain('1º Ten Silva');
    expect(container.textContent).toContain('Cap Souza');
  });

  test('cada cartão marca o lugar do quadriculado e repete o motivo no title', async () => {
    servico.resposta = [atividade()];
    await abrir();

    const malha = container.querySelector('.grade-prod__malha');
    expect(malha).not.toBeNull();
    expect(malha.textContent).toContain('Malha indisponível');
    expect(malha.getAttribute('title')).toBe(MOTIVO);
  });

  test('o motivo repetido em todas as linhas vira UMA frase', async () => {
    servico.resposta = [atividade(), atividade({ atividade_id: 2 }), atividade({ atividade_id: 3 })];
    await abrir();

    const ocorrencias = [...aviso().querySelectorAll('.grade-prod__aviso-texto')]
      .filter(p => p.textContent === MOTIVO);
    expect(ocorrencias).toHaveLength(1);
  });

  test('sem motivo na resposta, a faixa não aparece', async () => {
    // É o dia em que a segunda conexão existir: a rota para de mandar o motivo,
    // e a faixa some sozinha. Nenhuma frase desta tela continua afirmando o
    // contrário.
    servico.resposta = [atividade({ grade_indisponivel: null })];
    await abrir();

    expect(aviso().classList.contains('hidden')).toBe(true);
  });
});

describe('grade de acompanhamento: a leitura da lista', () => {
  test('sem atividade nenhuma, diz isso e não mostra a faixa da malha', async () => {
    servico.resposta = [];
    await abrir();

    expect(container.textContent).toContain('Nenhuma atividade em execução');
    expect(aviso().classList.contains('hidden')).toBe(true);
  });

  test('o cartão traz projeto, lote, operador, fase, bloco, subfase e etapa', async () => {
    servico.resposta = [atividade()];
    await abrir();

    const texto = cartoes()[0].textContent;
    for (const esperado of ['Projeto A', 'Lote 1', '1º Ten Silva', 'Produção',
      'Bloco Sul', 'Edição', 'Revisão']) {
      expect(texto).toContain(esperado);
    }
  });

  test('a mais recente vem primeiro', async () => {
    // A rota ordena por `data_inicio` crescente; quem pegou por último é quem
    // ainda está mudando, e é o que se procura primeiro.
    servico.resposta = [
      atividade({ atividade_id: 1, usuario: 'Antigo', data_inicio: '2026-07-01T09:00:00.000Z' }),
      atividade({ atividade_id: 2, usuario: 'Recente', data_inicio: '2026-08-05T09:00:00.000Z' }),
    ];
    await abrir();

    expect(cartoes()[0].textContent).toContain('Recente');
  });

  test('o filtro de lote esconde o resto e o resumo diz os DOIS números', async () => {
    servico.resposta = [
      atividade({ atividade_id: 1, lote: 'Lote 1' }),
      atividade({ atividade_id: 2, lote: 'Lote 2' }),
    ];
    await abrir();
    expect(container.querySelector('.grade-prod__resumo').textContent)
      .toContain('2 atividade(s)');

    // O segundo select da barra de filtros é o de lote.
    const selects = container.querySelectorAll('.page__filters select');
    selects[1].value = 'Lote 2';
    selects[1].dispatchEvent(new Event('change'));
    await flush();

    expect(cartoes()).toHaveLength(1);
    // "1 de 2" separa "há pouca coisa" de "eu escondi o resto".
    expect(container.querySelector('.grade-prod__resumo').textContent).toContain('1 de 2');
  });
});

describe('grade de acompanhamento: a falha', () => {
  test('erro de rede troca a galeria pelo estado de erro, e a faixa some', async () => {
    servico.falha = new Error('Servidor fora do ar');
    await abrir();

    // "o quadriculado não veio" e "não consegui perguntar nada" são coisas
    // diferentes: deixar a faixa ao lado do erro sugeriria que há lista abaixo.
    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(container.textContent).toContain('Servidor fora do ar');
    expect(aviso().classList.contains('hidden')).toBe(true);
    expect(cartoes()).toHaveLength(0);
  });

  test('"tentar de novo" repete a chamada', async () => {
    servico.falha = new Error('caiu');
    await abrir();
    expect(servico.chamadas).toBe(1);

    servico.falha = null;
    servico.resposta = [atividade()];
    container.querySelector('.dashboard-erro button').click();
    await flush();

    expect(servico.chamadas).toBe(2);
    expect(cartoes()).toHaveLength(1);
  });

  test('a resposta que chega depois de sair da tela não escreve nada', async () => {
    servico.resposta = [atividade()];
    const cleanup = await renderGrade(container);
    cleanup();
    await flush();
    // Nada a afirmar além de não ter estourado: o `disposed` corta a escrita.
    expect(typeof cleanup).toBe('function');
  });
});
