import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  atualizarViewsMaterializadas: vi.fn(() => Promise.resolve({})),
  criarViewsMaterializadas: vi.fn(() => Promise.resolve({})),
  limparDownloadsExpirados: vi.fn(() => Promise.resolve({})),
  limparSessoesEnvioExpiradas: vi.fn(() => Promise.resolve({ fechadas: 0, apagadas: 0 })),
  renomearPadrao: vi.fn(),
  atualizarChecksum: vi.fn(),
  contarMiniaturasPendentes: vi.fn(() => Promise.resolve({ pendentes: 0, lote: 20 })),
  varrerMiniaturas: vi.fn(),
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

// O cartao da fila tem DUAS linhas de estado: a primeira e o tamanho da fila,
// a segunda e o desfecho da ultima passada.
const fila = (titulo) => cartao(titulo).querySelectorAll('.manutencao__status')[0].textContent;
const desfecho = (titulo) => cartao(titulo).querySelectorAll('.manutencao__status')[1].textContent;

const preencher = (titulo, rotulo, valor) => {
  const campo = [...cartao(titulo).querySelectorAll('.manutencao__campo')]
    .find(l => l.querySelector('span').textContent.includes(rotulo));
  const input = campo.querySelector('input, textarea');
  input.value = valor;
  return input;
};

const RENOME = 'Padronizar o nome físico dos arquivos';
const CHECKSUM = 'Atualizar checksum por releitura';
const MINIATURAS = 'Fila de miniaturas';
const ENVIOS = 'Sessões de envio expiradas';

beforeEach(() => {
  confirmDialog.mockResolvedValue(true);
  svc.contarMiniaturasPendentes.mockResolvedValue({ pendentes: 0, lote: 20 });
});

describe('aba de Manutenção', () => {
  // O sexto cartão entrou em 06/08/2026: a limpeza das sessões de envio pegava
  // carona no botão de downloads, e o rótulo dele não dizia isso.
  test('monta os seis cartões, nesta ordem', async () => {
    await abrir();

    const titulos = [...container.querySelectorAll('.manutencao__titulo')]
      .map(t => t.textContent);
    expect(titulos).toEqual([
      'Visões materializadas',
      'Downloads expirados',
      ENVIOS,
      MINIATURAS,
      RENOME,
      CHECKSUM,
    ]);
  });

  test('o cartão de envios chama a rota própria, e não a de downloads', async () => {
    await abrir();

    botao(ENVIOS, 'Limpar expiradas').click();
    await flush();

    expect(svc.limparSessoesEnvioExpiradas).toHaveBeenCalledTimes(1);
    expect(svc.limparDownloadsExpirados).not.toHaveBeenCalled();
  });

  // O número volta para a tela. "Limpou" sem número é eco do clique.
  test('o cartão de envios mostra quantas fechou e quantas apagou', async () => {
    svc.limparSessoesEnvioExpiradas.mockResolvedValue({ fechadas: 2, apagadas: 5 });
    await abrir();

    botao(ENVIOS, 'Limpar expiradas').click();
    await flush();

    expect(status(ENVIOS)).toContain('2');
    expect(status(ENVIOS)).toContain('5');
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

  // As DUAS perguntam. Atualizar dispara um REFRESH CONCURRENTLY em todas as
  // `acervo.mv_produto_*`, que leva minutos numa base grande: um clique de
  // passagem custava isso sem ninguem ter decidido nada. O botao irmao, ao lado
  // no mesmo cartao, ja perguntava.
  test('as duas ações das visões materializadas perguntam antes', async () => {
    await abrir();

    botao('Visões materializadas', 'Atualizar todas as visões').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(svc.atualizarViewsMaterializadas).toHaveBeenCalled();

    botao('Visões materializadas', 'Criar as que faltam').click();
    await flush();
    expect(confirmDialog).toHaveBeenCalledTimes(2);
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

    // O OUTRO LADO: com divergente, o botão liga. Sem esta metade o caso
    // passaria com o Aplicar travado para sempre.
    svc.renomearPadrao.mockResolvedValueOnce({
      dry_run: true, divergentes_total: 12, nesta_chamada: 12, restantes: 0, amostra: [],
    });
    botao(RENOME, 'Simular').click();
    await flush();

    expect(botao(RENOME, 'Aplicar').disabled).toBe(false);
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

// A FILA DE MINIATURAS PRECISA DE TELA. Não há agendamento no sistema: a versão
// cuja miniatura falhou fica na fila até alguém varrer, e sem este cartão a
// dívida é invisível -- o acervo acumula ficha sem imagem que ninguém vê.
describe('fila de miniaturas', () => {
  test('mostra quantas esperam e o teto de cada passada', async () => {
    svc.contarMiniaturasPendentes.mockResolvedValue({ pendentes: 37, lote: 20 });
    await abrir();
    await flush();

    expect(fila(MINIATURAS)).toContain('37');
    expect(fila(MINIATURAS)).toContain('20');
    expect(botao(MINIATURAS, 'Varrer a fila').disabled).toBe(false);
  });

  test('fila vazia desliga o botão, em vez de mandar varrer o nada', async () => {
    svc.contarMiniaturasPendentes.mockResolvedValue({ pendentes: 0, lote: 20 });
    await abrir();
    await flush();

    expect(fila(MINIATURAS)).toMatch(/Nenhuma vers[ãa]o aguarda miniatura/i);
    expect(botao(MINIATURAS, 'Varrer a fila').disabled).toBe(true);
  });

  test('varrer conta o desfecho e RECONTA a fila', async () => {
    svc.contarMiniaturasPendentes
      .mockResolvedValueOnce({ pendentes: 37, lote: 20 })
      .mockResolvedValueOnce({ pendentes: 17, lote: 20 });
    svc.varrerMiniaturas.mockResolvedValue({ sucessos: 20, falhas: 0, restante: 17 });

    await abrir();
    await flush();

    botao(MINIATURAS, 'Varrer a fila').click();
    await flush();
    await flush();

    expect(svc.varrerMiniaturas).toHaveBeenCalledTimes(1);
    expect(svc.contarMiniaturasPendentes).toHaveBeenCalledTimes(2);
    expect(fila(MINIATURAS)).toContain('17');
    expect(desfecho(MINIATURAS)).toContain('20 miniatura(s) gerada(s)');
  });

  // Anunciar sucesso numa varredura PULADA seria anunciar trabalho que não
  // aconteceu: outra passada já está em curso.
  test('varredura pulada diz que nada foi feito', async () => {
    svc.contarMiniaturasPendentes.mockResolvedValue({ pendentes: 37, lote: 20 });
    svc.varrerMiniaturas.mockResolvedValue({ pulada: true });

    await abrir();
    await flush();

    botao(MINIATURAS, 'Varrer a fila').click();
    await flush();

    expect(desfecho(MINIATURAS)).toMatch(/j[áa] est[áa] em curso/i);
  });

  // Falhar ao CONTAR não é fila vazia: o botão fica de pé, e o que falta é o
  // número. É a mesma distinção entre "não há" e "não sei" do estado de erro.
  test('falha ao contar não desliga o botão', async () => {
    svc.contarMiniaturasPendentes.mockRejectedValue(new Error('sem rede'));

    await abrir();
    await flush();

    expect(fila(MINIATURAS)).toMatch(/n[ãa]o foi poss[íi]vel contar a fila/i);
    expect(botao(MINIATURAS, 'Varrer a fila').disabled).toBe(false);
  });
});
