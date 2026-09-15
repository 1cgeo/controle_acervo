import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A GALERIA DE FOTO E VIDEO DA CAPACITACAO, aberta pela linha da lista.
//
// O QUE ESTES CASOS FIXAM, e por que cada um existe:
//
//   1. A GALERIA E DE QUEM SO CONSULTA. Ver a foto da instrucao que a Divisao
//      deu e LER, e o botao aparece para consulta. O que ele NAO traz e o envio:
//      quem so consulta receberia 403 do servidor depois de ler um arquivo de
//      42 MB do disco.
//   2. O SERVICO SAI DO TIPO DA LINHA, e nao da tela. As rotas sao duas (a
//      ministrada e do PIT, a recebida e do Efetivo), e mandar o id de uma para
//      o caminho da outra responde 404 -- que na tela aparece como "nao foi
//      possivel carregar", sem dizer por que. Este e o pior caso que o par
//      existe para pegar, e ele so aparece quando os DOIS tipos sao exercitados:
//      um caso que so olhasse a ministrada passaria com as duas telas apontando
//      para o servico dela.
//   3. A CONTAGEM DA COLUNA ACOMPANHA A ESCRITA. Sem recarregar, a linha
//      continua dizendo 3 depois de a quarta foto entrar.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  const midia = () => ({
    listar: vi.fn(() => Promise.resolve([])),
    enviar: vi.fn(() => Promise.resolve({ id: 9 })),
    atualizar: vi.fn(() => Promise.resolve({ id: 9 })),
    excluir: vi.fn(() => Promise.resolve()),
    url: vi.fn(() => Promise.resolve('blob:x')),
  });
  return {
    ...real,
    getCapacitacoesMinistradas: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacaoMinistrada: vi.fn(() => Promise.resolve([2026])),
    deleteCapacitacaoMinistrada: vi.fn(() => Promise.resolve()),
    getCapacitacoesRecebidas: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacaoRecebida: vi.fn(() => Promise.resolve([2026])),
    deleteCapacitacaoRecebida: vi.fn(() => Promise.resolve()),
    getUsuarios: vi.fn(() => Promise.resolve([])),
    getMetasPit: vi.fn(() => Promise.resolve([])),
    midiaCapacitacaoMinistrada: midia(),
    midiaCapacitacaoRecebida: midia(),
  };
});

