import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que estes casos FIXAM na tela de rastreabilidade:
//
// 1. Ela obedece a ROTA. Sem isso nenhuma outra tela consegue apontar para o
//    histórico de uma pessoa ou de um período.
// 2. O evento de capacitação leva à tela do TIPO dele. A tabela é uma só, e as
//    telas são duas.
// 3. O combo de subsistema só oferece o que o servidor gera.
vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
  getRastreabilidade: vi.fn(() => Promise.resolve({
    dados: [],
    pagination: { totalItems: 0, totalPages: 1, currentPage: 1, pageSize: 20 },
  })),
  getFiltrosRastreabilidade: vi.fn(() => Promise.resolve({
    modulos: ['acervo', 'plataforma'],
    origens: ['web'],
    usuarios: [
      { usuario_uuid: 'u1', nome: 'Fulano de Tal', nome_guerra: 'Fulano', posto: 'Cap' },
    ],
    entidades: [
      { modulo: 'acervo', entidade: 'produto' },
      { modulo: 'plataforma', entidade: 'capacitacao' },
      { modulo: 'plataforma', entidade: 'usuario' },
    ],
  })),
}));

import { renderRastreabilidade, NOME_ENTIDADE } from '@pages/rastreabilidade/index.js';
import {
  getRastreabilidade,
  getFiltrosRastreabilidade,
} from '@services/rastreabilidade-service.js';
import { saveAuth } from '@store/auth-store.js';

async function montar(busca = '') {
  const container = document.createElement('div');
  const cleanup = await renderRastreabilidade(container, {
    params: {},
    query: new URLSearchParams(busca),
  });
  await flush();
  return { container, cleanup };
}

const EVENTO = (extra = {}) => ({
  id: 1,
  modulo: 'plataforma',
  entidade: 'capacitacao',
  entidade_id: '7',
  tabela: 'rpcmtec.capacitacao',
  registro_id: '7',
  operacao: 'U',
  data_evento: '2026-08-04T14:00:00.000Z',
  usuario_uuid: 'u1',
  usuario_nome: 'Fulano de Tal',
  usuario_nome_guerra: 'Fulano',
  usuario_posto: 'Cap',
  campos_alterados: ['situacao_id'],
  mudancas: [],
  resumo: 'Curso de SARP (2026)',
  origem: 'web',
  dados_antes: null,
  dados_depois: null,
  ...extra,
});

const umaPagina = (eventos) => ({
  dados: eventos,
  pagination: {
    totalItems: eventos.length, totalPages: 1, currentPage: 1, pageSize: 20,
  },
});

const registroOnde = (container) => container.querySelector('.rastro-onde__registro');

// `.form-field`, e nao `.rastro-filtros__campo`: os filtros desta tela passaram
// a usar as classes do SISTEMA. Antes eles tinham marcacao propria, e os
// controles carregavam `form-control`, uma classe que nao existe em folha
// nenhuma, o que deixava os combos daqui com o estilo cru do navegador.
const selectDoRotulo = (container, rotulo) =>
  [...container.querySelectorAll('.form-field')]
    .find(c => c.querySelector('.form-field__label')?.textContent === rotulo)
    ?.querySelector('select, input');

