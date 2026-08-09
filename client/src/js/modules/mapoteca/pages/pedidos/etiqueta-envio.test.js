import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Etiqueta de endereco do envio por Correios, montada a partir do pedido. O
// documento impresso e HTML autossuficiente, entao os testes leem a STRING que
// sai de montarEtiquetaHtml, e nao a arvore da pagina.
//
// A etiqueta é SALVA (GET e PUT /mapoteca/pedido/:id/etiqueta), então o diálogo
// fala com o service e o mock é obrigatório.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import {
  REMETENTE_ENDERECO,
  remetente,
  extrairCep,
  linhasEndereco,
  montarEtiquetaHtml,
  openEtiquetaEnvioDialog,
} from '@modules/mapoteca/pages/pedidos/etiqueta-envio.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

/** Entra na sessao como o Centro informado, que e de onde sai o remetente. */
const entrarComo = (instituicao) =>
  saveAuth({ token: 'nao-jwt', administrador: false, uuid: 'u-1', instituicao }, 'fulano');

const botao = (rotulo) => [...document.querySelectorAll('.modal__footer button')]
  .find(b => b.textContent.trim() === rotulo);

beforeEach(() => {
  // A sessao padrao e a desta instalacao. O remetente sai DELA desde 2026-08-09,
  // e nao de um nome escrito no codigo.
  entrarComo({ nome: '1º Centro de Geoinformação', sigla: '1º CGEO' });
  // O padrao e o pedido SEM etiqueta salva, que e a primeira abertura.
  svc.getEtiquetaEnvio.mockResolvedValue(null);
  svc.salvarEtiquetaEnvio.mockImplementation((pedidoId, dados) => Promise.resolve({
    id: 7,
    pedido_id: pedidoId,
    ...dados,
  }));
});

afterEach(() => {
  document.body.innerHTML = '';
  clearAuth();
  vi.clearAllMocks();
});

describe('extrairCep', () => {
  test('acha o CEP com e sem traco, no meio do endereco livre', () => {
    expect(extrairCep('Av. Marechal Bittencourt, 97 - Manaus - AM, 69029-160')).toBe('69029160');
    expect(extrairCep('Rua X, 1 - 90850240 Porto Alegre')).toBe('90850240');
  });

  test('endereco sem CEP devolve string vazia', () => {
    expect(extrairCep('Rua sem numero, bairro qualquer')).toBe('');
    expect(extrairCep(null)).toBe('');
  });
});

describe('linhasEndereco', () => {
  test('descarta linha vazia e espaco em volta', () => {
    expect(linhasEndereco('  Rua A, 10 \n\n Bairro B \n')).toEqual(['Rua A, 10', 'Bairro B']);
  });
});

