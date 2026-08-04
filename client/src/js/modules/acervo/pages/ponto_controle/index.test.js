import { describe, test, expect, vi, beforeEach } from 'vitest';

// O jsdom nao tem WebGL, entao o MapLibre real nao sobe. O duble registra o que
// a pagina PEDE ao mapa (quais pontos, o que esta selecionado, o que foi
// enquadrado, qual a area visivel), que e o contrato de verdade entre os dois.
// O desenho em si nao e o que estes testes protegem.
const mapaFalso = vi.hoisted(() => ({
  pontos: null,
  selecionados: null,
  apontado: undefined,
  enquadrado: null,
  enquadradoPonto: null,
  caixaVisivel: '-53,-31,-50,-29',
  onAlternarSelecao: null,
  onApontar: null,
  onMover: null,
  onAreaDesenhada: null,
  onAreaCancelada: null,
  areaMostrada: null,
  areaLimpa: 0,
  // Destaque do lugar filtrado: guarda o ULTIMO limite pintado e se ele
  // enquadrou, mais quantas vezes o destaque foi apagado.
  limiteDestacado: null,
  limiteEnquadrou: null,
  limiteLimpo: 0,
  iniciado: false,
  destruido: false,
}));

vi.mock('@modules/acervo/pages/ponto_controle/mapa.js', () => ({
  criarMapaPontos: ({
    onAlternarSelecao, onApontar, onMover, onAreaDesenhada, onAreaCancelada,
  }) => {
    mapaFalso.onAlternarSelecao = onAlternarSelecao;
    mapaFalso.onApontar = onApontar;
    mapaFalso.onMover = onMover;
    mapaFalso.onAreaDesenhada = onAreaDesenhada;
    mapaFalso.onAreaCancelada = onAreaCancelada;
    return {
      elemento: document.createElement('div'),
      iniciar: () => { mapaFalso.iniciado = true; return Promise.resolve(); },
      mostrar: (p) => { mapaFalso.pontos = p; },
      setSelecionados: (ids) => { mapaFalso.selecionados = [...ids]; },
      setApontado: (id) => { mapaFalso.apontado = id; },
      enquadrar: (c) => { mapaFalso.enquadrado = c; },
      enquadrarPonto: (id) => { mapaFalso.enquadradoPonto = id; return true; },
      caixaVisivel: () => mapaFalso.caixaVisivel,
      aviso: () => {},
      tratarTecla: () => false,
      mostrarArea: (g) => { mapaFalso.areaMostrada = g; },
      limparArea: () => { mapaFalso.areaLimpa += 1; },
      destacarLimite: (limite, opcoes) => {
        mapaFalso.limiteDestacado = limite;
        mapaFalso.limiteEnquadrou = !opcoes || opcoes.enquadrar !== false;
      },
      limparLimite: () => { mapaFalso.limiteLimpo += 1; },
      destruir: () => { mapaFalso.destruido = true; },
    };
  },
}));

vi.mock('@modules/acervo/pages/ponto_controle/ponto-dialog.js', () => ({
  abrirPontoDialog: vi.fn(),
}));

vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  buscarPontos: vi.fn(),
  buscarPosicoes: vi.fn(),
  getFacetas: vi.fn(),
  baixarPontosCsv: vi.fn(() => Promise.resolve()),
}));

vi.mock('@modules/acervo/services/limites-service.js', () => ({
  getLimite: vi.fn(),
}));

import { renderPontoControle } from '@modules/acervo/pages/ponto_controle/index.js';
import {
  buscarPontos, buscarPosicoes, getFacetas, baixarPontosCsv,
} from '@modules/acervo/services/ponto-controle-service.js';
import { getLimite } from '@modules/acervo/services/limites-service.js';
import { abrirPontoDialog } from '@modules/acervo/pages/ponto_controle/ponto-dialog.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PONTOS = [
  {
    id: 1, cod_ponto: 'RS-HV-1', lote_id: 70, lote: 'Missão 1', pit: 'PIT-01',
    projeto_id: 7, projeto: 'Copa Verde', data_rastreio: '2026-05-12',
    tipo_situacao: 3, tipo_situacao_nome: 'Aprovado', medidor: '3º Sgt Silva',
    altitude_ortometrica: 1024.35, longitude: -51.2, latitude: -30.1,
    total_arquivos: 3, total_mb: 42.5,
  },
  {
    id: 2, cod_ponto: 'RS-HV-2', lote_id: 70, lote: 'Missão 1', pit: 'PIT-01',
    projeto_id: 7, projeto: 'Copa Verde', data_rastreio: '2026-05-13',
    tipo_situacao: 2, tipo_situacao_nome: 'Aguardando revisão', medidor: 'Cb Souza',
    altitude_ortometrica: null, longitude: -50.4, latitude: -29.3,
    total_arquivos: 1, total_mb: 3.2,
  },
];

