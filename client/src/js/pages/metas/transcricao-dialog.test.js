import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// CORRECAO DE TRANSCRICAO da meta do PIT.
//
// A operacao reescreve o que uma revisao ASSINADA declarou, entao o que estes
// casos prendem nao e "o formulario grava", e sim as guardas que fazem dela uma
// acao de consequencia:
//   - sem confirmacao explicita, nada e gravado;
//   - sem motivo com o minimo que o Joi do servidor cobra, nada e gravado;
//   - `cancelada` vai SEMPRE no corpo, senao o servidor descancela em silencio;
//   - a tela diz o que muda e o que fica, campo a campo;
//   - a falha do servidor nao fecha o dialogo nem apaga o que foi digitado.

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    corrigirTranscricaoMeta: vi.fn(() => Promise.resolve({ id: 9 })),
  };
});

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showToast: vi.fn(),
}));

import { openTranscricaoDialog } from '@pages/metas/transcricao-dialog.js';
import { corrigirTranscricaoMeta } from '@services/plataforma-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showError, showSuccess } from '@utils/toast.js';

// A linha como `pit.meta_vigente` a devolve (er/pit.sql:259). `revisao_id` e
// `revisao` sao o que diz QUAL declaracao a correcao reescreve.
const META = {
  id: 42,
  ano: 2026,
  numero_meta: 4,
  item: '4.2',
  descricao: 'Carta Topográfica 1:25.000',
  quantidade_prevista: 53,
  prazo: '2026-08-31',
  demandante: 'COTER/DECEX',
  cancelada: false,
  revisao_id: 7,
  revisao: 'R1',
};

const modal = () => document.querySelector('.modal');
const campoPorRotulo = (rotulo) => {
  const label = [...document.querySelectorAll('.form-field__label')]
    .find(l => l.textContent.startsWith(rotulo));
  return label ? document.getElementById(label.getAttribute('for')) : null;
};
const botao = (texto) => [...document.querySelectorAll('.modal__footer .btn')]
  .find(b => b.textContent === texto);

function digitar(input, valor) {
  input.value = valor;
  input.dispatchEvent(new Event('input'));
}

