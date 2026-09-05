import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A TELA CHEIA DA GALERIA E O MODAL DE BAIXO, e quem fica com a tecla.
//
// Esta tela cheia (`campo-luz`) e um `<div>` solto no `body`, e nao entra na
// pilha de `modal-base.js`. Ela SO abre de dentro de um modal: a ficha do campo
// ou o formulario "Editar o campo". O modal registra o Escape dele na CAPTURA do
// `document` e chama `stopPropagation`, e o ouvinte daqui morava na BOLHA do
// mesmo `document` -- ele nunca recebia a tecla.
//
// O resultado, com a foto aberta em cima do formulario de edicao: Escape fechava
// o FORMULARIO, levando junto tudo o que estivesse digitado, e a foto continuava
// na tela por cima de nada. Quem apertava Escape via a tela nao mudar e apertava
// de novo.
//
// O conserto e a CAPTURA da `window`, que roda antes da do `document`, mais o
// `stopPropagation` daqui: a camada de cima ganha a tecla, que e o que se espera
// de quem esta por cima.
//
// O PRECO DA CAPTURA DA `window` e o ouvinte ORFAO, e os dois ultimos casos o
// cobram. A tela cheia pode sair do DOM sem passar por `fechar` -- o `<div>`
// mora no `body`, e o Voltar do navegador troca a pagina sem tira-lo de la. Na
// bolha do `document` esse orfao era inofensivo (a captura do modal rodava
// antes); na captura da `window` ele passa a comer toda seta e o primeiro
// Escape da sessao. Por isso `aoTeclar` desiste quando o fundo nao esta mais
// conectado, e um `hashchange` fecha a tela cheia.

vi.mock('@services/campo-service.js', () => ({
  listarImagensCampo: vi.fn(() => Promise.resolve([])),
  enviarImagemCampo: vi.fn(),
  excluirImagemCampo: vi.fn(),
  atualizarImagemCampo: vi.fn(),
  urlDaImagemCampo: vi.fn(() => Promise.resolve('blob:x')),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { abrirTelaCheia } from '@pages/campo/campo-midia.js';
import { urlDaImagemCampo } from '@services/campo-service.js';

const ITENS = [
  { id: 1, tipo: 'foto', descricao: 'Marco geodésico', data_imagem: null, bytes: 375905 },
  { id: 2, tipo: 'foto', descricao: 'Vista da área', data_imagem: null, bytes: 400000 },
];

const escape = () => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
);

const seta = (key) => document.dispatchEvent(
  new KeyboardEvent('keydown', { key, bubbles: true })
);

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  // O jsdom não tem `URL.revokeObjectURL`, e a tela cheia revoga o blob a cada
  // troca de item e ao fechar.
  URL.revokeObjectURL = vi.fn();
});

describe('a tela cheia da galeria por cima de um modal', () => {
  test('Escape fecha SÓ a tela cheia, e o formulário de baixo continua aberto', async () => {
    const modal = openModal({
      title: 'Editar campo: Reambulação Santiago 2026',
      content: el('div', {}, [el('input', { type: 'text', value: 'digitado' })]),
      actions: [{ label: 'Salvar', onClick: () => {} }],
    });

    const luz = abrirTelaCheia({ itens: ITENS, indice: 0 });
    await flush();
    expect(document.querySelector('.campo-luz')).not.toBeNull();

    escape();

    // A camada de cima saiu...
    expect(document.querySelector('.campo-luz')).toBeNull();
    // ...e o formulário, com o que estava digitado, ficou.
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(document.querySelector('.modal__body input').value).toBe('digitado');

    // O segundo Escape, agora sem a tela cheia, fecha o modal como sempre.
    escape();
    expect(document.querySelector('.modal-overlay')).toBeNull();

    luz.fechar();
    modal.close();
  });

  test('as setas navegam sem chegar ao modal, e o ouvinte sai ao fechar', async () => {
    const modal = openModal({ title: 'Ficha', content: el('div'), actions: [] });
    const luz = abrirTelaCheia({ itens: ITENS, indice: 0 });
    await flush();

    expect(document.querySelector('.campo-luz__contador').textContent).toBe('1 de 2');
    seta('ArrowRight');
    await flush();
    expect(document.querySelector('.campo-luz__contador').textContent).toBe('2 de 2');
    // Circular: a próxima volta ao começo.
    seta('ArrowRight');
    await flush();
    expect(document.querySelector('.campo-luz__contador').textContent).toBe('1 de 2');
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    // FECHADA A TELA CHEIA, o Escape volta a ser do modal. Sem remover o
    // ouvinte, ele continuaria comendo a tecla de todas as telas seguintes.
    luz.fechar();
    escape();
    expect(document.querySelector('.modal-overlay')).toBeNull();

    modal.close();
  });
});

describe('a tela cheia que morre sem passar por `fechar`', () => {
  test('o ouvinte orfao NAO come a tecla depois que o fundo sai do DOM', async () => {
    abrirTelaCheia({ itens: ITENS, indice: 0 });
    await flush();
    expect(urlDaImagemCampo).toHaveBeenCalledTimes(1);

    // O Voltar do navegador repinta a area de conteudo; o `<div>` do `body`
    // sai por outro caminho, sem `fechar()`.
    document.querySelector('.campo-luz').remove();

    const evento = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    document.dispatchEvent(evento);
    await flush();

    // A seta chega a quem estiver embaixo, e nenhum blob de ate 37 MB e pedido
    // para uma tela que ja nao existe.
    expect(evento.defaultPrevented).toBe(false);
    expect(urlDaImagemCampo).toHaveBeenCalledTimes(1);

    // E o primeiro Escape da sessao continua sendo do modal.
    const modal = openModal({ title: 'Ficha', content: el('div'), actions: [] });
    escape();
    expect(document.querySelector('.modal-overlay')).toBeNull();
    modal.close();
  });

  test('trocar de rota fecha a tela cheia', async () => {
    abrirTelaCheia({ itens: ITENS, indice: 0 });
    await flush();
    expect(document.querySelector('.campo-luz')).not.toBeNull();

    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(document.querySelector('.campo-luz')).toBeNull();
  });
});
