import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Ficha do produto: identificacao, versoes e os arquivos de cada versao, cada um
// com botao de baixar. O download vai por stream do servidor, que le o volume: o
// navegador nunca ve caminho de rede.
vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getProdutoDetalhado: vi.fn(),
  baixarArquivoDoAcervo: vi.fn(() => Promise.resolve()),
  // Devolve null: versao sem miniatura e o caso normal, e e o unico que o jsdom
  // consegue exercitar (ele nao tem a API de blob URL).
  getMiniaturaVersao: vi.fn(() => Promise.resolve(null)),
  excluirArquivos: vi.fn(() => Promise.resolve()),
  // Os relacionamentos so sao pedidos a quem PODE escrever. Sem estes dublês, o
  // caso que loga como administrador quebraria na primeira pintura da ficha.
  getTiposRelacionamento: vi.fn(() => Promise.resolve([
    { code: 1, nome: 'Insumo' },
    { code: 2, nome: 'Complementar' },
    { code: 3, nome: 'Conjunto' },
  ])),
  getRelacionamentos: vi.fn(() => Promise.resolve([])),
  criarRelacionamentos: vi.fn(() => Promise.resolve()),
  atualizarRelacionamentos: vi.fn(() => Promise.resolve()),
  excluirRelacionamentos: vi.fn(() => Promise.resolve()),
  excluirProdutos: vi.fn(() => Promise.resolve()),
  excluirVersoes: vi.fn(() => Promise.resolve()),
}));

import { saveAuth, clearAuth } from '@store/auth-store.js';
import { abrirProdutoDialog } from '@modules/acervo/pages/busca/produto-dialog.js';
import * as svc from '@modules/acervo/services/acervo-service.js';

const PRODUTO = { id: 12, nome: 'Porto Alegre', mi: '2987-2' };

// Um arquivo baixavel, um Tileserver (URL, sem byte em volume) e um com status de
// erro (byte possivelmente truncado no volume). Os dois ultimos o servidor recusa.
const FICHA = {
  id: 12,
  nome: 'Porto Alegre',
  mi: '2987-2',
  inom: 'SH-22-Y-B-VI-2',
  data_cadastramento: '2026-01-05',
  usuario_cadastramento: '3º Sgt Silva',
  data_modificacao: '2026-02-11',
  usuario_modificacao: 'Cap Souza',
  versoes: [
    {
      versao_id: 90,
      versao: '1',
      uuid_versao: 'bbbbbbbb-1111-2222-3333-555555555555',
      versao_data_edicao: '2026-01-10',
      arquivos: [
        {
          uuid_arquivo: 'aaaaaaaa-1111-2222-3333-444444444444',
          nome: 'Carta Topográfica 2987-2',
          nome_arquivo: 'ct_2987-2_ed1',
          extensao: 'tif',
          tamanho_mb: 42.5,
          tipo_arquivo_id: 1,
          tipo_status_id: 1,
          checksum: 'abc123def4567890fedcba',
        },
        {
          uuid_arquivo: 'bbbbbbbb-1111-2222-3333-444444444444',
          nome: 'Serviço de tiles',
          nome_arquivo: 'https://tiles.example/{z}/{x}/{y}.png',
          extensao: null,
          tamanho_mb: null,
          tipo_arquivo_id: 9,
          tipo_status_id: 1,
        },
        {
          uuid_arquivo: 'cccccccc-1111-2222-3333-444444444444',
          nome: 'Carta com erro de carregamento',
          nome_arquivo: 'ct_2987-2_ed1_erro',
          extensao: 'tif',
          tamanho_mb: 10,
          tipo_arquivo_id: 1,
          tipo_status_id: 2,
        },
      ],
    },
  ],
};

const botoesBaixar = () => [...document.querySelectorAll('.ficha-arquivo__baixar')];

