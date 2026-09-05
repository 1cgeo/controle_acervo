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
//    TELA INTEIRA e a mensagem que sobra é a dela. Aqui o piso é o MESMO nas três
//    chamadas (`consulta` em `producao`) e o que difere é o BANCO: a lista de
//    lotes vem do principal e a telemetria vem de um banco separado que pode nem
//    existir, então a falha de uma não pode apagar o que a outra trouxe;
//
//  - O FILTRO DE LOTE PRECISA CHEGAR NA REQUISIÇÃO. Até 2026-08-09 a lista vinha
//    de `/acompanhamento/dashboard/execucao`, que devolve `lote_id` e `lote`, e a
//    tela lia `id` e `nome`: toda opção nascia "Lote undefined" e o pedido saía
//    SEM lote, mostrando a produção inteira como se fosse a do lote escolhido. O
//    fixture abaixo é a forma REAL de `/acompanhamento/lotes`, e um caso prende
//    o `loteId` na chamada seguinte -- era o teste que faltava;
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
  getLotesComProducao: vi.fn(),
}));

vi.mock('@services/microcontrole-service.js', () => ({
  getResumoFeicao: servicos.getResumoFeicao,
  getCoberturaTela: servicos.getCoberturaTela,
  getAproveitamentoTela: servicos.getAproveitamentoTela,
}));

