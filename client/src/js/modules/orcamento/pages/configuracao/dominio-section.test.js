import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Testa o componente generico de gestao de dominio editavel (createDominioSection)
// usado na pagina de Configuracao para natureza de despesa, plano interno e UG.
// As funcoes de service sao injetadas pela config, entao passamos vi.fn() direto
// (sem mock de modulo). Os modais (openModal/confirmDialog) renderizam em
// document.body; localizamos os botoes pelo texto.

import { createDominioSection } from '@modules/orcamento/pages/configuracao/dominio-section.js';

// Acha um botao de rodape de modal (.modal__footer) pelo texto exato.
function clickFooterButton(label) {
  const btn = [...document.querySelectorAll('.modal__footer button')]
    .find(b => b.textContent.trim() === label);
  if (!btn) throw new Error(`Botao "${label}" nao encontrado`);
  btn.click();
}

// Config base de uma natureza de despesa (code + nome + gnd; grupo e derivado
// no backend, entao nao vai no corpo enviado pelo client).
function makeConfig(overrides = {}) {
  return {
    title: 'Naturezas de despesa',
    singular: 'natureza de despesa',
    novoLabel: 'Nova natureza',
    emptyMessage: 'Nenhuma natureza cadastrada',
    columns: [
      { key: 'code', label: 'Código' },
      { key: 'nome', label: 'Nome' },
      { key: 'gnd', label: 'GND' },
      { key: 'grupo', label: 'Grupo' },
    ],
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true, maxLength: 6, isKey: true },
      { key: 'nome', label: 'Nome', type: 'text', required: true, maxLength: 255 },
      { key: 'gnd', label: 'GND', type: 'select', required: true, options: [
        { value: 3, label: '3 - Custeio' },
        { value: 4, label: '4 - Capital' },
      ] },
    ],
    list: vi.fn(() => Promise.resolve([])),
    create: vi.fn(() => Promise.resolve()),
    update: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('createDominioSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('renderiza titulo, botao novo e carrega as linhas do service', async () => {
    const config = makeConfig({
      list: vi.fn(() => Promise.resolve([
        { code: '339030', nome: 'Material de consumo', gnd: 3, grupo: 'custeio' },
      ])),
    });
    const section = createDominioSection(config);
    document.body.appendChild(section.element);

    expect(section.element.querySelector('.config-section__title').textContent).toBe('Naturezas de despesa');
    expect([...section.element.querySelectorAll('button')].some(b => b.textContent.includes('Nova natureza'))).toBe(true);

    await section.load();
    await flush();

    expect(config.list).toHaveBeenCalled();
    expect(section.element.textContent).toContain('Material de consumo');

    section.cleanup();
  });

  test('botao novo abre o dialog e salvar chama create com o corpo (sem grupo)', async () => {
    const config = makeConfig();
    const section = createDominioSection(config);
    document.body.appendChild(section.element);
    await section.load();
    await flush();

    // Abre o dialog de novo registro.
    [...section.element.querySelectorAll('button')]
      .find(b => b.textContent.includes('Nova natureza'))
      .click();
    await flush();

    const body = document.querySelector('.modal__body');
    expect(body).not.toBeNull();
    const inputs = body.querySelectorAll('.form-field__input');
    inputs[0].value = '339030'; // code
    inputs[1].value = 'Material de consumo'; // nome
    body.querySelector('.form-field__select').value = '3'; // gnd

    clickFooterButton('Salvar');
    await flush();

    expect(config.create).toHaveBeenCalledTimes(1);
    expect(config.create).toHaveBeenCalledWith({ code: '339030', nome: 'Material de consumo', gnd: 3 });
    // grupo nao e enviado pelo client (derivado no backend)
    expect(config.create.mock.calls[0][0]).not.toHaveProperty('grupo');

    section.cleanup();
  });

  test('nao chama create quando um obrigatorio esta vazio', async () => {
    const config = makeConfig();
    const section = createDominioSection(config);
    document.body.appendChild(section.element);
    await section.load();
    await flush();

    [...section.element.querySelectorAll('button')]
      .find(b => b.textContent.includes('Nova natureza'))
      .click();
    await flush();

    // Deixa o code vazio; preenche so o nome.
    const body = document.querySelector('.modal__body');
    body.querySelectorAll('.form-field__input')[1].value = 'Sem codigo';

    clickFooterButton('Salvar');
    await flush();

    expect(config.create).not.toHaveBeenCalled();
    // O dialog continua aberto mostrando o erro do campo.
    expect(document.querySelector('.form-field--error')).not.toBeNull();

    section.cleanup();
  });

  test('editar abre o dialog com a chave desabilitada e salvar chama update(code, body)', async () => {
    const config = makeConfig({
      list: vi.fn(() => Promise.resolve([
        { code: '339030', nome: 'Material de consumo', gnd: 3, grupo: 'custeio' },
      ])),
    });
    const section = createDominioSection(config);
    document.body.appendChild(section.element);
    await section.load();
    await flush();

    section.element.querySelector('[title="Editar"]').click();
    await flush();

    const body = document.querySelector('.modal__body');
    const inputs = body.querySelectorAll('.form-field__input');
    expect(inputs[0].value).toBe('339030'); // code preenchido
    expect(inputs[0].disabled).toBe(true); // chave nao editavel no edit
    inputs[1].value = 'Material editado'; // novo nome

    clickFooterButton('Salvar');
    await flush();

    expect(config.update).toHaveBeenCalledTimes(1);
    expect(config.update).toHaveBeenCalledWith('339030', { nome: 'Material editado', gnd: 3 });
    // O update nao recebe a chave no corpo.
    expect(config.update.mock.calls[0][1]).not.toHaveProperty('code');

    section.cleanup();
  });

  test('excluir confirma e chama remove(code)', async () => {
    const config = makeConfig({
      list: vi.fn(() => Promise.resolve([
        { code: '339030', nome: 'Material de consumo', gnd: 3, grupo: 'custeio' },
      ])),
    });
    const section = createDominioSection(config);
    document.body.appendChild(section.element);
    await section.load();
    await flush();

    section.element.querySelector('[title="Excluir"]').click();
    await flush();

    // O confirmDialog usa o label 'Excluir' no botao de confirmacao.
    clickFooterButton('Excluir');
    await flush();

    expect(config.remove).toHaveBeenCalledTimes(1);
    expect(config.remove).toHaveBeenCalledWith('339030');

    section.cleanup();
  });
});
