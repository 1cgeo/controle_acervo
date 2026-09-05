import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderClientesList } from '@modules/mapoteca/pages/clientes/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

const CLIENTES = [
  {
    id: 1, nome: '1º CGEO', tipo_cliente_nome: 'OM EB', ponto_contato_principal: 'S3',
    total_pedidos: 4, data_ultimo_pedido: '2026-06-01', pedidos_em_andamento: 1,
  },
  {
    id: 2, nome: 'Prefeitura de Porto Alegre', tipo_cliente_nome: 'Órgão público',
    ponto_contato_principal: null, total_pedidos: 1, data_ultimo_pedido: null,
    pedidos_em_andamento: 0,
  },
];

describe('renderClientesList', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getClientes.mockResolvedValue(CLIENTES);
  });

  test('monta o titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getClientes).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Clientes');
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();
    expect(container.textContent).toContain('1º CGEO');
    expect(container.textContent).toContain('Prefeitura de Porto Alegre');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao de exclusao em lote nasce escondido', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const botao = container.querySelector('.btn--danger');
    expect(botao.classList.contains('hidden')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  // ESTE TESTE JA EXISTIA COM A EXPECTATIVA CONTRARIA: ele exigia que o erro
  // mostrasse "Nenhum cliente cadastrado". Aquilo era o defeito, escrito como
  // regra. "Nao ha cliente" manda cadastrar; "nao consegui saber" manda tentar
  // de novo. A tela dizia a primeira frase quando acontecia a segunda.
  test('erro do service aparece como ERRO, e nao como lista vazia', async () => {
    svc.getClientes.mockRejectedValueOnce(new Error('Erro de conexão'));
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Erro de conexão');
    expect(container.textContent).not.toContain('Nenhum cliente cadastrado');
    // E oferece o caminho de saida, que a mensagem de vazio nao oferecia.
    expect([...container.querySelectorAll('button')]
      .some(b => b.textContent.includes('Tentar de novo'))).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('tentar de novo devolve a lista, sem remontar a pagina', async () => {
    svc.getClientes.mockRejectedValueOnce(new Error('Erro de conexão'));
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Tentar de novo')).click();
    await flush();

    expect(container.textContent).not.toContain('Erro de conexão');
    expect(container.textContent).toContain('1º CGEO');

    if (typeof cleanup === 'function') cleanup();
  });
});

// Criar, editar e excluir cliente exigem gerente no servidor. A tela esconde as
// três ações de quem não é gerente, para o clique não levar 403.
describe('renderClientesList: o que cada perfil ve', () => {
  beforeEach(() => {
    svc.getClientes.mockResolvedValue(CLIENTES);
  });

  test('consulta ve a lista, sem "Novo cliente", sem selecao e sem acao de escrita', async () => {
    logarComo({ mapoteca: CONSULTA });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('1º CGEO');
    expect(container.textContent).not.toContain('Novo cliente');
    expect(container.textContent).not.toContain('Excluir selecionados');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    // Sobra so o "Ver detalhes" na coluna de acoes.
    expect(container.querySelectorAll('.data-table__action-btn')).toHaveLength(CLIENTES.length);
    expect(container.querySelector('.data-table__action-btn--danger')).toBeNull();

    cleanup();
  });

  test('operador tambem nao escreve aqui: o nivel exigido e gerente', async () => {
    logarComo({ mapoteca: OPERADOR });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).not.toContain('Novo cliente');
    expect(container.querySelector('.data-table__action-btn--danger')).toBeNull();

    cleanup();
  });

  test('gerente ve criar, editar e excluir', async () => {
    logarComo({ mapoteca: GERENTE });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Novo cliente');
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector('.data-table__action-btn--danger')).not.toBeNull();

    cleanup();
  });

  test('administrador global escreve mesmo sem perfil na mapoteca', async () => {
    logarComo({}, { administrador: true });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Novo cliente');

    cleanup();
  });
});

