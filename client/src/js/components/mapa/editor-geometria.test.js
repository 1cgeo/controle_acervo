import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Editor de geometria do produto.
 *
 * O que estas provas guardam e a REGRA CENTRAL do desenho: o modo de definir o
 * poligono sai da ESCALA, e nao da vontade de quem cadastra. Folha do SCN nasce
 * do identificador e nao pode ser desenhada a mao; fora do SCN vale o contrario.
 *
 * Sem isso guardado, a proxima pessoa a mexer nesta tela "conserta" a falta do
 * botao de desenhar no modo SCN, e os invariantes 1d/1e/1g/1h/1i do servidor
 * voltam a ter como falhar em produto novo.
 */

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getFolha: vi.fn(),
}));

import { getFolha } from '@modules/acervo/services/acervo-service.js';
import { criarEditorGeometria, ehEscalaScn } from './editor-geometria.js';

const FOLHA_25K = {
  inom: 'SF-22-Y-D-II-1-NE',
  mi: '2965-1-NE',
  sem_mi: false,
  tipo_escala_id: 1,
  geom: 'SRID=4674;POLYGON((-50 -25, -49.875 -25, -49.875 -24.875, -50 -24.875, -50 -25))',
};

const QUADRADO_EWKT =
  'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))';

function textoDe(editor) {
  return editor.element.textContent;
}

/** Dispara o input como o navegador faria, para o ouvinte do campo rodar. */
function digitar(input, valor) {
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  getFolha.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ehEscalaScn', () => {
  test('as quatro escalas sistematicas sao SCN', () => {
    expect(ehEscalaScn(1)).toBe(true);
    expect(ehEscalaScn(2)).toBe(true);
    expect(ehEscalaScn(3)).toBe(true);
    expect(ehEscalaScn(4)).toBe(true);
  });

  test('a escala personalizada (5) nao e SCN', () => {
    expect(ehEscalaScn(5)).toBe(false);
  });

  test('valor ausente ou estranho nao vira SCN por acidente', () => {
    expect(ehEscalaScn(null)).toBe(false);
    expect(ehEscalaScn(undefined)).toBe(false);
    expect(ehEscalaScn(0)).toBe(false);
    expect(ehEscalaScn('nao e numero')).toBe(false);
  });
});

