import { describe, test, expect, vi, beforeEach } from 'vitest';

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fileInputOf(root) {
  return root.querySelector('input[type="file"]');
}

function setFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function names(root) {
  return [...root.querySelectorAll('.file-attach__name')].map((n) => n.textContent);
}

describe('createFileAttachment', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
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

    expect(svc.deleteArquivo).toHaveBeenCalledWith(9);
    expect(names(w.element)).toEqual([]);
  });
});
