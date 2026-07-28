import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@services/plataforma-service.js', () => ({
  importarUsuarios: vi.fn(() => Promise.resolve({})),
}));

import { abrirImportarDialog } from '@pages/usuarios/importar-dialog.js';
import { importarUsuarios } from '@services/plataforma-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const DISPONIVEIS = [
  { uuid: 'u-1', login: 'sgt.silva', nome: 'Silva', tipo_posto_grad: '3 Sgt' },
  { uuid: 'u-2', login: 'cap.joao', nome: 'João Andrade', tipo_posto_grad: 'Cap' },
  { uuid: 'u-3', login: 'ten.souza', nome: 'Souza', tipo_posto_grad: '1 Ten' },
];

const nomeExibicao = (u) => u.nome || u.login || '-';

const itens = () => [...document.querySelectorAll('.importar-dialog__item')];
const visiveis = () => itens().filter(i => !i.classList.contains('hidden'));
const checkboxDe = (item) => item.querySelector('input[type="checkbox"]');
const busca = () => document.querySelector('input[type="search"]');
const contador = () => document.querySelector('.importar-dialog__contador').textContent;
const botao = (rotuloInicial) => [...document.querySelectorAll('.modal button')]
  .find(b => b.textContent.startsWith(rotuloInicial));
const botaoImportar = () => [...document.querySelectorAll('.modal__footer button')]
  .find(b => b.textContent.startsWith('Importar'));

function abrir(onSaved = vi.fn()) {
  abrirImportarDialog({ disponiveis: DISPONIVEIS, nomeExibicao, onSaved });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('abrirImportarDialog', () => {
  test('lista as pessoas com nome, login e posto', async () => {
    abrir();

    expect(itens()).toHaveLength(3);
    expect(itens()[0].textContent).toContain('Silva');
    expect(itens()[0].textContent).toContain('sgt.silva');
    expect(itens()[0].textContent).toContain('3 Sgt');
  });

  test('nasce sem nada marcado, e o botao de importar comeca desativado', async () => {
    abrir();

    expect(botaoImportar().disabled).toBe(true);
    expect(botaoImportar().textContent).toBe('Importar');
    expect(contador()).toContain('3 pessoa(s)');
  });

  // A lista chega com a DGEO inteira: sem busca, achar alguem e rolar com o olho.
  test('a busca filtra por nome, login ou posto, ignorando acento', async () => {
    abrir();

    busca().value = 'joao';
    busca().dispatchEvent(new Event('input'));

    // "joao" acha "João Andrade": os dois lados sao normalizados.
    expect(visiveis()).toHaveLength(1);
    expect(visiveis()[0].textContent).toContain('João Andrade');

    busca().value = 'sgt';
    busca().dispatchEvent(new Event('input'));
    expect(visiveis()).toHaveLength(1);
    expect(visiveis()[0].textContent).toContain('Silva');

    busca().value = '';
    busca().dispatchEvent(new Event('input'));
    expect(visiveis()).toHaveLength(3);
  });

  test('busca sem resultado mostra o estado vazio', async () => {
    abrir();

    busca().value = 'ninguem com esse nome';
    busca().dispatchEvent(new Event('input'));

    expect(visiveis()).toHaveLength(0);
    expect(document.querySelector('.importar-dialog__vazio').classList.contains('hidden')).toBe(false);
    expect(botao('Selecionar todos').disabled).toBe(true);
  });

  test('marcar atualiza o contador e o rotulo do botao', async () => {
    abrir();

    checkboxDe(itens()[0]).click();
    expect(contador()).toBe('1 de 3 selecionada(s)');
    expect(botaoImportar().disabled).toBe(false);
    expect(botaoImportar().textContent).toBe('Importar 1');

    checkboxDe(itens()[1]).click();
    expect(botaoImportar().textContent).toBe('Importar 2');
  });

  // Selecionar todos com filtro ligado pega SO o que esta na tela: marcar quem
  // a pessoa nem esta vendo seria uma surpresa desagradavel num POST.
  test('"selecionar todos" respeita o filtro da busca', async () => {
    abrir();

    busca().value = 'silva';
    busca().dispatchEvent(new Event('input'));
    botao('Selecionar todos').click();

    expect(contador()).toBe('1 de 3 selecionada(s)');

    busca().value = '';
    busca().dispatchEvent(new Event('input'));
    expect(itens().filter(i => checkboxDe(i).checked)).toHaveLength(1);
  });

  test('"limpar seleção" desmarca tudo o que esta visivel', async () => {
    abrir();

    botao('Selecionar todos').click();
    expect(contador()).toBe('3 de 3 selecionada(s)');

    botao('Limpar seleção').click();
    expect(botaoImportar().disabled).toBe(true);
    expect(itens().some(i => checkboxDe(i).checked)).toBe(false);
  });

  test('importar manda os uuids marcados e recarrega a lista', async () => {
    const onSaved = vi.fn();
    abrir(onSaved);

    checkboxDe(itens()[0]).click();
    checkboxDe(itens()[2]).click();
    botaoImportar().click();
    await flush();

    expect(importarUsuarios).toHaveBeenCalledWith(['u-1', 'u-3']);
    expect(onSaved).toHaveBeenCalled();
    // O modal fecha sozinho depois de importar.
    expect(document.querySelector('.modal')).toBeNull();
  });

  test('falha ao importar mantem o modal aberto e reabilita o botao', async () => {
    importarUsuarios.mockRejectedValueOnce(new Error('Auth Server fora do ar'));
    abrir();

    checkboxDe(itens()[0]).click();
    botaoImportar().click();
    await flush();

    expect(document.querySelector('.modal')).not.toBeNull();
    expect(botaoImportar().disabled).toBe(false);
  });

  // Importar cria a pessoa SEM perfil: conceder acesso e ato explicito, na
  // outra tela. Confundir as duas coisas e o erro natural de quem importa pela
  // primeira vez, entao o modal precisa dizer isso.
  test('avisa que importar nao concede acesso a modulo nenhum', async () => {
    abrir();

    const nota = document.querySelector('.importar-dialog__nota').textContent;
    expect(nota).toContain('sem perfil');
    expect(nota).toContain('Definir perfis por módulo');
  });
});
