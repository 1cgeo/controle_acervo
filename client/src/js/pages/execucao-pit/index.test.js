import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Execucao do PIT (#/execucao_pit): a GRADE do ano,.
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

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderExecucaoPit(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

// A grade traz UMA LINHA POR ITEM desde 1.30.0. O cabeçalho da Meta 1 não vem
// do servidor: a tela o sintetiza a partir de `numero_meta` e `nome`, que viajam
// na linha do próprio item. A fixtura não tem mais a linha de `item` nulo, e é
// isso que este arquivo passou a provar.
const GRADE = [
  {
    meta_id: '2', ano: 2026, numero_meta: 1, nome: 'Produção de Geoinformação',
    item: '1.1',
    descricao: 'Produzir Carta Topográfica 1:25.000',
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

/** Troca o alternador Planejar/Executar como a pessoa o troca. */
function trocarModo(container, valor) {
  const seletores = [...container.querySelectorAll('select')];
  const modo = seletores[seletores.length - 1];
  modo.value = valor;
  modo.dispatchEvent(new Event('change'));
}

const origem = (tr) => tr.querySelector('.grade-pit__origem');

// A MESMA grade com uma linha CALCULADA ao lado da manual. As duas juntas sao a
// variancia: um teste com so uma delas passaria numa tela que marcasse tudo
// igual.
const GRADE_MISTA = () => [
  ...GRADE,
  {
    meta_id: '3', ano: 2026, numero_meta: 2, nome: 'Capacitacao',
    item: '2.1',
    descricao: 'Capacitar o efetivo',
    quantidade_prevista: 10, unidade: 'militar',
    origem: 'as capacitacoes cadastradas',
    planejada_calculada: true,
    realizada_calculada: true,
    meses: [{ id: '20', mes: 5, planejada: 2, realizada: 2 }],
    realizado: 2, planejado: 2,
  },
];

// O RELOGIO E FIXO NO ARQUIVO INTEIRO, e nao e capricho: a cor so vale para o
// mes que ja FECHOU e a celula so abre ate o mes corrente, entao com a data real
// estes casos mudam de resposta conforme o dia em que rodam.
//
// ELE VIVIA DENTRO DO PRIMEIRO `describe`, e os outros dois rodavam no relogio
// de parede. O caso "no modo Executar, o mes futuro nao abre" escrevia no
// proprio comentario que o relogio estava em 02/08/2026, e nao estava: em
// 04/09/2026 setembro deixou de ser futuro, a celula passou a abrir e o caso
// caiu. Congelar uma vez, num `describe`, nao vira regra do arquivo sozinho.
//
// `shouldAdvanceTime` mantem o `setTimeout` do `flush` andando.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-02T12:00:00'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('renderExecucaoPit', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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

  // A DIVERGÊNCIA TEM DOIS LADOS, e o de cima existe: distribuir pelos doze
  // meses MAIS do que o ano promete é o erro de digitação simétrico. A frase
  // dizia "Faltam -3", que não nomeia nada e ainda parece defeito da tela.
  test('o plano que passa da quantidade do ano diz SOBRAM, e não "Faltam -N"', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([{
      ...GRADE[0],
      quantidade_prevista: 4,
      meses: [
        { id: '10', mes: 4, planejada: 4, realizada: null },
        { id: '11', mes: 5, planejada: 3, realizada: null },
      ],
      realizado: 0, planejado: 7,
    }]);

    const { container, cleanup } = await montar();

    const divergente = container.querySelector('.grade-pit__divergente');
    expect(divergente.title).toContain('O plano soma 7 e o ano promete 4.');
    expect(divergente.title).toContain('Sobram 3');
    expect(divergente.title).not.toContain('-');

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

// A CELULA QUE A ORIGEM CALCULA NAO ABRE PARA DIGITAR.
//
// Quem decide e o SERVIDOR, que manda `planejada_calculada` e
// `realizada_calculada` por linha (pit_execucao_ctrl.js). Antes a tela abria o
// campo em qualquer celula, a pessoa escrevia o numero e so entao a gravacao
// recusava: pedir e recusar depois e pior do que nao pedir.
describe('execucao do PIT: a celula calculada nao se digita', () => {
  // Sai da FOLHA que a amostra ja tem (a Meta 1.1), e nao de um objeto novo:
  // assim ela carrega os meses de verdade.
  const folha = GRADE[0];
  const linhaCalculada = {
    ...folha,
    meta_id: '91',
    origem: 'Capacitação',
    origem_id: 2,
    planejada_calculada: true,
    realizada_calculada: true,
  };

  test('clicar numa celula calculada nao abre campo de edicao', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([linhaCalculada]);
    const { container, cleanup } = await montar();

    // O indice 1: a linha 0 e o cabecalho do grupo, que a tela sintetiza.
    const celula = celulas(linhas(container)[1])[3];
    celula.click();
    await flush();

    expect(celula.querySelector('input')).toBeNull();
    // E nada foi mandado ao servidor: a recusa nem chega a ser necessaria.
    expect(salvarExecucaoPit).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('a celula calculada se distingue, e diz de onde vem o numero', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([linhaCalculada]);
    const { container, cleanup } = await montar();

    // O indice 1: a linha 0 e o cabecalho do grupo, que a tela sintetiza.
    const celula = celulas(linhas(container)[1])[3];
    expect(celula.className).toContain('grade-pit__celula--calculada');
    expect(celula.title).toContain('Calculado pelo sistema');
    // A ORIGEM entra na frase: "vem do sistema" sem dizer de onde nao ajuda
    // ninguem a achar onde mexer.
    expect(celula.title).toContain('Capacitação');

    if (typeof cleanup === 'function') cleanup();
  });

  // CONTROLE: a celula MANUAL continua abrindo. Sem este caso, um guarda que
  // bloqueasse tudo passaria nos dois acima.
  test('a celula manual segue abrindo para digitar', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([
      { ...folha, origem: 'Manual', origem_id: 1, planejada_calculada: false, realizada_calculada: false },
    ]);
    const { container, cleanup } = await montar();

    // O indice 1: a linha 0 e o cabecalho do grupo, que a tela sintetiza.
    const celula = celulas(linhas(container)[1])[3];
    celula.click();
    await flush();

    expect(celula.querySelector('input')).not.toBeNull();
    expect(celula.className).not.toContain('grade-pit__celula--calculada');

    if (typeof cleanup === 'function') cleanup();
  });
  // -------------------------------------------------------------------------
  // O que se digita e o que o sistema calcula
  // -------------------------------------------------------------------------

  // A DISTINCAO MORA NA LINHA, e nao na celula. Ela e propriedade da META, e
  // dita so no `title` da celula obrigava a passar o mouse casa a casa para
  // descobrir onde se pode escrever.
  test('a linha diz se o numero e dela ou do sistema', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_MISTA());

    const { container, cleanup } = await montar();

    const manual = linhas(container).find(tr => tr.textContent.includes('1.1'));
    const automatica = linhas(container).find(tr => tr.textContent.includes('2.1'));

    expect(origem(manual).textContent).toBe('à mão');
    expect(origem(automatica).textContent).toBe('automática');
    // A etiqueta da automatica diz DE ONDE vem o numero.
    expect(origem(automatica).title).toContain('as capacitacoes cadastradas');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a celula calculada nao abre para digitar, e a manual abre', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_MISTA());

    const { container, cleanup } = await montar();

    const automatica = linhas(container).find(tr => tr.textContent.includes('2.1'));
    const manual = linhas(container).find(tr => tr.textContent.includes('1.1'));

    celulas(automatica)[4].click();
    await flush();
    expect(celulas(automatica)[4].querySelector('input')).toBeNull();
    expect(celulas(automatica)[4].className).toContain('grade-pit__celula--calculada');

    // VARIANCIA: a manual do mesmo mes abre.
    celulas(manual)[4].click();
    await flush();
    expect(celulas(manual)[4].querySelector('input')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // A ETIQUETA SEGUE O MODO. A mesma meta pode ter o planejado calculado e o
  // realizado digitado, e ate 2026-08-06 a troca de modo nao repintava a linha:
  // as marcas do modo anterior ficavam na tela.
  test('trocar de modo repinta a etiqueta da linha', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([{
      ...GRADE[0],
      origem: 'as versoes do acervo',
      planejada_calculada: true,
      realizada_calculada: false,
    }]);

    const { container, cleanup } = await montar();
    const linha = linhas(container).find(tr => tr.textContent.includes('1.1'));

    // Modo Executar: o realizado e digitado.
    expect(origem(linha).textContent).toBe('à mão');

    trocarModo(container, 'quantidade_planejada');
    await flush();

    // Modo Planejar: o planejado sai da origem.
    expect(origem(linhas(container).find(tr => tr.textContent.includes('1.1'))).textContent)
      .toBe('automática');

    if (typeof cleanup === 'function') cleanup();
  });

  // -------------------------------------------------------------------------
  // O mes que ainda nao chegou
  // -------------------------------------------------------------------------

  // Realizado e o que a Divisao ENTREGOU. Lancado adiantado ele soma no
  // acumulado e vai para a subsecao 2.1 do RPCMTec como producao do mes: o
  // documento assinado passa a afirmar entrega que nao houve.
  //
  // O relogio destes casos esta em 02/08/2026: agosto e o mes corrente.
  test('no modo Executar, o mes futuro nao abre e diz por que', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();
    const item = linhas(container)[1];

    // Setembro (indice 8) ainda nao chegou.
    celulas(item)[8].click();
    await flush();

    expect(celulas(item)[8].querySelector('input')).toBeNull();
    expect(celulas(item)[8].className).toContain('grade-pit__celula--futuro');
    expect(celulas(item)[8].title).toMatch(/ainda n(ã|a)o chegou/i);

    if (typeof cleanup === 'function') cleanup();
  });

  // VARIANCIA, e ela e o coracao deste bloco: sem estes dois, um teste que
  // travasse a grade INTEIRA passaria igual.
  test('o mes CORRENTE e o passado continuam abrindo no modo Executar', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();
    const item = linhas(container)[1];

    // Agosto e o mes corrente: quem entrega no dia 3 lanca no dia 3.
    celulas(item)[7].click();
    await flush();
    expect(celulas(item)[7].querySelector('input')).not.toBeNull();
    expect(celulas(item)[7].className).not.toContain('grade-pit__celula--futuro');

    if (typeof cleanup === 'function') cleanup();
  });

  // PLANEJAR MES FUTURO E O TRABALHO NORMAL de quem distribui a meta pelo ano.
  test('no modo Planejar, o mes futuro abre normalmente', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE);

    const { container, cleanup } = await montar();

    trocarModo(container, 'quantidade_planejada');
    await flush();

    const item = linhas(container)[1];
    celulas(item)[8].click();
    await flush();

    expect(celulas(item)[8].querySelector('input')).not.toBeNull();
    expect(celulas(item)[8].className).not.toContain('grade-pit__celula--futuro');

    if (typeof cleanup === 'function') cleanup();
  });
});

