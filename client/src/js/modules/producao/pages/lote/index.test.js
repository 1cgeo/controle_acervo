import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// ESTA É A TELA EM QUE A REGRA DE 2026-08-08 MAIS IMPORTA. Ela lê de três
// lugares:
//
//   /acompanhamento/informacoes/:lote  consulta em `producao`  -- é a tela
//   /acompanhamento/lotes              consulta em `producao`  -- a lista de lotes
//   /acompanhamento/lotes/:lote/subfases  consulta em `producao` -- o seletor
//
// Num `Promise.all` a falha de qualquer uma derrubaria as três, e a mensagem que
// sobraria seria a dela. O que estes testes prendem é que cada uma cai sozinha.
//
// E A NOTA DA QUEDA NÃO PODE DIAGNOSTICAR ERRADO. A lista de lotes já foi
// `/projetos/lote`, que cobra o ACERVO, e a nota dizia "você não tem perfil no
// módulo acervo". Hoje a primeira chamada tem o MESMO piso da tela, então quem
// chegou aqui passa por ela: uma falha ali é servidor ou rede, e mandar procurar
// perfil no acervo é mandar para o lugar errado.
const servico = vi.hoisted(() => ({
  lotesAcervo: null,
  lotesExecucao: null,
  fases: null,
  subfases: null,
  etapas: null,
  chamadas: [],
}));

/** `{ dados }` ou `{ erro }`, para o teste declarar sucesso e falha do mesmo jeito. */
const responder = (caso) => {
  if (!caso) return Promise.resolve([]);
  // `{ promessa }` fica PENDENTE até o teste resolver, e é como se encena a
  // resposta que chega fora de ordem.
  if (caso.promessa) return caso.promessa;
  if (caso.erro) return Promise.reject(caso.erro);
  return Promise.resolve(caso.dados);
};

vi.mock('@services/producao-service.js', () => ({
  getLotesComProducao: () => {
    servico.chamadas.push('acervo');
    return responder(servico.lotesAcervo);
  },
  getLotesEmExecucao: () => {
    servico.chamadas.push('execucao');
    return responder(servico.lotesExecucao);
  },
  getInfoLote: (lote) => {
    servico.chamadas.push(`fases:${lote}`);
    return responder(servico.fases);
  },
  getSubfasesComProducao: (lote) => {
    servico.chamadas.push(`subfases:${lote}`);
    return responder(servico.subfases);
  },
  getInfoSubfaseLote: (lote, subfase) => {
    servico.chamadas.push(`etapas:${lote}:${subfase}`);
    return responder(servico.etapas);
  },
}));

const { renderLoteAcompanhamento } = await import('./index.js');

const fase = (extra = {}) => ({
  fase_id: 1,
  fase_ordem: 1,
  nome: 'Produção',
  atividades_finalizadas: 6,
  atividades_em_execucao: 2,
  atividades_restantes: 2,
  atividades_finalizadas_semana: 1,
  atividades_finalizadas_mes: 3,
  atividades_finalizadas_semana_anterior: 2,
  atividades_finalizadas_mes_anterior: 4,
  ...extra,
});

const etapa = (extra = {}) => ({
  etapa_id: 7,
  etapa_ordem: 1,
  nome: 'Execução',
  atividades_em_execucao: 1,
  atividades_pausadas: 1,
  atividades_restantes: 3,
  atividades_finalizadas: 5,
  atividades_finalizadas_hoje: 1,
  atividades_finalizadas_semana: 2,
  atividades_finalizadas_semana_anterior: 3,
  ...extra,
});

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
  // O FILTRO VIVE NA URL, e a barra de endereço é estado compartilhado entre os
  // casos deste arquivo: sem zerar, a query que um caso escreveu chegaria ao
  // seguinte como se fosse a rota por onde a pessoa entrou.
  history.replaceState(null, '', '#/producao/lote');
  servico.lotesAcervo = { dados: [{ id: 4, nome: 'Lote 4', projeto: 'Projeto A' }] };
  servico.lotesExecucao = { dados: [{ lote_id: 4, lote: 'Lote 4', em_execucao: 9 }] };
  servico.fases = { dados: [fase()] };
  // A FORMA E A DE `GET /acompanhamento/lotes/:lote/subfases`: `id` e `nome`,
  // e nao o `subfase_id`/`subfase` de `GET /producao/lote/:id/subfases`, que
  // cobra gerente. Trocar a rota sem trocar o fixture deixaria o rotulo sair
  // "undefined" na tela com o teste verde.
  servico.subfases = { dados: [{ id: 11, nome: 'Edição', fase: 'Produção' }] };
  servico.etapas = { dados: [etapa()] };
  servico.chamadas = [];
});

const abrir = async (busca = '') => {
  const cleanup = await renderLoteAcompanhamento(container, {
    query: new URLSearchParams(busca),
  });
  await flush();
  await flush();
  return cleanup;
};