// As facetas trazem o quantitativo, e trazem tambem opcao com ZERO: e o que
// permite provar que a tela nao a mostra.
const FACETAS = {
  projetos: [
    { code: 7, nome: 'Copa Verde', pontos: 2 },
    { code: 8, nome: 'Fronteira Oeste', pontos: 0 },
  ],
  lotes: [
    { code: 70, nome: 'Missão 1', pit: 'PIT-01', projeto_id: 7, pontos: 2 },
    { code: 71, nome: 'Missão 2', pit: 'PIT-02', projeto_id: 7, pontos: 0 },
  ],
  // `code`, e nao `id`: e o nome que o servidor devolve em TODA faceta
  // (`SELECT es.id AS code`), e e por ele que o preencherFaceta monta o value da
  // opcao. Com `id`, a opcao nascia com value "undefined" e escolher um estado
  // na tela nao filtrava nada.
  estados: [
    { code: 43, sigla: 'RS', nome: 'Rio Grande do Sul', pontos: 2 },
  ],
  municipios: [
    { code: 4314902, nome: 'Porto Alegre', pontos: 2 },
  ],
};

const resposta = ({ pontos = PONTOS, total = 2, pagina = 1 } = {}) =>
  Promise.resolve({ total, pagina, pontos });

const cartoes = (c) => [...c.querySelectorAll('.busca-cartao')];
// Selecionar passou a ser o BOTAO do rodape (chefe, 2026-07-31); o cartao abre
// a ficha. As duas telas do acervo andam juntas: mesmo cartao, mesmo gesto.
const marcar = (c, i) => c.querySelectorAll('.busca-cartao')[i]
  .querySelector('.busca-cartao__selecionar').click();
const contador = (c) => c.querySelector('.busca-resultados__contador').textContent;
const ultimaBusca = () => buscarPontos.mock.calls[buscarPontos.mock.calls.length - 1][0];

// Os filtros de dominio viraram marcacao MULTIPLA em 2026-08-04. Os auxiliares
// abaixo dirigem o componente pelo mesmo gesto de quem usa a tela: abrir o
// painel, marcar a caixa, fechar.
const filtros = (c) => [...c.querySelectorAll('.filtro-multiplo')];
const filtro = (c, rotulo) => c
  .querySelector(`.filtro-multiplo__botao[aria-label="${rotulo}"]`)
  .closest('.filtro-multiplo');

/** Texto do botao: e o que a pessoa le sem abrir o painel. */
const rotulo = (raiz) => raiz.querySelector('.filtro-multiplo__texto').textContent;

/** Codigos marcados, na ordem em que aparecem no painel. */
const marcados = (raiz) => [...raiz.querySelectorAll('input[type="checkbox"]')]
  .filter(i => i.checked).map(i => i.value);

function abrir(raiz) {
  const botao = raiz.querySelector('.filtro-multiplo__botao');
  if (botao.getAttribute('aria-expanded') !== 'true') botao.click();
  return botao;
}

/** Marca (ou desmarca) um codigo, e fecha o painel para a repintura entrar. */
function marcarFiltro(raiz, valor, ligado = true) {
  const botao = abrir(raiz);
  const caixa = raiz.querySelector(`input[type="checkbox"][value="${valor}"]`);
  caixa.checked = ligado;
  caixa.dispatchEvent(new Event('change'));
  botao.click();
}

/** Opcoes do painel como 'Nome (N)', para comparar com o combo antigo. */
function opcoes(raiz) {
  const botao = abrir(raiz);
  const itens = [...raiz.querySelectorAll('.filtro-multiplo__opcao')].map((o) => {
    const nome = o.querySelector('.filtro-multiplo__nome').textContent;
    const total = o.querySelector('.filtro-multiplo__total');
    return total ? `${nome} (${total.textContent})` : nome;
  });
  botao.click();
  return itens;
}

