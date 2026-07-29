import { describe, test, expect, afterEach } from 'vitest';

// Etiqueta de endereco do envio por Correios, montada a partir do pedido. O
// documento impresso e HTML autossuficiente, entao os testes leem a STRING que
// sai de montarEtiquetaHtml, e nao a arvore da pagina.
import {
  REMETENTE,
  extrairCep,
  linhasEndereco,
  montarEtiquetaHtml,
  openEtiquetaEnvioDialog,
} from '@modules/mapoteca/pages/pedidos/etiqueta-envio.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  document.body.innerHTML = '';
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

    expect(html).toContain(REMETENTE.nome);
    REMETENTE.linhas.forEach((linha) => expect(html).toContain(linha));
    expect(html).toContain(REMETENTE.telefone);
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

  test('imprimir sem destinatario mostra erro no campo e nao cria o iframe de impressao', async () => {
    openEtiquetaEnvioDialog({ ...PEDIDO, cliente_nome: '' });
    await flush();

    const imprimir = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Imprimir'));
    imprimir.click();
    await flush();

    expect(document.body.textContent).toContain('Campo obrigatório');
    // A previa continua sendo o unico iframe da pagina.
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });
});