describe('correcao de transcricao da meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    confirmDialog.mockResolvedValue(true);
    corrigirTranscricaoMeta.mockResolvedValue({ id: 9 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('o aviso separa o que MUDA do que FICA, e nomeia a revisao em vigor', () => {
    openTranscricaoDialog({ meta: META });

    const aviso = document.querySelector('.transcricao__aviso');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('R1');
    expect(aviso.textContent).toContain('MUDA');
    expect(aviso.textContent).toContain('FICA');
    // O que FICA e a promessa que evita o mal-entendido inteiro: a tela nao
    // emite revisao nova.
    expect(aviso.textContent).toContain('não emite revisão nova');
  });

  test('o painel lista campo a campo o que vai mudar, com o valor anterior', () => {
    openTranscricaoDialog({ meta: META });

    // CONTROLE NEGATIVO: sem ninguem digitar, nao ha mudanca nenhuma a anunciar.
    expect(document.querySelector('.transcricao__mudancas').textContent)
      .toContain('Nada mudou');

    digitar(campoPorRotulo('Quantidade prevista'), '35');

    const itens = [...document.querySelectorAll('.transcricao__mudancas li')]
      .map(li => li.textContent);
    expect(itens.length).toBe(1);
    expect(itens[0]).toContain('Quantidade prevista');
    expect(itens[0]).toContain('53');
    expect(itens[0]).toContain('35');
  });

  test('nao grava sem confirmar, e o que se confirma repete a mudanca', async () => {
    openTranscricaoDialog({ meta: META });

    digitar(campoPorRotulo('Quantidade prevista'), '35');
    digitar(campoPorRotulo('Motivo da correção'), 'O R1 assinado diz 35.');

    confirmDialog.mockResolvedValueOnce(false);
    botao('Corrigir transcrição').click();
    await flush();

    expect(confirmDialog).toHaveBeenCalled();
    // A mensagem da confirmacao nomeia a revisao e a mudanca, e nao so "tem
    // certeza?": e a ultima tela antes de reescrever documento assinado.
    const msg = confirmDialog.mock.calls[0][0].message;
    expect(msg).toContain('R1');
    expect(msg).toContain('35');
    // DESISTIR NAO GRAVA. Sem este caso, um confirmDialog que sempre devolvesse
    // verdadeiro passaria no teste do caminho feliz.
    expect(corrigirTranscricaoMeta).not.toHaveBeenCalled();
    expect(modal()).not.toBeNull();
  });

  test('nao grava com motivo curto, e nem chega a perguntar', async () => {
    openTranscricaoDialog({ meta: META });

    digitar(campoPorRotulo('Quantidade prevista'), '35');
    digitar(campoPorRotulo('Motivo da correção'), 'oops');

    botao('Corrigir transcrição').click();
    await flush();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(corrigirTranscricaoMeta).not.toHaveBeenCalled();
    expect(document.querySelector('.form-field--error')).not.toBeNull();
  });

  test('nao grava quando nenhum campo mudou', async () => {
    openTranscricaoDialog({ meta: META });

    digitar(campoPorRotulo('Motivo da correção'), 'Conferi com o R1 assinado.');

    botao('Corrigir transcrição').click();
    await flush();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(corrigirTranscricaoMeta).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  // O corpo vai INTEIRO, e este e o caso que mais importa: o servidor grava a
  // declaracao toda e trata campo ausente como padrao (`declaracao()` em
  // pit_ctrl.js). Omitir `cancelada` descancelaria a meta que a DSG cancelou.
  test('manda os cinco campos da declaracao mais o motivo, inclusive cancelada', async () => {
    openTranscricaoDialog({ meta: { ...META, cancelada: true }, onSaved: vi.fn() });

    digitar(campoPorRotulo('Quantidade prevista'), '35');
    digitar(campoPorRotulo('Motivo da correção'), 'O R1 assinado diz 35.');

    botao('Corrigir transcrição').click();
    await flush();

    expect(corrigirTranscricaoMeta).toHaveBeenCalledWith(42, {
      descricao: 'Carta Topográfica 1:25.000',
      quantidade_prevista: 35,
      prazo: '2026-08-31',
      demandante: 'COTER/DECEX',
      cancelada: true,
      motivo: 'O R1 assinado diz 35.',
    });
  });

  test('gravou: avisa, fecha e devolve o controle a lista', async () => {
    const onSaved = vi.fn();
    openTranscricaoDialog({ meta: META, onSaved });

    digitar(campoPorRotulo('Quantidade prevista'), '35');
    digitar(campoPorRotulo('Motivo da correção'), 'O R1 assinado diz 35.');

    botao('Corrigir transcrição').click();
    await flush();

    expect(showSuccess).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    expect(modal()).toBeNull();
  });

  // A gravacao que falha nao pode levar junto o que a pessoa digitou: o motivo
  // do servidor so serve a quem ainda tem o formulario na frente.
  test('a falha do servidor mantem o dialogo e o que foi digitado', async () => {
    corrigirTranscricaoMeta.mockRejectedValueOnce(new Error('O exercício de 2026 está encerrado e não aceita alteração.'));
    const onSaved = vi.fn();
    openTranscricaoDialog({ meta: META, onSaved });

    digitar(campoPorRotulo('Quantidade prevista'), '35');
    digitar(campoPorRotulo('Motivo da correção'), 'O R1 assinado diz 35.');

    botao('Corrigir transcrição').click();
    await flush();

    expect(modal()).not.toBeNull();
    expect(campoPorRotulo('Quantidade prevista').value).toBe('35');
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('encerrado'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Enquanto a gravacao corre, o dialogo nao se fecha por Escape: o erro do
  // servidor chegaria a uma tela sem formulario.
  test('Escape nao fecha o dialogo durante a gravacao', async () => {
    // CONTROLE POSITIVO: fora da gravacao o Escape fecha, como sempre fechou.
    // Sem ele, um modal que nunca fechasse passaria no caso principal.
    openTranscricaoDialog({ meta: META });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal()).toBeNull();

    let liberar;
    corrigirTranscricaoMeta.mockImplementationOnce(
      () => new Promise(resolve => { liberar = resolve; })
    );

    openTranscricaoDialog({ meta: META });
    digitar(campoPorRotulo('Quantidade prevista'), '35');
    digitar(campoPorRotulo('Motivo da correção'), 'O R1 assinado diz 35.');

    botao('Corrigir transcrição').click();
    await flush();

    // A gravacao esta em voo: o botao mostra isso e o Escape nao fecha.
    expect(botao('Corrigir transcrição').classList.contains('btn--ocupado')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal()).not.toBeNull();

    liberar({ id: 9 });
    await flush();

    // A trava dura o tempo da requisicao, e nao mais que isso: terminada a
    // gravacao o dialogo fecha sozinho.
    expect(modal()).toBeNull();
  });
});
