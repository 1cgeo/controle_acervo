import { describe, test, expect, afterEach } from 'vitest';
import { reconciliar } from './reconciliar.js';

// O contrato do reconciliador: quem tem a mesma CHAVE mantem o mesmo no.
// O teste prova a identidade do no (===), e nao so o texto na tela: repintar
// tudo tambem acerta o texto, e perde o foco do teclado no caminho.

function criarNo(item) {
  const no = document.createElement('div');
  no.dataset.id = String(item.id);
  no.textContent = item.nome;
  return no;
}

function atualizarNo(no, item) {
  no.textContent = item.nome;
}

const opcoes = { chave: (item) => item.id, criar: criarNo, atualizar: atualizarNo };

const textos = (container) => [...container.children].map(n => n.textContent);
const ids = (container) => [...container.children].map(n => n.dataset.id);

function novoContainer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.textContent = '';
});

describe('reconciliar', () => {
  test('monta a lista na ordem pedida', () => {
    const container = novoContainer();

    reconciliar(container, [
      { id: 1, nome: 'Alfa' },
      { id: 2, nome: 'Beta' },
    ], opcoes);

    expect(textos(container)).toEqual(['Alfa', 'Beta']);
  });

  test('preserva o no quando a chave se repete, e repinta pelo atualizar', () => {
    const container = novoContainer();

    reconciliar(container, [{ id: 1, nome: 'Alfa' }, { id: 2, nome: 'Beta' }], opcoes);
    const [noAlfa, noBeta] = [...container.children];

    // Objetos NOVOS, como vem do servidor depois de gravar.
    reconciliar(container, [{ id: 1, nome: 'Alfa II' }, { id: 2, nome: 'Beta' }], opcoes);

    expect(container.children[0]).toBe(noAlfa);
    expect(container.children[1]).toBe(noBeta);
    expect(textos(container)).toEqual(['Alfa II', 'Beta']);
  });

  test('insere o que entrou e remove o que saiu, sem tocar no que ficou', () => {
    const container = novoContainer();

    reconciliar(container, [{ id: 1, nome: 'Alfa' }, { id: 2, nome: 'Beta' }], opcoes);
    const noBeta = container.children[1];

    reconciliar(container, [{ id: 2, nome: 'Beta' }, { id: 3, nome: 'Gama' }], opcoes);

    expect(ids(container)).toEqual(['2', '3']);
    expect(container.children[0]).toBe(noBeta);
  });

  test('reordena movendo os nos existentes, sem recriar nenhum', () => {
    const container = novoContainer();

    reconciliar(container, [
      { id: 1, nome: 'Alfa' },
      { id: 2, nome: 'Beta' },
      { id: 3, nome: 'Gama' },
    ], opcoes);
    const [a, b, c] = [...container.children];

    reconciliar(container, [
      { id: 3, nome: 'Gama' },
      { id: 1, nome: 'Alfa' },
      { id: 2, nome: 'Beta' },
    ], opcoes);

    expect([...container.children]).toEqual([c, a, b]);
  });

  test('preserva o foco do teclado quando o no focado sobrevive', () => {
    const container = novoContainer();
    const criarComBotao = (item) => {
      const no = document.createElement('div');
      no.dataset.id = String(item.id);
      no.appendChild(document.createElement('button'));
      return no;
    };
    const opcoesBotao = { chave: (item) => item.id, criar: criarComBotao, atualizar: () => {} };

    reconciliar(container, [{ id: 1 }, { id: 2 }, { id: 3 }], opcoesBotao);
    const botao = container.children[1].querySelector('button');
    botao.focus();
    expect(document.activeElement).toBe(botao);

    // A reordenacao move o no focado, e mover tira o foco. O reconciliador devolve.
    reconciliar(container, [{ id: 3 }, { id: 2 }, { id: 1 }], opcoesBotao);

    expect(document.activeElement).toBe(botao);
    expect(ids(container)).toEqual(['3', '2', '1']);
  });

  test('recria o no quando o container foi esvaziado por fora', () => {
    const container = novoContainer();

    reconciliar(container, [{ id: 1, nome: 'Alfa' }], opcoes);
    const antigo = container.children[0];
    container.textContent = '';

    reconciliar(container, [{ id: 1, nome: 'Alfa' }], opcoes);

    expect(container.children.length).toBe(1);
    expect(container.children[0]).not.toBe(antigo);
  });

  test('chave repetida nao faz dois itens dividirem o mesmo no', () => {
    const container = novoContainer();

    reconciliar(container, [{ id: 1, nome: 'Alfa' }, { id: 1, nome: 'Alfa bis' }], opcoes);

    expect(container.children.length).toBe(2);
    expect(container.children[0]).not.toBe(container.children[1]);
  });

  test('lista vazia esvazia o container', () => {
    const container = novoContainer();

    reconciliar(container, [{ id: 1, nome: 'Alfa' }], opcoes);
    reconciliar(container, [], opcoes);

    expect(container.children.length).toBe(0);
  });

  test('sem atualizar, o no reaproveitado fica como estava', () => {
    const container = novoContainer();
    const so = { chave: (item) => item.id, criar: criarNo };

    reconciliar(container, [{ id: 1, nome: 'Alfa' }], so);
    reconciliar(container, [{ id: 1, nome: 'Outro' }], so);

    expect(textos(container)).toEqual(['Alfa']);
  });
});
