import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// MICROCONTROLE: a tela que passou a funcionar em 2026-08-09.
//
// ATÉ AQUELE DIA ELA NÃO CHAMAVA REDE NENHUMA, e havia um caso que prendia
// exatamente isso: `/api/microcontrole` estava montado com ZERO rotas, e
// qualquer chamada levaria 404 do Express -- que numa tela se lê como "quebrou"
// ou "meu perfil não alcança", duas coisas que não tinham acontecido. O
// microcontrole atravessou por decisão do chefe, as onze rotas existem, e aquele
// caso virou o oposto: a tela TEM de chamar.
//
// O QUE ESTES CASOS PRENDEM, e que não se vê olhando a tela:
//
//  - AS SEÇÕES CARREGAM SEPARADAS, cada uma com o próprio `catch`. É a regra que
//    mordeu três vezes em 2026-08-08: num `Promise.all` a falha de uma derruba a
//    TELA INTEIRA e a mensagem que sobra é a dela. Aqui as chamadas têm guardas
//    e BANCOS diferentes -- a lista de lotes é `consulta` no banco principal, a
//    telemetria é `gerente` num banco separado que pode nem existir --, então a
//    falha de uma não pode apagar o que a outra trouxe;
//
//  - O 503 DA TELEMETRIA APARECE COMO A FRASE DO SERVIDOR, dentro da seção. Ele
//    distingue "não configurado" de "fora do ar", e é a única coisa que manda
//    quem lê ao lugar certo. Uma frase genérica desta tela apagaria a distinção;
//
//  - O APROVEITAMENTO NÃO CHAMA SEM OPERADOR. A rota exige o UUID, e pedir sem
//    ele levaria 400 do Joi -- um defeito aparente onde não houve nenhum.

const servicos = vi.hoisted(() => ({
  getResumoFeicao: vi.fn(),
  getCoberturaTela: vi.fn(),
  getAproveitamentoTela: vi.fn(),
  getLotesEmExecucao: vi.fn(),
}));

vi.mock('@services/microcontrole-service.js', () => ({
  getResumoFeicao: servicos.getResumoFeicao,
  getCoberturaTela: servicos.getCoberturaTela,
  getAproveitamentoTela: servicos.getAproveitamentoTela,
}));

vi.mock('@services/producao-acompanhamento-service.js', () => ({
  getLotesEmExecucao: servicos.getLotesEmExecucao,
}));

const { renderMicrocontrole, amostrasPorOperador } = await import('./index.js');

const RESUMO = {
  por_operador: [
    {
      usuario_uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      usuario: 'Cap Silva',
      insercoes: 120, delecoes: 3, atualizacoes_atributo: 8,
      atualizacoes_geometria: 15, comprimento: 4210.5, vertices: 9800,
    },
  ],
  por_camada: [
    {
      camada: 'edicao.via_deslocamento',
      insercoes: 100, delecoes: 2, atualizacoes_atributo: 5,
      atualizacoes_geometria: 10, comprimento: 4000, vertices: 9000,
    },
  ],
  serie_diaria: [
    {
      dia: '2026-08-08',
      insercoes: 60, delecoes: 1, atualizacoes_atributo: 4,
      atualizacoes_geometria: 7,
    },
  ],
};

const COBERTURA = {
  type: 'FeatureCollection',
  aviso: null,
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {
        atividade_id: 12,
        usuario_uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        usuario: 'Cap Silva',
        data: '2026-08-08T10:00:00-03',
        zoom: 5000,
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {
        atividade_id: 12,
        usuario_uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        usuario: 'Cap Silva',
        data: '2026-08-08T10:05:00-03',
        zoom: 5000,
      },
    },
  ],
};

function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = renderMicrocontrole(container);
  return { container, cleanup };
}

/** Deixa as promessas pendentes da carga inicial resolverem. */
const assentar = () => new Promise((resolver) => { setTimeout(resolver, 0); });

