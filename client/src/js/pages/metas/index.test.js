import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A TELA DO PIT DO ANO (#/metas), que substituiu "Metas do PIT" e "Revisões do
// PIT".
//
// O que ela fixa, e é a decisão do chefe: o texto assinado é o rei, e o que está
// no sistema é transcrição dele. Nenhuma meta se altera solta: escolhe-se a
// REVISÃO e edita-se dentro dela. Sumiram "Editar", "Corrigir transcrição",
// "Corrigir cadastro" e "Excluir meta" avulso.

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getMetasPit: vi.fn(() => Promise.resolve([])),
    getAnosMetaPit: vi.fn(() => Promise.resolve([2027, 2026])),
    deleteMetaPit: vi.fn(() => Promise.resolve()),
    removerDeclaracao: vi.fn(() => Promise.resolve()),
    excluirRevisao: vi.fn(() => Promise.resolve()),
    listarExercicios: vi.fn(() => Promise.resolve([])),
    listarRevisoes: vi.fn(() => Promise.resolve([])),
    getAlteracoesRevisao: vi.fn(() => Promise.resolve([])),
    getDiagnosticoPit: vi.fn(() => Promise.resolve([])),
  };
});
vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: () => ({ element: document.createElement('div'), recarregar: vi.fn() }),
}));
// A confirmação responde SIM sozinha: o que se prova aqui é o que acontece
// DEPOIS dela, e clicar no botão do modal só acrescentaria ruído.
vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

