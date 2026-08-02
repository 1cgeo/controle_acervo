import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  atualizarViewsMaterializadas: vi.fn(() => Promise.resolve({})),
  criarViewsMaterializadas: vi.fn(() => Promise.resolve({})),
  limparDownloadsExpirados: vi.fn(() => Promise.resolve({})),
  renomearPadrao: vi.fn(),
  atualizarChecksum: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderManutencaoTab } from '@modules/acervo/pages/administracao/manutencao-tab.js';
import * as svc from '@modules/acervo/services/admin-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showError } from '@utils/toast.js';

const flush = () => new Promise(r => setTimeout(r, 0));

let container;

const abrir = async () => {
  container = document.createElement('div');
  return renderManutencaoTab(container);
};

const cartao = (titulo) =>
  [...container.querySelectorAll('.manutencao__cartao')]
    .find(c => c.querySelector('.manutencao__titulo').textContent === titulo);

const botao = (titulo, rotulo) =>
  [...cartao(titulo).querySelectorAll('button')]
    .find(b => b.textContent.includes(rotulo));

const status = (titulo) => cartao(titulo).querySelector('.manutencao__status').textContent;

const preencher = (titulo, rotulo, valor) => {
  const campo = [...cartao(titulo).querySelectorAll('.manutencao__campo')]
    .find(l => l.querySelector('span').textContent.includes(rotulo));
  const input = campo.querySelector('input, textarea');
  input.value = valor;
  return input;
};

const RENOME = 'Padronizar o nome físico dos arquivos';
const CHECKSUM = 'Atualizar checksum por releitura';

beforeEach(() => {
  confirmDialog.mockResolvedValue(true);
});