beforeEach(() => {
  servicos.getResumoFeicao.mockResolvedValue(RESUMO);
  servicos.getCoberturaTela.mockResolvedValue(COBERTURA);
  servicos.getAproveitamentoTela.mockResolvedValue([]);
  servicos.getLotesEmExecucao.mockResolvedValue([{ id: 7, nome: 'Lote Teste' }]);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('microcontrole: a tela mede o trabalho', () => {
  test('carrega feição e cobertura na abertura, e o período padrão é de 30 dias', async () => {
    const { cleanup } = montar();
    await assentar();

    expect(servicos.getResumoFeicao).toHaveBeenCalledTimes(1);
    expect(servicos.getCoberturaTela).toHaveBeenCalledTimes(1);

    // O PERÍODO VAI EXPLÍCITO, e não em branco. O servidor assume 30 dias quando
    // as datas faltam; escrevê-las aqui é o que faz a tela dizer qual recorte
    // está mostrando, em vez de um número sem janela.
    const filtro = servicos.getResumoFeicao.mock.calls[0][0];
    expect(filtro.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filtro.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dias = (new Date(filtro.dataFim) - new Date(filtro.dataInicio)) / 86400000;
    expect(Math.round(dias)).toBe(30);

    cleanup();
  });

  test('mostra o que a feição mediu, por operador, por camada e por dia', async () => {
    const { container, cleanup } = montar();
    await assentar();

    const texto = container.textContent;
    expect(texto).toMatch(/Cap Silva/);
    expect(texto).toMatch(/edicao\.via_deslocamento/);
    expect(texto).toMatch(/2026-08-08/);
    cleanup();
  });

  test('a falha da telemetria fica NA SEÇÃO dela, e a outra continua de pé', async () => {
    // 503 do banco separado, com a frase do servidor. É o caso da instalação que
    // nunca configurou telemetria.
    servicos.getCoberturaTela.mockRejectedValue(
      new Error('A telemetria do microcontrole não está configurada nesta instalação.'),
    );

    const { container, cleanup } = montar();
    await assentar();

    // A FRASE DO SERVIDOR, e não uma genérica desta tela: ela é o que distingue
    // "não configurado" de "fora do ar".
    expect(container.textContent).toMatch(/não está configurada nesta instalação/);
    // E a seção de feição, que veio da MESMA telemetria mas de outra chamada,
    // continua na tela: num `Promise.all` ela teria sumido junto.
    expect(container.textContent).toMatch(/edicao\.via_deslocamento/);
    cleanup();
  });

  test('a falha da lista de lotes não apaga a medição', async () => {
    // A lista de lotes é `consulta` no `producao` e vem do banco PRINCIPAL: quem
    // não a alcança leva 403 nela e continua alcançando o resto.
    servicos.getLotesEmExecucao.mockRejectedValue(new Error('403'));

    const { container, cleanup } = montar();
    await assentar();

    expect(container.textContent).toMatch(/Cap Silva/);
    expect(servicos.getResumoFeicao).toHaveBeenCalledTimes(1);
    cleanup();
  });

  test('não pede aproveitamento sem operador escolhido', async () => {
    const { cleanup } = montar();
    await assentar();

    // A rota exige o UUID: chamar sem ele levaria 400 do Joi, que numa tela se
    // lê como defeito.
    expect(servicos.getAproveitamentoTela).not.toHaveBeenCalled();
    cleanup();
  });

  test('pede o aproveitamento do operador escolhido, com o mesmo período', async () => {
    const { container, cleanup } = montar();
    await assentar();

    // O seletor se preenche do RESUMO DE FEIÇÃO: quem aparece é quem TEM medição
    // no período filtrado, e não a lista inteira de militares.
    const selects = [...container.querySelectorAll('select')];
    const seletorOperador = selects.find(
      (s) => [...s.options].some((o) => o.textContent === 'Cap Silva'),
    );
    expect(seletorOperador).toBeTruthy();

    seletorOperador.value = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    seletorOperador.dispatchEvent(new Event('change'));
    await assentar();

    expect(servicos.getAproveitamentoTela).toHaveBeenCalledTimes(1);
    const pedido = servicos.getAproveitamentoTela.mock.calls[0][0];
    expect(pedido.usuarioUuid).toBe('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22');
    expect(pedido.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    cleanup();
  });

  test('mostra o aviso de truncamento que o servidor mandou', async () => {
    servicos.getCoberturaTela.mockResolvedValue({
      ...COBERTURA,
      aviso: 'Resultado truncado em 5000 amostras. Refine o filtro de lote, de operador ou de período.',
    });

    const { container, cleanup } = montar();
    await assentar();

    // SEM O AVISO, uma lista cortada se leria como "só trabalharam até aqui".
    expect(container.textContent).toMatch(/Resultado truncado em 5000 amostras/);
    cleanup();
  });

  test('devolve um cleanup que não estoura', async () => {
    const { cleanup } = montar();
    await assentar();
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});

describe('amostrasPorOperador', () => {
  test('conta as amostras por operador, da maior para a menor', () => {
    const linhas = amostrasPorOperador({
      features: [
        { properties: { usuario_uuid: 'a', usuario: 'Cap A' } },
        { properties: { usuario_uuid: 'b', usuario: 'Ten B' } },
        { properties: { usuario_uuid: 'b', usuario: 'Ten B' } },
      ],
    });

    expect(linhas).toEqual([
      { usuario_uuid: 'b', usuario: 'Ten B', amostras: 2 },
      { usuario_uuid: 'a', usuario: 'Cap A', amostras: 1 },
    ]);
  });

  // A TELEMETRIA NÃO TEM CHAVE ESTRANGEIRA PARA `dgeo.usuario` -- ela vive em
  // OUTRO banco --, então uma amostra pode citar uma conta que já foi apagada. A
  // linha NÃO some: ela é a prova de que aquele trabalho aconteceu, e escondê-la
  // faria o total da tela não bater com o do banco, sem dizer por quê.
  test('não descarta a amostra cujo operador o servidor não identificou', () => {
    const linhas = amostrasPorOperador({
      features: [{ properties: { usuario: 'Operador não identificado' } }],
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0].amostras).toBe(1);
    expect(linhas[0].usuario).toBe('Operador não identificado');
  });

  test('aceita coleção vazia e coleção ausente', () => {
    expect(amostrasPorOperador({ features: [] })).toEqual([]);
    expect(amostrasPorOperador(null)).toEqual([]);
  });
});