async function montar(ctx = {}) {
  const container = document.createElement('div');
  const cleanup = await renderPontoControle(container, {
    params: {},
    query: new URLSearchParams(ctx.query || ''),
  });
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  vi.clearAllMocks();
  location.hash = '';
  buscarPontos.mockImplementation(() => resposta());
  buscarPosicoes.mockImplementation(() =>
    Promise.resolve({ total: PONTOS.length, pontos: PONTOS }));
  getFacetas.mockImplementation(() => Promise.resolve(FACETAS));
  getLimite.mockImplementation((tipo, id) => Promise.resolve({
    tipo, id: Number(id), nome: 'Rio Grande do Sul', sigla: 'RS',
    bbox: [-57.6, -33.7, -49.6, -27.0],
    geometria: {
      type: 'Polygon',
      coordinates: [[[-57.6, -33.7], [-49.6, -33.7], [-49.6, -27], [-57.6, -27], [-57.6, -33.7]]],
    },
  }));
  Object.assign(mapaFalso, {
    pontos: null, selecionados: null, apontado: undefined,
    enquadrado: null, enquadradoPonto: null,
    caixaVisivel: '-53,-31,-50,-29', iniciado: false, destruido: false,
    areaMostrada: null, areaLimpa: 0,
    limiteDestacado: null, limiteEnquadrou: null, limiteLimpo: 0,
  });
});

describe('tela de ponto de controle: lista e mapa', () => {
  test('lista os pontos e resume o total', async () => {
    const { container } = await montar();

    expect(cartoes(container)).toHaveLength(2);
    expect(contador(container)).toBe('2 pontos');
    expect(container.textContent).toContain('RS-HV-1');
    expect(container.textContent).toContain('Aprovado');
    expect(container.textContent).toContain('3 arquivos');
    // Um arquivo so nao vira "1 arquivos".
    expect(container.textContent).toContain('1 arquivo');
  });

  test('o mapa recebe o resultado INTEIRO, e nao a pagina', async () => {
    buscarPontos.mockImplementation(() => resposta({ pontos: [PONTOS[0]], total: 40 }));
    buscarPosicoes.mockImplementation(() => Promise.resolve({
      total: 40,
      pontos: Array.from({ length: 40 }, (_, i) => ({
        id: i + 1, cod_ponto: `RS-HV-${i + 1}`, tipo_situacao: 3,
        longitude: -51 + i * 0.01, latitude: -30,
      })),
    }));

    const { container } = await montar();
    expect(cartoes(container)).toHaveLength(1);
    // Quarenta pontos no mapa contra um cartao na lista: e o ponto da rota
    // separada. Mostrar so a pagina afirmaria que a missao tem um ponto ali.
    expect(mapaFalso.pontos).toHaveLength(40);
  });

  test('clicar no cartao abre a FICHA e leva o mapa ate o ponto, sem selecionar', async () => {
    const { container } = await montar();
    cartoes(container)[1].click();

    expect(abrirPontoDialog).toHaveBeenCalledWith(['RS-HV-2'], 0);
    // O enquadramento continua: fechada a ficha, o circulo ja esta no lugar.
    expect(mapaFalso.enquadradoPonto).toBe(2);
    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(false);
  });

  test('o botao do rodape seleciona, e clicar de novo desmarca', async () => {
    const { container } = await montar();
    const botao = () => cartoes(container)[0].querySelector('.busca-cartao__selecionar');

    expect(botao().getAttribute('aria-pressed')).toBe('false');

    botao().click();
    expect(mapaFalso.selecionados).toEqual([1]);
    expect(botao().getAttribute('aria-pressed')).toBe('true');
    expect(botao().textContent).toContain('Selecionado');
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(true);

    botao().click();
    expect(mapaFalso.selecionados).toEqual([]);
    expect(botao().getAttribute('aria-pressed')).toBe('false');
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(false);
  });

  test('o clique no MAPA seleciona o mesmo ponto', async () => {
    const { container } = await montar();
    mapaFalso.onAlternarSelecao(1);
    await flush();

    expect(mapaFalso.selecionados).toEqual([1]);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(true);
  });

  test('o clique no mapa seleciona ponto que NAO esta na pagina da lista', async () => {
    // O mapa mostra o resultado inteiro e a lista pagina de 20 em 20. Com 3.490
    // pontos no acervo, quase todo ponto clicavel esta fora da pagina: a tela
    // ficava sem responder ao clique, e parecia defeito do agrupamento.
    buscarPontos.mockImplementation(() => resposta({ pontos: [PONTOS[0]], total: 2 }));
    const { container } = await montar();
    expect(cartoes(container)).toHaveLength(1);

    mapaFalso.onAlternarSelecao(2);
    await flush();

    expect(mapaFalso.selecionados).toEqual([2]);
    // O chip usa o CODIGO, que vem das posicoes e nao do cartao.
    expect(container.textContent).toContain('RS-HV-2');
  });

  test('clicar de novo desmarca, mesmo fora da pagina', async () => {
    buscarPontos.mockImplementation(() => resposta({ pontos: [PONTOS[0]], total: 2 }));
    await montar();

    mapaFalso.onAlternarSelecao(2);
    await flush();
    // Sem este passo a prova passaria com o defeito presente: a selecao nasce
    // vazia, e "continuar vazia" nao distingue desmarcar de nunca ter marcado.
    expect(mapaFalso.selecionados).toEqual([2]);

    mapaFalso.onAlternarSelecao(2);
    await flush();
    expect(mapaFalso.selecionados).toEqual([]);
  });

  test('apontar no mapa acende o cartao, e apontar no cartao acende o ponto', async () => {
    const { container } = await montar();

    mapaFalso.onApontar(2);
    expect(cartoes(container)[1].classList.contains('busca-cartao--apontado')).toBe(true);
    expect(cartoes(container)[0].classList.contains('busca-cartao--apontado')).toBe(false);

    cartoes(container)[0].dispatchEvent(new Event('mouseenter'));
    expect(mapaFalso.apontado).toBe(1);
  });

  test('a barra de selecao aparece com chip por ponto, e o chip usa o CÓDIGO', async () => {
    const { container } = await montar();
    expect(container.querySelector('.busca-selecao').classList.contains('hidden')).toBe(true);

    marcar(container, 0);
    const barra = container.querySelector('.busca-selecao');
    expect(barra.classList.contains('hidden')).toBe(false);
    expect(barra.textContent).toContain('1 ponto selecionado');
    // Sem o rotulo proprio, o chip diria "Produto 1".
    expect(container.querySelector('.busca-selecao__chip-nome').textContent).toBe('RS-HV-1');
  });

  test('"Ver fichas" abre a ficha dos selecionados, na ordem', async () => {
    const { container } = await montar();
    marcar(container, 1);
    marcar(container, 0);

    container.querySelector('.busca-selecao__acoes .btn--primary').click();
    expect(abrirPontoDialog).toHaveBeenCalledWith(['RS-HV-2', 'RS-HV-1'], 0);
  });

  test('o botao do rodape NAO abre a ficha: ele so seleciona', async () => {
    const { container } = await montar();
    marcar(container, 0);

    expect(abrirPontoDialog).not.toHaveBeenCalled();
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(true);
  });
});