import { renderPitAno } from '@pages/metas/index.js';
import {
  getMetasPit, getAnosMetaPit, listarExercicios, listarRevisoes, getAlteracoesRevisao,
  deleteMetaPit, getDiagnosticoPit,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

const ANO = new Date().getFullYear();

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({
    token: 't', administrador, uuid: 'u', perfis, modulos: [],
  }, 'x');
}

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderPitAno(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const EXERCICIO = {
  ano: ANO, situacao_id: 1, situacao: 'Em elaboração', observacao: null,
  metas: 3, revisoes: 2,
};

const R0 = {
  id: 7, ano: ANO, codigo: 'R0', rascunho: false, data_vigencia: `${ANO}-01-15`,
  data_documento: `${ANO}-01-10`, assinante: 'Gen Div Fulano', alteracoes: 3, anexos: 1,
};
const R1 = {
  id: 8, ano: ANO, codigo: 'R1', rascunho: true, data_vigencia: null,
  data_documento: null, assinante: null, alteracoes: 1, anexos: 0,
};

// O CONSOLIDADO, como `pit.meta_vigente` o devolve. `declaracoes` e
// `revisao_criadora_id` são as duas colunas que o servidor passou a mandar para
// a tela saber quando APAGAR a meta ainda é possível.
const METAS = [
  {
    id: 1, ano: ANO, numero_meta: 4, item: '4.1', descricao: 'Impressão em sulfite',
    quantidade_prevista: 327, unidade: 'Folha', revisao_id: 7, revisao: 'R0',
    declaracoes: 1, revisao_criadora_id: 7, credito_nc: '0.00', pdr_autorizado: null,
  },
  {
    id: 2, ano: ANO, numero_meta: 4, item: '4.2', descricao: 'Impressão em Tyvek',
    quantidade_prevista: 252, unidade: 'Folha', revisao_id: 8, revisao: 'R1',
    declaracoes: 2, revisao_criadora_id: 7, credito_nc: '0.00', pdr_autorizado: null,
  },
  {
    id: 3, ano: ANO, numero_meta: 1, item: '-', descricao: 'Produção de Geoinformação',
    quantidade_prevista: null, revisao_id: null, revisao: null,
    declaracoes: 0, revisao_criadora_id: null, credito_nc: '0.00', pdr_autorizado: null,
  },
];

const ALTERACOES_R1 = [
  {
    meta_id: 2, numero_meta: 4, item: '4.2', descricao: 'Impressão em Tyvek',
    quantidade_prevista: 252, quantidade_anterior: 247, prazo: null, prazo_anterior: null,
    demandante: null, cancelada: false, meta_nova: false,
  },
];

const acaoPorTitulo = (raiz, prefixo) =>
  [...raiz.querySelectorAll('.data-table__action-btn')]
    .filter((b) => String(b.getAttribute('title') || '').startsWith(prefixo));

const revisaoBtn = (container, codigo) =>
  [...container.querySelectorAll('.pit-revisao')]
    .find((b) => b.textContent.startsWith(codigo));

describe('PIT do ano: o exercício e as revisões em cima', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([2027, 2026]);
    getMetasPit.mockResolvedValue(METAS);
    listarExercicios.mockResolvedValue([EXERCICIO]);
    listarRevisoes.mockResolvedValue([R0, R1]);
    getAlteracoesRevisao.mockResolvedValue([]);
  });

  test('a tela junta o exercício, as revisões e o consolidado', async () => {
    logar({ perfis: { mapoteca: 3 } });

    const { container, cleanup } = await montar();

    // O EXERCÍCIO, com a situação: 'Em elaboração' é o estado em que o PIT do
    // ano seguinte se monta, e o servidor já aceita alteração nele.
    expect(container.querySelector('.pit-exercicio').textContent)
      .toContain('Em elaboração');
    // AS REVISÕES do ano, como faixa de escolha.
    expect(container.querySelectorAll('.pit-revisao').length).toBe(2);
    // O CONSOLIDADO, com uma linha por meta.
    expect(container.querySelectorAll('tbody tr').length).toBe(3);

    // Rede contra o falso verde: a tela abriu de verdade, e não vazia por falta
    // de sessão.
    expect(container.querySelector('.page__title').textContent).toBe('PIT do ano');

    if (typeof cleanup === 'function') cleanup();
  });

  // A FRASE QUE ENSINA O MODELO, e ela está em DOIS lugares: no cabeçalho (o
  // princípio) e acima da tabela (o que fazer agora).
  //
  // CONTROLE NEGATIVO: as duas telas antigas diziam "abra a revisão do ano" com
  // um LINK para outra rota. Esta asserção reprova aquele estado, porque exige a
  // frase sem sair da página.
  // O SUBTÍTULO SAIU em 2026-08-06. Ele explicava que o PIT é o texto assinado
  // pela DSG e que meta se edita dentro da revisão. A tela diz o mesmo pela
  // FORMA: a faixa de revisões vem antes da grade, e ação de linha só aparece
  // com uma revisão escolhida (o caso seguinte prende isso).
  test('o cabeçalho não explica mais o modelo, e não leva a outra tela', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    expect(container.querySelector('.page__subtitle')).toBeNull();
    // A ausência do parágrafo não pode ter levado o título junto.
    expect(container.querySelector('.page__title').textContent).toBe('PIT do ano');
    expect(container.querySelector('.page__header a[href="#/revisoes_pit"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // SEM REVISÃO ESCOLHIDA NÃO HÁ ATO. É o que a tela ensina, e é o oposto do que
  // havia: a tela de metas oferecia "Corrigir transcrição", "Corrigir cadastro"
  // e "Excluir" em toda linha, sem revisão nenhuma na frente.
  test('sem revisão escolhida, o administrador não recebe ação de linha nenhuma', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    expect(container.querySelector('.data-table__action-btn')).toBeNull();
    expect(container.querySelector('.pit-sem-revisao').textContent)
      .toMatch(/escolha uma revis(ã|a)o/i);
    // E "Meta nova" existe, mas barrado, com o motivo no title.
    const nova = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Meta nova'));
    expect(nova.disabled).toBe(true);
    expect(nova.title).toMatch(/revis(ã|a)o/i);

    if (typeof cleanup === 'function') cleanup();
  });

  // CONTROLE NEGATIVO do teste acima: escolhendo a revisão, as ações aparecem.
  // Sem esta prova, "nenhuma ação" passaria numa tela que nunca as oferece.
  test('escolhida a revisão, a linha ganha as ações e "Meta nova" libera', async () => {
    logar({ administrador: true });
    getAlteracoesRevisao.mockResolvedValue(ALTERACOES_R1);

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R1').click();
    await flush();

    expect(acaoPorTitulo(container, 'Alterar a meta nesta revisão').length).toBe(3);
    expect(getAlteracoesRevisao).toHaveBeenCalledWith(8);

    const nova = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Meta nova'));
    expect(nova.disabled).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  // A COLUNA "NESTA REVISÃO" diz o que a revisão escolhida faz com cada linha. A
  // tabela `pit.meta_item_revisao` é esparsa: a meta que a revisão não toca não tem
  // linha nela, e aqui isso vira um '-'.
  test('a coluna "Nesta revisão" marca só a meta que a revisão altera', async () => {
    logar({ administrador: true });
    getAlteracoesRevisao.mockResolvedValue(ALTERACOES_R1);

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R1').click();
    await flush();

    const th = [...container.querySelectorAll('th')].map((c) => c.textContent);
    expect(th).toContain('Nesta revisão');
    const coluna = th.indexOf('Nesta revisão') + 1;
    const marcas = [...container.querySelectorAll(`tbody tr td:nth-child(${coluna})`)]
      .map((td) => td.textContent);
    expect(marcas).toEqual(['-', 'Altera', '-']);

    if (typeof cleanup === 'function') cleanup();
  });

  // DE QUE REVISÃO VEIO A LINHA. É o que torna "consolidado" concreto: a 4.2 diz
  // 252 pelo R1, e a 4.1 continua com o que o R0 declarou.
  test('a coluna "Pelo" mostra a revisão que declarou cada meta', async () => {
    logar({ perfis: { mapoteca: 3 } });

    const { container, cleanup } = await montar();

    const th = [...container.querySelectorAll('th')].map((c) => c.textContent);
    const coluna = th.indexOf('Pelo') + 1;
    const pelo = [...container.querySelectorAll(`tbody tr td:nth-child(${coluna})`)]
      .map((td) => td.textContent);
    expect(pelo).toEqual(['R0', 'R1', '-']);

    if (typeof cleanup === 'function') cleanup();
  });
});

// APAGAR A META, e a regra que o chefe decidiu: a primeira criação pode ser
// apagada, porque a meta pode ter nascido errada e o documento assinado talvez
// nem a tenha. Da segunda declaração em diante só resta CANCELAR.
describe('PIT do ano: apagar a meta só na revisão que a criou', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([2027, 2026]);
    getMetasPit.mockResolvedValue(METAS);
    listarExercicios.mockResolvedValue([EXERCICIO]);
    listarRevisoes.mockResolvedValue([R0, R1]);
    getAlteracoesRevisao.mockResolvedValue([]);
  });

  test('no R0, só a meta que ele criou oferece apagar', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R0').click();
    await flush();

    const linhas = [...container.querySelectorAll('tbody tr')];
    // A 4.1 tem UMA declaração, e ela é do R0: apaga.
    expect(linhas[0].querySelector('[title^="Apagar a meta"]')).not.toBeNull();
    // CONTROLE NEGATIVO: a 4.2 tem DUAS declarações. Ela já entrou na história
    // do plano, e o que cabe é cancelar. Antes desta regra o botão de excluir
    // aparecia em toda linha, e esta asserção reprova aquele estado.
    expect(linhas[1].querySelector('[title^="Apagar a meta"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('no R1, a meta que o R0 criou não oferece apagar', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R1').click();
    await flush();

    const linhas = [...container.querySelectorAll('tbody tr')];
    // Estando noutra revisão, o que cabe é CANCELAR: o servidor recusaria com
    // "a meta foi criada pela revisão R0", e oferecer o botão entregaria um 400.
    expect(linhas[0].querySelector('[title^="Apagar a meta"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // TIRAR DA REVISÃO é desfazer o acréscimo, e só no rascunho: na publicada esta
  // linha é o que o relatório daquele mês reportou.
  test('tirar da revisão aparece só no rascunho, e só na meta que ele declara', async () => {
    logar({ administrador: true });
    getAlteracoesRevisao.mockResolvedValue(ALTERACOES_R1);

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R1').click();
    await flush();

    const linhas = [...container.querySelectorAll('tbody tr')];
    expect(linhas[1].querySelector('[title^="Tirar a meta desta revisão"]')).not.toBeNull();
    expect(linhas[0].querySelector('[title^="Tirar a meta desta revisão"]')).toBeNull();

    // CONTROLE NEGATIVO: no R0, que é PUBLICADO, a ação some inteira.
    revisaoBtn(container, 'R0').click();
    await flush();
    expect(container.querySelector('[title^="Tirar a meta desta revisão"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('PIT do ano: o que a revisão escolhida diz', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([2027, 2026]);
    getMetasPit.mockResolvedValue(METAS);
    listarExercicios.mockResolvedValue([EXERCICIO]);
    listarRevisoes.mockResolvedValue([R0, R1]);
    getAlteracoesRevisao.mockResolvedValue([]);
  });

  // A REVISÃO PUBLICADA PODE SER EDITADA, e a nota diz por quê: o texto assinado
  // é o rei, e editar aqui conserta a nossa cópia.
  //
  // CONTROLE NEGATIVO: a tela antiga escrevia "O que ela declara não se altera
  // mais" na revisão publicada, e esta asserção reprova aquele texto.
  // A NOTA DA REVISÃO PUBLICADA SAIU em 2026-08-06. A primeira metade repetia o
  // botão da revisão escolhida, logo acima, que já traz o código e o "Rege
  // desde"; a segunda explicava o modelo.
  test('a revisão publicada não escreve nota nenhuma', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R0').click();
    await flush();

    // Nem parágrafo vazio: espaço em branco entre a faixa e os botões leria
    // como carregamento que não terminou.
    expect(container.querySelector('.pit-revisao-detalhe__texto')).toBeNull();
    // O QUE A NOTA DIZIA continua na tela, no botão da revisão: sem isto o caso
    // acima passaria com a informação perdida, e não só com o texto removido.
    expect(revisaoBtn(container, 'R0').textContent).toMatch(/rege desde/i);
    // Publicar e excluir só existem no rascunho.
    expect([...container.querySelectorAll('button')].some((b) => b.textContent.includes('Publicar')))
      .toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o rascunho oferece publicar e excluir, e avisa que nada rege ainda', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R1').click();
    await flush();

    expect(container.querySelector('.pit-revisao-detalhe__texto').textContent)
      .toMatch(/rascunho/i);
    const rotulos = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(rotulos.some((r) => r.includes('Publicar'))).toBe(true);
    expect(rotulos.some((r) => r.includes('Excluir rascunho'))).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  // UM RASCUNHO POR ANO, cobrado por índice parcial no banco. Com o R1 aberto,
  // "Nova revisão" só levaria um 409, e o motivo aparece no title.
  test('com rascunho aberto, "Nova revisão" fica barrada e diz por quê', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    const nova = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Nova revisão'));
    expect(nova.disabled).toBe(true);
    expect(nova.title).toMatch(/rascunho/i);

    if (typeof cleanup === 'function') cleanup();
  });
});

// O ANO É ONDE SE COMEÇA. O PIT de 2027 se monta durante 2026, e o exercício
// nasce SEM meta nenhuma: enquanto a lista de anos saía de `pit.meta` e o filtro
// não deixava escolher ano fora dela, o ano novo era um beco sem saída.
describe('PIT do ano: o ano é o começo, e não um filtro do passado', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([2027, 2026]);
    getMetasPit.mockResolvedValue([]);
    listarExercicios.mockResolvedValue([]);
    listarRevisoes.mockResolvedValue([]);
    getAlteracoesRevisao.mockResolvedValue([]);
  });

  // CONTROLE NEGATIVO: `permitirOutroAno` era FALSO aqui, e a opção não existia.
  // Esta asserção reprova aquele estado.
  test('o filtro de ano oferece trabalhar num ano fora da lista', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    const opcoes = [...container.querySelectorAll('.page__filters select option')]
      .map((o) => o.textContent);
    expect(opcoes.some((o) => o.includes('Outro ano'))).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('ano sem exercício diz o que fazer, e barra a revisão nova', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    expect(container.querySelector('.pit-exercicio').textContent)
      .toMatch(/ainda n(ã|a)o existe/i);

    const abrir = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Abrir exercício'));
    expect(abrir).toBeTruthy();

    const nova = [...container.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Nova revisão'));
    expect(nova.disabled).toBe(true);
    expect(nova.title).toMatch(/exerc(í|i)cio/i);

    if (typeof cleanup === 'function') cleanup();
  });
});

// A REGRA DE OURO: salvar NÃO reconstrói a tela.
//
// Quem apaga uma meta continua na mesma revisão, com a mesma busca digitada e a
// mesma ordenação. A tela só troca o conteúdo da tabela, e o `data-table`
// preserva busca, página e ordem entre `update()`.
describe('PIT do ano: salvar não reconstrói a tela', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([2027, 2026]);
    getMetasPit.mockResolvedValue(METAS);
    listarExercicios.mockResolvedValue([EXERCICIO]);
    listarRevisoes.mockResolvedValue([R0, R1]);
    getAlteracoesRevisao.mockResolvedValue([]);
    deleteMetaPit.mockResolvedValue(undefined);
  });

  test('apagar uma meta preserva a revisão escolhida e a busca digitada', async () => {
    logar({ administrador: true });

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R0').click();
    await flush();

    const busca = container.querySelector('.data-table-toolbar__search-input');
    busca.value = 'Impressão';
    busca.dispatchEvent(new Event('input'));
    expect(container.querySelectorAll('tbody tr').length).toBe(2);

    // A 4.1 é a única com uma declaração, e ela é do R0.
    container.querySelector('[title^="Apagar a meta"]').click();
    await flush();
    await flush();

    expect(deleteMetaPit).toHaveBeenCalledWith(1, 7);

    // A REVISÃO CONTINUA ESCOLHIDA: sem isso, quem apaga uma meta cairia de
    // volta no modo de leitura e teria de escolher o R0 de novo a cada ato.
    expect(revisaoBtn(container, 'R0').className).toContain('pit-revisao--selecionada');
    // E A BUSCA CONTINUA NA TELA, com o mesmo recorte.
    expect(container.querySelector('.data-table-toolbar__search-input').value)
      .toBe('Impressão');
    expect(container.querySelectorAll('tbody tr').length).toBe(2);

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('PIT do ano: quem não é administrador', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([2027, 2026]);
    getMetasPit.mockResolvedValue(METAS);
    listarExercicios.mockResolvedValue([EXERCICIO]);
    listarRevisoes.mockResolvedValue([R0, R1]);
    getAlteracoesRevisao.mockResolvedValue([]);
  });

  // LER é de quem tem perfil em algum módulo; ESCREVER é do administrador, e o
  // servidor cobra. Oferecer o botão a quem vai levar 403 troca uma tela por um
  // erro.
  test('lê o PIT inteiro e não recebe botão de escrita nenhum', async () => {
    logar({ perfis: { mapoteca: 3 } });

    const { container, cleanup } = await montar();

    revisaoBtn(container, 'R1').click();
    await flush();

    expect(container.querySelectorAll('tbody tr').length).toBe(3);
    expect(container.querySelector('.data-table__action-btn')).toBeNull();

    const rotulos = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(rotulos.some((r) => r.includes('Meta nova'))).toBe(false);
    expect(rotulos.some((r) => r.includes('Nova revisão'))).toBe(false);
    expect(rotulos.some((r) => r.includes('Abrir exercício'))).toBe(false);
    expect(rotulos.some((r) => r.includes('Editar exercício'))).toBe(false);
    expect(rotulos.some((r) => r.includes('Publicar'))).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });
});

