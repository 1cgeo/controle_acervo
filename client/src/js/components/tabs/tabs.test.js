import { describe, test, expect, vi } from 'vitest';
import { createTabs } from './tabs.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function abasSimples() {
  return [
    { id: 'a', label: 'Aba A', render: (c) => { c.appendChild(document.createElement('p')); c.lastChild.textContent = 'conteudo A'; } },
    { id: 'b', label: 'Aba B', render: (c) => { c.appendChild(document.createElement('p')); c.lastChild.textContent = 'conteudo B'; } },
  ];
}

describe('createTabs', () => {
  test('monta um botao por aba e ativa a primeira', async () => {
    const abas = createTabs({ tabs: abasSimples() });
    await abas.ready;

    const botoes = abas.element.querySelectorAll('.tabs__item');
    expect(botoes).toHaveLength(2);
    expect(botoes[0].classList.contains('tabs__item--active')).toBe(true);
    expect(botoes[0].getAttribute('aria-selected')).toBe('true');
    expect(botoes[1].getAttribute('aria-selected')).toBe('false');
    expect(abas.getActive()).toBe('a');
    expect(abas.element.querySelector('.tabs__content').textContent).toBe('conteudo A');
  });

  test('activeId escolhe a aba inicial', async () => {
    const abas = createTabs({ tabs: abasSimples(), activeId: 'b' });
    await abas.ready;
    expect(abas.getActive()).toBe('b');
    expect(abas.element.querySelector('.tabs__content').textContent).toBe('conteudo B');
  });

  test('clicar troca a aba, limpa a anterior e chama o cleanup dela', async () => {
    const cleanupA = vi.fn();
    const tabs = [
      { id: 'a', label: 'A', render: () => cleanupA },
      { id: 'b', label: 'B', render: (c) => { c.textContent = 'B pronta'; } },
    ];
    const abas = createTabs({ tabs });
    await abas.ready;

    abas.element.querySelectorAll('.tabs__item')[1].click();
    await flush();

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(abas.getActive()).toBe('b');
    expect(abas.element.querySelector('.tabs__content').textContent).toBe('B pronta');
  });

  test('refreshActive chama o refresh so da aba ativa', async () => {
    const refreshA = vi.fn(() => Promise.resolve());
    const refreshB = vi.fn(() => Promise.resolve());
    const abas = createTabs({
      tabs: [
        { id: 'a', label: 'A', render: () => ({ refresh: refreshA }) },
        { id: 'b', label: 'B', render: () => ({ refresh: refreshB }) },
      ],
    });
    await abas.ready;

    await abas.refreshActive();
    expect(refreshA).toHaveBeenCalledTimes(1);
    expect(refreshB).not.toHaveBeenCalled();

    await abas.setActive('b');
    await abas.refreshActive();
    expect(refreshB).toHaveBeenCalledTimes(1);
    expect(refreshA).toHaveBeenCalledTimes(1);
  });

  test('aba sem refresh nao quebra o refreshActive', async () => {
    const abas = createTabs({ tabs: abasSimples() });
    await abas.ready;
    await expect(abas.refreshActive()).resolves.toBeUndefined();
  });

  test('_cleanup limpa a aba ativa uma unica vez', async () => {
    const cleanup = vi.fn();
    const abas = createTabs({ tabs: [{ id: 'a', label: 'A', render: () => ({ cleanup }) }] });
    await abas.ready;

    abas._cleanup();
    abas._cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('troca durante o carregamento descarta o resultado atrasado', async () => {
    const cleanupLenta = vi.fn();
    const abas = createTabs({
      tabs: [
        {
          id: 'lenta',
          label: 'Lenta',
          render: async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return { cleanup: cleanupLenta };
          },
        },
        { id: 'rapida', label: 'Rápida', render: (c) => { c.textContent = 'pronta'; } },
      ],
    });

    // Troca antes de a primeira aba terminar de carregar.
    const promessaInicial = abas.ready;
    await abas.setActive('rapida');
    await promessaInicial;
    await new Promise(resolve => setTimeout(resolve, 40));

    // A aba atrasada teve o cleanup chamado no descarte, e nao virou a ativa.
    expect(cleanupLenta).toHaveBeenCalledTimes(1);
    expect(abas.getActive()).toBe('rapida');
    expect(abas.element.querySelector('.tabs__content').textContent).toBe('pronta');
  });

  test('className troca o bloco BEM (sub-tabs)', async () => {
    const abas = createTabs({ tabs: abasSimples(), className: 'sub-tabs' });
    await abas.ready;
    expect(abas.element.querySelectorAll('.sub-tabs__item')).toHaveLength(2);
    expect(abas.element.querySelector('.sub-tabs__item--active')).not.toBeNull();
  });
});