describe('aba de Manutenção', () => {
  test('monta os quatro cartões', async () => {
    await abrir();

    const titulos = [...container.querySelectorAll('.manutencao__titulo')]
      .map(t => t.textContent);
    expect(titulos).toEqual([
      'Visões materializadas',
      'Downloads expirados',
      RENOME,
      CHECKSUM,
    ]);
  });

  // Cada cartão diz o que a ação NÃO faz, que é onde mora o susto. Sem isso,
  // "Limpar downloads expirados" se lê como se apagasse arquivo.
  test('todo cartão traz os avisos do que a ação não faz', async () => {
    await abrir();

    expect(cartao('Downloads expirados').textContent)
      .toContain('Não apaga arquivo nenhum');
    expect(cartao(RENOME).textContent)
      .toContain('Começa em SIMULAÇÃO');
    expect(cartao(CHECKSUM).textContent)
      .toContain('NADA é alterado');
  });

  test('atualizar as visões materializadas não pergunta, e a criação pergunta', async () => {
    await abrir();

    botao('Visões materializadas', 'Atualizar todas').click();
    await flush();
    expect(svc.atualizarViewsMaterializadas).toHaveBeenCalled();
    expect(confirmDialog).not.toHaveBeenCalled();

    botao('Visões materializadas', 'Criar as que faltam').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalled();
    expect(svc.criarViewsMaterializadas).toHaveBeenCalled();
  });

  // O botão volta a funcionar depois da falha: preso, a pessoa recarregaria a
  // página para tentar de novo.
  test('a falha aparece no acompanhamento e devolve o botão', async () => {
    svc.limparDownloadsExpirados.mockRejectedValueOnce(new Error('Acesso negado'));
    await abrir();

    const btn = botao('Downloads expirados', 'Limpar expirados');
    btn.click();
    await flush();

    expect(status('Downloads expirados')).toContain('Acesso negado');
    expect(btn.disabled).toBe(false);
  });

  // ---- renome: simulação, laço e falha -------------------------------------

  test('o motivo curto é recusado na tela, sem chamar o servidor', async () => {
    await abrir();

    preencher(RENOME, 'Motivo', 'oi');
    botao(RENOME, 'Simular').click();
    await flush();

    expect(svc.renomearPadrao).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('5 caracteres'));
  });

  test('simular pede dry_run e mostra o plano sem aplicar nada', async () => {
    svc.renomearPadrao.mockResolvedValue({
      dry_run: true,
      divergentes_total: 1284,
      nesta_chamada: 500,
      restantes: 784,
      amostra: [{ id: 12, de: 'carta_ensaio.tif', para: 'CT_s12_2757-1-NE_1dsg.tif' }],
    });
    await abrir();

    preencher(RENOME, 'Motivo', 'padronizacao do acervo legado');
    botao(RENOME, 'Simular').click();
    await flush();

    expect(svc.renomearPadrao).toHaveBeenCalledWith(
      expect.objectContaining({ dry_run: true, limite: 500 }),
    );
    expect(status(RENOME)).toContain('1.284');
    expect(status(RENOME)).toContain('784');
    expect(cartao(RENOME).textContent).toContain('CT_s12_2757-1-NE_1dsg.tif');
  });

  // Aplicar só depois de simular: o aviso do plano é o que separa esta ação de
  // um botão que renomeia o acervo inteiro sem nada na tela.
  test('aplicar começa desabilitado e só liga depois de uma simulação com divergentes', async () => {
    svc.renomearPadrao.mockResolvedValue({
      dry_run: true, divergentes_total: 0, nesta_chamada: 0, restantes: 0, amostra: [],
    });
    await abrir();

    expect(botao(RENOME, 'Aplicar').disabled).toBe(true);

    preencher(RENOME, 'Motivo', 'conferindo se ha divergencia');
    botao(RENOME, 'Simular').click();
    await flush();

    expect(status(RENOME)).toContain('Nenhum arquivo divergente');
    expect(botao(RENOME, 'Aplicar').disabled).toBe(true);
  });

  // A ROTA TRABALHA POR LOTE, e é para chamar em laço até `restantes` zerar. Uma
  // chamada só e um "pronto" mentiriam sobre os milhares restantes.
  test('aplicar chama em laço até restantes zerar, somando o progresso', async () => {
    svc.renomearPadrao
      .mockResolvedValueOnce({
        dry_run: true, divergentes_total: 1200, nesta_chamada: 500, restantes: 700, amostra: [],
      })
      .mockResolvedValueOnce({ renomeados: 500, falhas: 0, restantes: 700, nesta_chamada: 500 })
      .mockResolvedValueOnce({ renomeados: 500, falhas: 0, restantes: 200, nesta_chamada: 500 })
      .mockResolvedValueOnce({ renomeados: 200, falhas: 0, restantes: 0, nesta_chamada: 200 });

    await abrir();
    preencher(RENOME, 'Motivo', 'padronizacao do acervo legado');
    botao(RENOME, 'Simular').click();
    await flush();

    botao(RENOME, 'Aplicar').click();
    await flush();

    // Uma simulação e três aplicações.
    expect(svc.renomearPadrao).toHaveBeenCalledTimes(4);
    expect(svc.renomearPadrao).toHaveBeenLastCalledWith(
      expect.objectContaining({ dry_run: false }),
    );
    expect(status(RENOME)).toContain('1.200 arquivo(s) renomeado(s)');
  });

  // Insistir num lote que falhou repetiria o mesmo erro até o teto de 5.000.
  test('o laço para na primeira falha e mostra o detalhe', async () => {
    svc.renomearPadrao
      .mockResolvedValueOnce({
        dry_run: true, divergentes_total: 1000, nesta_chamada: 500, restantes: 500, amostra: [],
      })
      .mockResolvedValueOnce({
        renomeados: 3,
        falhas: 1,
        restantes: 496,
        nesta_chamada: 500,
        detalhe: [{ id: 9, de: 'a.tif', para: 'b.tif', erro: 'o nome alvo JÁ EXISTE no volume' }],
      });

    await abrir();
    preencher(RENOME, 'Motivo', 'padronizacao do acervo legado');
    botao(RENOME, 'Simular').click();
    await flush();

    botao(RENOME, 'Aplicar').click();
    await flush();

    expect(svc.renomearPadrao).toHaveBeenCalledTimes(2);
    expect(cartao(RENOME).textContent).toContain('o nome alvo JÁ EXISTE no volume');
    expect(status(RENOME)).toContain('1 falha(s)');
  });

  // `nesta_chamada` zero com `restantes` positivo é lote que não anda: sem esta
  // guarda o laço rodaria para sempre.
  test('o laço para quando o lote não avança', async () => {
    svc.renomearPadrao
      .mockResolvedValueOnce({
        dry_run: true, divergentes_total: 10, nesta_chamada: 10, restantes: 0, amostra: [],
      })
      .mockResolvedValue({ renomeados: 0, falhas: 0, restantes: 10, nesta_chamada: 0 });

    await abrir();
    preencher(RENOME, 'Motivo', 'padronizacao do acervo legado');
    botao(RENOME, 'Simular').click();
    await flush();

    botao(RENOME, 'Aplicar').click();
    await flush();

    expect(svc.renomearPadrao).toHaveBeenCalledTimes(2);
  });

  // O 409 do servidor ("há sessão de upload aberta") diz o que fazer. Um texto
  // genérico esconderia justamente isso.
  test('a recusa do servidor no renome aparece com a frase dele', async () => {
    svc.renomearPadrao.mockRejectedValue(
      new Error('Há 2 sessão(ões) de upload aberta(s). Espere fechar ou cancele.'),
    );
    await abrir();

    preencher(RENOME, 'Motivo', 'padronizacao do acervo legado');
    botao(RENOME, 'Simular').click();
    await flush();

    expect(status(RENOME)).toContain('sessão(ões) de upload aberta');
  });

  // ---- checksum ------------------------------------------------------------

  test('os ids aceitam vírgula, espaço e quebra de linha, e vão sem repetição', async () => {
    svc.atualizarChecksum.mockResolvedValue({
      solicitados: 3, alterados: 1, inalterados: 2, economia_mb: 0, arquivos: [],
    });
    await abrir();

    preencher(CHECKSUM, 'Ids', '12, 34\n56 12');
    preencher(CHECKSUM, 'Motivo', 'recompressao sem perda');
    botao(CHECKSUM, 'Reler e atualizar').click();
    await flush();

    expect(svc.atualizarChecksum).toHaveBeenCalledWith({
      arquivo_ids: [12, 34, 56],
      motivo: 'recompressao sem perda',
    });
  });

  test('sem id nenhum não chama o servidor', async () => {
    await abrir();

    preencher(CHECKSUM, 'Motivo', 'recompressao sem perda');
    botao(CHECKSUM, 'Reler e atualizar').click();
    await flush();

    expect(svc.atualizarChecksum).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('id de arquivo'));
  });

  // O teto do schema é 500. Recusar aqui poupa um 400 com a mensagem crua do Joi
  // depois de a pessoa colar uma lista longa.
  test('mais de 500 ids é recusado na tela', async () => {
    await abrir();

    preencher(CHECKSUM, 'Ids', Array.from({ length: 501 }, (_, i) => i + 1).join(','));
    preencher(CHECKSUM, 'Motivo', 'recompressao sem perda');
    botao(CHECKSUM, 'Reler e atualizar').click();
    await flush();

    expect(svc.atualizarChecksum).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('limite por chamada é 500'));
  });

  test('o resultado diz quantos mudaram e lista arquivo a arquivo', async () => {
    svc.atualizarChecksum.mockResolvedValue({
      solicitados: 2,
      alterados: 1,
      inalterados: 1,
      economia_mb: 12.5,
      arquivos: [
        {
          id: 12, nome_arquivo: 'CT_s12_2757', extensao: 'tif',
          tamanho_mb_anterior: 100, tamanho_mb_novo: 87.5, alterado: true,
        },
        {
          id: 13, nome_arquivo: 'CT_s12_2758', extensao: 'tif',
          tamanho_mb_anterior: 50, tamanho_mb_novo: 50, alterado: false,
        },
      ],
    });
    await abrir();

    preencher(CHECKSUM, 'Ids', '12 13');
    preencher(CHECKSUM, 'Motivo', 'recompressao sem perda');
    botao(CHECKSUM, 'Reler e atualizar').click();
    await flush();

    expect(status(CHECKSUM)).toContain('1 alterado(s)');
    expect(status(CHECKSUM)).toContain('1 sem mudança');
    expect(cartao(CHECKSUM).textContent).toContain('CT_s12_2757.tif');
    expect(cartao(CHECKSUM).textContent).toContain('CT_s12_2758.tif');
  });
});