beforeEach(() => {
  svc.getProdutoDetalhado.mockResolvedValue(FICHA);
  svc.baixarArquivoDoAcervo.mockResolvedValue();
  svc.getMiniaturaVersao.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('abrirProdutoDialog: download de arquivo', () => {
  test('cada arquivo da versao ganha um botao de baixar', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(svc.getProdutoDetalhado).toHaveBeenCalledWith(12);
    expect(botoesBaixar()).toHaveLength(3);
  });

  // O nome salvo e o nome FISICO (nome_arquivo.extensao), derivado do cadastro. E
  // o mesmo nome que o plugin do QGIS recebe, e o que a pessoa espera no disco.
  test('baixa pelo uuid do arquivo, com o nome fisico', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    botoesBaixar()[0].click();
    await flush();

    expect(svc.baixarArquivoDoAcervo).toHaveBeenCalledWith(
      'aaaaaaaa-1111-2222-3333-444444444444',
      'ct_2987-2_ed1.tif'
    );
  });

  test('Tileserver e arquivo com status de erro ficam desabilitados', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    const [normal, tileserver, comErro] = botoesBaixar();
    expect(normal.disabled).toBe(false);
    // O servidor recusa os dois; a tela nao promete um download que vai dar erro.
    expect(tileserver.disabled).toBe(true);
    expect(comErro.disabled).toBe(true);

    tileserver.click();
    comErro.click();
    await flush();
    expect(svc.baixarArquivoDoAcervo).not.toHaveBeenCalled();
  });

  test('falha no download avisa e o botao volta a funcionar', async () => {
    svc.baixarArquivoDoAcervo.mockRejectedValueOnce(
      new Error('O arquivo está registrado mas não foi encontrado no volume: ct_2987-2_ed1.tif')
    );
    abrirProdutoDialog(PRODUTO);
    await flush();

    const botao = botoesBaixar()[0];
    botao.click();
    await flush();

    expect(document.body.textContent).toContain('não foi encontrado no volume');
    // Sem isto o botao ficaria travado depois da primeira falha, e a pessoa
    // precisaria fechar e reabrir a ficha para tentar de novo.
    expect(botao.disabled).toBe(false);
  });
});

// A ficha detalhada ja diz quais versoes tem imagem (`tem_miniatura`). A tela
// respeita isso: pedir a imagem de uma versao que nao tem custaria um 404 por
// versao aberta, e o acervo tem 2.247 versoes so vetoriais.
describe('abrirProdutoDialog: miniatura', () => {
  const COM_IMAGEM = {
    ...FICHA,
    versoes: [
      { versao_id: 90, versao: '2ª Edição', tem_miniatura: true, miniatura_largura: 600, miniatura_altura: 457, arquivos: [] },
      { versao_id: 91, versao: '1ª Edição', tem_miniatura: false, arquivos: [] },
    ],
  };

  test('so pede a imagem da versao que tem miniatura', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_IMAGEM);
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(svc.getMiniaturaVersao).toHaveBeenCalledTimes(1);
    expect(svc.getMiniaturaVersao).toHaveBeenCalledWith(90);
  });

  test('versao sem miniatura mostra a marca, e nao um espaco vazio', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_IMAGEM);
    svc.getMiniaturaVersao.mockResolvedValue('blob:miniatura-de-teste');
    abrirProdutoDialog(PRODUTO);
    await flush();

    // A que tem imagem vira uma tag de imagem; a que nao tem fica com a marca.
    expect(document.querySelectorAll('.ficha-miniatura__img')).toHaveLength(1);
    expect(document.querySelectorAll('.ficha-miniatura--vazia')).toHaveLength(1);
    expect(document.body.textContent).toContain('Sem imagem');
  });

  // O painel nasce com a proporcao real para a lista de versoes nao saltar
  // quando cada imagem chega.
  test('reserva a proporcao da imagem antes de ela chegar', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_IMAGEM);
    abrirProdutoDialog(PRODUTO);
    await flush();

    const painel = document.querySelector('.ficha-miniatura--destaque');
    expect(painel.style.aspectRatio).toBe('600 / 457');
  });

  // Falha de imagem nao pode derrubar a ficha: o resto dela continua util.
  test('falha na imagem nao quebra a ficha', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_IMAGEM);
    svc.getMiniaturaVersao.mockRejectedValueOnce(new Error('rede caiu'));
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(document.body.textContent).toContain('Imagem indisponível');
    expect(document.body.textContent).toContain('2ª Edição');
  });
});

