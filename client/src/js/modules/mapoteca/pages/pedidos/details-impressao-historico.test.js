import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que o detalhe do pedido ganhou: registrar impressao de dentro
// do pedido, o resumo de QUEM imprimiu quanto, e o historico do pedido (a rota
// de auditoria).
//
// Arquivo SEPARADO de details.test.js de proposito: aqui a sessao entra logada
// (saveAuth), e o perfil vale para o arquivo inteiro. Misturado com os testes
// que montam a tela deslogada, um mudaria o resultado do outro.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});
// O histórico é `/api/auditoria`, rota de PLATAFORMA: o rastro dos módulos
// vive numa tabela só.
//
// O service dele é PRÓPRIO e pequeno (três funções), e por isso o mock aqui é
// ele INTEIRO, em três linhas. Se as funções morassem em `plataforma-service.js`,
// que tem dezenas, este arquivo teria de manter a fábrica daquele service em dia
// por causa de três nomes que não têm nada a ver com o pedido.
vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
  getRastreabilidade: vi.fn(() => Promise.resolve({ dados: [], pagination: null })),
  getFiltrosRastreabilidade: vi.fn(() => Promise.resolve({
    modulos: [], entidades: [], origens: [], usuarios: [],
  })),
}));

import { renderPedidoDetails } from '@modules/mapoteca/pages/pedidos/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import * as rastro from '@services/rastreabilidade-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

const PEDIDO = {
  id: 55,
  cliente_id: 7,
  cliente_nome: '1º CGEO',
  localizador_pedido: 'AB12-CD34-EF56',
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
  data_pedido: '2026-06-10',
  produtos: [
    {
      id: 900, produto_nome: 'Porto Alegre', mi: '2987-2', escala: '1:25.000',
      tipo_midia_nome: 'Papel', quantidade: 50, quantidade_impressa: 50,
      quantidade_restante: 0, impressao_concluida: true,
    },
  ],
  impressao: { concluida: true, itens_concluidos: 1, total_itens: 1 },
};

// Tres sessoes de duas pessoas: e o caso que o chefe pediu para enxergar (uma
// pessoa imprimiu 40 e outra imprimiu 10, em duas idas ao plotter).
const HISTORICO_ITEM = {
  produto_pedido_id: 900,
  quantidade: 50,
  quantidade_impressa: 50,
  quantidade_restante: 0,
  impressao_concluida: true,
  registros: [
    { id: 1, quantidade: 40, observacao: null, data_impressao: '2026-07-28T10:00:00Z', usuario_nome: 'Cap Fulano' },
    { id: 2, quantidade: 6, observacao: null, data_impressao: '2026-07-29T10:00:00Z', usuario_nome: 'Sd Beltrano' },
    { id: 3, quantidade: 4, observacao: 'reimpressão', data_impressao: '2026-07-29T14:00:00Z', usuario_nome: 'Sd Beltrano' },
  ],
};

// O evento como o SERVIDOR o devolve: com o `resumo` do
// registro e o diff JA RENDERIZADO (`mudancas`), em vez de só a lista de nomes
// de coluna. Ver server/src/auditoria/renderizar.js.
const AUDITORIA = [
  {
    id: 3, tabela: 'mapoteca.impressao_item', registro_id: 12, operacao: 'I',
    resumo: 'Impressão de 4 cópia(s)',
    campos_alterados: ['quantidade', 'produto_pedido_id'],
    mudancas: [],
    data_evento: '2026-07-29T14:00:00Z',
    usuario_nome: 'Beltrano', usuario_nome_guerra: 'Beltrano', usuario_posto: 'Sd',
    origem: 'web',
  },
  {
    id: 2, tabela: 'mapoteca.produto_pedido', registro_id: 900, operacao: 'U',
    resumo: 'Item da versão 9f1e-...',
    campos_alterados: ['quantidade'],
    mudancas: [{
      campo: 'quantidade',
      rotulo: 'Quantidade',
      tipo: 'numero',
      declarado: true,
      antes: 40, depois: 50,
      antes_texto: '40', depois_texto: '50',
    }],
    data_evento: '2026-07-28T09:00:00Z',
    usuario_nome: 'Fulano', usuario_nome_guerra: 'Fulano', usuario_posto: 'Cap',
    origem: 'web',
  },
  {
    id: 1, tabela: 'mapoteca.pedido', registro_id: 55, operacao: 'I',
    resumo: 'Pedido AB12-CD34-EF56',
    campos_alterados: ['cliente_id', 'data_pedido'],
    mudancas: [],
    data_evento: '2026-06-10T08:00:00Z',
    usuario_nome: null, usuario_nome_guerra: null, usuario_posto: null,
    origem: 'migracao',
  },
];

