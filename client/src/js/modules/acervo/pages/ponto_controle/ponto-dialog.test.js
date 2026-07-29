import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  getPonto: vi.fn(),
  baixarArquivoDoPonto: vi.fn(() => Promise.resolve()),
}));

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showToast: vi.fn(),
}));

import { abrirPontoDialog } from '@modules/acervo/pages/ponto_controle/ponto-dialog.js';
import {
  getPonto, baixarArquivoDoPonto,
} from '@modules/acervo/services/ponto-controle-service.js';
import { showError } from '@utils/toast.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * O ponto como o servidor o entrega: dominio em DOIS campos, o codigo em
 * `<dominio>` e o nome em `<dominio>_nome`; a posicao da geometria em `geom_*`;
 * e as entidades do acervo em `lote_nome`/`projeto_nome`, porque `lote` e
 * `projeto` sao texto livre que o medidor digitou em campo.
 */
const PONTO = {
  id: 1,
  cod_ponto: 'RS-HV-1',
  projeto_nome: 'Copa Verde',
  lote_nome: 'Missão 1',
  pit: 'PIT-01',
  projeto: 'MIF 2026',
  lote: 'lote 3 do caderno',
  tipo_situacao: 3,
  tipo_situacao_nome: 'Aprovado',
  materializado: true,
  reserva: false,
  geometria_aproximada: false,
  geom_latitude: -30.12345678,
  geom_longitude: -51.87654321,
  altitude_ortometrica: 1024.35,
  data_rastreio: '2026-05-12',
  medidor: '3º Sgt Silva',
  modelo_gps: 'Trimble R10',
  altura_antena: 1.62,
  observacao: 'Marco em bom estado.',
  engenheiro_responsavel: 'Cap Almeida',
  cpf_engenheiro_responsavel: '123.456.789-00',
  metodo_posicionamento: 1,
  metodo_posicionamento_nome: 'Posicionamento por ponto preciso (PPP)',
  sistema_geodesico: 2,
  sistema_geodesico_nome: 'SIRGAS2000',
  // 9999 e o NULO do modelo do plugin ("A SER PREENCHIDO"), e nao um valor.
  orbita: 9999,
  orbita_nome: 'A SER PREENCHIDO',
  situacao_marco: 9999,
  situacao_marco_nome: 'A SER PREENCHIDO',
  // DOIS arquivos por ponto desde 2026-07-29: o pacote e a monografia.
  arquivos: [
    {
      id: 1, tipo_arquivo_id: 1, tipo_arquivo: 'Pacote do ponto',
      nome_arquivo: 'RS-HV-1_pacote', extensao: 'zip', tamanho_mb: 21.4,
    },
    {
      id: 2, tipo_arquivo_id: 2, tipo_arquivo: 'Monografia',
      nome_arquivo: 'RS-HV-1', extensao: 'pdf', tamanho_mb: 1.8,
    },
  ],
};

const modal = () => document.querySelector('.modal, dialog');
const texto = () => (modal() ? modal().textContent : '');
const rotulos = () => [...document.querySelectorAll('.detail-card__label')]
  .map(n => n.textContent);
const titulos = () => [...document.querySelectorAll('.pc-ficha__bloco-titulo')]
  .map(n => n.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('ficha do ponto: domínios', () => {
  test('mostra o NOME do domínio, e nunca o código', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).toContain('Aprovado');
    expect(texto()).toContain('SIRGAS2000');
    expect(texto()).toContain('Posicionamento por ponto preciso (PPP)');
    // Era isto que aparecia antes: o codigo cru na tela.
    expect(texto()).not.toContain('9999');
    expect(texto()).not.toContain('Situação 3');
  });

  test('o código 9999 é campo VAZIO, e não "A SER PREENCHIDO"', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    // 9999 e o NULO do modelo do plugin. Mostra-lo resolvido encheria a tela de
    // linhas dizendo que nao se sabe.
    expect(texto()).not.toContain('A SER PREENCHIDO');
    expect(rotulos()).not.toContain('Órbita');
    expect(rotulos()).not.toContain('Situação do marco');
  });

  test('código órfão no domínio aparece marcado, em vez de sumir', async () => {
    getPonto.mockResolvedValue({ ...PONTO, orbita: 77, orbita_nome: null });
    abrirPontoDialog('RS-HV-1');
    await flush();

    // Esconder deixaria um defeito de dado invisível.
    expect(texto()).toContain('Código 77 (fora do domínio)');
  });
});