// O servidor sempre devolveu os relacionamentos e a ficha anterior os
// descartava em silencio. Sao a proveniencia da carta: de onde ela veio.
describe('abrirProdutoDialog: relacionamentos', () => {
  const COM_RELACAO = {
    ...FICHA,
    versoes: [{
      versao_id: 90,
      versao: '1ª Edição',
      arquivos: [],
      relacionamentos: [
        {
          id: 1,
          versao_relacionada_id: 700,
          tipo_relacionamento: 'Insumo',
          versao_relacionada: '3ª Edição',
          produto_relacionado_id: 55,
          produto_relacionado: '2823-1-SE',
        },
        // Relacionamento cuja ponta sumiu: aparece, mas nao vira link.
        {
          id: 2,
          versao_relacionada_id: 701,
          tipo_relacionamento: 'Complementar',
          versao_relacionada: null,
          produto_relacionado_id: null,
          produto_relacionado: null,
        },
      ],
    }],
  };

  test('mostra o produto relacionado pelo nome, e nao pelo id', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_RELACAO);
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(document.body.textContent).toContain('Insumo');
    expect(document.body.textContent).toContain('2823-1-SE, 3ª Edição');
  });

  test('relacionamento sem produto vivo nao vira link', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_RELACAO);
    abrirProdutoDialog(PRODUTO);
    await flush();

    // Dois itens listados, um so clicavel.
    expect(document.querySelectorAll('.ficha-relacionamentos__item')).toHaveLength(2);
    expect(document.querySelectorAll('.ficha-relacionamentos__link')).toHaveLength(1);
  });

  // Seguir um insumo ACRESCENTA o produto a selecao, em vez de trocar a ficha no
  // lugar: sem isso, "Anterior" nao teria como voltar para de onde a pessoa veio.
  test('seguir um relacionamento acrescenta o produto a selecao', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_RELACAO);
    abrirProdutoDialog(PRODUTO);
    await flush();

    document.querySelector('.ficha-relacionamentos__link').click();
    await flush();

    expect(svc.getProdutoDetalhado).toHaveBeenLastCalledWith(55);
    expect(document.querySelector('.produto-ficha__posicao').textContent).toBe('2 de 2');
  });
});

// --- O DADO QUE O SERVIDOR JA MANDAVA E A TELA DESCARTAVA -------------------
//
// Padrao que atravessa o modulo inteiro: a consulta resolve o campo, a resposta
// o carrega, e o cliente nao o desenha. Aqui eram tres, e os tres respondem
// pergunta que alguem fazia na mao, no SQL.
describe('abrirProdutoDialog: o que a ficha passou a mostrar', () => {
  test('diz QUEM cadastrou e quem alterou por ultimo', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    // Os dois uuid ja vinham resolvidos em nome pela consulta da ficha
    // (`u1.nome`, `u2.nome`), e a tela mostrava so a data.
    const texto = document.body.textContent;
    expect(texto).toContain('3º Sgt Silva');
    expect(texto).toContain('Cap Souza');
  });

  test('o checksum aparece abreviado, com o completo no title', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    const checksum = document.querySelector('.ficha-arquivo__checksum');
    expect(checksum).not.toBeNull();
    // Doze caracteres bastam para distinguir; o inteiro nao cabe na linha.
    expect(checksum.textContent).toBe('abc123def456');
    expect(checksum.getAttribute('title')).toContain('abc123def4567890fedcba');
  });
});

// "Sem arquivo digital" fundia dois fatos OPOSTOS: a folha que ainda nao existe
// (promessa de producao) e a folha que existe no mundo e o acervo nao tem o
// arquivo. Quem procura carta decide coisas diferentes em cada caso.
describe('abrirProdutoDialog: versao sem arquivo diz QUAL e o caso', () => {
  const semArquivo = (tipoVersaoId) => ({
    ...FICHA,
    versoes: [{
      versao_id: 91,
      versao: '1',
      versao_data_edicao: '2026-03-01',
      tipo_versao_id: tipoVersaoId,
      arquivos: [],
    }],
  });

  test('planejada e promessa de producao', async () => {
    svc.getProdutoDetalhado.mockResolvedValueOnce(semArquivo(3));
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(document.body.textContent).toContain('Planejada, ainda sem arquivo');
  });

  test('registro historico e folha que existe e o acervo nao tem', async () => {
    svc.getProdutoDetalhado.mockResolvedValueOnce(semArquivo(2));
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(document.body.textContent).toContain('Registro histórico, sem arquivo');
  });
});