describe('montarEtiquetaHtml', () => {
  const DADOS = {
    destinatario: '4º Centro de Geoinformação',
    aosCuidados: 'Cap Ronaldo',
    endereco: 'Avenida Marechal Bittencourt, 97\nSanto Antônio\nManaus - AM',
    cep: '69029-160',
    referencia: 'Pedido AB12-CD34-EF56',
  };

  test('traz destinatario, A/C, as linhas do endereco e a referencia do pedido', () => {
    const html = montarEtiquetaHtml(DADOS);

    expect(html).toContain('4º Centro de Geoinformação');
    expect(html).toContain('A/C Cap Ronaldo');
    expect(html).toContain('Avenida Marechal Bittencourt, 97');
    expect(html).toContain('Santo Antônio');
    expect(html).toContain('Manaus - AM');
    expect(html).toContain('Pedido AB12-CD34-EF56');
  });

  test('o remetente e sempre a mapoteca, sem depender do pedido', () => {
    const html = montarEtiquetaHtml({ destinatario: 'OM Qualquer' });

    expect(html).toContain(remetente().nome);
    REMETENTE_ENDERECO.linhas.forEach((linha) => expect(html).toContain(linha));
    expect(html).toContain(REMETENTE_ENDERECO.telefone);
  });

  // ---------------------------------------------------------------------------
  // O NOME DO CENTRO VEM DA SESSAO, e nao do codigo (2026-08-09)
  // ---------------------------------------------------------------------------
  //
  // A prova que interessa e com OUTRA instituicao: um teste que so confirma
  // '1º Centro de Geoinformação' passaria igual com o nome escrito aqui dentro,
  // que e exatamente o defeito que esta mudanca conserta.

  test('o remetente sai da instituicao da sessao', () => {
    entrarComo({ nome: '1º Centro de Geoinformação', sigla: '1º CGEO' });
    expect(montarEtiquetaHtml({ destinatario: 'OM Qualquer' }))
      .toContain('1º Centro de Geoinformação - Mapoteca');
  });

  test('OUTRO Centro na sessao imprime o nome DELE, e nunca o nosso', () => {
    entrarComo({ nome: '4º Centro de Geoinformação', sigla: '4º CGEO' });

    const html = montarEtiquetaHtml({ destinatario: 'OM Qualquer' });

    expect(html).toContain('4º Centro de Geoinformação - Mapoteca');
    expect(html).not.toContain('1º Centro de Geoinformação');
  });

  // Sessao sem instituicao e o banco sem a linha de `dgeo.instituicao`. A
  // etiqueta sai incompleta de proposito: a previa mostra isso antes de
  // imprimir, e e melhor do que colar no pacote o nome de outro Centro.
  test('sem instituicao na sessao, o remetente e so a Mapoteca', () => {
    clearAuth();

    const html = montarEtiquetaHtml({ destinatario: 'OM Qualquer' });

    expect(html).toContain('Mapoteca');
    expect(html).not.toContain('Centro de Geoinformação - Mapoteca');
    // O endereco postal continua no codigo, e por isso continua saindo.
    expect(html).toContain(REMETENTE_ENDERECO.telefone);
  });

  // O nome e lido a cada montagem, e nao no `import`: o administrador corrige a
  // instituicao no meio do expediente, e a etiqueta seguinte tem de acompanhar.
  test('trocar a instituicao muda a etiqueta seguinte, sem recarregar o modulo', () => {
    entrarComo({ nome: '1º Centro de Geoinformação', sigla: '1º CGEO' });
    const antes = montarEtiquetaHtml({ destinatario: 'OM Qualquer' });

    entrarComo({ nome: 'Centro de Geoinformação de Teste', sigla: 'CGEO-T' });
    const depois = montarEtiquetaHtml({ destinatario: 'OM Qualquer' });

    expect(antes).toContain('1º Centro de Geoinformação - Mapoteca');
    expect(depois).toContain('Centro de Geoinformação de Teste - Mapoteca');
  });

  // Os oito quadradinhos do modelo em .doc: um digito por quadrado, com o traco
  // entre o quinto e o sexto.
  test('o CEP sai em oito quadrados, e some quando esta incompleto', () => {
    const comCep = montarEtiquetaHtml(DADOS);
    expect(comCep.match(/class="cep__digito"/g)).toHaveLength(8);
    expect(comCep).toContain('class="cep__traco"');

    const semCep = montarEtiquetaHtml({ ...DADOS, cep: '6902' });
    expect(semCep).not.toContain('class="cep__digito"');
  });

  test('escapa o texto do cadastro, para o endereco nao virar marcacao', () => {
    const html = montarEtiquetaHtml({
      destinatario: 'OM <script>alert(1)</script>',
      endereco: 'Rua "A" & 10',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Rua &quot;A&quot; &amp; 10');
  });

  test('sem A/C, a linha do A/C nao aparece', () => {
    expect(montarEtiquetaHtml({ destinatario: 'OM X' })).not.toContain('A/C');
  });
});

describe('openEtiquetaEnvioDialog', () => {
  const PEDIDO = {
    id: 42,
    localizador_pedido: 'AB12-CD34-EF56',
    cliente_nome: '18º BI Mtz',
    ponto_contato: 'Cap Ronaldo',
    endereco_entrega: 'Rua Marechal Deodoro, 100\nCentro\nPorto Alegre - RS, 90010-000',
  };

  test('preenche destinatario, A/C, endereco e CEP a partir do pedido', async () => {
    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    const valores = [...document.querySelectorAll('input, textarea')].map(c => c.value);
    expect(valores).toContain('18º BI Mtz');
    expect(valores).toContain('Cap Ronaldo');
    expect(valores).toContain('90010-000');
    expect(valores.some(v => v.includes('Rua Marechal Deodoro, 100'))).toBe(true);
  });

  // O endereco do PEDIDO manda; o do cadastro do cliente e a reserva. Mesma
  // ordem dos dois pontos de contato.
  test('sem endereco no pedido, cai no endereco do cadastro do cliente', async () => {
    openEtiquetaEnvioDialog({
      ...PEDIDO,
      endereco_entrega: null,
      ponto_contato: null,
      cliente_ponto_contato: 'S3',
      cliente_endereco_entrega: 'Rua Cadastro, 7 - 91000-000 Porto Alegre - RS',
    });
    await flush();

    const valores = [...document.querySelectorAll('input, textarea')].map(c => c.value);
    expect(valores.some(v => v.includes('Rua Cadastro, 7'))).toBe(true);
    expect(valores).toContain('91000-000');
    expect(valores).toContain('S3');
  });

  test('pedido sem endereco nenhum avisa em vez de imprimir etiqueta em branco', async () => {
    openEtiquetaEnvioDialog({ ...PEDIDO, endereco_entrega: null });
    await flush();

    expect(document.body.textContent).toContain('não tem endereço de entrega');
  });

  test('a previa e um iframe com o HTML da etiqueta, e acompanha a edicao', async () => {
    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    const previa = document.querySelector('.etiqueta-previa');
    expect(previa).toBeTruthy();
    expect(previa.srcdoc).toContain('18º BI Mtz');

    const destinatario = document.querySelector('input');
    destinatario.value = '9º BE Cmb';
    destinatario.dispatchEvent(new Event('input'));

    expect(previa.srcdoc).toContain('9º BE Cmb');
  });

  test('salvar sem destinatario mostra erro no campo e nao chama o servidor', async () => {
    openEtiquetaEnvioDialog({ ...PEDIDO, cliente_nome: '' });
    await flush();

    botao('Salvar').click();
    await flush();

    expect(document.body.textContent).toContain('Campo obrigatório');
    expect(svc.salvarEtiquetaEnvio).not.toHaveBeenCalled();
    // A previa continua sendo o unico iframe da pagina.
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
});

// A TRAVA: o que sai impresso é sempre o que está registrado. A regra vale
// SEMPRE, inclusive na primeira abertura e sem edição nenhuma, para não existir
// a exceção que ninguém lembra.
describe('openEtiquetaEnvioDialog - trava do botao Imprimir', () => {
  const PEDIDO = {
    id: 42,
    localizador_pedido: 'AB12-CD34-EF56',
    cliente_nome: '18º BI Mtz',
    ponto_contato: 'Cap Ronaldo',
    endereco_entrega: 'Rua Marechal Deodoro, 100\nCentro\nPorto Alegre - RS, 90010-000',
  };

  const ETIQUETA_SALVA = {
    id: 7,
    pedido_id: 42,
    destinatario: '18º BI Mtz',
    aos_cuidados: 'Cap Ronaldo',
    endereco: 'Rua Cleveland, 250\nPorto Alegre - RS',
    cep: '90850-240',
  };

  test('na primeira abertura, sem etiqueta salva, Imprimir nasce travado', async () => {
    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    expect(botao('Imprimir').disabled).toBe(true);
    // O motivo tem de estar em texto na tela: botao morto e sem explicacao vira
    // chamado de suporte.
    expect(document.body.textContent).toContain('Imprimir libera depois de Salvar');
    expect(document.body.textContent).toContain('ainda não tem etiqueta salva');
  });

  test('abre com a etiqueta salva nos campos, e Imprimir ja liberado', async () => {
    svc.getEtiquetaEnvio.mockResolvedValue(ETIQUETA_SALVA);

    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    expect(svc.getEtiquetaEnvio).toHaveBeenCalledWith(42);

    // A etiqueta salva manda sobre o endereco do pedido: ela E a correcao.
    const valores = [...document.querySelectorAll('input, textarea')].map(c => c.value);
    expect(valores).toContain('90850-240');
    expect(valores.some(v => v.includes('Rua Cleveland, 250'))).toBe(true);

    expect(botao('Imprimir').disabled).toBe(false);
    expect(document.body.textContent).toContain('Etiqueta salva');
  });

  test('alterar um campo trava o Imprimir de novo; salvar destrava', async () => {
    svc.getEtiquetaEnvio.mockResolvedValue(ETIQUETA_SALVA);

    openEtiquetaEnvioDialog(PEDIDO);
    await flush();
    expect(botao('Imprimir').disabled).toBe(false);

    const destinatario = document.querySelector('input');
    destinatario.value = '9º BE Cmb';
    destinatario.dispatchEvent(new Event('input'));

    expect(botao('Imprimir').disabled).toBe(true);
    expect(document.body.textContent).toContain('mudanças na tela que ainda não foram salvas');

    botao('Salvar').click();
    await flush();

    expect(svc.salvarEtiquetaEnvio).toHaveBeenCalledWith(42, {
      destinatario: '9º BE Cmb',
      aos_cuidados: 'Cap Ronaldo',
      endereco: 'Rua Cleveland, 250\nPorto Alegre - RS',
      cep: '90850-240',
    });
    expect(botao('Imprimir').disabled).toBe(false);
  });

  // O botao so confia no que o SERVIDOR devolveu. Campo que o destino ignorou em
  // silencio conta como falha, nao como sucesso: a trava tem de continuar.
  test('gravacao que o servidor devolve diferente mantem o Imprimir travado', async () => {
    svc.salvarEtiquetaEnvio.mockResolvedValue({
      ...ETIQUETA_SALVA,
      cep: null,
    });

    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    const campos = [...document.querySelectorAll('input, textarea')];
    campos[0].value = ETIQUETA_SALVA.destinatario;
    campos[0].dispatchEvent(new Event('input'));
    campos[1].value = ETIQUETA_SALVA.aos_cuidados;
    campos[1].dispatchEvent(new Event('input'));
    campos[2].value = ETIQUETA_SALVA.endereco;
    campos[2].dispatchEvent(new Event('input'));
    campos[3].value = ETIQUETA_SALVA.cep;
    campos[3].dispatchEvent(new Event('input'));

    botao('Salvar').click();
    await flush();

    expect(botao('Imprimir').disabled).toBe(true);
  });

  // Falha na leitura nao pode virar botao liberado: sem a etiqueta salva nao ha
  // como afirmar que o papel bate com o registro.
  test('erro ao carregar a etiqueta mantem o Imprimir travado', async () => {
    svc.getEtiquetaEnvio.mockRejectedValue(new Error('rede fora'));

    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    expect(botao('Imprimir').disabled).toBe(true);
  });

  test('imprimir usa o que esta SALVO, e cria o iframe da impressao', async () => {
    svc.getEtiquetaEnvio.mockResolvedValue(ETIQUETA_SALVA);

    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    botao('Imprimir').click();
    await flush();

    // Previa + iframe da impressao.
    const iframes = [...document.querySelectorAll('iframe')];
    expect(iframes).toHaveLength(2);
    const impressao = iframes.find(f => f.getAttribute('aria-hidden') === 'true');
    expect(impressao.srcdoc).toContain('Rua Cleveland, 250');
    expect(impressao.srcdoc).toContain('Pedido AB12-CD34-EF56');
  });

  // A previa acompanha a EDICAO, e nao o que esta salvo: ela existe para a
  // pessoa ver o efeito do conserto ANTES de gravar.
  test('a previa continua acompanhando a edicao com o Imprimir travado', async () => {
    svc.getEtiquetaEnvio.mockResolvedValue(ETIQUETA_SALVA);

    openEtiquetaEnvioDialog(PEDIDO);
    await flush();

    const destinatario = document.querySelector('input');
    destinatario.value = '9º BE Cmb';
    destinatario.dispatchEvent(new Event('input'));

    expect(document.querySelector('.etiqueta-previa').srcdoc).toContain('9º BE Cmb');
    expect(botao('Imprimir').disabled).toBe(true);
  });
});