const montar = async () => {
  const container = document.createElement('div');
  const cleanup = await renderPedidoDetails(container, {
    params: { id: '55' }, query: new URLSearchParams(),
  });
  await flush();
  await flush();
  return { container, cleanup };
};

const acaoDoItem = (container, titulo) => {
  const linha = container.querySelectorAll('tbody tr')[0];
  return [...linha.querySelectorAll('button')].find(b => (b.title || '').includes(titulo));
};

beforeEach(() => {
  // Gerente na mapoteca: e quem abre esta tela (ela nao esta nas rotas de
  // operador), e gerente satisfaz operador.
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { mapoteca: 3 } }, 'fulano');
  svc.getPedido.mockResolvedValue(PEDIDO);
  svc.getAnexosPedido.mockResolvedValue([]);
  rastro.getHistorico.mockResolvedValue(AUDITORIA);
  svc.getImpressaoItem.mockResolvedValue(HISTORICO_ITEM);
  svc.registrarImpressao.mockResolvedValue(null);
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('detalhe do pedido: registrar impressao', () => {
  test('a acao aparece na linha do item e grava pelo id do item', async () => {
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Registrar impressão').click();
    await flush();

    const campo = [...document.querySelectorAll('input[type="number"]')].pop();
    campo.value = '3';
    campo.dispatchEvent(new Event('input'));

    [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Registrar').pop().click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 3, observacao: undefined, data_impressao: undefined },
    ]);

    if (typeof cleanup === 'function') cleanup();
  });

  // POST /mapoteca/impressao e operador. Quem so consulta nao lanca impressao, e
  // o botao some.
  test('quem so consulta nao ve a acao de registrar', async () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u-2', perfis: { mapoteca: 1 } }, 'ciclano');
    const { container, cleanup } = await montar();

    expect(acaoDoItem(container, 'Registrar impressão')).toBeUndefined();
    // O historico continua, que e leitura.
    expect(acaoDoItem(container, 'Histórico de impressão')).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('detalhe do pedido: quem imprimiu quanto', () => {
  test('soma as sessoes de cada pessoa antes da lista', async () => {
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();

    const texto = document.body.textContent;
    expect(texto).toContain('Quem imprimiu');
    // Uma sessao de 40 e duas de 5 e 5: a soma e o que o chefe le, e nao as
    // linhas soltas da tabela paginada.
    expect(texto).toContain('Cap Fulano 40 cópia(s) (1 sessão)');
    expect(texto).toContain('Sd Beltrano 10 cópia(s) (2 sessões)');
    expect(texto).toContain('Total 50 de 50');

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem mais imprimiu vem primeiro', async () => {
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();

    const texto = document.body.textContent;
    expect(texto.indexOf('Cap Fulano')).toBeLessThan(texto.indexOf('Sd Beltrano'));

    if (typeof cleanup === 'function') cleanup();
  });

  test('item sem sessao nenhuma nao mostra o bloco vazio', async () => {
    svc.getImpressaoItem.mockResolvedValue({
      ...HISTORICO_ITEM, quantidade_impressa: 0, quantidade_restante: 50,
      impressao_concluida: false, registros: [],
    });
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();

    expect(document.body.textContent).not.toContain('Quem imprimiu');
    expect(document.body.textContent).toContain('Nenhuma sessão de impressão registrada');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('detalhe do pedido: historico do pedido', () => {
  test('le a rota de rastreabilidade pelo agregado do pedido', async () => {
    const { container, cleanup } = await montar();

    // Modulo, entidade e id: o historico do pedido traz tudo o que aconteceu com
    // ele, itens e impressoes inclusive, porque os tres compartilham o agregado.
    expect(rastro.getHistorico).toHaveBeenCalledWith('mapoteca', 'pedido', 55);
    const texto = container.textContent;
    expect(texto).toContain('Histórico do pedido');
    expect(texto).toContain('Adicionou');
    expect(texto).toContain('Alterou');
    // O RESUMO do registro, montado pelo servidor, e nao o nome da tabela. O
    // mapa `NOME_TABELA` que vivia nesta tela morreu junto: ele tinha quatro
    // chaves e so valia para o pedido, enquanto o servidor conhece as dezenas de
    // tabelas auditadas.
    expect(texto).toContain('Impressão de 4 cópia(s)');
    expect(texto).toContain('Pedido AB12-CD34-EF56');
    expect(texto).not.toContain('mapoteca.impressao_item');

    if (typeof cleanup === 'function') cleanup();
  });

  // A coluna "O que mudou" lê `dados_antes` e `dados_depois`, e escreve o
  // rótulo de tela com o valor de antes e o de agora. `campos_alterados`
  // sozinho diria que algo mudou, sem dizer DE QUE PARA QUE.
  test('mostra o valor ANTERIOR e o ATUAL, e nao o nome da coluna', async () => {
    const { container, cleanup } = await montar();
    const texto = container.textContent;

    expect(texto).toContain('Quantidade');
    expect(texto).toContain('40');
    expect(texto).toContain('50');
    // O nome cru da coluna nao aparece mais: quem le a mapoteca nao fala assim.
    expect(texto).not.toContain('produto_pedido');

    if (typeof cleanup === 'function') cleanup();
  });

  test('mostra quem mudou, com posto e nome de guerra', async () => {
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Sd Beltrano');
    expect(container.textContent).toContain('Cap Fulano');
    // Evento sem usuario e migracao, e nao erro: os eventos anteriores a
    // rastreabilidade entraram sem dono.
    expect(container.textContent).toContain('migração');

    if (typeof cleanup === 'function') cleanup();
  });

  test('pedido sem evento diz que nao ha alteracao, sem tabela vazia muda', async () => {
    rastro.getHistorico.mockResolvedValue([]);
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Nenhuma alteração registrada');

    if (typeof cleanup === 'function') cleanup();
  });

  // O que o chefe pediu no item 6 foi o historico de quem alterou a ETIQUETA, e
  // ele sai do mesmo agregado. O que a tela mostra e o resumo do servidor.
  test('a etiqueta de envio aparece pelo resumo, e diz o que mudou', async () => {
    rastro.getHistorico.mockResolvedValue([
      {
        id: 9, tabela: 'mapoteca.etiqueta_envio', registro_id: 4, operacao: 'U',
        resumo: 'Etiqueta para 12º BE Cmb',
        campos_alterados: ['endereco'],
        mudancas: [{
          campo: 'endereco', rotulo: 'Endereço', tipo: 'texto', declarado: true,
          antes: 'Rua A, 1', depois: 'Rua B, 2',
          antes_texto: 'Rua A, 1', depois_texto: 'Rua B, 2',
        }],
        data_evento: '2026-07-30T12:00:00Z',
        usuario_nome: 'Fulano', usuario_nome_guerra: 'Fulano', usuario_posto: 'Cap',
        origem: 'web',
      },
    ]);
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Endereço');
    expect(container.textContent).toContain('Rua A, 1');
    expect(container.textContent).toContain('Rua B, 2');
    expect(container.textContent).not.toContain('etiqueta_envio');

    if (typeof cleanup === 'function') cleanup();
  });

  // A outra metade do item 8: quem REMOVEU o pedido. A linha sobrevive (o rastro
  // nao tem chave estrangeira para o pedido, de proposito), mas antes ela ficava
  // inalcancavel, porque a tela parava no "Pedido nao encontrado".
  test('pedido apagado ainda mostra quem o removeu', async () => {
    svc.getPedido.mockRejectedValueOnce(new Error('Pedido não encontrado'));
    rastro.getHistorico.mockResolvedValue([
      {
        id: 10, tabela: 'mapoteca.pedido', registro_id: 55, operacao: 'D',
        resumo: 'Pedido AB12-CD34-EF56',
        campos_alterados: ['id', 'cliente_id'], mudancas: [],
        data_evento: '2026-07-30T13:00:00Z',
        usuario_nome: 'Fulano', usuario_nome_guerra: 'Fulano', usuario_posto: 'Cap',
        origem: 'web',
      },
    ]);
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Pedido não encontrado');
    expect(container.textContent).toContain('Histórico do pedido');
    expect(container.textContent).toContain('Removeu');
    expect(container.textContent).toContain('Cap Fulano');

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro no historico nao derruba o resto do detalhe', async () => {
    rastro.getHistorico.mockRejectedValueOnce(new Error('Falha ao ler a auditoria'));
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Falha ao ler a auditoria');
    expect(container.textContent).toContain('Produtos do pedido');

    if (typeof cleanup === 'function') cleanup();
  });
});

// A coluna "Qtd. fornecida" e a comparacao dela com a impressa sairam da tela
// em 2026-08-08, junto com `produto_pedido.quantidade_fornecida`: a coluna era
// IGUAL a `quantidade` em 1759 de 1759 linhas preenchidas, e o alarme de
// divergencia nunca teve o que alarmar. O que de fato saiu da impressora fica
// na coluna "Impressão", que le `mapoteca.impressao_item`.
describe('detalhe do pedido: o que a poda tirou da tabela de itens', () => {
  test('nao existe mais coluna de quantidade fornecida', async () => {
    const { container, cleanup } = await montar();

    const cabecalhos = [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());
    expect(cabecalhos).not.toContain('Qtd. fornecida');
    // A quantidade PEDIDA fica, e a impressao tambem: a poda tirou uma das
    // tres, e nao as tres.
    expect(cabecalhos).toContain('Qtd.');
    expect(cabecalhos).toContain('Impressão');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o alarme de divergencia sumiu junto, ate com o dado antigo na mao', async () => {
    // Um item como o banco antigo o devolvia, com fornecida diferente da
    // impressa: a tela ignora a chave morta em vez de pintar um alarme.
    svc.getPedido.mockResolvedValue({
      ...PEDIDO,
      produtos: [{ ...PEDIDO.produtos[0], quantidade_fornecida: 48 }],
    });
    const { container, cleanup } = await montar();

    expect(container.textContent).not.toContain('difere da impressa');
    expect(container.textContent).not.toContain('48');

    if (typeof cleanup === 'function') cleanup();
  });
});

// PUT /mapoteca/impressao/:id/data existia no servidor e nenhuma tela o chamava.
// Sem ele, a sessao lancada no dia errado so se conserta excluindo e lancando de
// novo, e a exclusao apaga quem imprimiu e a observacao junto.
describe('detalhe do pedido: corrigir a data de uma sessao de impressao', () => {
  const abrirHistorico = async (container) => {
    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();
  };

  const acaoDoRegistro = (titulo, indice = 0) => {
    const linha = [...document.querySelectorAll('.modal tbody tr')][indice];
    return [...linha.querySelectorAll('button')].find(b => (b.title || '').includes(titulo));
  };

  beforeEach(() => {
    svc.corrigirDataImpressao.mockResolvedValue(null);
  });

  test('grava a data nova com o motivo, pelo id do registro', async () => {
    const { container, cleanup } = await montar();
    await abrirHistorico(container);

    acaoDoRegistro('Corrigir a data').click();
    await flush();

    // O campo nasce com a data que o registro ja tem.
    const campoData = [...document.querySelectorAll('input[type="date"]')].pop();
    expect(campoData.value).toBe('2026-07-28');
    campoData.value = '2026-07-25';

    const campoMotivo = [...document.querySelectorAll('.modal input[type="text"]')].pop();
    campoMotivo.value = 'lancado no dia errado';

    [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Salvar').pop().click();
    await flush();

    expect(svc.corrigirDataImpressao).toHaveBeenCalledWith(1, {
      data_impressao: '2026-07-25',
      motivo: 'lancado no dia errado',
    });

    if (typeof cleanup === 'function') cleanup();
  });

  // O servidor exige motivo com 3 caracteres no minimo (Joi). Sem a checagem
  // aqui, o 400 chegava como toast depois de a pessoa achar que tinha gravado.
  test('motivo em branco barra a gravacao', async () => {
    const { container, cleanup } = await montar();
    await abrirHistorico(container);

    acaoDoRegistro('Corrigir a data').click();
    await flush();

    [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Salvar').pop().click();
    await flush();

    expect(svc.corrigirDataImpressao).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Escreva o motivo');

    if (typeof cleanup === 'function') cleanup();
  });

  // PUT /impressao/:id/data e GERENTE, embora REGISTRAR seja operador: mudar
  // QUANDO um gasto aconteceu muda o numero que o RPCMTec reporta naquele mes.
  test('quem so consulta nao ve a acao de corrigir', async () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u-3', perfis: { mapoteca: 1 } }, 'ciclano');
    const { container, cleanup } = await montar();
    await abrirHistorico(container);

    expect(acaoDoRegistro('Corrigir a data')).toBeUndefined();

    if (typeof cleanup === 'function') cleanup();
  });
});
