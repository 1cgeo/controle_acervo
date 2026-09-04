import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPedidosList } from '@modules/mapoteca/pages/pedidos/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, GERENTE, CONSULTA } from '@/__tests__/helpers/sessao.js';

// A tela tem o proprio filtro de ano e abre no ano ATUAL.
// O seletor da navbar acabou, e nada fica guardado no localStorage.
const ANO_ATUAL = new Date().getFullYear();
const ANO_ANTERIOR = ANO_ATUAL - 1;

/** O select do filtro de ano, primeiro item da barra de filtros. */
const filtroAno = (container) => container.querySelector('.filtro-barra select');

// Militar (tipo 1 a 3) e civil (4 a 9) no mesmo lote, senao o filtro nao tem o
// que separar e o teste passa sem provar nada.
const PEDIDOS = [
  {
    id: 55, data_pedido: '2026-06-10', cliente_nome: '1º CGEO',
    tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
    documento_solicitacao: 'DIEx 123', situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento', prazo: '2026-06-30',
    palavras_chave: ['Extra-PIT', 'Adestramento'],
    quantidade_produtos: 8, itens_impressos: 3, localizador_pedido: 'AB12-CD34-EF56',
  },
  {
    id: 56, data_pedido: '2026-06-11', cliente_nome: 'Prefeitura de Santa Maria',
    tipo_cliente_id: 6, tipo_cliente_nome: 'Órgão Publico Municipal',
    documento_solicitacao: 'Ofício 9', situacao_pedido_id: 5,
    situacao_pedido_nome: 'Concluído', prazo: '2026-07-01',
    palavras_chave: [],
    quantidade_produtos: 2, itens_impressos: 2, localizador_pedido: 'ZZ99-YY88-XX77',
  },
  {
    id: 57, data_pedido: '2026-06-12', cliente_nome: 'Base Aérea de Santa Maria',
    tipo_cliente_id: 2, tipo_cliente_nome: 'OM Aeronáutica',
    documento_solicitacao: 'DIEx 456', situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento', prazo: '2026-07-05',
    quantidade_produtos: 1, itens_impressos: 0, localizador_pedido: 'QQ11-WW22-EE33',
  },
];

// Um pedido em Aguardando producao (situacao 7) NAO entra no lote acima de
// proposito: ele mudaria a contagem dos testes de militar/civil, que ja provam
// outra coisa. O teste do filtro novo carrega o seu proprio lote.
const PEDIDO_AGUARDANDO = {
  id: 58, data_pedido: '2026-06-13', cliente_nome: 'Comando Militar do Sul',
  tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
  documento_solicitacao: 'DIEx 789', situacao_pedido_id: 7,
  situacao_pedido_nome: 'Aguardando produção', prazo: '2026-09-30',
  quantidade_produtos: 33, itens_impressos: 0, localizador_pedido: 'AA10-BB20-CC30',
};

// O mesmo motivo do de cima: fora do lote padrao para nao mexer nas contagens
// que os outros testes provam.
const PEDIDO_AGUARDANDO_ENVIO = {
  id: 59, data_pedido: '2026-06-14', cliente_nome: '2º Batalhão de Comunicações',
  tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
  documento_solicitacao: 'DIEx 790', situacao_pedido_id: 8,
  situacao_pedido_nome: 'Aguardando envio', prazo: '2026-09-30',
  quantidade_produtos: 7, itens_impressos: 7, localizador_pedido: 'DD40-EE50-FF60',
};

/** Texto das linhas visiveis da tabela (o filtro age no corpo, nao no cabecalho). */
const corpo = (container) => [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent);

/** O campo de busca por palavra-chave, na barra de filtros. */
const campoEtiqueta = (container) => container.querySelector('.filtro-barra__busca input');

/** Digita a etiqueta e busca por Enter, como quem usa a tela. */
const buscarEtiqueta = (container, texto) => {
  const campo = campoEtiqueta(container);
  campo.value = texto;
  campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};

/** Clica no botao de filtro pelo rotulo. */
const clicarFiltro = (container, rotulo) => {
  const botao = [...container.querySelectorAll('.filtro-barra__grupo button')]
    .find(b => b.textContent === rotulo);
  if (!botao) throw new Error(`filtro "${rotulo}" nao existe na tela`);
  botao.click();
};

