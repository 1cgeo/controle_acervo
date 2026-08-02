import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Execucao do PIT (#/execucao_pit): a GRADE do ano, desde 2026-08-02.
//
// O que estes casos FIXAM, e que nao se ve olhando a tela:
//  - dois numeros por celula, o realizado em cima e o planejado embaixo. A
//    planilha da Divisao tem duas abas com as mesmas linhas e as mesmas doze
//    colunas, e a diferenca entre elas e so qual dos dois a celula guarda;
//  - `·` e vazio e `0` e zero, nos DOIS numeros. "Ninguem lancou" e "conferi e
//    nao houve" sao coisas diferentes;
//  - a cor e do ACUMULADO ate o mes, e nao do mes sozinho. E o que faz trabalho
//    ADIANTADO deixar de aparecer como atraso no mes em que estava planejado;
//  - mes que ainda corre e mes futuro nao recebem cor;
//  - o cabecalho da meta e linha de GRUPO com o subtotal, e nao recebe
//    lancamento: quem entrega e o item;
//  - o modo decide qual dos dois o clique edita, e o corpo do POST leva SO
//    aquele campo -- omitir o outro e "nao mexer nele".
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
  // Cabeçalho da Meta 1: não é folha, então vira linha de grupo sem meses.
  {
    meta_id: '1', ano: 2026, numero_meta: 1, item: null,
    descricao: 'Produção de Geoinformação', folha: false,
    quantidade_prevista: null, unidade: null, meses: [], realizado: 0, planejado: 0,
  },
  {
    meta_id: '2', ano: 2026, numero_meta: 1, item: '1.1',
    descricao: 'Produzir Carta Topográfica 1:25.000', folha: true,
    quantidade_prevista: 24, unidade: 'carta',
    // O caso real do chefe, em 2026: planejou 4/1/1/1 de abril a julho e
    // entregou nada/6/2/0. Julho tem plano e realizado ZERO, mas o que ele pedia
    // ja estava entregue desde maio.
    meses: [
      { id: '10', mes: 4, planejada: 4, realizada: null },
      { id: '11', mes: 5, planejada: 1, realizada: 6 },
      { id: '12', mes: 6, planejada: 1, realizada: 2 },
      { id: '13', mes: 7, planejada: 1, realizada: 0 },
    ],
    realizado: 8, planejado: 7,
  },
];

const linhas = (c) => [...c.querySelectorAll('tbody tr')];
const celulas = (tr) => [...tr.querySelectorAll('.grade-pit__celula')];

describe('renderExecucaoPit', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // O RELOGIO E FIXO aqui, e nao e capricho: a cor so vale para o mes que ja
    // FECHOU, entao com a data real estes casos passariam de fevereiro a
    // dezembro e falhariam em janeiro. `shouldAdvanceTime` mantem o `setTimeout`
    // do `flush` andando.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-02T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a meta subdividida vira linha de GRUPO, sem células de mês', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    const [grupo, item] = linhas(container);
    expect(grupo.className).toContain('grade-pit__grupo');
    // O cabeçalho não recebe lançamento: quem entrega é o item.
    expect(celulas(grupo).length).toBe(0);
    expect(celulas(item).length).toBe(12);

    if (typeof cleanup === 'function') cleanup();
  });

  test('cada célula traz os DOIS números, e vazio não se confunde com zero', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    const item = linhas(container)[1];
    const abril = celulas(item)[3];
    const junho = celulas(item)[5];
    const julho = celulas(item)[6];

    // Abril: planejou 4 e ninguém lançou nada.
    expect(abril.querySelector('.grade-pit__planejado').textContent).toBe('4');
    expect(abril.querySelector('.grade-pit__realizado').textContent).toBe('·');
    // Junho: planejou 1 e entregou 2.
    expect(junho.querySelector('.grade-pit__realizado').textContent).toBe('2');
    // Julho: planejou 1 e o zero é "conferi e não houve", diferente do ponto.
    expect(julho.querySelector('.grade-pit__realizado').textContent).toBe('0');

    if (typeof cleanup === 'function') cleanup();
  });

  // O defeito que este caso guarda: com a regra do mês isolado, JULHO ficava
  // vermelho (plano 1, realizado 0) embora o que ele pedia estivesse entregue
  // desde maio. Trabalho adiantado nao e atraso.
  test('a cor é do ACUMULADO: trabalho adiantado não vira atraso', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    const item = linhas(container)[1];
    // Até abril: planejado 4, realizado 0. Estava atrasado mesmo.
    expect(celulas(item)[3].className).toContain('grade-pit__celula--nada');
    // Até maio: 6 contra 5. Recuperou.
    expect(celulas(item)[4].className).toContain('grade-pit__celula--atingiu');
    // Até junho: 8 contra 6. Até julho: 8 contra 7, com realizado ZERO no mês.
    expect(celulas(item)[5].className).toContain('grade-pit__celula--atingiu');
    expect(celulas(item)[6].className).toContain('grade-pit__celula--atingiu');
    // E o `title` mostra as duas contas, senão uma célula verde com realizado
    // zero se leria como erro.
    expect(celulas(item)[6].title).toContain('até JUL: planejado 7, realizado 8');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o plano que não fecha com a quantidade do ano fica marcado', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    const divergente = container.querySelector('.grade-pit__divergente');
    // O ano promete 24 e o plano soma 7.
    expect(divergente.textContent).toBe('24 carta');
    expect(divergente.title).toContain('Faltam 17');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o modo decide qual dos dois o clique edita, e o POST leva só esse campo', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    const abril = celulas(linhas(container)[1])[3];
    abril.click();
    await flush();

    const input = abril.querySelector('input');
    // O modo nasce em Executar, e abril não tem realizado nenhum.
    expect(input.value).toBe('');

    input.value = '7';
    input.dispatchEvent(new Event('blur'));
    await flush();

    expect(salvarExecucaoPit).toHaveBeenCalledWith({
      // NUMERO, e nao a string que a API devolve: o BIGSERIAL chega como texto
      // no JSON e o Joi desta rota e `.strict()`.
      meta_id: 2,
      mes: 4,
      // Só o realizado. Omitir o planejado é "não mexer nele", e é o que permite
      // lançar sem carregar o plano junto.
      quantidade: 7,
    });

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem não é administrador lê a grade e não abre campo nenhum', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    const abril = celulas(linhas(container)[1])[3];
    abril.click();
    await flush();

    expect(abril.querySelector('input')).toBeNull();
    // E o alternador de modo nem é montado.
    expect(container.textContent).not.toContain('Planejar');

    if (typeof cleanup === 'function') cleanup();
  });
});