// AS DUAS TELAS DE RISCO DA LISTA: excluir em lote e criar duplicata.
describe('renderClientesList: a lista nomeia o que apaga e recusa o duplicado', () => {
  const COM_SIGLA = [
    { ...CLIENTES[0], sigla: '1º CGEO', tipo_cliente_id: 1 },
    { ...CLIENTES[1], sigla: null, tipo_cliente_id: 5 },
  ];

  beforeEach(() => {
    logarComo({ mapoteca: GERENTE });
    svc.getClientes.mockResolvedValue(COM_SIGLA);
    svc.getDominioTipoCliente.mockResolvedValue([
      { code: 1, nome: 'OM EB' }, { code: 5, nome: 'Órgão público' },
    ]);
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  // A TELA ENTRA NO DOCUMENTO, e nao fica num `div` solto: o jsdom so dispara o
  // `change` do checkbox em no CONECTADO, e a selecao da tabela vive nesse
  // evento. Num container solto as caixas ficam marcadas e a selecao, vazia.
  async function montar() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();
    return { container, cleanup };
  }

  /** O campo do diálogo aberto, pelo rótulo. */
  const campo = (rotulo) => [...document.querySelectorAll('.modal .form-field')]
    .find(f => f.querySelector('.form-field__label')?.textContent.startsWith(rotulo));

  /** Botão do rodapé do diálogo aberto, pelo texto. */
  const botaoDoModal = (texto) => [...document.querySelectorAll('.modal__footer button')]
    .find(b => b.textContent.trim() === texto);

  // A EXCLUSAO EM LOTE NOMEIA QUEM VAI SAIR. A tabela e paginada e a selecao
  // atravessa a paginacao: a contagem sozinha nao devolve o que se marcou tres
  // paginas atras, e a acao e irreversivel.
  test('a confirmação em lote nomeia os clientes marcados', async () => {
    const { container, cleanup } = await montar();

    for (const caixa of container.querySelectorAll('tbody input[type="checkbox"]')) {
      caixa.click();
    }
    await flush();

    [...container.querySelectorAll('.btn--danger')]
      .find(b => b.textContent.includes('Excluir selecionados')).click();
    await flush();

    const mensagem = document.querySelector('.modal').textContent;
    expect(mensagem).toContain('1º CGEO');
    expect(mensagem).toContain('Prefeitura de Porto Alegre');
    expect(mensagem).toContain('Esta ação não pode ser desfeita');

    cleanup();
  });

  // O PAR IDENTICO NAO GANHA "CRIAR ASSIM MESMO". O banco tem
  // `unique_cliente_nome_sigla UNIQUE NULLS NOT DISTINCT (nome, sigla)` sobre o
  // texto CRU: com o par igual, o POST devolve 409 sempre. Oferecer a criacao e
  // prometer uma saida que nao existe.
  test('nome e sigla idênticos param no campo, sem oferecer "Criar assim mesmo"', async () => {
    const { container, cleanup } = await montar();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Novo cliente')).click();
    await flush();

    campo('Nome').querySelector('input').value = '1º CGEO';
    campo('Sigla').querySelector('input').value = '1º CGEO';
    campo('Tipo de cliente').querySelector('select').value = '1';
    campo('Tipo de cliente').querySelector('select')
      .dispatchEvent(new Event('change', { bubbles: true }));
    botaoDoModal('Criar').click();
    await flush();

    expect(botaoDoModal('Criar assim mesmo')).toBeUndefined();
    expect(campo('Nome').textContent).toContain('Já existe este cliente');
    expect(svc.createCliente).not.toHaveBeenCalled();

    cleanup();
  });

  // O QUASE-HOMONIMO CONTINUA SENDO CONFIRMACAO: '1o CGEO' e '1º CGEO' sao o
  // mesmo para o `normalizar` e DIFERENTES para o UNIQUE, entao "criar assim
  // mesmo" funciona de verdade ali. E o caso decidido em docs/decisoes.md.
  test('o quase-homônimo continua abrindo a confirmação', async () => {
    const { container, cleanup } = await montar();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Novo cliente')).click();
    await flush();

    campo('Nome').querySelector('input').value = '1o CGEO';
    campo('Tipo de cliente').querySelector('select').value = '1';
    campo('Tipo de cliente').querySelector('select')
      .dispatchEvent(new Event('change', { bubbles: true }));
    botaoDoModal('Criar').click();
    await flush();

    expect(botaoDoModal('Criar assim mesmo')).toBeTruthy();

    cleanup();
  });
});