// A ficha ja deixava ACRESCENTAR arquivo a uma versao gravada e nao deixava
// tirar nenhum: o arquivo mandado por engano so saia pelo plugin do QGIS, ou
// levando a versao inteira junto. A rota `DELETE /arquivo/arquivo` e gerente, e
// exige motivo, como as outras exclusoes.
describe('abrirProdutoDialog: excluir UM arquivo', () => {
  const COM_ID = {
    ...FICHA,
    versoes: [{
      ...FICHA.versoes[0],
      arquivos: FICHA.versoes[0].arquivos.map((a, i) => ({ ...a, id: 500 + i })),
    }],
  };

  const excluirBotoes = () => [...document.querySelectorAll('.ficha-arquivo__excluir')];
  const rodape = () => [...document.querySelectorAll('.modal__footer .btn')];
  const clicar = (texto) => rodape().reverse().find(b => b.textContent === texto).click();

  beforeEach(() => {
    svc.getProdutoDetalhado.mockResolvedValue(COM_ID);
    // Administrador satisfaz qualquer perfil: e o caminho mais curto para
    // exercitar a acao de gerente sem montar a tabela de perfis.
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  afterEach(() => {
    clearAuth();
  });

  test('quem nao e gerente nao ve o botao', async () => {
    clearAuth();
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(excluirBotoes()).toHaveLength(0);
    // CONTROLE: a ficha carregou, e o que falta e so o botao de excluir.
    expect(botoesBaixar()).toHaveLength(3);
  });

  test('o gerente ve um botao de excluir por arquivo', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(excluirBotoes()).toHaveLength(3);
  });

  test('desistir da confirmacao nao chama o servidor', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    excluirBotoes()[0].click();
    await flush();
    clicar('Cancelar');
    await flush();

    expect(svc.excluirArquivos).not.toHaveBeenCalled();
  });

  test('confirmar sem motivo nao chama o servidor', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    excluirBotoes()[0].click();
    await flush();
    clicar('Excluir');
    await flush();

    // O segundo passo pede o motivo. Sem preencher, o botao nao fecha nem grava:
    // o servidor recusa motivo vazio, e descobrir isso depois seria refazer os
    // dois passos.
    clicar('Excluir');
    await flush();

    expect(svc.excluirArquivos).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe o motivo da exclusão');
  });

  test('confirmado e com motivo, exclui SO aquele arquivo e recarrega a ficha', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(svc.getProdutoDetalhado).toHaveBeenCalledTimes(1);

    excluirBotoes()[1].click();
    await flush();
    clicar('Excluir');
    await flush();

    document.querySelector('.form-field__textarea').value = 'Subiu duplicado';
    clicar('Excluir');
    await flush();

    // O id do SEGUNDO arquivo, e nao o do primeiro nem o da versao.
    expect(svc.excluirArquivos).toHaveBeenCalledWith([501], 'Subiu duplicado');
    // A ficha volta do servidor: sem isto, o arquivo apagado continuaria na
    // lista ate alguem fechar e reabrir.
    expect(svc.getProdutoDetalhado).toHaveBeenCalledTimes(2);
  });

  test('falha do servidor mostra a mensagem dele e nao recarrega', async () => {
    svc.excluirArquivos.mockRejectedValueOnce(
      new Error('O arquivo é o único da versão. Exclua a versão.')
    );
    abrirProdutoDialog(PRODUTO);
    await flush();

    excluirBotoes()[0].click();
    await flush();
    clicar('Excluir');
    await flush();
    document.querySelector('.form-field__textarea').value = 'Engano';
    clicar('Excluir');
    await flush();

    expect(document.body.textContent).toContain('é o único da versão');
    expect(svc.getProdutoDetalhado).toHaveBeenCalledTimes(1);
  });
  // -------------------------------------------------------------------------
  // O UUID DA VERSAO na ficha
  // -------------------------------------------------------------------------

  // Ele e a chave que o plugin do QGIS, o `acervo_cli` e o item do pedido da
  // mapoteca usam (`produto_pedido.uuid_versao`). Sem ele aqui, ligar uma folha
  // a um pedido, ou pedir "esta versao" a alguem, exigia ir ao banco.
  test('a ficha mostra o UUID da versao', async () => {
    svc.getProdutoDetalhado.mockResolvedValue(FICHA);
    await abrirProdutoDialog(PRODUTO);
    await flush();

    const uuid = document.querySelector('.ficha-uuid__valor');
    expect(uuid).not.toBeNull();
    expect(uuid.textContent).toBe('bbbbbbbb-1111-2222-3333-555555555555');
  });

  test('o botao copia o UUID para a area de transferencia', async () => {
    const escrever = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: escrever }, configurable: true,
    });

    svc.getProdutoDetalhado.mockResolvedValue(FICHA);
    await abrirProdutoDialog(PRODUTO);
    await flush();

    const botao = document.querySelector('.ficha-uuid__copiar');
    botao.click();
    await flush();

    expect(escrever).toHaveBeenCalledWith('bbbbbbbb-1111-2222-3333-555555555555');
    // O texto do BOTAO confirma, e nao um aviso no canto da tela: a pessoa esta
    // olhando para o que acabou de clicar.
    expect(botao.textContent).toBe('Copiado');
  });

  // VARIANCIA: sem este caso, os dois acima passariam numa ficha que mostrasse
  // a linha do UUID sempre, inclusive vazia.
  test('versao sem uuid nao ganha a linha', async () => {
    svc.getProdutoDetalhado.mockResolvedValue({
      ...FICHA,
      versoes: [{ ...FICHA.versoes[0], uuid_versao: null }],
    });
    await abrirProdutoDialog(PRODUTO);
    await flush();

    expect(document.querySelector('.ficha-uuid')).toBeNull();
  });
});