describe('modo SCN (escalas 1 a 4)', () => {
  test('pede o identificador e NAO oferece desenhar nem cantos', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 1 });

    expect(textoDe(editor)).toContain('INOM');
    expect(textoDe(editor)).toContain('MI');
    // O botao de desenhar e os campos de canto nao existem aqui: e essa
    // ausencia que fecha os invariantes 1d/1e/1g/1h/1i na origem. A asserção é
    // sobre a ESTRUTURA, e não sobre a frase: reescrever o texto de ajuda não
    // pode fazer este teste passar a mentir.
    expect(textoDe(editor)).not.toContain('Desenhar área');
    expect(editor.element.querySelectorAll('input[type="number"]').length).toBe(0);

    editor._cleanup();
  });

  test('calcular a folha preenche o outro identificador e vira a resposta', async () => {
    getFolha.mockResolvedValue(FOLHA_25K);
    const editor = criarEditorGeometria({ tipoEscalaId: 1 });

    const inomInput = editor.element.querySelectorAll('input[type="text"]')[0];
    digitar(inomInput, 'SF-22-Y-D-II-1-NE');
    editor.element.querySelector('button').click();
    await vi.waitFor(() => expect(editor.resultado()).not.toBeNull());

    const resultado = editor.resultado();
    expect(resultado.mi).toBe('2965-1-NE');
    expect(resultado.inom).toBe('SF-22-Y-D-II-1-NE');
    expect(resultado.tipo_escala_id).toBe(1);
    expect(resultado.ewkt).toContain('SRID=4674;POLYGON((');

    editor._cleanup();
  });

  test('o INOM manda quando os dois vem preenchidos', async () => {
    getFolha.mockResolvedValue(FOLHA_25K);
    const editor = criarEditorGeometria({ tipoEscalaId: 1 });

    const textos = editor.element.querySelectorAll('input[type="text"]');
    digitar(textos[0], 'SF-22-Y-D-II-1-NE'); // INOM
    digitar(textos[1], '9999');              // MI conflitante
    editor.element.querySelector('button').click();
    await vi.waitFor(() => expect(getFolha).toHaveBeenCalled());

    // O INOM determina quadro E escala sozinho; o MI depende de tabela e pode
    // nao existir. Mandar os dois deixaria o servidor desempatar em silencio.
    expect(getFolha).toHaveBeenCalledWith({ inom: 'SF-22-Y-D-II-1-NE' });

    editor._cleanup();
  });

  test('folha sem MI e avisada, e nao tratada como falha', async () => {
    getFolha.mockResolvedValue({ ...FOLHA_25K, mi: null, sem_mi: true });
    const editor = criarEditorGeometria({ tipoEscalaId: 1 });

    digitar(editor.element.querySelectorAll('input[type="text"]')[0], 'SF-22-Y-D-II-1-NE');
    editor.element.querySelector('button').click();
    await vi.waitFor(() => expect(editor.resultado()).not.toBeNull());

    expect(textoDe(editor)).toContain('não tem MI');
    // Continua sendo uma geometria utilizavel: o produto existe, so nao tem MI.
    expect(editor.resultado().ewkt).toContain('POLYGON');
    expect(editor.resultado().mi).toBeNull();

    editor._cleanup();
  });

  test('erro do servidor aparece na tela e nao vira geometria', async () => {
    getFolha.mockRejectedValue(new Error('Folha nao encontrada'));
    const editor = criarEditorGeometria({ tipoEscalaId: 1 });

    digitar(editor.element.querySelectorAll('input[type="text"]')[0], 'ZZ-99-Z-Z-IX-9-XX');
    editor.element.querySelector('button').click();
    await vi.waitFor(() => expect(textoDe(editor)).toContain('Folha nao encontrada'));

    expect(editor.resultado()).toBeNull();

    editor._cleanup();
  });

  test('sem identificador nenhum, nao consulta o servidor', async () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 2 });

    editor.element.querySelector('button').click();
    expect(getFolha).not.toHaveBeenCalled();

    editor._cleanup();
  });
});

describe('modo fora do SCN (escala personalizada)', () => {
  test('pede os cantos e oferece desenhar', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5 });

    expect(textoDe(editor)).toContain('Longitude oeste');
    expect(textoDe(editor)).toContain('Latitude norte');
    expect(textoDe(editor)).toContain('Desenhar área');
    expect(editor.element.querySelectorAll('input[type="number"]').length).toBe(4);
    // E nao pede identificador de folha, que aqui nao existe.
    expect(getFolha).not.toHaveBeenCalled();

    editor._cleanup();
  });

  test('os quatro cantos formam o retangulo', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5 });
    const numeros = editor.element.querySelectorAll('input[type="number"]');

    digitar(numeros[0], '-50'); // oeste
    digitar(numeros[1], '-49'); // leste
    digitar(numeros[2], '-25'); // sul
    digitar(numeros[3], '-24'); // norte

    expect(editor.resultado().ewkt).toBe(QUADRADO_EWKT);

    editor._cleanup();
  });

  test('canto incompleto nao produz geometria pela metade', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5 });
    const numeros = editor.element.querySelectorAll('input[type="number"]');

    digitar(numeros[0], '-50');
    digitar(numeros[1], '-49');

    expect(editor.resultado()).toBeNull();
    expect(textoDe(editor)).toContain('Preencha os quatro valores');

    editor._cleanup();
  });

  test('cantos que nao formam area avisam em vez de gravar', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5 });
    const numeros = editor.element.querySelectorAll('input[type="number"]');

    digitar(numeros[0], '-50');
    digitar(numeros[1], '-50'); // leste igual ao oeste: largura zero
    digitar(numeros[2], '-25');
    digitar(numeros[3], '-24');

    expect(editor.resultado()).toBeNull();
    expect(textoDe(editor)).toContain('não formam área');

    editor._cleanup();
  });

  test('colar EWKT preenche os cantos', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5 });
    const textos = editor.element.querySelectorAll('input[type="text"]');

    digitar(textos[textos.length - 1], QUADRADO_EWKT);

    const numeros = editor.element.querySelectorAll('input[type="number"]');
    expect(numeros[0].value).toBe('-50');
    expect(numeros[3].value).toBe('-24');
    expect(editor.resultado().ewkt).toBe(QUADRADO_EWKT);

    editor._cleanup();
  });

  test('MULTIPOLYGON colado e recusado com motivo', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5 });
    const textos = editor.element.querySelectorAll('input[type="text"]');

    digitar(textos[textos.length - 1],
      'SRID=4674;MULTIPOLYGON(((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25)))');

    expect(editor.resultado()).toBeNull();
    expect(textoDe(editor)).toContain('anel único');

    editor._cleanup();
  });
});