describe('tela de ponto de controle: facetas', () => {
  test('a opcao mostra o quantitativo, e o botao mostra o total', async () => {
    const { container } = await montar();
    // Nao ha filtro de SITUACAO desde 2026-07-29: so ponto aprovado entra no
    // acervo, entao a coluna e constante e o filtro nao discriminava nada.
    const projeto = filtro(container, 'Projeto');
    const lote = filtro(container, 'Lote (missão)');

    expect(opcoes(projeto)).toContain('Copa Verde (2)');
    expect(opcoes(lote)).toContain('Missão 1 (PIT-01) (2)');
    // Sem nada marcado, o botao diz quantos pontos a consulta devolve.
    expect(rotulo(projeto)).toBe('Todos os projetos (2)');
    expect(filtro(container, 'Estado')).toBeTruthy();
  });

  test('opcao SEM ponto nao aparece', async () => {
    const { container } = await montar();
    const projeto = filtro(container, 'Projeto');
    const lote = filtro(container, 'Lote (missão)');

    // Um filtro com os 86 lotes do acervo, dos quais dois tem ponto, faz a
    // pessoa procurar agulha.
    expect(opcoes(projeto).join()).not.toContain('Fronteira Oeste');
    expect(opcoes(lote).join()).not.toContain('Missão 2');
  });

  test('a opcao MARCADA sobrevive mesmo caindo a zero', async () => {
    // O servidor devolve a faceta com o proprio filtro aplicado zerado quando
    // ele nao casa com mais nada. Some-la tiraria da tela o filtro que produziu
    // o vazio, e a pessoa nao teria o que desfazer.
    getFacetas.mockImplementation(() => Promise.resolve({
      ...FACETAS,
      lotes: [{ code: 71, nome: 'Missão 2', pit: 'PIT-02', projeto_id: 7, pontos: 0 }],
    }));
    const { container } = await montar({ query: 'lote_id=71' });
    const lote = filtro(container, 'Lote (missão)');

    expect(opcoes(lote).join()).toContain('Missão 2 (PIT-02) (0)');
    expect(marcados(lote)).toEqual(['71']);
  });

  test('as facetas recebem os MESMOS filtros da lista', async () => {
    await montar({ query: 'projeto_id=7' });
    const chamada = getFacetas.mock.calls[getFacetas.mock.calls.length - 1][0];
    expect(chamada.projeto_id).toEqual(['7']);
  });

  test('marcar um projeto reconsulta, e a lista de lote se estreita', async () => {
    const { container } = await montar();
    const projeto = filtro(container, 'Projeto');
    const lote = filtro(container, 'Lote (missão)');

    getFacetas.mockImplementation(() => Promise.resolve({
      ...FACETAS,
      lotes: [{ code: 70, nome: 'Missão 1', pit: 'PIT-01', projeto_id: 7, pontos: 2 }],
    }));

    marcarFiltro(projeto, '7');
    await flush();

    expect(ultimaBusca().projeto_id).toEqual(['7']);
    expect(opcoes(lote)).toEqual(['Missão 1 (PIT-01) (2)']);
  });

  test('marcar DOIS projetos pergunta pelos dois de uma vez', async () => {
    // A razao de o filtro ter deixado de ser combo (chefe, 2026-08-04): antes,
    // responder "o que existe nos dois projetos" custava duas consultas.
    const { container } = await montar();
    const projeto = filtro(container, 'Projeto');

    // Com o primeiro marcado, a faceta passa a contar ponto nos dois.
    getFacetas.mockImplementation(() => Promise.resolve({
      ...FACETAS,
      projetos: [
        { code: 7, nome: 'Copa Verde', pontos: 2 },
        { code: 8, nome: 'Fronteira Oeste', pontos: 3 },
      ],
    }));

    marcarFiltro(projeto, '7');
    await flush();
    marcarFiltro(projeto, '8');
    await flush();

    expect(ultimaBusca().projeto_id).toEqual(['7', '8']);
    expect(rotulo(projeto)).toBe('2 projetos');
  });

  test('desmarcar a ultima opcao tira o filtro, e nao manda lista vazia', async () => {
    const { container } = await montar();
    const projeto = filtro(container, 'Projeto');

    marcarFiltro(projeto, '7');
    await flush();
    marcarFiltro(projeto, '7', false);
    await flush();

    expect(ultimaBusca().projeto_id).toEqual([]);
    expect(location.hash).not.toContain('projeto_id');
  });

  test('"Limpar" dentro do painel desmarca tudo de uma vez', async () => {
    const { container } = await montar();
    const projeto = filtro(container, 'Projeto');

    getFacetas.mockImplementation(() => Promise.resolve({
      ...FACETAS,
      projetos: [
        { code: 7, nome: 'Copa Verde', pontos: 2 },
        { code: 8, nome: 'Fronteira Oeste', pontos: 3 },
      ],
    }));

    marcarFiltro(projeto, '7');
    await flush();
    marcarFiltro(projeto, '8');
    await flush();

    abrir(projeto);
    projeto.querySelector('.filtro-multiplo__limpar').click();
    await flush();

    expect(marcados(projeto)).toEqual([]);
    expect(ultimaBusca().projeto_id).toEqual([]);
    // O total do rotulo e a soma da faceta corrente: 2 + 3 dos dois projetos.
    expect(rotulo(projeto)).toBe('Todos os projetos (5)');
  });

  test('filtro sem nenhuma opcao diz que nao ha o que marcar', async () => {
    getFacetas.mockImplementation(() => Promise.resolve({
      projetos: [], lotes: [],
    }));
    const { container } = await montar();
    const projeto = filtro(container, 'Projeto');
    abrir(projeto);

    expect(opcoes(projeto)).toEqual([]);
    expect(projeto.querySelector('.filtro-multiplo__vazio').classList.contains('hidden'))
      .toBe(false);
    expect(filtros(container).length).toBeGreaterThan(0);
  });
});

