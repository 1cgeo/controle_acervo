import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { modulosPortados } from '@modules/registry.js';
import { createModuleSelector } from './module-selector.js';

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
];

function logar({ administrador = false, perfis = {}, modulos = CATALOGO } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos }, 'x');
}

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});

describe('seletor de modulo', () => {
  test('lista so os modulos em que a pessoa tem perfil', () => {
    logar({ perfis: { orcamento: 2 } });
    const { element } = createModuleSelector();
    const valores = [...element.options].map(o => o.value);
    expect(valores).toEqual(['orcamento']);
  });

  test('quem nao tem perfil em modulo nenhum ve o seletor vazio', () => {
    logar({ perfis: {} });
    const { element } = createModuleSelector();
    expect(element.options).toHaveLength(0);
  });

  test('administrador global ve todos os modulos portados', () => {
    logar({ administrador: true, perfis: {} });
    const { element } = createModuleSelector();
    const valores = [...element.options].map(o => o.value);
    expect(valores).toEqual(modulosPortados().map(m => m.id));
  });

  test('o rotulo vem do catalogo do servidor, nao de nome decorado', () => {
    logar({ perfis: { orcamento: 1 } });
    const { element } = createModuleSelector();
    expect(element.options[0].textContent).toBe('Controle Orçamentário');
  });

  test('sem catalogo, mostra o nome_abrev em vez de quebrar', () => {
    logar({ perfis: { orcamento: 1 }, modulos: [] });
    const { element } = createModuleSelector();
    expect(element.options[0].textContent).toBe('orcamento');
  });

  test('escolher um modulo troca a ROTA, sem recarregar', () => {
    logar({ administrador: true });
    const { element } = createModuleSelector();
    element.value = 'orcamento';
    element.dispatchEvent(new Event('change'));
    expect(location.hash).toBe('#/orcamento/dashboard');
  });

  test('setModulo sincroniza o valor exibido com a rota atual', () => {
    logar({ administrador: true });
    const { element, setModulo } = createModuleSelector();
    setModulo('orcamento');
    expect(element.value).toBe('orcamento');
    // Modulo sem acesso nao muda a selecao
    setModulo('producao');
    expect(element.value).toBe('orcamento');
  });
});