// -----------------------------------------------------------------------------
// AS DUAS CAIXAS: esconder as automaticas e esconder as concluidas
// -----------------------------------------------------------------------------
//
// A pergunta do mes na grade e "o que falta EU lancar". As automaticas ninguem
// digita e a meta que ja fechou o ano nao pede mais nada, entao as duas caixas
// deixam na tela so o trabalho que sobrou.
//
// O que estes casos FIXAM, e que nao se ve olhando a tela:
//  - a caixa esconde LINHA e nunca numero: o subtotal do grupo continua contando
//    o item escondido, e a linha de grupo diz quantos sairam;
//  - a caixa das automaticas SEGUE O MODO, pela mesma razao que a etiqueta da
//    linha segue: a mesma meta pode ter o plano calculado e o realizado a mao;
//  - meta sem quantidade do ano NUNCA conclui, e nao some;
//  - com tudo escondido a tela NAO diz que o ano esta vazio, que e a afirmacao
//    oposta e a que faria a pessoa cadastrar meta duplicada.
describe('execucao do PIT: as caixas que escondem linha', () => {
  // Quatro itens, e cada um cobre um ramo: manual em aberto (fica sempre),
  // manual concluida, automatica, e a sem quantidade do ano. Com menos que isso
  // um filtro que escondesse demais passaria.
  const GRADE_FILTRO = () => [
    {
      meta_id: '2', ano: 2026, numero_meta: 1, nome: 'Producao de Geoinformacao',
      item: '1.1', descricao: 'Produzir Carta Topografica 1:25.000',
      quantidade_prevista: 24, unidade: 'carta',
      meses: [{ id: '11', mes: 5, planejada: 1, realizada: 8 }],
      realizado: 8, planejado: 1,
    },
    {
      meta_id: '3', ano: 2026, numero_meta: 1, nome: 'Producao de Geoinformacao',
      item: '1.2', descricao: 'Produzir Carta Ortoimagem',
      quantidade_prevista: 5, unidade: 'carta',
      meses: [{ id: '12', mes: 5, planejada: 5, realizada: 5 }],
      realizado: 5, planejado: 5,
    },
    {
      meta_id: '4', ano: 2026, numero_meta: 2, nome: 'Capacitacao',
      item: '2.1', descricao: 'Capacitar o efetivo',
      quantidade_prevista: 10, unidade: 'militar',
      origem: 'as capacitacoes cadastradas',
      planejada_calculada: true, realizada_calculada: true,
      meses: [{ id: '20', mes: 5, planejada: 2, realizada: 2 }],
      realizado: 2, planejado: 2,
    },
    {
      meta_id: '5', ano: 2026, numero_meta: 3, nome: 'Apoio',
      item: '3.1', descricao: 'Atender demanda de apoio',
      quantidade_prevista: null, unidade: null,
      meses: [{ id: '30', mes: 5, planejada: null, realizada: 3 }],
      realizado: 3, planejado: 0,
    },
  ];

  /** Marca ou desmarca a caixa pelo rotulo, como a pessoa a marca. */
  function marcarCaixa(container, rotulo, marcado = true) {
    const label = [...container.querySelectorAll('.page__filters label')]
      .find(l => l.textContent.includes(rotulo));
    const caixa = label.parentElement.querySelector('input[type="checkbox"]');
    caixa.checked = marcado;
    caixa.dispatchEvent(new Event('change'));
  }

  const temItem = (container, item) => linhas(container)
    .some(tr => tr.textContent.includes(item));

  test('a caixa das automaticas tira a calculada e deixa a que se digita', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_FILTRO());

    const { container, cleanup } = await montar();
    expect(temItem(container, '2.1')).toBe(true);

    marcarCaixa(container, 'Esconder as automáticas');
    await flush();

    expect(temItem(container, '2.1')).toBe(false);
    // VARIANCIA: as tres manuais ficam. Sem isto, uma caixa que esvaziasse a
    // grade passaria.
    expect(temItem(container, '1.1')).toBe(true);
    expect(temItem(container, '1.2')).toBe(true);
    expect(temItem(container, '3.1')).toBe(true);

    // E desmarcar traz de volta.
    marcarCaixa(container, 'Esconder as automáticas', false);
    await flush();
    expect(temItem(container, '2.1')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  // A CAIXA SEGUE O MODO. A meta com o plano calculado e o realizado a mao e
  // automatica em Planejar e manual em Executar, e a caixa tem de concordar com
  // a etiqueta da propria linha.
  test('a caixa das automaticas segue o modo Planejar/Executar', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([{
      ...GRADE_FILTRO()[0],
      origem: 'as versoes do acervo',
      planejada_calculada: true,
      realizada_calculada: false,
    }]);

    const { container, cleanup } = await montar();

    marcarCaixa(container, 'Esconder as automáticas');
    await flush();
    // Em Executar o numero e digitado, entao a linha fica.
    expect(temItem(container, '1.1')).toBe(true);

    trocarModo(container, 'quantidade_planejada');
    await flush();
    // Em Planejar o numero vem do sistema, e a mesma linha some.
    expect(temItem(container, '1.1')).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a caixa das concluidas tira a que fechou o ano, e a sem quantidade fica', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_FILTRO());

    const { container, cleanup } = await montar();

    marcarCaixa(container, 'Esconder as concluídas');
    await flush();

    // 1.2 entregou os 5 que o ano pedia.
    expect(temItem(container, '1.2')).toBe(false);
    // 1.1 entregou 8 dos 24.
    expect(temItem(container, '1.1')).toBe(true);
    // 3.1 nao tem quantidade do ano: sem denominador nao ha o que alcancar, e
    // esconde-la apagaria da tela justo a meta com o cadastro incompleto.
    expect(temItem(container, '3.1')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  // O NUMERO NAO MUDA COM A CAIXA. O subtotal e fato da META: recalcula-lo sobre
  // o que sobrou faria a meta parecer menos adiantada so porque o item pronto
  // saiu da tela.
  test('o subtotal do grupo conta o item escondido, e a linha diz quantos', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_FILTRO());

    const { container, cleanup } = await montar();

    marcarCaixa(container, 'Esconder as concluídas');
    await flush();

    const grupo = linhas(container).find(tr => tr.textContent.includes('Meta 1'));
    const celulasDoGrupo = [...grupo.children];
    // Realizado do grupo: 8 do item 1.1 mais os 5 do 1.2, que saiu da tela.
    expect(celulasDoGrupo[celulasDoGrupo.length - 3].textContent).toBe('13');
    expect(celulasDoGrupo[celulasDoGrupo.length - 2].textContent).toBe('29');
    // E o grupo AVISA que ha item fora da tela, senao a soma pareceria errada.
    expect(grupo.textContent).toContain('1 escondido(s)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o resumo diz quantas linhas as caixas tiraram', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_FILTRO());

    const { container, cleanup } = await montar();
    expect(container.textContent).toContain('4 meta(s) em 2026.');
    expect(container.textContent).not.toContain('escondida(s)');

    marcarCaixa(container, 'Esconder as automáticas');
    marcarCaixa(container, 'Esconder as concluídas');
    await flush();

    // A automatica e a concluida: duas saem, e as quatro continuam sendo o ano.
    expect(container.textContent).toContain('4 meta(s) em 2026.');
    expect(container.textContent).toContain('2 escondida(s) pelas caixas.');

    if (typeof cleanup === 'function') cleanup();
  });

  // Com as duas caixas num ano ja fechado a grade fica vazia, e dizer aqui
  // "nenhuma meta cadastrada" seria a afirmacao OPOSTA sobre o ano.
  test('a grade esvaziada pelas caixas nao se confunde com ano sem meta', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce([GRADE_FILTRO()[1]]);

    const { container, cleanup } = await montar();

    marcarCaixa(container, 'Esconder as concluídas');
    await flush();

    expect(linhas(container).length).toBe(0);
    expect(container.textContent).toContain('escondidas pelas');
    expect(container.textContent).not.toContain('Nenhuma meta cadastrada');

    if (typeof cleanup === 'function') cleanup();
  });

  // A GRAVACAO CRUZA A REGUA: lancar o que faltava conclui a meta, e com a caixa
  // marcada ela tem de sair da tela na hora.
  test('a meta que a gravacao conclui sai da tela com a caixa marcada', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_FILTRO());

    const { container, cleanup } = await montar();

    marcarCaixa(container, 'Esconder as concluídas');
    await flush();
    expect(temItem(container, '1.1')).toBe(true);

    // Maio ja tem 8; lancar 24 fecha os 24 do ano.
    const item = linhas(container).find(tr => tr.textContent.includes('1.1'));
    const maio = celulas(item)[4];
    maio.click();
    await flush();
    const input = maio.querySelector('input');
    input.value = '24';
    input.dispatchEvent(new Event('blur'));
    await flush();

    expect(salvarExecucaoPit).toHaveBeenCalled();
    expect(temItem(container, '1.1')).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });
});