describe('ficha do ponto: campos', () => {
  test('separa a entidade do acervo do texto que o medidor digitou', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).toContain('Copa Verde');
    expect(texto()).toContain('Missão 1');
    expect(rotulos()).toContain('Projeto informado em campo');
    expect(texto()).toContain('MIF 2026');
    expect(texto()).toContain('lote 3 do caderno');
  });

  test('a coordenada sai com as 8 casas, e vem da GEOMETRIA', async () => {
    getPonto.mockResolvedValue({
      ...PONTO,
      // A coluna REAL do plugin e a derivada da geometria diferem na sétima
      // casa: é o erro de arredondamento do float4, e é 1 cm no terreno.
      latitude: -30.1234,
      longitude: -51.8765,
    });
    abrirPontoDialog('RS-HV-1');
    await flush();

    // Casa decimal É o dado aqui. formatNumber() cortaria em 3 casas.
    expect(texto()).toContain('-30,12345678°');
    expect(texto()).toContain('-51,87654321°');
  });

  test('ponto sem geometria cai nas colunas do plugin', async () => {
    getPonto.mockResolvedValue({
      ...PONTO, latitude: -30.1234, longitude: -51.8765,
      geom_latitude: null, geom_longitude: null,
    });
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).toContain('-30,12340000°');
  });

  test('o CPF do engenheiro NÃO aparece na tela', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    // O CPF existe na tabela porque o BPC o exige na entrega, e não para ser
    // exibido a quem consulta. Mesma razão de o usuário read-only não receber
    // GRANT no schema (er/permissao_readonly.sql).
    expect(texto()).toContain('Cap Almeida');
    expect(texto()).not.toContain('123.456.789-00');
  });

  test('os blocos seguem o ciclo do ponto', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(titulos()).toEqual([
      'Identificação', 'Posição', 'Rastreio', 'Equipamento',
      'Processamento', 'Marco no terreno', 'Registro no acervo',
      'Observação', 'Arquivos',
    ]);
  });

  test('o interruptor revela os campos não preenchidos', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(rotulos()).not.toContain('Órbita');
    expect(rotulos()).not.toContain('Norte');

    const alternar = document.querySelector('#pc-ficha-vazios');
    alternar.checked = true;
    alternar.dispatchEvent(new Event('change'));

    // Quem confere o que FALTA preencher precisa ver o campo vazio.
    expect(rotulos()).toContain('Órbita');
    expect(rotulos()).toContain('Norte');
    expect(texto()).toContain('—');
  });
});

describe('ficha do ponto: os dois downloads', () => {
  test('mostra os dois arquivos, cada um com seu botão', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    const linhas = [...document.querySelectorAll('.pc-ficha__download')];
    expect(linhas).toHaveLength(2);
    expect(texto()).toContain('Pacote do ponto');
    expect(texto()).toContain('RS-HV-1_pacote.zip');
    expect(texto()).toContain('21,4 MB');
    expect(texto()).toContain('Monografia');
    expect(texto()).toContain('RS-HV-1.pdf');
    expect(linhas.every(l => l.querySelector('button'))).toBe(true);
  });

  test('o botão baixa pelo TIPO, e não pelo id do arquivo', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog('RS-HV-1');
    await flush();

    const [pacote, mono] = [...document.querySelectorAll('.pc-ficha__download button')];
    pacote.click();
    await flush();
    expect(baixarArquivoDoPonto).toHaveBeenCalledWith(
      'RS-HV-1', 'pacote', 'RS-HV-1_pacote.zip'
    );

    mono.click();
    await flush();
    expect(baixarArquivoDoPonto).toHaveBeenCalledWith(
      'RS-HV-1', 'monografia', 'RS-HV-1.pdf'
    );
  });

  test('falha no download avisa, e o botão volta a funcionar', async () => {
    getPonto.mockResolvedValue(PONTO);
    baixarArquivoDoPonto.mockRejectedValueOnce(new Error('sem rede'));
    abrirPontoDialog('RS-HV-1');
    await flush();

    const botao = document.querySelector('.pc-ficha__download button');
    botao.click();
    await flush();

    expect(showError).toHaveBeenCalledWith('sem rede');
    expect(botao.disabled).toBe(false);
  });

  test('tipo que a tela não conhece aparece, mas sem prometer download', async () => {
    getPonto.mockResolvedValue({
      ...PONTO,
      arquivos: [{ id: 9, tipo_arquivo_id: 7, tipo_arquivo: 'Tipo novo', nome_arquivo: 'x', extensao: 'bin' }],
    });
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).toContain('Tipo novo');
    expect(document.querySelector('.pc-ficha__download button').disabled).toBe(true);
  });

  test('o CAMINHO do arquivo no volume NÃO aparece', async () => {
    // O servidor nem o envia: é infraestrutura, não informação do ponto. Este
    // teste guarda o caso de alguém voltar a mandá-lo e a tela o exibir.
    getPonto.mockResolvedValue({
      ...PONTO,
      arquivos: PONTO.arquivos.map(a => ({
        ...a, volume: '/data/pc', caminho: '/data/pc/RS-HV-1/x.zip',
      })),
    });
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).not.toContain('/data/pc');
  });

  test('ponto sem arquivo diz isso, em vez de mostrar uma lista vazia', async () => {
    getPonto.mockResolvedValue({ ...PONTO, arquivos: [] });
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).toContain('Nenhum arquivo registrado');
  });
});

