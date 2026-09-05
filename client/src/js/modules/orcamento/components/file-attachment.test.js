import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Mock do service: o componente importa as 4 funcoes de anexo. Usa vi.hoisted
// porque a factory do vi.mock e icada para o topo do arquivo.
const svc = vi.hoisted(() => ({
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));
vi.mock('@modules/orcamento/services/orcamento-service.js', () => svc);
vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

function fileInputOf(root) {
  return root.querySelector('input[type="file"]');
}

function setFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

/**
 * O botao do modal de confirmacao, pelo ROTULO.
 *
 * O `confirmDialog` pendura o modal no `document.body`, e nao dentro do widget:
 * procurar dentro de `w.element` nao o acha.
 */
function botaoDoDialogo(rotulo) {
  const botao = [...document.querySelectorAll('.modal__footer .btn')]
    .find((b) => b.textContent.trim() === rotulo);
  if (!botao) throw new Error(`Botão "${rotulo}" não está no diálogo de confirmação`);
  return botao;
}

const confirmarNoDialogo = () => botaoDoDialogo('Remover').click();
const cancelarNoDialogo = () => botaoDoDialogo('Cancelar').click();

function names(root) {
  return [...root.querySelectorAll('.file-attach__name')].map((n) => n.textContent);
}

describe('createFileAttachment', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    // Anexar e operador e remover e gerente. Os testes abaixo exercitam os
    // dois, entao entram como gerente; o gate em si tem teste proprio no fim.
    logarComo({ orcamento: GERENTE });
  });

  test('multi (PDR): upload imediato adiciona o arquivo a lista', async () => {
    svc.getArquivos.mockResolvedValueOnce([]);
    svc.uploadArquivo.mockResolvedValueOnce([{ id: 1, nome_original: 'pdr.xlsx' }]);

    const w = createFileAttachment({ mode: 'multi', vinculo: { pdr_ano: 2026 } });
    document.body.appendChild(w.element);
    await flush();

    setFile(fileInputOf(w.element), new File(['x'], 'pdr.xlsx'));
    await flush();

    expect(svc.uploadArquivo).toHaveBeenCalledWith(
      { pdr_ano: 2026 },
      expect.any(File)
    );
    expect(names(w.element)).toEqual(['pdr.xlsx']);
  });

  test('single diferido (criar): segura o arquivo e so envia no flush', async () => {
    svc.uploadArquivo.mockResolvedValueOnce([{ id: 2, nome_original: 'siafi.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: null });
    document.body.appendChild(w.element);
    await flush();

    setFile(fileInputOf(w.element), new File(['x'], 'siafi.pdf', { type: 'application/pdf' }));
    await flush();

    // Nada sobe ainda; o arquivo fica retido.
    expect(svc.uploadArquivo).not.toHaveBeenCalled();
    expect(w.hasPending()).toBe(true);
    expect(names(w.element)).toEqual(['siafi.pdf']);

    await w.flush({ nota_credito_id: 7 });

    expect(svc.uploadArquivo).toHaveBeenCalledWith(
      { nota_credito_id: 7 },
      expect.any(File)
    );
    expect(w.hasPending()).toBe(false);
  });

  test('single edicao: mostra o anexo existente e remove sob demanda', async () => {
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'extrato.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 3 } });
    document.body.appendChild(w.element);
    await flush();

    expect(svc.getArquivos).toHaveBeenCalledWith({ nota_credito_id: 3 });
    expect(names(w.element)).toEqual(['extrato.pdf']);

    // Botao de remover (data-table__action-btn--danger)
    const removeBtn = w.element.querySelector('.data-table__action-btn--danger');
    removeBtn.click();
    await flush();

    // O DELETE so sai depois da confirmacao: o arquivo sai do servidor, e o
    // lixo fica a um pixel do botao de baixar.
    expect(svc.deleteArquivo).not.toHaveBeenCalled();
    confirmarNoDialogo();
    await flush();

    expect(svc.deleteArquivo).toHaveBeenCalledWith(9);
    expect(names(w.element)).toEqual([]);
  });

  // O CONTROLE NEGATIVO da confirmacao: cancelar tem de deixar o arquivo onde
  // esta. Sem este caso, um `confirmDialog` que sempre resolvesse `true`
  // passaria no teste acima.
  test('single edicao: cancelar a confirmacao NAO remove o anexo', async () => {
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'extrato.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 3 } });
    document.body.appendChild(w.element);
    await flush();

    w.element.querySelector('.data-table__action-btn--danger').click();
    await flush();

    cancelarNoDialogo();
    await flush();

    expect(svc.deleteArquivo).not.toHaveBeenCalled();
    expect(names(w.element)).toEqual(['extrato.pdf']);
  });

  // SUBSTITUIR TAMBEM DESTROI. No modo single o POST apaga a linha anterior
  // dentro da mesma transacao: o PDF do SIAFI daquela NC saia do servidor sem
  // pergunta nenhuma, pelo botao ao lado do lixo que a tela esconde de quem nao
  // e gerente.
  test('single edicao: substituir CONFIRMA antes, nomeando o arquivo que sai', async () => {
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'extrato.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 3 } });
    document.body.appendChild(w.element);
    await flush();

    setFile(fileInputOf(w.element), new File(['x'], 'novo.pdf'));
    await flush();

    expect(svc.uploadArquivo).not.toHaveBeenCalled();
    const mensagem = document.querySelector('.modal__body').textContent;
    expect(mensagem).toContain('extrato.pdf');
    expect(mensagem).toContain('novo.pdf');

    botaoDoDialogo('Substituir').click();
    await flush();

    expect(svc.uploadArquivo).toHaveBeenCalledTimes(1);
  });

  test('single edicao: cancelar a substituição não envia arquivo nenhum', async () => {
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'extrato.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 3 } });
    document.body.appendChild(w.element);
    await flush();

    setFile(fileInputOf(w.element), new File(['x'], 'novo.pdf'));
    await flush();

    cancelarNoDialogo();
    await flush();

    expect(svc.uploadArquivo).not.toHaveBeenCalled();
    expect(names(w.element)).toEqual(['extrato.pdf']);
  });

  // O modo multi ACRESCENTA, e nao substitui: perguntar ali seria uma pergunta
  // sobre uma destruicao que nao acontece.
  test('multi (PDR): anexar mais um NÃO pergunta nada', async () => {
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'planilha.xlsx' }]);
    svc.uploadArquivo.mockResolvedValueOnce([
      { id: 9, nome_original: 'planilha.xlsx' },
      { id: 10, nome_original: 'outra.xlsx' },
    ]);

    const w = createFileAttachment({ mode: 'multi', vinculo: { pdr_ano: 2026 } });
    document.body.appendChild(w.element);
    await flush();

    setFile(fileInputOf(w.element), new File(['x'], 'outra.xlsx'));
    await flush();

    expect(document.querySelector('.modal__footer')).toBeNull();
    expect(svc.uploadArquivo).toHaveBeenCalledTimes(1);
  });
});