describe('rastreabilidade: rota, destino e filtro', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    saveAuth({ token: 'tk-teste', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  test('a tela obedece ao usuario_uuid e ao período da rota', async () => {
    const { container, cleanup } = await montar(
      'usuario_uuid=u1&data_inicio=2026-01-01&data_fim=2026-03-31'
    );

    expect(getRastreabilidade).toHaveBeenCalledWith(expect.objectContaining({
      usuario_uuid: 'u1',
      data_inicio: '2026-01-01',
      data_fim: '2026-03-31',
    }));
    // Os controles MOSTRAM o recorte: filtro que age sem aparecer faz a lista
    // parecer curta sem dizer por quê.
    expect(selectDoRotulo(container, 'Usuário').value).toBe('u1');
    expect(selectDoRotulo(container, 'De').value).toBe('2026-01-01');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o militar sem evento nenhum continua sendo o recorte da tela', async () => {
    const { container, cleanup } = await montar('usuario_uuid=u9');

    // O combo vem do que EXISTE na tabela, e u9 não está lá. Descartar o filtro
    // mostraria o sistema inteiro a quem pediu uma pessoa.
    expect(getRastreabilidade).toHaveBeenCalledWith(expect.objectContaining({
      usuario_uuid: 'u9',
    }));
    expect(selectDoRotulo(container, 'Usuário').value).toBe('u9');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o sistema da rota recorta o combo de subsistema', async () => {
    const { container, cleanup } = await montar('modulo=acervo');

    const subsistema = selectDoRotulo(container, 'Subsistema');
    const valores = [...subsistema.options].map(o => o.value);
    expect(valores).toEqual(['', 'produto']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a capacitação RECEBIDA leva à tela de recebida', async () => {
    // dominio.tipo_capacitacao: 1 Ministrada, 2 Recebida.
    getRastreabilidade.mockResolvedValueOnce(umaPagina([
      EVENTO({ dados_depois: { id: 7, nome: 'Curso de SARP', tipo_id: 2 } }),
    ]));

    const { container, cleanup } = await montar();

    const registro = registroOnde(container);
    expect(registro.tagName).toBe('A');
    expect(registro.getAttribute('href')).toBe('#/capacitacao_recebida');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a capacitação MINISTRADA leva à tela de ministrada', async () => {
    getRastreabilidade.mockResolvedValueOnce(umaPagina([
      EVENTO({ dados_depois: { id: 7, nome: 'Estágio de SIG', tipo_id: 1 } }),
    ]));

    const { container, cleanup } = await montar();

    expect(registroOnde(container).getAttribute('href'))
      .toBe('#/capacitacao_ministrada');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a exclusão lê o tipo do estado anterior', async () => {
    getRastreabilidade.mockResolvedValueOnce(umaPagina([
      EVENTO({
        operacao: 'D',
        dados_antes: { id: 7, nome: 'Curso de SARP', tipo_id: 2 },
        dados_depois: null,
      }),
    ]));

    const { container, cleanup } = await montar();

    expect(registroOnde(container).getAttribute('href'))
      .toBe('#/capacitacao_recebida');

    if (typeof cleanup === 'function') cleanup();
  });

  test('sem o tipo no evento, a tela não promete destino', async () => {
    // O evento da LISTA de militares (`rpcmtec.capacitacao_militar`) não carrega
    // o `tipo_id`: ele é do vínculo, e não da capacitação.
    getRastreabilidade.mockResolvedValueOnce(umaPagina([
      EVENTO({
        tabela: 'rpcmtec.capacitacao_militar',
        dados_depois: { capacitacao_id: 7, militares: ['Cap Fulano'] },
      }),
    ]));

    const { container, cleanup } = await montar();

    // Link para a tela errada é pior que texto: quem não achar o registro lá
    // conclui que ele foi apagado.
    expect(registroOnde(container).tagName).toBe('SPAN');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o combo nomeia todas as entidades do servidor, e nenhuma a mais', async () => {
    // Fonte: o `entidade:` de cada entrada de server/src/auditoria/mapa/*.js.
    // 'aproveitamento' NÃO está lá: passagem e impedimento caem em 'usuario'.
    // 'configuracao' saiu em 2026-08-06, com a poda da orcamento.configuracao.
    //
    // O módulo `equipamento` acrescentou DUAS entidades, e não seis: o mapa
    // registra dois agregados ('equipamento' e 'tipo_equipamento'), e as quatro
    // tabelas de lançamento (indisponibilidade, afastamento, manutenção e
    // transferência) são auditadas SOB O BEM, com o `entidade_id` dele. É o que
    // faz a ficha responder "o que mudou neste equipamento" em vez de "o que
    // mudou no cadastro dele".
    //
    // 'manutencao' já estava na lista, e é OUTRA COISA: a manutenção das visões
    // materializadas do acervo. Os consertos de equipamento não entram por ali.
    //
    // O schema `campo` acrescentou UMA entidade, e nao seis: as finalidades, os
    // militares, as versoes atendidas, as fotos e os trajetos sao auditados SOB
    // O CAMPO, com o `entidade_id` dele. Mesmo recorte da ficha que a pessoa
    // abre, e mesma razao do equipamento acima.
    const DO_SERVIDOR = [
      'campo', 'capacitacao', 'cliente', 'dfd', 'dominio', 'edicao', 'equipamento',
      'exercicio', 'extra_pit', 'licitacao', 'manutencao', 'material', 'meta',
      'nota_credito', 'nota_empenho', 'pdr', 'pedido', 'ponto',
      'produto', 'projeto', 'rpnp', 'tipo_equipamento', 'usuario', 'volume',
    ];

    expect(Object.keys(NOME_ENTIDADE).sort()).toEqual([...DO_SERVIDOR].sort());
  });

});

// A falha do catálogo de opções não pode levar a barra junto: quem abriu a tela
// ainda precisa do recorte por data, que não depende daquele catálogo.
describe('rastreabilidade: o catálogo de opções fora do ar', () => {
  test('a barra continua de pé, com os campos que não dependem do catálogo', async () => {
    getFiltrosRastreabilidade.mockRejectedValueOnce(new Error('sem opções'));

    const { container, cleanup } = await montar();

    expect(container.querySelector('.rastro-filtros')).not.toBeNull();
    // Os campos de período seguem utilizáveis, e o de usuário nasce vazio em
    // vez de sumir da barra.
    expect(selectDoRotulo(container, 'De')).not.toBeNull();
    expect(selectDoRotulo(container, 'Até')).not.toBeNull();
    expect(selectDoRotulo(container, 'Usuário').value).toBe('');

    if (typeof cleanup === 'function') cleanup();
  });
});
