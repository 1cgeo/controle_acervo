import { describe, test, expect } from 'vitest';
import { createTabs } from './tabs.js';

// As abas declaravam `role="tablist"`, `role="tab"` e `role="tabpanel"` e paravam
// ai: nenhum `id`, nenhum `aria-controls`, nenhum `aria-labelledby`, e todas as
// abas na ordem de tabulacao. Papel de ARIA sem a ligacao entre as partes nao
// entrega o comportamento que ele promete.
//
// Estes testes prendem as duas metades: a LIGACAO (quem controla o que) e a
// TABULACAO ITINERANTE (uma parada de Tab, setas andando entre as abas).

function abas() {
  return [
    { id: 'a', label: 'Aba A', render: (c) => { c.textContent = 'conteudo A'; } },
    { id: 'b', label: 'Aba B', render: (c) => { c.textContent = 'conteudo B'; } },
    { id: 'c', label: 'Aba C', render: (c) => { c.textContent = 'conteudo C'; } },
  ];
}

const botoes = (ctrl) => [...ctrl.element.querySelectorAll('[role="tab"]')];
const painel = (ctrl) => ctrl.element.querySelector('[role="tabpanel"]');

function teclar(no, key) {
  const evento = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  no.dispatchEvent(evento);
  return evento;
}

describe('createTabs: a ligacao entre aba e painel', () => {
  test('cada aba aponta para o painel, e o painel para a aba ativa', async () => {
    const ctrl = createTabs({ tabs: abas() });
    await ctrl.ready;

    const idPainel = painel(ctrl).id;
    expect(idPainel).toBeTruthy();
    for (const btn of botoes(ctrl)) {
      expect(btn.id).toBeTruthy();
      expect(btn.getAttribute('aria-controls')).toBe(idPainel);
    }
    expect(painel(ctrl).getAttribute('aria-labelledby')).toBe(botoes(ctrl)[0].id);
  });

  test('trocar de aba move o aria-labelledby do painel', async () => {
    const ctrl = createTabs({ tabs: abas() });
    await ctrl.ready;

    await ctrl.setActive('c');
    expect(painel(ctrl).getAttribute('aria-labelledby')).toBe(botoes(ctrl)[2].id);
  });

  // CONTROLE NEGATIVO: duas barras de abas na mesma pagina (nivel 1 e nivel 2)
  // nao podem repetir `id`, senao o `aria-controls` de uma aponta para o painel
  // da outra.
  test('duas instancias nao repetem id', async () => {
    const um = createTabs({ tabs: abas() });
    const dois = createTabs({ tabs: abas(), className: 'sub-tabs' });
    await um.ready;
    await dois.ready;

    expect(painel(um).id).not.toBe(painel(dois).id);
    expect(botoes(um)[0].id).not.toBe(botoes(dois)[0].id);
  });
});

describe('createTabs: tabulacao itinerante', () => {
  test('so a aba ATIVA para o Tab; as demais saem da ordem', async () => {
    const ctrl = createTabs({ tabs: abas() });
    await ctrl.ready;

    const [a, b, c] = botoes(ctrl);
    expect(a.tabIndex).toBe(0);
    expect(b.tabIndex).toBe(-1);
    expect(c.tabIndex).toBe(-1);

    await ctrl.setActive('b');
    expect(a.tabIndex).toBe(-1);
    expect(b.tabIndex).toBe(0);
  });

  test('a seta para a direita anda e da a volta', async () => {
    const ctrl = createTabs({ tabs: abas() });
    await ctrl.ready;
    const [a, , c] = botoes(ctrl);

    teclar(a, 'ArrowRight');
    expect(ctrl.getActive()).toBe('b');

    teclar(botoes(ctrl)[1], 'ArrowRight');
    expect(ctrl.getActive()).toBe('c');

    // Da volta ao inicio.
    teclar(c, 'ArrowRight');
    expect(ctrl.getActive()).toBe('a');
  });

  test('Home e End vao aos extremos', async () => {
    const ctrl = createTabs({ tabs: abas() });
    await ctrl.ready;

    teclar(botoes(ctrl)[0], 'End');
    expect(ctrl.getActive()).toBe('c');

    teclar(botoes(ctrl)[2], 'Home');
    expect(ctrl.getActive()).toBe('a');
  });

  // CONTROLE NEGATIVO: tecla que nao e de navegacao nao troca de aba nem
  // consome o evento. Sem isto, um `preventDefault()` incondicional passaria.
  test('outra tecla nao troca de aba', async () => {
    const ctrl = createTabs({ tabs: abas() });
    await ctrl.ready;

    const evento = teclar(botoes(ctrl)[0], 'x');
    expect(ctrl.getActive()).toBe('a');
    expect(evento.defaultPrevented).toBe(false);
  });
});