vi.mock('@services/producao-service.js', () => ({
  getLotesComProducao: servicos.getLotesComProducao,
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

// A FORMA REAL DE `GET /api/acompanhamento/lotes`: `id`, `nome` e `projeto`, que
// é o que `lotesComProducao` seleciona. Escrever aqui uma forma que o servidor
// não produz é o que deixava a suíte verde com o filtro quebrado.
const LOTES = [
  { id: 7, nome: 'Lote Alfa', pit: 2026, projeto: 'Carta Topográfica' },
  { id: 9, nome: 'Lote Bravo', pit: 2026, projeto: 'Carta Topográfica' },
];

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

/** O seletor de lote, achado pelo placeholder dele (o outro select é o de operador). */
const seletorDeLote = (container) => [...container.querySelectorAll('select')].find(
  (s) => [...s.options].some((o) => o.textContent === 'Todos os lotes'),
);

beforeEach(() => {
  servicos.getResumoFeicao.mockResolvedValue(RESUMO);
  servicos.getCoberturaTela.mockResolvedValue(COBERTURA);
  servicos.getAproveitamentoTela.mockResolvedValue([]);
  servicos.getLotesComProducao.mockResolvedValue(LOTES);
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

  test('a lista de lotes vira opções com nome, e não "Lote undefined"', async () => {
    const { container, cleanup } = montar();
    await assentar();

    const seletorLote = seletorDeLote(container);
    const opcoes = [...seletorLote.options].map((o) => o.textContent);

    expect(opcoes).toEqual([
      'Todos os lotes',
      'Lote Alfa (Carta Topográfica)',
      'Lote Bravo (Carta Topográfica)',
    ]);
    // A rota de execução devolve `lote_id` e `lote`: ler `id` e `nome` de lá
    // daria três opções indistinguíveis, todas "Lote undefined".
    expect(opcoes.join(' ')).not.toMatch(/undefined/);
    cleanup();
  });

  test('o lote escolhido chega nas DUAS chamadas do filtro', async () => {
    const { container, cleanup } = montar();
    await assentar();

    servicos.getResumoFeicao.mockClear();
    servicos.getCoberturaTela.mockClear();

    const seletorLote = seletorDeLote(container);
    seletorLote.value = '9';
    seletorLote.dispatchEvent(new Event('change'));

    // O "Aplicar" é o que dispara: o filtro é um `form`, e o submit dele recarrega
    // as duas seções.
    container.querySelector('.microcontrole__filtro').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await assentar();

    // O TIPO É O DA RESPOSTA, e não a string do `<option>`: `createSelectField`
    // devolve o valor original. Com `undefined`, o helper `query()` do serviço
    // descartava o parâmetro e a medição saía da produção INTEIRA, sem 400 e sem
    // nada na tela dizendo que o filtro não pegou.
    expect(servicos.getResumoFeicao).toHaveBeenCalledTimes(1);
    expect(servicos.getResumoFeicao.mock.calls[0][0].loteId).toBe(9);
    expect(servicos.getCoberturaTela).toHaveBeenCalledTimes(1);
    expect(servicos.getCoberturaTela.mock.calls[0][0].loteId).toBe(9);
    cleanup();
  });

  test('sem lote escolhido, a medição sai de toda a produção', async () => {
    const { cleanup } = montar();
    await assentar();

    // `null`, e não a string vazia nem `undefined`: é o que o serviço omite da
    // query, e é o "todos os lotes" que a tela promete no placeholder.
    expect(servicos.getResumoFeicao.mock.calls[0][0].loteId).toBeNull();
    cleanup();
  });

  test('a falha da lista de lotes não apaga a medição', async () => {
    // A lista de lotes é `consulta` no `producao` e vem do banco PRINCIPAL: quem
    // não a alcança leva 403 nela e continua alcançando o resto.
    servicos.getLotesComProducao.mockRejectedValue(new Error('403'));

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

  // O PERÍODO INVERTIDO NÃO VAI AO SERVIDOR. O Joi de lá valida cada data
  // sozinha e não compara as duas: "de 08/09 até 08/08" é uma consulta válida
  // que volta vazia, e a tela diria "0 operação(ões) de feição" -- a frase de
  // quem não trabalhou, para um filtro digitado ao contrário.
  test('data final anterior à inicial vira erro no campo, e não uma tela zerada', async () => {
    const { container, cleanup } = montar();
    await assentar();

    servicos.getResumoFeicao.mockClear();
    servicos.getCoberturaTela.mockClear();

    const datas = [...container.querySelectorAll('input[type="date"]')];
    datas[1].value = '2020-01-01';
    container.querySelector('.microcontrole__filtro').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await assentar();

    expect(servicos.getResumoFeicao).not.toHaveBeenCalled();
    expect(servicos.getCoberturaTela).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(/A data final é anterior à inicial/);
    // E o que já estava na tela continua lá: ele é o último período válido.
    expect(container.textContent).toMatch(/Cap Silva/);
    cleanup();
  });

  // E O ERRO SOME AO CORRIGIR, e não só no próximo "Aplicar": a frase ficava sob
  // um par de datas que já estava certo, e quem a lê antes de clicar conclui que
  // corrigir não adiantou.
  test('corrigir a data final apaga o erro do período na hora', async () => {
    const { container, cleanup } = montar();
    await assentar();

    const datas = [...container.querySelectorAll('input[type="date"]')];
    datas[1].value = '2020-01-01';
    container.querySelector('.microcontrole__filtro').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await assentar();
    expect(container.textContent).toMatch(/A data final é anterior à inicial/);

    datas[1].value = '2030-01-01';
    datas[1].dispatchEvent(new Event('input'));
    await assentar();

    expect(container.textContent).not.toMatch(/A data final é anterior à inicial/);
    cleanup();
  });

  // DOIS "APLICAR" SEGUIDOS, RESPOSTAS FORA DE ORDEM. Sem a conferência do
  // filtro depois do `await`, a resposta do primeiro período pinta as tabelas
  // dela sob as datas do segundo, e o resumo afirma o número de um mês sobre o
  // período de outro.
  test('a resposta do período antigo não pinta por cima do novo', async () => {
    const { container, cleanup } = montar();
    await assentar();

    const liberar = new Map();
    servicos.getResumoFeicao.mockImplementation(filtro => new Promise((resolver) => {
      liberar.set(filtro.dataInicio, resolver);
    }));
    servicos.getCoberturaTela.mockResolvedValue({ type: 'FeatureCollection', features: [] });

    const datas = [...container.querySelectorAll('input[type="date"]')];
    const aplicar = () => container.querySelector('.microcontrole__filtro').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );

    datas[0].value = '2026-01-01';
    aplicar();
    await assentar();
    datas[0].value = '2026-02-01';
    aplicar();
    await assentar();

    // A SEGUNDA CHEGA PRIMEIRO, com um operador só.
    liberar.get('2026-02-01')({ por_operador: [], por_camada: [], serie_diaria: [] });
    await assentar();
    expect(container.textContent).toMatch(/0 operação\(ões\) de feição/);

    // E A PRIMEIRA CHEGA DEPOIS: descartada.
    liberar.get('2026-01-01')(RESUMO);
    await assentar();

    expect(container.textContent).toMatch(/0 operação\(ões\) de feição/);
    expect(container.textContent).not.toMatch(/Cap Silva/);
    cleanup();
  });

  test('devolve um cleanup que não estoura', async () => {
    const { cleanup } = montar();
    await assentar();
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  test('depois do cleanup, a resposta atrasada não escreve mais na tela', async () => {
    // A CHAMADA QUE VOLTA TARDE É O CASO REAL: a pessoa troca de rota enquanto a
    // telemetria ainda responde. Sem a guarda `disposed`, esta resolução pintaria
    // tabela num container que já saiu do documento.
    let liberar;
    servicos.getResumoFeicao.mockReturnValue(
      new Promise((resolver) => { liberar = resolver; }),
    );

    const { container, cleanup } = montar();
    cleanup();

    liberar(RESUMO);
    await assentar();

    expect(container.textContent).not.toMatch(/Cap Silva/);
    expect(container.textContent).not.toMatch(/edicao\.via_deslocamento/);
  });

  test('depois do cleanup, o "Aplicar" não dispara mais chamada', async () => {
    const { container, cleanup } = montar();
    await assentar();

    cleanup();
    servicos.getResumoFeicao.mockClear();
    servicos.getCoberturaTela.mockClear();

    container.querySelector('.microcontrole__filtro').dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await assentar();

    expect(servicos.getResumoFeicao).not.toHaveBeenCalled();
    expect(servicos.getCoberturaTela).not.toHaveBeenCalled();
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
