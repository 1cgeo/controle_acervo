import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import {
  MODULOS, getModulo, modulosPortados, modulosAcessiveis,
  moduloDaRota, rotaInicial, primeiroModuloAcessivel,
  getRota, podeAbrirRota,
} from './registry.js';

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
];

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: CATALOGO }, 'x');
}

beforeEach(() => localStorage.clear());

describe('registry: manifestos', () => {
  test('os tres modulos estao registrados', () => {
    expect(MODULOS.map(m => m.id)).toEqual(['acervo', 'mapoteca', 'orcamento']);
  });

  test('o id do modulo casa com o nome_abrev do catalogo do servidor', () => {
    const abrevs = CATALOGO.map(m => m.nome_abrev);
    for (const modulo of MODULOS) {
      expect(abrevs).toContain(modulo.id);
    }
  });

  test('getModulo acha pelo id e devolve null no desconhecido', () => {
    expect(getModulo('orcamento').id).toBe('orcamento');
    expect(getModulo('producao')).toBeNull();
  });

  test('modulo esqueleto (sem rota) nao conta como portado', () => {
    // Generico de proposito: os modulos sao portados um a um, entao o teste
    // afere a REGRA (rotas vazias ficam de fora), nunca quem ja foi portado.
    const portados = modulosPortados().map(m => m.id);
    expect(portados).toContain('orcamento');
    for (const modulo of MODULOS) {
      const temRota = Array.isArray(modulo.rotas) && modulo.rotas.length > 0;
      expect(portados.includes(modulo.id)).toBe(temRota);
    }
  });
});

describe('registry: o que a pessoa ve', () => {
  test('so os modulos portados EM QUE ela tem perfil', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(modulosAcessiveis().map(m => m.id)).toEqual(['orcamento']);
  });

  test('perfil so em modulo ainda nao portado nao abre nada', () => {
    const esqueleto = MODULOS.find(m => !Array.isArray(m.rotas) || m.rotas.length === 0);
    // Enquanto sobrar um esqueleto, perfil nele nao abre tela nenhuma.
    if (!esqueleto) return;
    logar({ perfis: { [esqueleto.id]: 3 } });
    expect(modulosAcessiveis()).toEqual([]);
    expect(primeiroModuloAcessivel()).toBeNull();
  });

  test('sem perfil nenhum, nenhum modulo', () => {
    logar({ perfis: {} });
    expect(modulosAcessiveis()).toEqual([]);
  });

  test('administrador global ve todos os modulos PORTADOS', () => {
    logar({ administrador: true, perfis: {} });
    expect(modulosAcessiveis().map(m => m.id)).toEqual(modulosPortados().map(m => m.id));
  });
});

describe('registry: rotas', () => {
  test('moduloDaRota le o primeiro segmento', () => {
    expect(moduloDaRota('/orcamento/dfd')).toBe('orcamento');
    expect(moduloDaRota('/orcamento/notas_empenho/3?x=1')).toBe('orcamento');
    expect(moduloDaRota('/acervo/dashboard')).toBe('acervo');
    // Rota de plataforma nao pertence a modulo nenhum
    expect(moduloDaRota('/usuarios')).toBeNull();
    expect(moduloDaRota('/login')).toBeNull();
    expect(moduloDaRota('/')).toBeNull();
  });

  test('rotaInicial monta prefixo + home do modulo', () => {
    expect(rotaInicial('orcamento')).toBe('/orcamento/dashboard');
    expect(rotaInicial(getModulo('orcamento'))).toBe('/orcamento/dashboard');
    expect(rotaInicial('inexistente')).toBe('/404');
  });

  test('a raiz aponta para o primeiro modulo acessivel', () => {
    logar({ perfis: { orcamento: 2 } });
    expect(rotaInicial(primeiroModuloAcessivel())).toBe('/orcamento/dashboard');
  });
});

describe('registry: podeAbrirRota espelha o guarda de index.js', () => {
  test('rota admin so abre para o administrador global', () => {
    logar({ perfis: { orcamento: 3 } });
    expect(podeAbrirRota('orcamento', '/configuracao')).toBe(false);

    logar({ administrador: true });
    expect(podeAbrirRota('orcamento', '/configuracao')).toBe(true);
  });

  test('rota de consulta abre para qualquer nivel do modulo', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(podeAbrirRota('orcamento', '/dfd')).toBe(true);
  });

  test('rota com nivel minimo respeita a hierarquia dentro do modulo', () => {
    // O wizard de pedido e gerente porque POST /pedido e gerente: quem nao pode
    // criar nao percorre as tres etapas para perder tudo no fim.
    logar({ perfis: { mapoteca: 2 } });
    expect(podeAbrirRota('mapoteca', '/pedidos')).toBe(true);
    expect(podeAbrirRota('mapoteca', '/pedidos/novo')).toBe(false);

    logar({ perfis: { mapoteca: 3 } });
    expect(podeAbrirRota('mapoteca', '/pedidos/novo')).toBe(true);
  });

  test('perfil em OUTRO modulo nao abre a rota deste', () => {
    logar({ perfis: { acervo: 3 } });
    expect(podeAbrirRota('orcamento', '/dfd')).toBe(false);
  });

  test('caminho que nao e rota registrada fica para o guarda decidir', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(getRota('orcamento', '/nao-existe')).toBeNull();
    expect(podeAbrirRota('orcamento', '/nao-existe')).toBe(true);
  });
});