const urlDaTela = () => window.location.hash.replace(/^#/, '');

const selects = () => [...container.querySelectorAll('.page__filters select')];
const escolher = async (indice, valor) => {
  const s = selects()[indice];
  s.value = String(valor);
  s.dispatchEvent(new Event('change'));
  await flush();
  await flush();
};
const notas = () => [...container.querySelectorAll('.lote-acomp__nota')]
  .filter(n => !n.classList.contains('hidden'))
  .map(n => n.textContent)
  .join(' | ');

describe('acompanhamento do lote: cada chamada cai sozinha', () => {
  test('a lista de lotes que falha não derruba a tela, e cai para os em execução', async () => {
    servico.lotesAcervo = { erro: new Error('Erro ao buscar os lotes com produção') };
    await abrir();

    // A tela abriu, e o seletor tem os lotes da rota de queda.
    expect(container.querySelector('.page__title').textContent)
      .toBe('Acompanhamento do lote');
    expect(selects()[0].options.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('Lote 4');
    // E DIZ que a lista é menor: uma lista curta e calada se leria como "o
    // resto dos lotes não existe".
    expect(notas()).toContain('só os lotes com versão em execução');
    // COM A MENSAGEM DO SERVIDOR, e não um diagnóstico inventado pela tela: as
    // duas rotas têm o mesmo piso desta página, então "falta perfil" não é a
    // explicação, e afirmá-la mandaria procurar no lugar errado.
    expect(notas()).toContain('Erro ao buscar os lotes com produção');
    expect(notas()).not.toContain('acervo');
  });

  test('com o acervo respondendo, a queda nem é pedida', async () => {
    await abrir();
    expect(servico.chamadas).toContain('acervo');
    expect(servico.chamadas).not.toContain('execucao');
    expect(notas()).toBe('');
  });

  test('as duas listas de lote falhando, a falha vira nota e não erro de tela', async () => {
    servico.lotesAcervo = { erro: new Error('sem acervo') };
    servico.lotesExecucao = { erro: new Error('banco fora do ar') };
    await abrir();

    expect(notas()).toContain('banco fora do ar');
    expect(container.querySelector('.page__title')).not.toBeNull();
  });

  test('a falha da lista de subfases não derruba o quadro de fases', async () => {
    // A rota do seletor é `consulta` em `producao`, o mesmo piso da tela: quem
    // chegou aqui passou por ela, então o que cai é servidor ou rede, e não
    // perfil. Por isso o erro encenado é o do servidor.
    servico.subfases = { erro: new Error('Erro ao buscar as subfases do lote') };
    await abrir();
    await escolher(0, 4);

    // O quadro de fases, que é a resposta principal da tela, está lá.
    expect(container.querySelectorAll('.lote-acomp__tabela').length).toBe(1);
    expect(container.textContent).toContain('Produção');
    // E a falha ficou na seção dela, com as palavras do servidor e sem
    // diagnóstico inventado.
    expect(notas()).toContain('Erro ao buscar as subfases do lote');
    expect(notas()).toContain('O quadro de fases acima não depende dela');
    expect(notas()).not.toContain('gerência');
  });
});

describe('acompanhamento do lote: as fases', () => {
  test('antes de escolher um lote, a tela pede o lote em vez de mostrar zero', async () => {
    await abrir();
    expect(container.textContent).toContain('Escolha um lote');
    expect(servico.chamadas.some(c => c.startsWith('fases:'))).toBe(false);
  });

  test('escolher o lote carrega as fases com os totais e o percentual', async () => {
    await abrir();
    await escolher(0, 4);

    expect(servico.chamadas).toContain('fases:4');
    const linha = container.querySelector('.lote-acomp__tabela tbody tr');
    expect(linha.textContent).toContain('Produção');
    // 6 finalizadas de 6+2+2 = 60%
    expect(linha.textContent).toContain('60%');
  });

  test('a legenda diz que a contagem das FASES é por versão', async () => {
    await abrir();
    // Os dois quadros contam unidades diferentes, e ler os dois como a mesma
    // coisa faria a soma de um não bater com a do outro.
    expect(container.textContent).toContain('por VERSÃO');
    expect(container.textContent).toContain('por ATIVIDADE');
  });

  test('erro nas fases fica na área das fases, com "tentar de novo"', async () => {
    servico.fases = { erro: new Error('consulta falhou') };
    await abrir();
    await escolher(0, 4);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(container.textContent).toContain('consulta falhou');
  });
});

describe('acompanhamento do lote: as etapas da subfase', () => {
  test('a ordem dos argumentos é (lote, subfase)', async () => {
    // Invertida, os dois filtros vão para a coluna errada e a resposta vem
    // VAZIA, sem erro nenhum: é o defeito que a origem tinha.
    await abrir();
    await escolher(0, 4);
    await escolher(1, 11);

    expect(servico.chamadas).toContain('etapas:4:11');
  });

  test('as etapas trazem finalizadas, em execução, pausadas e restantes', async () => {
    await abrir();
    await escolher(0, 4);
    await escolher(1, 11);

    const tabelas = container.querySelectorAll('.lote-acomp__tabela');
    expect(tabelas.length).toBe(2);
    const cabecalho = tabelas[1].querySelector('thead').textContent;
    expect(cabecalho).toContain('Pausadas');
    expect(tabelas[1].querySelector('tbody tr').textContent).toContain('Execução');
  });

  test('trocar de lote limpa a subfase escolhida', async () => {
    await abrir();
    await escolher(0, 4);
    await escolher(1, 11);
    expect(container.querySelectorAll('.lote-acomp__tabela').length).toBe(2);

    servico.chamadas = [];
    await escolher(0, 4);

    // A subfase de um lote não vale para outro: o quadro de etapas volta ao
    // pedido, e nenhuma consulta de etapa sai com a subfase velha.
    expect(servico.chamadas.some(c => c.startsWith('etapas:'))).toBe(false);
    expect(container.textContent).toContain('Escolha um lote e uma subfase');
  });

  test('lote sem subfase cadastrada diz isso, e não fica mudo', async () => {
    servico.subfases = { dados: [] };
    await abrir();
    await escolher(0, 4);

    expect(notas()).toContain('ainda não tem subfase com etapa cadastrada');
  });

  // TROCAR O LOTE DUAS VEZES DEPRESSA. A tabela de fases não repete o nome do
  // lote em coluna nenhuma, então a resposta do primeiro chegando depois pinta
  // os números DELE sob um seletor que já marca o outro, e não há como
  // perceber.
  test('a resposta do lote antigo não pinta por cima do novo', async () => {
    servico.lotesAcervo = {
      dados: [
        { id: 4, nome: 'Lote 4', projeto: 'Projeto A' },
        { id: 5, nome: 'Lote 5', projeto: 'Projeto A' },
      ],
    };
    await abrir();

    let liberarQuatro;
    let liberarCinco;
    servico.fases = { promessa: new Promise((r) => { liberarQuatro = r; }) };
    await escolher(0, 4);
    servico.fases = { promessa: new Promise((r) => { liberarCinco = r; }) };
    await escolher(0, 5);

    // A SEGUNDA CHEGA PRIMEIRO.
    liberarCinco([fase({ nome: 'Fase do lote 5' })]);
    await flush();
    expect(container.textContent).toContain('Fase do lote 5');

    // E A PRIMEIRA CHEGA DEPOIS: descartada.
    liberarQuatro([fase({ nome: 'Fase do lote 4' })]);
    await flush();

    expect(container.textContent).toContain('Fase do lote 5');
    expect(container.textContent).not.toContain('Fase do lote 4');
  });
});

// O LOTE E A SUBFASE VIVEM NA URL, no molde da lista de pedidos da mapoteca
// (commit `a8212b9`): achar o lote, descer ate a subfase, sair para conferir
// outra coisa e voltar devolvia a tela pedindo "escolha um lote", e nao havia
// como mandar a alguem o acompanhamento de um lote.
describe('acompanhamento do lote: a escolha vive na URL', () => {
  test('abre no lote da query, com as duas cargas ja feitas', async () => {
    await abrir('lote=4');

    expect(selects()[0].value).toBe('4');
    expect(servico.chamadas).toContain('fases:4');
    expect(servico.chamadas).toContain('subfases:4');
    expect(container.querySelectorAll('.lote-acomp__tabela').length).toBe(1);
  });

  test('a subfase da query abre a secao de etapas junto', async () => {
    await abrir('lote=4&subfase=11');

    expect(selects()[1].value).toBe('11');
    expect(servico.chamadas).toContain('etapas:4:11');
    expect(container.querySelectorAll('.lote-acomp__tabela').length).toBe(2);
  });

  // O RECORTE QUE ACABOU: consultar um id que a lista nao tem seria perguntar
  // por um lote que ninguem escolheu, com o seletor vazio ao lado.
  test('lote da URL que nao esta na lista e descartado', async () => {
    await abrir('lote=99');

    expect(selects()[0].value).toBe('');
    expect(servico.chamadas.some(c => c.startsWith('fases:'))).toBe(false);
    expect(container.textContent).toContain('Escolha um lote');
    expect(urlDaTela()).toBe('/producao/lote');
  });

  test('escolher no seletor escreve a URL, e a subfase entra junto', async () => {
    await abrir();
    expect(urlDaTela()).toBe('/producao/lote');

    await escolher(0, 4);
    expect(urlDaTela()).toBe('/producao/lote?lote=4');

    await escolher(1, 11);
    expect(urlDaTela()).toBe('/producao/lote?lote=4&subfase=11');
  });
});
