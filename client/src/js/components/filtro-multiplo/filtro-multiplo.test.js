import { describe, test, expect, vi, beforeEach } from 'vitest';
import { criarFiltroMultiplo } from './filtro-multiplo.js';

// O filtro de dominio com marcacao MULTIPLA substituiu o `<select>` de escolha
// unica na busca do acervo e no ponto de controle (chefe, 2026-08-04). O que
// estes testes protegem sao as tres regras que o combo antigo ja tinha e que
// nao podem se perder na troca, mais as duas que nasceram com ele.

const ITENS = [
  { code: 1, nome: 'Carta Topográfica' },
  { code: 9, nome: 'Carta Ortoimagem' },
];

const caixas = (f) => [...f.element.querySelectorAll('input[type="checkbox"]')];
const caixa = (f, valor) => f.element
  .querySelector(`input[type="checkbox"][value="${valor}"]`);
const rotulo = (f) => f.element.querySelector('.filtro-multiplo__texto').textContent;
const botao = (f) => f.element.querySelector('.filtro-multiplo__botao');
const nomes = (f) => [...f.element.querySelectorAll('.filtro-multiplo__nome')]
  .map(n => n.textContent);

function marcar(f, valor, ligado = true) {
  const c = caixa(f, valor);
  c.checked = ligado;
  c.dispatchEvent(new Event('change'));
}

let onMudar;
function montar(opcoes = {}) {
  onMudar = vi.fn();
  const f = criarFiltroMultiplo({
    rotuloTodos: 'Todos os tipos',
    nomePlural: 'tipos',
    ariaLabel: 'Tipo de produto',
    onMudar,
    ...opcoes,
  });
  document.body.appendChild(f.element);
  return f;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('filtro de marcacao multipla', () => {
  test('o botao diz o que esta valendo, sem precisar abrir', () => {
    const f = montar();
    f.preencher(ITENS);
    expect(rotulo(f)).toBe('Todos os tipos');

    marcar(f, 1);
    expect(rotulo(f)).toBe('Carta Topográfica');

    marcar(f, 9);
    expect(rotulo(f)).toBe('2 tipos');
    // Com mais de um marcado, o nome de cada um vai para o title: com seis
    // filtros lado a lado, "2 tipos" sozinho nao diz QUAIS.
    expect(botao(f).title).toBe('Carta Topográfica, Carta Ortoimagem');

    f._cleanup();
  });

  test('marcar avisa quem chama, com a lista inteira', () => {
    const f = montar();
    f.preencher(ITENS);

    marcar(f, 1);
    expect(onMudar).toHaveBeenLastCalledWith(['1']);
    marcar(f, 9);
    expect(onMudar).toHaveBeenLastCalledWith(['1', '9']);
    marcar(f, 1, false);
    expect(onMudar).toHaveBeenLastCalledWith(['9']);

    f._cleanup();
  });

  test('"Limpar" desmarca tudo de uma vez, e avisa UMA vez so', () => {
    const f = montar();
    f.preencher(ITENS);
    marcar(f, 1);
    marcar(f, 9);
    onMudar.mockClear();

    f.element.querySelector('.filtro-multiplo__limpar').click();

    expect(f.valores()).toEqual([]);
    expect(caixas(f).every(c => !c.checked)).toBe(true);
    expect(onMudar).toHaveBeenCalledTimes(1);

    f._cleanup();
  });

  test('"Limpar" nasce desabilitado, porque nao ha o que limpar', () => {
    const f = montar();
    f.preencher(ITENS);
    const limpar = f.element.querySelector('.filtro-multiplo__limpar');
    expect(limpar.disabled).toBe(true);

    marcar(f, 1);
    expect(limpar.disabled).toBe(false);

    f._cleanup();
  });

  // A regra do combo antigo que nao pode se perder: a opcao com zero sai da
  // lista, salvo se ela for a escolhida.
  test('opcao com ZERO sai da lista', () => {
    const f = montar();
    f.preencher(ITENS, null, new Map([['1', 2], ['9', 0]]));
    expect(nomes(f)).toEqual(['Carta Topográfica']);
    f._cleanup();
  });

  test('a opcao MARCADA fica, com (0), mesmo cruzando a zero', () => {
    // Some-la desfaria em silencio o que a pessoa pediu, e ela veria o
    // resultado mudar sem entender por que.
    const f = montar();
    f.preencher(ITENS);
    marcar(f, 9);

    f.preencher(ITENS, null, new Map([['1', 2], ['9', 0]]));

    expect(nomes(f)).toContain('Carta Ortoimagem');
    expect(caixa(f, 9).checked).toBe(true);
    expect(f.valores()).toEqual(['9']);

    f._cleanup();
  });

  test('marcacao que sumiu ate do dominio continua legivel pelo rotulo guardado', () => {
    const f = montar();
    f.preencher(ITENS);
    marcar(f, 9);

    // O subtipo faz isso quando o tipo muda: a opcao deixa de existir na lista.
    f.preencher([ITENS[0]]);

    expect(nomes(f)).toContain('Carta Ortoimagem');
    f._cleanup();
  });

  test('aberto, o painel NAO se repinta: a repintura espera o fechamento', () => {
    // A faceta chega a cada busca, e refazer a lista sob o cursor moveria a
    // opcao que a pessoa esta prestes a marcar.
    const f = montar();
    f.preencher(ITENS);
    botao(f).click();

    f.preencher([{ code: 7, nome: 'Modelo Digital' }]);
    expect(nomes(f)).toEqual(['Carta Topográfica', 'Carta Ortoimagem']);

    botao(f).click();
    expect(nomes(f)).toEqual(['Modelo Digital']);

    f._cleanup();
  });

  test('o valor inicial vale antes de as opcoes chegarem', () => {
    // E o que faz o link colado funcionar: a primeira busca ja leva o filtro,
    // mesmo com o dominio ainda a caminho.
    const f = montar({ valorInicial: ['9'] });
    expect(f.valores()).toEqual(['9']);

    f.preencher(ITENS);
    expect(caixa(f, 9).checked).toBe(true);

    f._cleanup();
  });

  test('`limpar` e `definir` nao disparam onMudar', () => {
    // Quem limpa a tela inteira busca UMA vez, no fim, e nao uma por filtro.
    const f = montar();
    f.preencher(ITENS);
    marcar(f, 1);
    onMudar.mockClear();

    f.limpar();
    f.definir(['9']);

    expect(onMudar).not.toHaveBeenCalled();
    expect(f.valores()).toEqual(['9']);

    f._cleanup();
  });

  test('Escape fecha o painel e devolve o foco ao botao', () => {
    const f = montar();
    f.preencher(ITENS);
    botao(f).click();
    expect(botao(f).getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(botao(f).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(botao(f));

    f._cleanup();
  });

  test('clicar FORA fecha o painel', () => {
    const f = montar();
    f.preencher(ITENS);
    botao(f).click();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(botao(f).getAttribute('aria-expanded')).toBe('false');
    f._cleanup();
  });

  test('o cleanup solta os ouvintes do documento', () => {
    const f = montar();
    f.preencher(ITENS);
    botao(f).click();
    f._cleanup();

    // Sem o cleanup, a tela seguinte herdaria o ouvinte de uma tela que ja
    // morreu, e o Escape dela mexeria neste painel.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(botao(f).getAttribute('aria-expanded')).toBe('true');
  });

  test('sem opcao nenhuma, o painel diz que nao ha o que marcar', () => {
    const f = montar();
    f.preencher([]);
    expect(f.element.querySelector('.filtro-multiplo__vazio').classList.contains('hidden'))
      .toBe(false);
    f._cleanup();
  });
});