describe('renderPedidosList', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getPedidos.mockResolvedValue(PEDIDOS);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
  });

  // O filtro e desta tela e abre sempre no ano ATUAL. Antes o ano vinha da
  // navbar e valia para o modulo inteiro: olhar o mapa de outro ano mudava
  // calado esta lista.
  test('abre no ano ATUAL e trocar o ano recarrega a lista', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(filtroAno(container).value).toBe(String(ANO_ATUAL));
    // Sem palavra-chave, o segundo argumento vai NULO: e o ano inteiro.
    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ATUAL, null);

    filtroAno(container).value = String(ANO_ANTERIOR);
    filtroAno(container).dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ANTERIOR, null);
    // O contador diz de que ano e a contagem que esta na tela.
    expect(container.querySelector('.page__meta').textContent).toContain(String(ANO_ANTERIOR));

    if (typeof cleanup === 'function') cleanup();
  });

  test('monta o titulo e carrega os pedidos', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getPedidos).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Pedidos');
    expect(container.textContent).toContain('AB12-CD34-EF56');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a coluna de impressao mostra impressos/total', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('3/8');

    if (typeof cleanup === 'function') cleanup();
  });

  // O id e chave interna: nao tem valor para quem opera, e some da lista.
  test('nao existe coluna de ID', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const cabecalhos = [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());
    expect(cabecalhos).not.toContain('ID');
    expect(cabecalhos).toContain('Localizador');
    expect(cabecalhos).toContain('Tipo');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o filtro separa militar de civil, e Todos traz os tres de volta', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(corpo(container)).toHaveLength(3);

    clicarFiltro(container, 'Militar');
    let linhas = corpo(container);
    expect(linhas).toHaveLength(2);
    expect(linhas.join(' ')).toContain('1º CGEO');
    expect(linhas.join(' ')).toContain('Base Aérea');
    expect(linhas.join(' ')).not.toContain('Prefeitura');

    clicarFiltro(container, 'Civil');
    linhas = corpo(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('Prefeitura');

    clicarFiltro(container, 'Todos');
    expect(corpo(container)).toHaveLength(3);

    if (typeof cleanup === 'function') cleanup();
  });

  // O pedido em Aguardando produção fica fora da fila de atendimento: ele
  // espera carta que ainda não existe. Esta lista é o único lugar onde ele
  // aparece, e sem filtro próprio ele vira esquecimento.
  test('o filtro "Aguardando produção" isola a situação 7', async () => {
    svc.getPedidos.mockResolvedValue([...PEDIDOS, PEDIDO_AGUARDANDO]);
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(corpo(container)).toHaveLength(4);

    clicarFiltro(container, 'Aguardando produção');
    const linhas = corpo(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('Comando Militar do Sul');
    expect(linhas[0]).toContain('AA10-BB20-CC30');

    clicarFiltro(container, 'Todos');
    expect(corpo(container)).toHaveLength(4);

    if (typeof cleanup === 'function') cleanup();
  });

  // O Aguardando envio ESTA na fila de atendimento, ao contrario do Aguardando
  // produção, e ganha filtro pelo motivo oposto: quem monta a remessa do dia
  // quer a lista dos que saem, sem garimpar entre os que ainda estão na
  // impressão.
  test('o filtro "Aguardando envio" isola a situação 8', async () => {
    svc.getPedidos.mockResolvedValue([...PEDIDOS, PEDIDO_AGUARDANDO_ENVIO]);
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    clicarFiltro(container, 'Aguardando envio');
    const linhas = corpo(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('2º Batalhão de Comunicações');
    expect(linhas[0]).toContain('DD40-EE50-FF60');

    // E não se confunde com o Aguardando produção, que começa igual e é o
    // estágio oposto: aquele espera carta, este espera despacho.
    clicarFiltro(container, 'Aguardando produção');
    expect(corpo(container)).toHaveLength(0);

    clicarFiltro(container, 'Todos');
    expect(corpo(container)).toHaveLength(4);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o contador diz quanto o filtro escondeu', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const meta = () => container.querySelector('.page__meta').textContent;
    expect(meta()).toContain('3 pedido(s)');

    clicarFiltro(container, 'Civil');
    // Com filtro, o total aparece junto: o numero na tela nunca se confunde
    // com o total de pedidos do sistema.
    expect(meta()).toContain('1 de 3');

    if (typeof cleanup === 'function') cleanup();
  });

  // A planilha do RTM sai da tela do RPCMTec, junto do Anuário e do DOCX, e lá
  // respeita o MÊS escolhido. Aqui não teria como: esta tela só filtra por ano.
  test('a planilha do RTM nao sai mais desta tela', async () => {
    logarComo({ mapoteca: CONSULTA });
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect([...container.querySelectorAll('button')]
      .some(b => b.textContent.includes('RTM'))).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  test('"Novo pedido" leva ao wizard COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    container.querySelector('.btn--primary').click();
    expect(location.hash).toBe('#/mapoteca/pedidos/novo');

    if (typeof cleanup === 'function') cleanup();
  });

  // A URL escolhe o filtro. A fila de atendimento manda quem clicou em "Ver na
  // lista de pedidos" cair direto no recorte Remetido, em vez de chegar em
  // "Todos" e ter de achar o botao entre seis.
  test('?filtro=remetido abre a tela ja no recorte Remetido', async () => {
    const REMETIDO = {
      id: 59, data_pedido: '2026-06-14', cliente_nome: '4º BE Cmb',
      tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
      documento_solicitacao: 'DIEx 900', situacao_pedido_id: 4,
      situacao_pedido_nome: 'Remetido', prazo: null,
      quantidade_produtos: 3, itens_impressos: 3, localizador_pedido: 'RR11-TT22-YY33',
    };
    svc.getPedidos.mockResolvedValue([...PEDIDOS, REMETIDO]);

    const container = document.createElement('div');
    const cleanup = await renderPedidosList(
      container, { params: {}, query: new URLSearchParams('filtro=remetido') }
    );
    await flush();

    const linhas = corpo(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('4º BE Cmb');
    // O botao do filtro nasce marcado, senao a tela mostraria um recorte que
    // nenhum botao explica.
    const botaoRemetido = [...container.querySelectorAll('.filtro-barra__grupo button')]
      .find(b => b.textContent === 'Remetido');
    expect(botaoRemetido.className).toContain('btn--primary');

    if (typeof cleanup === 'function') cleanup();
  });

  test('filtro desconhecido na URL cai em Todos', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(
      container, { params: {}, query: new URLSearchParams('filtro=inventado') }
    );
    await flush();

    expect(corpo(container)).toHaveLength(3);

    if (typeof cleanup === 'function') cleanup();
  });

  // "Nenhum pedido neste ano. Troque o ano no filtro" manda trocar o ano; o erro
  // manda tentar de novo. Mostrar a primeira frase quando aconteceu a segunda
  // faz a pessoa procurar o pedido em anos onde ele nunca esteve.
  test('erro de carga nao vira "nenhum pedido neste ano"', async () => {
    svc.getPedidos.mockRejectedValue(new Error('Falha ao consultar os pedidos'));

    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Falha ao consultar os pedidos');
    expect(container.textContent).not.toContain('Nenhum pedido neste ano');

    if (typeof cleanup === 'function') cleanup();
  });
});

// A BUSCA POR PALAVRA-CHAVE, de 2026-08-08. `pedido.palavras_chave` tinha 18
// linhas preenchidas e NENHUM leitor: o indice GIN existia desde a instalacao e
// nao servia consulta nenhuma. O que faltava era a consulta, e ela e do
// SERVIDOR, porque casa a etiqueta inteira por continencia (@>).
describe('busca por palavra-chave na lista de pedidos', () => {
  beforeEach(() => {
    logarComo({ mapoteca: GERENTE });
    svc.getPedidos.mockResolvedValue(PEDIDOS);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
  });

  test('o campo fica na barra de filtros, ao lado do ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(campoEtiqueta(container)).not.toBeNull();
    // O ano continua sendo o primeiro da barra: ele e quem decide o que o
    // servidor traz, e a etiqueta so recorta dentro dele.
    expect(filtroAno(container)).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('buscar chama a ROTA com o parametro palavra_chave', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    buscarEtiqueta(container, 'Extra-PIT');
    await flush();

    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ATUAL, 'Extra-PIT');

    if (typeof cleanup === 'function') cleanup();
  });

  test('apagar o campo e buscar de novo traz o ano inteiro', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    buscarEtiqueta(container, 'Extra-PIT');
    await flush();
    buscarEtiqueta(container, '');
    await flush();

    // Nulo, e nao string em branco: o Joi do servidor recusa o `.min(1)`, que
    // pediria "todo pedido com a etiqueta vazia".
    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ATUAL, null);

    if (typeof cleanup === 'function') cleanup();
  });

  // Filtrar por algo que a tela nao mostra deixa quem filtrou sem saber por que
  // aquela linha entrou, e sem saber com que grafia a etiqueta foi gravada, que
  // e justamente o que a busca exige acertar.
  test('a coluna de palavras-chave aparece, com as etiquetas da linha', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const cabecalhos = [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());
    expect(cabecalhos).toContain('Palavras-chave');
    // A linha do pedido 55 e a unica com etiqueta; a tabela abre ordenada por
    // data decrescente, entao ela nao e a primeira.
    const linha = corpo(container).find(t => t.includes('AB12-CD34-EF56'));
    expect(linha).toContain('Extra-PIT');
    expect(linha).toContain('Adestramento');

    if (typeof cleanup === 'function') cleanup();
  });

  // O clique e a unica forma de acertar a grafia sem adivinhar: a busca casa a
  // etiqueta INTEIRA e diferencia maiuscula de minuscula.
  test('clicar na etiqueta busca por ela, com a grafia gravada', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const etiqueta = [...container.querySelectorAll('tbody .chip')]
      .find(c => c.textContent === 'Extra-PIT');
    etiqueta.click();
    await flush();

    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ATUAL, 'Extra-PIT');
    expect(campoEtiqueta(container).value).toBe('Extra-PIT');

    if (typeof cleanup === 'function') cleanup();
  });

  // A busca casa a etiqueta INTEIRA e e sensivel a maiuscula, de proposito: e o
  // que usa o indice GIN. Sem o aviso no campo, quem digitar 'extra' e nao
  // achar 'Extra-PIT' conclui que a busca esta quebrada.
  test('a ajuda do campo explica que a etiqueta casa inteira e com maiuscula', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const ajuda = container.querySelector('.filtro-barra__busca').textContent;
    expect(ajuda).toContain('etiqueta inteira');
    expect(ajuda).toContain('maiúscula');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o contador diz qual etiqueta recortou a lista', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    svc.getPedidos.mockResolvedValue([PEDIDOS[0]]);
    buscarEtiqueta(container, 'Extra-PIT');
    await flush();

    const meta = container.querySelector('.page__meta').textContent;
    expect(meta).toContain('1 pedido(s)');
    expect(meta).toContain('Extra-PIT');

    if (typeof cleanup === 'function') cleanup();
  });

  // Mandar a alguem o link de um recorte vale mais do que instruir como chegar
  // nele, e e a mesma ideia do `?filtro=` que a fila de atendimento ja usa.
  test('?palavra_chave= na URL abre a tela com a busca ja feita', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(
      container, { params: {}, query: new URLSearchParams('palavra_chave=Extra-PIT') }
    );
    await flush();

    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ATUAL, 'Extra-PIT');
    expect(campoEtiqueta(container).value).toBe('Extra-PIT');

    if (typeof cleanup === 'function') cleanup();
  });

  // A SITUACAO SE MUDA NA LISTA, pelo chip, sem abrir o pedido. O dialogo vem do
  // arquivo de verdade (nao esta mockado), entao estes casos provam tambem a
  // ligacao entre os dois. O comportamento do dialogo em si mora em
  // dialog-situacao.test.js.
  //
  // O chip se procura DENTRO da linha do localizador, e nunca pelo texto solto:
  // dois pedidos do lote estao 'Em andamento', e o primeiro do DOM e o outro.
  const chipDaLinha = (container, localizador) => {
    const linha = [...container.querySelectorAll('tbody tr')]
      .find(tr => tr.textContent.includes(localizador));
    if (!linha) throw new Error(`pedido "${localizador}" nao esta na tela`);
    return linha.querySelector('td:nth-child(6) .chip');
  };

  const SITUACOES = [
    { code: 3, nome: 'Em andamento' },
    { code: 8, nome: 'Aguardando envio' },
  ];

  test('o chip de Situacao abre o dialogo de mudanca para o gerente', async () => {
    document.body.innerHTML = '';
    svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const chip = chipDaLinha(container, 'AB12-CD34-EF56');
    expect(chip.textContent).toBe('Em andamento');
    expect(chip.getAttribute('role')).toBe('button');

    chip.click();
    await flush();

    expect(document.querySelector('.modal__title').textContent)
      .toBe('Situação do pedido AB12-CD34-EF56');

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  test('salvar a situacao recarrega a lista', async () => {
    document.body.innerHTML = '';
    svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
    svc.updateSituacaoPedido.mockResolvedValue(null);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const antes = svc.getPedidos.mock.calls.length;
    chipDaLinha(container, 'AB12-CD34-EF56').click();
    await flush();

    const select = document.querySelector('.modal select');
    select.value = '8';
    select.dispatchEvent(new Event('change'));
    [...document.querySelectorAll('.modal__footer button')]
      .find(b => b.textContent.trim() === 'Salvar').click();
    await flush();

    expect(svc.updateSituacaoPedido).toHaveBeenCalledWith(55, { situacao_pedido_id: 8 });
    // A lista releu do servidor: sem isso o chip continuaria dizendo a situacao
    // antiga ate alguem trocar o ano ou recarregar a pagina.
    expect(svc.getPedidos.mock.calls.length).toBeGreaterThan(antes);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  // Quem tem consulta ou operador ve o chip PARADO: o servidor cobra gerente em
  // PUT /pedido/:id/situacao, e um chip que abre dialogo para terminar em 403
  // e pior do que chip nenhum.
  test('quem tem consulta ve o chip parado', async () => {
    logarComo({ mapoteca: CONSULTA });
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const chip = chipDaLinha(container, 'AB12-CD34-EF56');
    expect(chip.textContent).toBe('Em andamento');
    expect(chip.getAttribute('role')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});

// A COLUNA DE CEP NASCE ESCONDIDA e aparece quando a busca da TABELA casa por
// ela. Nao confundir com o campo de palavra-chave da barra de filtros, que vai
// ao servidor: o CEP ja chega na linha, e quem filtra e a caixa da tabela.
const PEDIDOS_COM_CEP = [
  {
    id: 172, data_pedido: '2026-08-20', cliente_nome: '5ª Divisão de Exército',
    tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
    documento_solicitacao: 'DIEx 200', situacao_pedido_id: 8,
    situacao_pedido_nome: 'Aguardando envio', prazo: '2026-09-10',
    quantidade_produtos: 3, itens_impressos: 3, localizador_pedido: 'AA10-BB20-CC30',
    cep_etiqueta: '81150-900',
  },
  {
    id: 184, data_pedido: '2026-08-22', cliente_nome: 'Artilharia Divisionária da 5ª DE',
    tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
    documento_solicitacao: 'DIEx 201', situacao_pedido_id: 8,
    situacao_pedido_nome: 'Aguardando envio', prazo: '2026-09-11',
    quantidade_produtos: 5, itens_impressos: 5, localizador_pedido: 'DD11-EE22-FF33',
    // GRAVADO SEM HIFEN de proposito: o campo e texto livre no banco, e a busca
    // tem de achar os dois pedidos com um termo so.
    cep_etiqueta: '81150900',
  },
  {
    id: 190, data_pedido: '2026-08-23', cliente_nome: 'Comando Militar do Sul',
    tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
    documento_solicitacao: 'DIEx 202', situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento', prazo: '2026-09-12',
    quantidade_produtos: 1, itens_impressos: 0, localizador_pedido: 'GG44-HH55-II66',
    // Sem etiqueta salva: 181 dos 195 pedidos estavam assim em 2026-08-27.
    cep_etiqueta: null,
  },
];

/** A caixa de busca da TABELA, que e outra coisa do campo de palavra-chave. */
const buscaDaTabela = (container) =>
  container.querySelector('.data-table-toolbar__search-input');

const digitarNaTabela = (container, texto) => {
  const campo = buscaDaTabela(container);
  campo.value = texto;
  campo.dispatchEvent(new Event('input', { bubbles: true }));
};

const cabecalhos = (container) =>
  [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());

describe('renderPedidosList: busca por CEP da etiqueta', () => {
  beforeEach(() => {
    logarComo({ mapoteca: GERENTE });
    svc.getPedidos.mockResolvedValue(PEDIDOS_COM_CEP);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
  });

  test('a coluna CEP nao aparece na abertura da tela', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(cabecalhos(container)).not.toContain('CEP');
    expect(corpo(container).length).toBe(3);

    if (typeof cleanup === 'function') cleanup();
  });

  test('buscar o CEP filtra os pedidos e revela a coluna', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    digitarNaTabela(container, '81150');

    expect(cabecalhos(container)).toContain('CEP');
    const linhas = corpo(container);
    expect(linhas.length).toBe(2);
    expect(linhas.join(' ')).toContain('81150-900');
    expect(linhas.join(' ')).not.toContain('Comando Militar do Sul');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o hifen nao decide: 81150900 e 81150-900 acham os dois pedidos', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    digitarNaTabela(container, '81150900');
    expect(corpo(container).length).toBe(2);

    digitarNaTabela(container, '81150-900');
    expect(corpo(container).length).toBe(2);

    if (typeof cleanup === 'function') cleanup();
  });

  test('buscar por outra coluna nao revela o CEP', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    digitarNaTabela(container, 'Comando');

    expect(corpo(container).length).toBe(1);
    expect(cabecalhos(container)).not.toContain('CEP');

    if (typeof cleanup === 'function') cleanup();
  });

  test('apagar a busca esconde a coluna de novo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    digitarNaTabela(container, '81150');
    expect(cabecalhos(container)).toContain('CEP');

    digitarNaTabela(container, '');
    expect(cabecalhos(container)).not.toContain('CEP');
    expect(corpo(container).length).toBe(3);

    if (typeof cleanup === 'function') cleanup();
  });
});

// ENTRAR NUM PEDIDO E VOLTAR NAO PODE APAGAR A ESCOLHA.
//
// Ate 2026-09-04 apagava: ano, palavra-chave e filtro eram variaveis locais de
// renderPedidosList, busca, ordem, pagina e itens por pagina eram privados do
// createDataTable, e o `<- Pedidos` do detalhe ia para '/mapoteca/pedidos'
// pelado. Quem filtrava, achava a linha na pagina 3 e abria o pedido voltava
// para a primeira pagina de "Todos", em 10 por pagina, sem busca.
//
// O ciclo se prova em DUAS montagens da mesma tela, que e o que o roteador faz:
// a primeira escreve na URL, a segunda nasce do que ficou escrito.
describe('renderPedidosList: o estado da tela sobrevive a ida ao pedido', () => {
  beforeEach(() => {
    logarComo({ mapoteca: GERENTE });
    svc.getPedidos.mockResolvedValue(PEDIDOS);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
    location.hash = '#/mapoteca/pedidos';
  });

  /** A query que a tela escreveu na barra de endereco. */
  const queryDaUrl = () => new URLSearchParams(location.hash.split('?')[1] || '');

  /** Monta a tela com o que a URL diz agora, como o roteador faria. */
  const remontar = async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(
      container, { params: {}, query: queryDaUrl() }
    );
    await flush();
    return { container, cleanup };
  };

  test('a tela pelada nao suja a URL', async () => {
    const { cleanup } = await remontar();

    expect(location.hash).toBe('#/mapoteca/pedidos');

    if (typeof cleanup === 'function') cleanup();
  });

  test('filtro, ano e palavra-chave entram na URL e voltam na remontagem', async () => {
    const primeira = await remontar();

    clicarFiltro(primeira.container, 'Militar');
    buscarEtiqueta(primeira.container, 'Extra-PIT');
    await flush();
    filtroAno(primeira.container).value = String(ANO_ANTERIOR);
    filtroAno(primeira.container).dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(queryDaUrl().get('filtro')).toBe('militar');
    expect(queryDaUrl().get('palavra_chave')).toBe('Extra-PIT');
    expect(queryDaUrl().get('ano')).toBe(String(ANO_ANTERIOR));
    if (typeof primeira.cleanup === 'function') primeira.cleanup();

    // A ida ao pedido e a volta pelo '<- Pedidos', que le esta mesma URL.
    const segunda = await remontar();

    expect(filtroAno(segunda.container).value).toBe(String(ANO_ANTERIOR));
    expect(campoEtiqueta(segunda.container).value).toBe('Extra-PIT');
    expect(svc.getPedidos).toHaveBeenLastCalledWith(ANO_ANTERIOR, 'Extra-PIT');
    // O filtro Militar continua aplicado: 2 dos 3 pedidos do lote.
    expect(corpo(segunda.container)).toHaveLength(2);
    expect(corpo(segunda.container).join(' ')).not.toContain('Prefeitura');

    if (typeof segunda.cleanup === 'function') segunda.cleanup();
  });

  test('busca da tabela, ordem, pagina e itens por pagina voltam junto', async () => {
    const primeira = await remontar();

    // Ordena por Cliente crescente (a tabela abre por Data decrescente).
    const cabecalhoCliente = [...primeira.container.querySelectorAll('thead th')]
      .find(th => th.textContent.trim().startsWith('Cliente'));
    cabecalhoCliente.click();
    digitarNaTabela(primeira.container, 'Santa Maria');

    expect(queryDaUrl().get('ordem')).toBe('cliente_nome');
    expect(queryDaUrl().get('dir')).toBe('asc');
    expect(queryDaUrl().get('busca')).toBe('Santa Maria');
    if (typeof primeira.cleanup === 'function') primeira.cleanup();

    const segunda = await remontar();

    expect(buscaDaTabela(segunda.container).value).toBe('Santa Maria');
    // A busca casa os dois de Santa Maria, e a ordem crescente por cliente poe
    // a Base Aerea na frente da Prefeitura.
    const linhas = corpo(segunda.container);
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toContain('Base Aérea');
    expect(segunda.container.querySelector('thead th[aria-sort="ascending"]').textContent)
      .toContain('Cliente');

    if (typeof segunda.cleanup === 'function') segunda.cleanup();
  });

  test('a pagina e o "por pagina" sobrevivem, e a pagina e 1-based na URL', async () => {
    // 12 pedidos para haver o que paginar de 5 em 5.
    svc.getPedidos.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        ...PEDIDOS[0],
        id: 100 + i,
        data_pedido: `2026-06-${String(i + 1).padStart(2, '0')}`,
        cliente_nome: `Cliente ${String(i + 1).padStart(2, '0')}`,
        localizador_pedido: `LOC-${i}`,
      }))
    );
    const primeira = await remontar();

    const seletor = primeira.container.querySelector('.pagination__select');
    seletor.value = '5';
    seletor.dispatchEvent(new Event('change', { bubbles: true }));
    primeira.container.querySelector('[aria-label="Próxima página"]').click();

    expect(queryDaUrl().get('por_pagina')).toBe('5');
    // Pagina 1 aqui dentro, 2 na barra de endereco: quem le a URL conta como o
    // rodape da tabela conta.
    expect(queryDaUrl().get('pagina')).toBe('2');
    if (typeof primeira.cleanup === 'function') primeira.cleanup();

    const segunda = await remontar();

    expect(segunda.container.querySelector('.pagination__info span').textContent)
      .toBe('6-10 de 12');
    expect(segunda.container.querySelector('.pagination__select').value).toBe('5');

    if (typeof segunda.cleanup === 'function') segunda.cleanup();
  });

  // O PIOR CASO: a URL e editada a mao, ou envelhece porque o pedido sumiu. A
  // tela tem de abrir, e nao explodir nem mostrar lista em branco.
  test('URL adulterada abre a tela no padrao, sem quebrar', async () => {
    location.hash = '#/mapoteca/pedidos?ano=abacaxi&filtro=inventado&pagina=99'
      + '&por_pagina=7&ordem=coluna_que_nao_existe&dir=lateral';

    const { container, cleanup } = await remontar();

    expect(filtroAno(container).value).toBe(String(ANO_ATUAL));
    expect(corpo(container)).toHaveLength(3);
    // Volta a ordem de partida, data decrescente: o pedido 57 e o mais novo.
    expect(corpo(container)[0]).toContain('Base Aérea');

    if (typeof cleanup === 'function') cleanup();
  });
});