/** Um quadrado qualquer: o que importa é o caminho, não a forma. */
const AREA = {
  type: 'Polygon',
  coordinates: [[[-53, -31], [-50, -31], [-50, -29], [-53, -29], [-53, -31]]],
};

/**
 * O chip esta A VISTA?
 *
 * Pelo `hidden`, e nao pelo texto: o jsdom nao aplica CSS, entao o chip
 * escondido continua no `textContent` e a prova passaria com o chip na tela.
 */
const chipVisivel = (container) => {
  const chip = container.querySelector('.busca-area-chip');
  return !!chip && !chip.classList.contains('hidden');
};

describe('tela de ponto de controle: filtros, área e exportação', () => {
  test('o filtro que veio no link e aplicado ja na PRIMEIRA consulta', async () => {
    await montar({ query: 'projeto_id=7&lote_id=70&estado_id=43&cod_ponto=HV' });

    // A primeira chamada, e nao a ultima: os filtros nascem marcados com o que
    // veio na URL justamente para que a consulta inicial ja o aplique.
    const primeira = buscarPontos.mock.calls[0][0];
    expect(primeira.projeto_id).toEqual(['7']);
    expect(primeira.lote_id).toEqual(['70']);
    expect(primeira.estado_id).toEqual(['43']);
    expect(primeira.cod_ponto).toBe('HV');

    expect(location.hash).toContain('projeto_id=7');
  });

  test('"só na área do mapa" manda a bbox e para de reenquadrar', async () => {
    const { container } = await montar();
    mapaFalso.enquadrado = null;

    const seguir = container.querySelector('#pc-seguir-mapa');
    seguir.checked = true;
    seguir.dispatchEvent(new Event('change'));
    await flush();

    expect(ultimaBusca().bbox).toBe('-53,-31,-50,-29');
    // Reenquadrar aqui mudaria a area, que mudaria o resultado: o laco nao
    // fecharia nunca.
    expect(mapaFalso.enquadrado).toBeNull();
  });

  test('mover o mapa so reconsulta quando a consulta segue o mapa', async () => {
    const { container } = await montar();
    const antes = buscarPontos.mock.calls.length;

    mapaFalso.onMover();
    await new Promise(r => setTimeout(r, 600));
    expect(buscarPontos.mock.calls.length).toBe(antes);

    const seguir = container.querySelector('#pc-seguir-mapa');
    seguir.checked = true;
    seguir.dispatchEvent(new Event('change'));
    await flush();

    const depois = buscarPontos.mock.calls.length;
    mapaFalso.onMover();
    await new Promise(r => setTimeout(r, 600));
    expect(buscarPontos.mock.calls.length).toBeGreaterThan(depois);
  });

  test('sem seguir o mapa, a camera vai para a caixa de TODOS os pontos', async () => {
    await montar();
    expect(mapaFalso.enquadrado).toEqual([-51.2, -30.1, -50.4, -29.3]);
  });

  test('"Limpar filtros" zera tudo, inclusive a selecao', async () => {
    const { container } = await montar({ query: 'projeto_id=7&cod_ponto=HV' });
    marcar(container, 0);

    container.querySelector('.busca__acoes .btn--text').click();
    await flush();

    const filtros = ultimaBusca();
    expect(filtros.projeto_id).toEqual([]);
    expect(filtros.cod_ponto).toBe('');
    expect(container.querySelector('.busca-selecao').classList.contains('hidden')).toBe(true);
  });

  test('a area desenhada vira o filtro `geometria`, e aparece no link', async () => {
    const { container } = await montar();

    mapaFalso.onAreaDesenhada(AREA);
    await flush();

    expect(ultimaBusca().geometria).toBe(JSON.stringify(AREA));
    expect(chipVisivel(container)).toBe(true);
    expect(container.querySelector('.busca-area-chip').textContent)
      .toContain('Área desenhada no mapa');
    expect(decodeURIComponent(location.hash)).toContain('"type":"Polygon"');
  });

  test('desenhar DESLIGA o "so na area do mapa": o recorte e um so', async () => {
    const { container } = await montar();
    const seguir = container.querySelector('#pc-seguir-mapa');
    seguir.checked = true;
    seguir.dispatchEvent(new Event('change'));
    await flush();
    expect(ultimaBusca().bbox).toBe('-53,-31,-50,-29');

    mapaFalso.onAreaDesenhada(AREA);
    await flush();

    // Os dois juntos pediriam a interseção do retângulo com o polígono, que
    // ninguém desenhou e ninguém consegue ler na tela.
    expect(ultimaBusca().bbox).toBe('');
    expect(seguir.checked).toBe(false);
  });

  test('remarcar "so na area do mapa" apaga o desenho DO MAPA, e nao so o filtro', async () => {
    const { container } = await montar();
    mapaFalso.onAreaDesenhada(AREA);
    await flush();

    const seguir = container.querySelector('#pc-seguir-mapa');
    seguir.checked = true;
    seguir.dispatchEvent(new Event('change'));
    await flush();

    expect(ultimaBusca().geometria).toBe('');
    // Sem isto o polígono continuaria pintado no mapa afirmando um recorte que
    // a consulta não usa mais.
    expect(mapaFalso.areaLimpa).toBeGreaterThan(0);
    expect(chipVisivel(container)).toBe(false);
  });

  test('o × do chip tira a area e reconsulta', async () => {
    const { container } = await montar();
    mapaFalso.onAreaDesenhada(AREA);
    await flush();

    container.querySelector('.busca-area-chip__remover').click();
    await flush();

    expect(ultimaBusca().geometria).toBe('');
    expect(mapaFalso.areaLimpa).toBeGreaterThan(0);
  });

  test('a area que veio no LINK e restaurada no mapa e na consulta', async () => {
    await montar({ query: `geometria=${encodeURIComponent(JSON.stringify(AREA))}` });

    expect(buscarPontos.mock.calls[0][0].geometria).toBe(JSON.stringify(AREA));
    // Restaurar só o filtro deixaria a consulta recortada sem nada no mapa que
    // dissesse por quê.
    expect(mapaFalso.areaMostrada).toEqual(AREA);
  });

  test('geometria quebrada no link nao derruba a tela', async () => {
    const { container } = await montar({ query: 'geometria=%7Bnao-e-json' });

    expect(cartoes(container)).toHaveLength(2);
    expect(buscarPontos.mock.calls[0][0].geometria).toBe('');
  });

  test('"Limpar filtros" tira tambem a area desenhada', async () => {
    const { container } = await montar();
    mapaFalso.onAreaDesenhada(AREA);
    await flush();

    container.querySelector('.busca__acoes .btn--text').click();
    await flush();

    expect(ultimaBusca().geometria).toBe('');
    expect(chipVisivel(container)).toBe(false);
  });

  test('exportar CSV leva os filtros e NAO a pagina', async () => {
    const { container } = await montar({ query: 'projeto_id=7' });
    const botoes = [...container.querySelectorAll('.busca__acoes button')];
    botoes[botoes.length - 1].click();
    await flush();

    const [filtros, nome] = baixarPontosCsv.mock.calls[0];
    expect(filtros.projeto_id).toEqual(['7']);
    expect(filtros.pagina).toBeUndefined();
    expect(filtros.ids).toBeNull();
    expect(nome).toBe('pontos-de-controle.csv');
  });

  test('o botao de exportar selecionados so aparece com selecao, e leva os ids', async () => {
    const { container } = await montar();
    const selecionadosBtn = [...container.querySelectorAll('.busca__acoes button')]
      .find(b => b.textContent.includes('selecionado'));
    expect(selecionadosBtn.classList.contains('hidden')).toBe(true);

    marcar(container, 0);
    marcar(container, 1);
    expect(selecionadosBtn.classList.contains('hidden')).toBe(false);
    expect(selecionadosBtn.textContent).toContain('2 selecionados');

    selecionadosBtn.click();
    await flush();
    const [filtros, nome] = baixarPontosCsv.mock.calls[0];
    expect(filtros.ids).toBe('1,2');
    expect(nome).toBe('pontos-selecionados.csv');
  });
});