describe('ficha do ponto: navegação e falha', () => {
  test('abre já com o código no título, antes de a resposta chegar', async () => {
    let liberar;
    getPonto.mockImplementation(() => new Promise(r => { liberar = r; }));

    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(texto()).toContain('RS-HV-1');
    expect(texto()).toContain('Carregando');

    liberar(PONTO);
    await flush();
    expect(texto()).not.toContain('Carregando');
  });

  test('com um ponto só, não há barra de navegação', async () => {
    getPonto.mockResolvedValue(PONTO);
    abrirPontoDialog(['RS-HV-1']);
    await flush();

    expect(document.querySelector('.produto-ficha__nav')).toBeNull();
  });

  test('com vários, navega entre eles sem fechar', async () => {
    getPonto.mockImplementation(cod =>
      Promise.resolve({ ...PONTO, cod_ponto: cod, medidor: `Medidor de ${cod}` }));

    abrirPontoDialog(['RS-HV-1', 'RS-HV-2', 'RS-HV-3'], 0);
    await flush();

    expect(texto()).toContain('1 de 3');
    expect(texto()).toContain('Medidor de RS-HV-1');

    const [anterior, proxima] = document.querySelectorAll('.produto-ficha__nav button');
    expect(anterior.disabled).toBe(true);

    proxima.click();
    await flush();
    expect(texto()).toContain('2 de 3');
    expect(texto()).toContain('Medidor de RS-HV-2');
    expect(document.querySelector('.modal__title').textContent).toBe('RS-HV-2');
    expect(anterior.disabled).toBe(false);
  });

  test('voltar a um ponto já visto não repete a chamada', async () => {
    getPonto.mockImplementation(cod => Promise.resolve({ ...PONTO, cod_ponto: cod }));
    abrirPontoDialog(['RS-HV-1', 'RS-HV-2'], 0);
    await flush();

    const [anterior, proxima] = document.querySelectorAll('.produto-ficha__nav button');
    proxima.click();
    await flush();
    const chamadas = getPonto.mock.calls.length;

    anterior.click();
    await flush();
    expect(getPonto.mock.calls.length).toBe(chamadas);
    expect(texto()).toContain('1 de 2');
  });

  test('falha com um ponto só avisa e fecha', async () => {
    getPonto.mockRejectedValue(new Error('sem rede'));
    abrirPontoDialog('RS-HV-1');
    await flush();

    expect(showError).toHaveBeenCalledWith('sem rede');
    expect(modal()).toBeNull();
  });

  test('falha num de vários avisa e MANTÉM o modal, para poder navegar', async () => {
    getPonto.mockRejectedValue(new Error('sem rede'));
    abrirPontoDialog(['RS-HV-1', 'RS-HV-2'], 0);
    await flush();

    expect(showError).toHaveBeenCalled();
    // Fechar aqui tiraria da pessoa os outros pontos que ela selecionou.
    expect(modal()).not.toBeNull();
  });
});