describe('escala ainda nao escolhida', () => {
  test('pergunta o enquadramento em vez de assumir um modo', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: null });

    // Nem cantos nem identificador: primeiro a pergunta sobre o PRODUTO.
    expect(editor.element.querySelectorAll('input[type="number"]').length).toBe(0);
    expect(textoDe(editor)).toContain('folha do Sistema Cartográfico');
    expect(editor.element.querySelectorAll('button').length).toBe(2);

    editor._cleanup();
  });

  test('nao cai no modo livre por omissao', () => {
    // Este e o defeito que a pergunta existe para impedir: sem escala, assumir
    // "fora do SCN" ofereceria desenho a mao para uma folha sistematica.
    for (const vazio of [null, undefined, '']) {
      const editor = criarEditorGeometria({ tipoEscalaId: vazio });
      expect(textoDe(editor)).not.toContain('Desenhar área');
      expect(textoDe(editor)).not.toContain('Longitude oeste');
      editor._cleanup();
    }
  });

  test('responder "e do SCN" leva ao identificador', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: null });
    editor.element.querySelectorAll('button')[0].click();

    expect(textoDe(editor)).toContain('INOM');
    expect(editor.element.querySelectorAll('input[type="number"]').length).toBe(0);

    editor._cleanup();
  });

  test('responder "nao e do SCN" leva aos cantos', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: null });
    editor.element.querySelectorAll('button')[1].click();

    expect(editor.element.querySelectorAll('input[type="number"]').length).toBe(4);
    expect(textoDe(editor)).toContain('Desenhar área');

    editor._cleanup();
  });

  test('a pergunta nao aparece quando a escala ja e conhecida', () => {
    const scn = criarEditorGeometria({ tipoEscalaId: 3 });
    expect(textoDe(scn)).not.toContain('folha do Sistema Cartográfico Nacional?');
    scn._cleanup();

    const livre = criarEditorGeometria({ tipoEscalaId: 5 });
    expect(livre.element.querySelectorAll('input[type="number"]').length).toBe(4);
    livre._cleanup();
  });
});

describe('editar geometria que ja existe', () => {
  test('carrega o poligono gravado nos cantos, fora do SCN', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5, ewktAtual: QUADRADO_EWKT });
    const numeros = editor.element.querySelectorAll('input[type="number"]');

    expect(numeros[0].value).toBe('-50');
    expect(numeros[1].value).toBe('-49');
    expect(numeros[2].value).toBe('-25');
    expect(numeros[3].value).toBe('-24');

    editor._cleanup();
  });

  test('geometria ilegivel nao derruba a tela', () => {
    const editor = criarEditorGeometria({ tipoEscalaId: 5, ewktAtual: 'lixo' });

    expect(editor.element).toBeTruthy();
    expect(editor.resultado()).toBeNull();

    editor._cleanup();
  });
});