describe('tela de ponto de controle: robustez', () => {
  test('a paginacao aparece so quando ha mais de uma pagina', async () => {
    const { container } = await montar();
    expect(container.querySelector('.busca-paginacao').children.length).toBe(0);

    buscarPontos.mockImplementation(() => resposta({ total: 50 }));
    const outra = await montar();
    expect(outra.container.textContent).toContain('Página 1 de 3');

    const [anterior, proxima] = outra.container.querySelectorAll('.busca-paginacao button');
    // `disabled: false` passado ao el() vira `disabled="false"` no HTML, que
    // desabilita o botao. Isto ja pegou um bug real.
    expect(anterior.disabled).toBe(true);
    expect(proxima.disabled).toBe(false);

    buscarPontos.mockImplementation(() => resposta({ total: 50, pagina: 2 }));
    proxima.click();
    await flush();
    expect(ultimaBusca().pagina).toBe(2);
  });

  test('lista vazia nao deixa o resumo em branco', async () => {
    buscarPontos.mockImplementation(() => resposta({ pontos: [], total: 0 }));
    buscarPosicoes.mockImplementation(() => Promise.resolve({ total: 0, pontos: [] }));
    const { container } = await montar();

    expect(contador(container)).toBe('Nenhum ponto de controle encontrado.');
    expect(cartoes(container)).toHaveLength(0);
    expect(container.textContent).toContain('Nenhum ponto de controle com esses filtros.');
    expect(mapaFalso.pontos).toEqual([]);
  });

  test('consulta que falha avisa, em vez de deixar a tela mentindo o resultado antigo', async () => {
    const { container } = await montar();
    expect(cartoes(container)).toHaveLength(2);

    buscarPontos.mockImplementation(() => Promise.reject(new Error('sem rede')));
    container.querySelector('#pc-seguir-mapa').dispatchEvent(new Event('change'));
    await flush();

    expect(contador(container)).toBe('A consulta falhou.');
    expect(cartoes(container)).toHaveLength(0);
  });

  test('resposta atrasada de uma consulta antiga nao pinta sobre a nova', async () => {
    const { container } = await montar();

    let liberarAntiga;
    buscarPontos.mockImplementationOnce(() => new Promise(r => { liberarAntiga = r; }));
    const codigo = container.querySelector('.busca-campo__input');
    codigo.value = 'RS';
    codigo.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 400));

    buscarPontos.mockImplementation(() => resposta({ pontos: [PONTOS[0]], total: 1 }));
    codigo.value = 'RS-HV-1';
    codigo.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 400));

    // A antiga so responde AGORA, depois de a nova ja ter pintado.
    liberarAntiga({ total: 999, pagina: 1, pontos: PONTOS });
    await flush();

    expect(contador(container)).toBe('1 ponto');
    expect(cartoes(container)).toHaveLength(1);
  });

  // --- Destaque do lugar filtrado (chefe, 2026-07-29) ------------------------
  //
  // O filtro por lugar era invisivel no mapa: escolher um estado mudava a lista
  // e deixava a camera onde estava, entao a tela nao dizia ONDE o recorte caiu.

  test('marcar o estado pinta o contorno e leva a camera ate ele', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();

    expect(getLimite).toHaveBeenCalledWith('estado', '43');
    // Uma LISTA de limites desde 2026-08-04: o filtro marca varios estados.
    expect(mapaFalso.limiteDestacado[0].bbox).toEqual([-57.6, -33.7, -49.6, -27.0]);
    expect(mapaFalso.limiteEnquadrou).toBe(true);
  });

  test('o MUNICIPIO ganha do estado: e o recorte que a consulta aplica', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');
    const municipio = filtro(container, 'Município');

    marcarFiltro(estado, '43');
    await flush();

    marcarFiltro(municipio, '4314902');
    await flush();

    expect(getLimite).toHaveBeenLastCalledWith('municipio', '4314902');
  });

  test('tirar o lugar apaga o contorno, sem mexer na camera', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();
    expect(mapaFalso.limiteLimpo).toBe(0);

    marcarFiltro(estado, '43', false);
    await flush();

    expect(mapaFalso.limiteLimpo).toBe(1);
  });

  test('com lugar destacado, o resultado NAO reenquadra o mapa por cima', async () => {
    const { container } = await montar();
    // Sem lugar, a consulta enquadra nos pontos, como sempre fez.
    expect(mapaFalso.enquadrado).not.toBeNull();

    const estado = filtro(container, 'Estado');
    mapaFalso.enquadrado = null;
    marcarFiltro(estado, '43');
    await flush();

    // Enquadrar nos pontos aqui tiraria a borda vermelha da vista logo depois
    // de ela aparecer, e o destaque perderia a razao de existir.
    expect(mapaFalso.enquadrado).toBeNull();
  });

  test('o lugar que veio no LINK aparece destacado', async () => {
    await montar({ query: 'estado_id=43' });

    expect(getLimite).toHaveBeenCalledWith('estado', '43');
    expect(mapaFalso.limiteDestacado).not.toBeNull();
    expect(mapaFalso.limiteEnquadrou).toBe(true);
  });

  test('link com area desenhada destaca o lugar SEM mover a camera', async () => {
    await montar({
      query: `estado_id=43&geometria=${encodeURIComponent(JSON.stringify(AREA))}`,
    });

    // Quem mandou o link ja escolheu onde a camera devia parar. O zoom no
    // estado jogaria a area desenhada para fora da tela.
    expect(mapaFalso.limiteDestacado).not.toBeNull();
    expect(mapaFalso.limiteEnquadrou).toBe(false);
  });

  test('o contorno que falha nao derruba a consulta', async () => {
    getLimite.mockImplementation(() => Promise.reject(new Error('sem rede')));
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();

    // O destaque e apoio visual. Sem ele a tela perde a borda, e nao a lista.
    expect(mapaFalso.limiteDestacado).toBeNull();
    expect(cartoes(container)).toHaveLength(2);
    expect(ultimaBusca().estado_id).toEqual(['43']);
  });

  test('marcar DOIS estados destaca os dois e enquadra a uniao', async () => {
    getFacetas.mockImplementation(() => Promise.resolve({
      ...FACETAS,
      estados: [
        { code: 43, sigla: 'RS', nome: 'Rio Grande do Sul', pontos: 2 },
        { code: 42, sigla: 'SC', nome: 'Santa Catarina', pontos: 1 },
      ],
    }));
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();
    marcarFiltro(estado, '42');
    await flush();

    // Enquadrar so o primeiro deixaria o outro fora da tela, dizendo que o
    // recorte e menor do que e.
    expect(mapaFalso.limiteDestacado).toHaveLength(2);
    expect(ultimaBusca().estado_id).toEqual(['43', '42']);
  });

  test('o cleanup solta o mapa e a altura fixa', async () => {
    const { container, cleanup } = await montar();
    expect(container.classList.contains('main-content--altura-fixa')).toBe(true);

    cleanup();

    expect(mapaFalso.destruido).toBe(true);
    expect(container.classList.contains('main-content--altura-fixa')).toBe(false);
  });
});