// O AVISO DO CADASTRO. O que ele existe para pegar é um erro SILENCIOSO: numa
// meta automática o número é contado das entidades ligadas a ela, então esquecer
// de cadastrar não dá erro, dá ZERO, e zero é indistinguível de "o mês ainda não
// chegou". O painel é a única coisa que torna isso visível.
describe('PIT do ano: o aviso do cadastro', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getAnosMetaPit.mockResolvedValue([ANO]);
    listarExercicios.mockResolvedValue([]);
    listarRevisoes.mockResolvedValue([]);
    getMetasPit.mockResolvedValue([]);
    getAlteracoesRevisao.mockResolvedValue([]);
    getDiagnosticoPit.mockResolvedValue([]);
  });

  const aviso = (container) => container.querySelector('.pit-aviso');

  test('sem nada a dizer, o painel NÃO aparece', async () => {
    logar({ administrador: true });
    getDiagnosticoPit.mockResolvedValue([
      {
        meta_id: 1, numero_meta: 5, item: '5.1', origem_id: 2, origem: 'Capacitação',
        quantidade_prevista: 1, previstas: 1, sem_data: 0, registros: 1, faltam: 0,
      },
    ]);

    const { container, cleanup } = await montar();

    // Aviso permanente vira moldura, e moldura não se lê.
    expect(aviso(container)).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('conta o que falta cadastrar, e leva à tela que cadastra', async () => {
    logar({ administrador: true });
    getDiagnosticoPit.mockResolvedValue([
      {
        meta_id: 7, numero_meta: 4, item: '4.1', origem_id: 4, origem: 'Impressão',
        quantidade_prevista: 327, previstas: 325, sem_data: 0, registros: 10, faltam: 2,
      },
    ]);

    const { container, cleanup } = await montar();

    const texto = aviso(container).textContent;
    expect(texto).toContain('Meta 4.1');
    expect(texto).toContain('faltam 2 de 327');

    // O link leva à tela DE SEMPRE, e não a um formulário paralelo do PIT.
    const link = container.querySelector('.pit-aviso__link');
    expect(link.getAttribute('href')).toBe('#/mapoteca/pedidos');

    if (typeof cleanup === 'function') cleanup();
  });

  // A DATA EM BRANCO NAO E PENDENCIA, desde 2026-08-06.
  //
  // Ela e o padrao do sistema: a `data_prevista` vai sendo preenchida conforme os
  // PITs chegam, e quase nada do acervo e do PIT. Enquanto ela contava como
  // falta, o painel acusava meta com o cadastro COMPLETO: esta fixtura e o caso
  // real da meta 1.3, que promete 72 folhas, tem as 72 ligadas, e o painel dizia
  // "faltam 72".
  test('meta com o cadastro completo e sem data prevista NAO aparece', async () => {
    logar({ administrador: true });
    getDiagnosticoPit.mockResolvedValue([
      {
        meta_id: 3, numero_meta: 1, item: '1.3', origem_id: 3, origem: 'Produção',
        quantidade_prevista: 72,
        previstas: 0, sem_data: 72, fora_do_ano: 0, registros: 72,
        cadastradas: 72, faltam: 0,
      },
    ]);

    const { container, cleanup } = await montar();

    expect(aviso(container)).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // A DATA DE OUTRO ANO ENTRA, e e outra coisa: a entidade esta ligada a um item
  // DESTE PIT e promete um mes de outro. O planejado da grade filtra por ano e
  // nao a ve, entao ela some da curva sem nada dizer.
  test('entidade com data prevista de OUTRO ano e acusada', async () => {
    logar({ administrador: true });
    getDiagnosticoPit.mockResolvedValue([
      {
        meta_id: 3, numero_meta: 1, item: '1.3', origem_id: 3, origem: 'Produção',
        quantidade_prevista: 72,
        previstas: 60, sem_data: 0, fora_do_ano: 12, registros: 72,
        cadastradas: 72, faltam: 0,
      },
    ]);

    const { container, cleanup } = await montar();

    const texto = aviso(container).textContent;
    expect(texto).toMatch(/12 com data prevista de OUTRO ano/);
    expect(container.querySelector('.pit-aviso__link').getAttribute('href'))
      .toBe('#/acervo');

    if (typeof cleanup === 'function') cleanup();
  });

  // O QUE JA ESTA CADASTRADO entra na frase: "faltam 2 de 327" sozinho nao diz
  // se ha 325 ou nenhum, e as duas situacoes pedem acoes opostas.
  test('a acusacao diz quanto JA esta cadastrado', async () => {
    logar({ administrador: true });
    getDiagnosticoPit.mockResolvedValue([
      {
        meta_id: 9, numero_meta: 4, item: '4.1', origem_id: 4, origem: 'Impressão',
        quantidade_prevista: 327,
        previstas: 0, sem_data: 325, fora_do_ano: 0, registros: 11,
        cadastradas: 325, faltam: 2,
      },
    ]);

    const { container, cleanup } = await montar();

    const texto = aviso(container).textContent;
    expect(texto).toContain('faltam 2 de 327');
    expect(texto).toContain('325');

    if (typeof cleanup === 'function') cleanup();
  });

  // A tela LÊ para qualquer pessoa logada, e a rota do diagnóstico é do gerente
  // para cima. O 403 dela não pode derrubar o PIT inteiro para quem só quer ler.
  test('o diagnóstico fora do alcance não derruba a tela', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getDiagnosticoPit.mockRejectedValue(new Error('sem permissão'));
    getMetasPit.mockResolvedValue([
      {
        id: 1, ano: ANO, numero_meta: 1, item: null, descricao: 'Uma meta',
        quantidade_prevista: 10,
      },
    ]);

    const { container, cleanup } = await montar();

    expect(aviso(container)).toBeNull();
    expect(container.querySelectorAll('tbody tr').length).toBe(1);

    if (typeof cleanup === 'function') cleanup();
  });
});