// O widget e usado em NC, DFD e PDR, entao o gate mora nele e vale nos tres de
// uma vez. Baixar e consulta e nunca some; anexar e operador; remover e gerente.
describe('createFileAttachment: o que cada perfil ve', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('consulta ve a lista e o botao de baixar, sem anexar nem remover', async () => {
    logarComo({ orcamento: CONSULTA });
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'nc.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 5 } });
    document.body.appendChild(w.element);
    await flush();

    expect(names(w.element)).toEqual(['nc.pdf']);
    expect(fileInputOf(w.element)).toBeNull();
    // Sobra apenas o botao de baixar na linha do arquivo.
    expect(w.element.querySelectorAll('.file-attach__row-actions button')).toHaveLength(1);
  });

  test('operador anexa, mas nao remove o que ja esta salvo', async () => {
    logarComo({ orcamento: OPERADOR });
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'nc.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 5 } });
    document.body.appendChild(w.element);
    await flush();

    expect(fileInputOf(w.element)).not.toBeNull();
    expect(w.element.querySelectorAll('.file-attach__row-actions button')).toHaveLength(1);
  });

  test('gerente anexa e remove', async () => {
    logarComo({ orcamento: GERENTE });
    svc.getArquivos.mockResolvedValueOnce([{ id: 9, nome_original: 'nc.pdf' }]);

    const w = createFileAttachment({ mode: 'single', vinculo: { nota_credito_id: 5 } });
    document.body.appendChild(w.element);
    await flush();

    expect(fileInputOf(w.element)).not.toBeNull();
    // Baixar + remover.
    expect(w.element.querySelectorAll('.file-attach__row-actions button')).toHaveLength(2);
  });

  // Arquivo ainda na mao, antes de existir o registro pai: tirar da lista nao
  // chama rota nenhuma, entao nao depende de gerente.
  test('operador retira o arquivo que ainda nao foi enviado', async () => {
    logarComo({ orcamento: OPERADOR });

    const w = createFileAttachment({ mode: 'single', vinculo: null });
    document.body.appendChild(w.element);
    await flush();

    setFile(fileInputOf(w.element), new File(['x'], 'novo.pdf'));
    await flush();

    expect(names(w.element)).toEqual(['novo.pdf']);
    expect(w.element.querySelectorAll('.file-attach__row-actions button')).toHaveLength(1);
  });
});