// -----------------------------------------------------------------------------
// O ANO ENCERRADO
// -----------------------------------------------------------------------------
//
// Encerrar o exercicio (`pit.pit.situacao_id = 3`) faz `salvar` e `deletar`
// recusarem lancamento com 400. Sem o recorte na tela, a celula de 2025 abria em
// 2027: a pessoa digitava 12, tirava o foco e SO ENTAO levava a recusa. E o
// mesmo "pedir e recusar depois" que as celulas calculada e futura ja evitam, e
// a frase e LETRA POR LETRA a do servidor (`pit_execucao_ctrl.js:772`).
//
// `ano_encerrado` vem do servidor por linha da grade. Quando ele NAO vem
// (servidor antigo), a celula continua editavel: recusar por um campo que nao
// chegou travaria a grade inteira em vez de proteger o ano fechado.
describe('a grade do ano encerrado', () => {
  const GRADE_ENCERRADA = (encerrado) => [{
    ...GRADE[0],
    ano: 2025,
    ...(encerrado === undefined ? {} : { ano_encerrado: encerrado }),
  }];

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('a célula do ano encerrado não abre, e diz a frase do servidor', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_ENCERRADA(true));

    const { container, cleanup } = await montar();
    const item = linhas(container)[1];

    // Junho de um ano que já passou: nem calculada, nem futura.
    const junho = celulas(item)[5];
    junho.click();
    await flush();

    expect(junho.querySelector('input')).toBeNull();
    expect(junho.className).toContain('grade-pit__celula--encerrada');
    expect(junho.title).toContain('O exercício de 2025 está encerrado e não aceita lançamento.');

    if (typeof cleanup === 'function') cleanup();
  });

  // Encerrado nao aceita nem PLANO: a recusa do servidor e da linha de
  // `pit.execucao`, e nao da coluna.
  test('nem o modo Planejar abre a célula do ano encerrado', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValue(GRADE_ENCERRADA(true));

    const { container, cleanup } = await montar();
    trocarModo(container, 'quantidade_planejada');
    await flush();

    const junho = celulas(linhas(container)[1])[5];
    junho.click();
    await flush();

    expect(junho.querySelector('input')).toBeNull();
    expect(junho.className).toContain('grade-pit__celula--encerrada');

    if (typeof cleanup === 'function') cleanup();
  });

  // VARIANCIA: sem estes dois, um caso que travasse a grade INTEIRA passaria.
  test('o ano ABERTO continua abrindo a mesma célula', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_ENCERRADA(false));

    const { container, cleanup } = await montar();
    const junho = celulas(linhas(container)[1])[5];
    junho.click();
    await flush();

    expect(junho.querySelector('input')).not.toBeNull();
    expect(junho.className).not.toContain('grade-pit__celula--encerrada');

    if (typeof cleanup === 'function') cleanup();
  });

  test('sem o campo na resposta, a célula continua editável', async () => {
    logar({ administrador: true });
    getGradePit.mockResolvedValueOnce(GRADE_ENCERRADA(undefined));

    const { container, cleanup } = await montar();
    const junho = celulas(linhas(container)[1])[5];
    junho.click();
    await flush();

    expect(junho.querySelector('input')).not.toBeNull();
    expect(junho.className).not.toContain('grade-pit__celula--encerrada');

    if (typeof cleanup === 'function') cleanup();
  });
});