import {
  renderCapacitacaoMinistrada,
  renderCapacitacaoRecebida,
} from '@pages/capacitacao/list.js';
import {
  getCapacitacoesMinistradas,
  getCapacitacoesRecebidas,
  midiaCapacitacaoMinistrada,
  midiaCapacitacaoRecebida,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

const MINISTRADA = {
  id: '1', ano: 2026, nome: 'Estágio de Geoinformação',
  tipo_id: 1, situacao_id: 3, situacao: 'Concluída',
  data_inicio: '2026-07-06', data_fim: '2026-07-10',
  efetivo_capacitado: 18, militares: [], total_imagens: 3,
};

const RECEBIDA = {
  id: '2', ano: 2026, nome: 'PCE-EECN',
  tipo_id: 2, situacao_id: 2, situacao: 'Em execução',
  data_inicio: '2026-07-20', data_fim: null,
  plano_codigo: 'C25/DCT003', militares: [], total_imagens: 0,
};

async function montar(render) {
  const container = document.createElement('div');
  const cleanup = await render(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const botaoFotos = (container) => [...container.querySelectorAll('.data-table__action-btn')]
  .find(b => b.getAttribute('title') === 'Fotos e vídeos');

const modalAberto = () => document.querySelector('.modal');
const fecharModal = () => {
  const btn = [...document.querySelectorAll('.modal__footer button')]
    .find(b => b.textContent.includes('Fechar'));
  if (btn) btn.click();
};
const botaoEnviar = () => [...document.querySelectorAll('.modal button')]
  .find(b => b.textContent.includes('Enviar foto ou vídeo'));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  saveAuth({
    token: 't', administrador: false, uuid: 'u', perfis: { pit: 2, efetivo: 2 }, modulos: [],
  }, 'x');
});

describe('a galeria da capacitação', () => {
  test('a MINISTRADA abre pela rota do PIT, e não pela da recebida', async () => {
    getCapacitacoesMinistradas.mockResolvedValueOnce([MINISTRADA]);

    const { container, cleanup } = await montar(renderCapacitacaoMinistrada);
    botaoFotos(container).click();
    await flush();

    expect(modalAberto()).not.toBeNull();
    expect(midiaCapacitacaoMinistrada.listar).toHaveBeenCalledWith('1');
    // A VARIANCIA QUE IMPORTA: a do outro tipo não foi chamada. Sem esta linha,
    // as duas telas apontando para o mesmo serviço passariam.
    expect(midiaCapacitacaoRecebida.listar).not.toHaveBeenCalled();

    fecharModal();
    if (typeof cleanup === 'function') cleanup();
  });

  test('a RECEBIDA abre pela rota do Efetivo, e não pela da ministrada', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);
    botaoFotos(container).click();
    await flush();

    expect(midiaCapacitacaoRecebida.listar).toHaveBeenCalledWith('2');
    expect(midiaCapacitacaoMinistrada.listar).not.toHaveBeenCalled();

    fecharModal();
    if (typeof cleanup === 'function') cleanup();
  });

  test('o operador envia, e quem só consulta vê a galeria sem o botão de enviar', async () => {
    getCapacitacoesMinistradas.mockResolvedValueOnce([MINISTRADA]);

    const operador = await montar(renderCapacitacaoMinistrada);
    botaoFotos(operador.container).click();
    await flush();
    expect(botaoEnviar()).toBeDefined();
    fecharModal();
    if (typeof operador.cleanup === 'function') operador.cleanup();

    // A MESMA TELA, outro perfil. O botão da galeria FICA, e o de enviar some.
    document.body.innerHTML = '';
    saveAuth({
      token: 't', administrador: false, uuid: 'u', perfis: { pit: 1 }, modulos: [],
    }, 'x');
    getCapacitacoesMinistradas.mockResolvedValueOnce([MINISTRADA]);

    const consulta = await montar(renderCapacitacaoMinistrada);
    expect(botaoFotos(consulta.container)).toBeDefined();
    botaoFotos(consulta.container).click();
    await flush();

    expect(modalAberto()).not.toBeNull();
    expect(botaoEnviar()).toBeUndefined();

    fecharModal();
    if (typeof consulta.cleanup === 'function') consulta.cleanup();
  });

  test('a lista recarrega depois de a galeria escrever, e a coluna Mídia acompanha', async () => {
    // A PRIMEIRA CARGA e a SEGUNDA. A segunda é a que prova o recarregamento, e
    // ela devolve a contagem nova: sem repintar, a linha continuaria dizendo 3
    // depois de a quarta foto entrar.
    getCapacitacoesMinistradas
      .mockResolvedValueOnce([MINISTRADA])
      .mockResolvedValueOnce([{ ...MINISTRADA, total_imagens: 4 }]);

    const { container, cleanup } = await montar(renderCapacitacaoMinistrada);

    const celulaMidia = () => {
      const i = [...container.querySelectorAll('thead th')]
        .findIndex(th => th.textContent.replace(/[▲▼]/g, '').trim() === 'Mídia');
      return container.querySelector('tbody tr').querySelectorAll('td')[i].textContent;
    };
    expect(celulaMidia()).toBe('3');

    botaoFotos(container).click();
    await flush();

    // O ENVIO DE VERDADE, pela entrada de arquivo da galeria: é ele que dispara
    // o `aoMudar`, e um `aoMudar` chamado à mão provaria o teste, não o código.
    const entrada = document.querySelector('.modal input[type="file"]');
    const arquivo = new File(['x'], 'turma.jpg', { type: 'image/jpeg' });
    Object.defineProperty(entrada, 'files', {
      configurable: true,
      value: Object.assign([arquivo], { item: (i) => [arquivo][i] }),
    });
    entrada.dispatchEvent(new Event('change'));
    // O `FileReader` é MACROtarefa, e um `flush` só basta por acaso. O sinal de
    // que a subida ACABOU é o botão voltar ao rótulo de repouso: durante o envio
    // ele diz "Enviando...", e esperar só por "não desabilitado" sairia do laço
    // antes de o leitor disparar -- foi o que fez este caso reprovar primeiro.
    for (let i = 0; i < 60; i += 1) {
      await flush();
      if (botaoEnviar() && !botaoEnviar().disabled) break;
    }
    expect(midiaCapacitacaoMinistrada.enviar).toHaveBeenCalled();

    // A LISTA AINDA NÃO RECARREGOU: recarregá-la a cada foto de um lote de dez
    // custaria dez idas ao banco. Quem repassa é o FECHAR do modal.
    expect(getCapacitacoesMinistradas).toHaveBeenCalledTimes(1);

    fecharModal();
    await flush();

    expect(getCapacitacoesMinistradas).toHaveBeenCalledTimes(2);
    expect(celulaMidia()).toBe('4');

    if (typeof cleanup === 'function') cleanup();
  });
});
