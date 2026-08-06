import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A GRADE do PIT nao se remonta.
//
// O que estes casos FIXAM, e que o `grade.innerHTML = ''` desfazia:
//  - trocar o modo Planejar/Executar nao muda numero nenhum da grade. Ele so
//    decide qual dos dois o CLIQUE edita, entao refazer a tabela inteira era
//    trabalho jogado fora que ainda por cima movia a tela;
//  - o campo aberto numa celula sobrevive a troca de modo. Quem esta digitando
//    perde o valor e o foco quando a linha e recriada por baixo;
//  - a tabela e as linhas sao os MESMOS nos entre desenhos.

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getGradePit: vi.fn(() => Promise.resolve([])),
    getAnosMetaPit: vi.fn(() => Promise.resolve([2026])),
    salvarExecucaoPit: vi.fn(() => Promise.resolve({ id: 1 })),
  };
});

import { renderExecucaoPit } from '@pages/execucao-pit/index.js';
import { getGradePit, salvarExecucaoPit } from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

// UMA LINHA POR ITEM desde 1.30.0. A linha de grupo da Meta 1 é sintetizada pela
// tela a partir de `numero_meta` e `nome`, e por isso não está aqui: o que este
// arquivo mede é o nó do ITEM sobreviver à recarga.
const GRADE = [
  {
    meta_id: '2', ano: 2026, numero_meta: 1, nome: 'Produção de Geoinformação',
    item: '1.1',
    descricao: 'Produzir Carta Topográfica 1:25.000',
    quantidade_prevista: 24, unidade: 'carta',
    meses: [
      { id: '10', mes: 4, planejada: 4, realizada: null },
      { id: '11', mes: 5, planejada: 1, realizada: 6 },
    ],
    realizado: 6, planejado: 5,
  },
];

const linhas = (c) => [...c.querySelectorAll('tbody tr')];
const celulas = (tr) => [...tr.querySelectorAll('.grade-pit__celula')];

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderExecucaoPit(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

/** Troca o alternador Planejar/Executar como a pessoa o troca. */
function trocarModo(container, valor) {
  const seletores = [...container.querySelectorAll('select')];
  const modo = seletores[seletores.length - 1];
  modo.value = valor;
  modo.dispatchEvent(new Event('change'));
}

describe('a grade do PIT não se remonta', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-02T12:00:00'));
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('trocar o modo não recria a tabela nem as linhas', async () => {
    getGradePit.mockResolvedValueOnce(GRADE);
    const { container, cleanup } = await montar();

    const tabela = container.querySelector('.grade-pit__tabela');
    const [grupo, item] = linhas(container);
    const maio = celulas(item)[4];

    trocarModo(container, 'quantidade_planejada');
    await flush();

    expect(container.querySelector('.grade-pit__tabela')).toBe(tabela);
    expect(linhas(container)[0]).toBe(grupo);
    expect(linhas(container)[1]).toBe(item);
    // A célula também: a cor e os dois números não dependem do modo.
    expect(celulas(linhas(container)[1])[4]).toBe(maio);

    cleanup();
  });

  // O CAMPO ABERTO FECHA na troca de modo, e isso MUDOU em 2026-08-06.
  //
  // Antes ele sobrevivia, e era um defeito escondido: o campo não carrega o modo
  // em que foi aberto, e `gravar` lê o modo VIGENTE. Quem digitava 9 no
  // realizado de abril, trocava para Planejar e saía da célula gravava 9 no
  // PLANEJADO de abril, sem erro nenhum e sem nada na tela dizendo isso.
  //
  // Fechar sem gravar é a saída segura: o que se perde é uma digitação que a
  // pessoa acabou de fazer e vê desaparecer, e não um número gravado na coluna
  // errada, que ninguém vê.
  test('o campo aberto fecha na troca de modo, sem gravar na coluna errada', async () => {
    getGradePit.mockResolvedValueOnce(GRADE);
    const { container, cleanup } = await montar();

    const abril = celulas(linhas(container)[1])[3];
    abril.click();
    await flush();

    const input = abril.querySelector('input');
    expect(input).not.toBeNull();
    input.value = '9';

    trocarModo(container, 'quantidade_planejada');
    await flush();

    expect(container.querySelector('.grade-pit__edicao')).toBeNull();
    // E NADA foi para o servidor: o `9` era do realizado, e o modo agora é
    // outro. Gravar aqui seria gravar no campo que a pessoa não escolheu.
    expect(salvarExecucaoPit).not.toHaveBeenCalled();
    // A célula continua sendo o MESMO nó, com os números de antes: fechar o
    // campo não pode custar a reconciliação.
    expect(celulas(linhas(container)[1])[3]).toBe(abril);

    cleanup();
  });

  test('a linha que continua no ano mantém o nó quando a grade recarrega', async () => {
    getGradePit.mockResolvedValueOnce(GRADE);
    const { container, cleanup } = await montar();

    const item = linhas(container)[1];

    // O ano muda, e a meta 1.1 continua lá com outro número. Só o que mudou se
    // repinta; o nó da linha fica.
    const outroAno = [
      { ...GRADE[0], meses: [{ id: '10', mes: 4, planejada: 4, realizada: 4 }], realizado: 4 },
    ];
    getGradePit.mockResolvedValueOnce(outroAno);
    const ano = container.querySelector('select');
    ano.value = '2026';
    ano.dispatchEvent(new Event('change'));
    await flush();

    expect(linhas(container)[1]).toBe(item);
    expect(celulas(item)[3].querySelector('.grade-pit__realizado').textContent).toBe('4');

    cleanup();
  });
});
