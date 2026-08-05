import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A ficha de UM militar, aberta pela linha do mapa.
//
// Três invariantes:
//  - impedimento que não cruza passagem nenhuma não muda número nenhum. O SQL o
//    descarta em silêncio (o `CASE WHEN p.id IS NULL THEN NULL` de
//    efetivo_ctrl.js), e a ficha tem de dizer isso;
//  - salvar recarrega a ficha, e não só a tela por baixo, senão a correção
//    parece não ter valido;
//  - o estado vazio não afirma "o militar rendeu 100% do tempo em que esteve",
//    resultado que a ficha não conferiu.

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    createPeriodoEfetivo: vi.fn(() => Promise.resolve({})),
    updatePeriodoEfetivo: vi.fn(() => Promise.resolve({})),
    deletePeriodoEfetivo: vi.fn(() => Promise.resolve({})),
    createImpedimento: vi.fn(() => Promise.resolve({})),
    updateImpedimento: vi.fn(() => Promise.resolve({})),
    deleteImpedimento: vi.fn(() => Promise.resolve({})),
  };
});

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

import { openMilitarDialog, openImpedimentoDialog } from '@pages/aproveitamento/militar-dialog.js';
import { deleteImpedimento } from '@services/plataforma-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { saveAuth } from '@store/auth-store.js';

const MILITAR = { usuario_uuid: 'u1', posto_abrev: '2º Sgt', nome_guerra: 'Beltrano' };

const PASSAGEM = {
  id: 1, usuario_uuid: 'u1', data_inicio: '2026-03-01', data_fim: '2026-06-30',
  observacao: null,
};

// Cruza a passagem: conta.
const DENTRO = {
  id: 10, usuario_uuid: 'u1', descricao: 'Chefe do S5', percentual: 50,
  data_inicio: '2026-04-01', data_fim: '2026-04-10',
};

// Comeca depois de a passagem terminar: nao cruza passagem nenhuma no ano, e o
// SQL o descarta.
const FORA = {
  id: 11, usuario_uuid: 'u1', descricao: 'Curso PCE-EECN', percentual: 100,
  data_inicio: '2026-08-01', data_fim: '2026-08-10',
};

const modalAberta = () => document.querySelector('.modal');
// A LINHA, e nao o container dela. `.modal__body div` pegava tambem o corpo da
// secao, cujo texto comeca pelo texto da primeira linha: o teste que compara a
// IDENTIDADE do no comparava sempre o mesmo container e passava por construcao.
const linhaDo = (descricao) => [...document.querySelectorAll('.ficha-militar__linha')]
  .find(d => d.textContent.startsWith(descricao));

describe('ficha do militar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // Sem administrador: o historico da pessoa e verifyAdmin, e ele buscaria a
    // rota. O que se testa aqui e a lista, e nao o painel do historico.
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: {}, modulos: [] }, 'x');
    confirmDialog.mockResolvedValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // 5. Impedimento fora da passagem
  test('marca o impedimento que nao cruza passagem nenhuma do ano', async () => {
    openMilitarDialog({
      militar: MILITAR, ano: 2026,
      periodos: [PASSAGEM], impedimentos: [DENTRO, FORA],
    });

    const marcadas = [...document.querySelectorAll('.ficha-militar__linha--fora')];
    expect(marcadas.length).toBe(1);
    expect(marcadas[0].textContent).toContain('Curso PCE-EECN');
    expect(marcadas[0].textContent).not.toContain('Chefe do S5');
    // A ficha diz o que a marca significa: o registro nao muda numero nenhum.
    expect(marcadas[0].textContent).toContain('Não entra na conta');
  });

  test('o impedimento que cruza a passagem nao leva marca', async () => {
    openMilitarDialog({
      militar: MILITAR, ano: 2026,
      periodos: [PASSAGEM], impedimentos: [DENTRO],
    });

    expect(document.querySelectorAll('.ficha-militar__linha--fora').length).toBe(0);
  });

  // 6. A ficha se atualiza sem fechar
  test('excluir um impedimento repinta a lista DENTRO da ficha, sem fecha-la', async () => {
    const onSaved = vi.fn(async () => ({ periodos: [PASSAGEM], impedimentos: [FORA] }));

    openMilitarDialog({
      militar: MILITAR, ano: 2026,
      periodos: [PASSAGEM], impedimentos: [DENTRO, FORA],
      onSaved,
    });

    expect(modalAberta().textContent).toContain('Chefe do S5');

    const linha = linhaDo('Chefe do S5');
    const excluir = [...linha.querySelectorAll('button')]
      .find(b => b.title === 'Excluir');
    excluir.click();
    await flush();
    await flush();

    expect(deleteImpedimento).toHaveBeenCalledWith(10);
    expect(onSaved).toHaveBeenCalled();
    // A ficha CONTINUA aberta...
    expect(modalAberta()).not.toBeNull();
    // ...e mostra a lista nova, e nao a velha.
    expect(modalAberta().textContent).not.toContain('Chefe do S5');
    expect(modalAberta().textContent).toContain('Curso PCE-EECN');
  });

  // REGRA DE OURO: salvar nao reconstroi a tela.
  //
  // `pintar()` fazia `innerHTML = ''` nos dois corpos, e e chamada depois de
  // TODA gravacao e exclusao. Quem apagava o terceiro de oito impedimentos
  // voltava ao topo da lista e perdia o foco com o no que o continha.
  //
  // O jsdom nao faz layout, entao `scrollTop` e sempre zero: o que estes casos
  // medem e a CAUSA (a identidade dos nos e o foco), e nao a rolagem.
  test('salvar nao recria a linha que nao mudou, e o foco sobrevive', async () => {
    const onSaved = vi.fn(async () => ({
      periodos: [PASSAGEM], impedimentos: [DENTRO],
    }));

    openMilitarDialog({
      militar: MILITAR, ano: 2026,
      periodos: [PASSAGEM], impedimentos: [DENTRO, FORA],
      onSaved,
    });

    const linhaDentro = linhaDo('Chefe do S5');
    const editarDentro = [...linhaDentro.querySelectorAll('button')]
      .find(b => b.title === 'Editar');
    editarDentro.focus();
    expect(document.activeElement).toBe(editarDentro);

    // Exclui o OUTRO impedimento. A linha do 'Chefe do S5' nao tem por que ser
    // tocada.
    const excluirFora = [...linhaDo('Curso PCE-EECN').querySelectorAll('button')]
      .find(b => b.title === 'Excluir');
    excluirFora.click();
    await flush();
    await flush();

    expect(deleteImpedimento).toHaveBeenCalledWith(11);
    // O MESMO no, e nao um igual: e a identidade que preserva rolagem e foco.
    expect(linhaDo('Chefe do S5')).toBe(linhaDentro);
    expect(document.activeElement).toBe(editarDentro);
    // E o que saiu, saiu.
    expect(linhaDo('Curso PCE-EECN')).toBeUndefined();
  });

  // CONTROLE NEGATIVO do caso acima: reaproveitar o no SEMPRE seria tao errado
  // quanto recriar sempre, porque a linha alterada continuaria mostrando o
  // numero velho. A que mudou tem de ser repintada, e so ela.
  test('a linha que mudou e repintada, e a vizinha nao', async () => {
    const DENTRO_NOVO = { ...DENTRO, percentual: 80 };
    const onSaved = vi.fn(async () => ({
      periodos: [PASSAGEM], impedimentos: [DENTRO_NOVO, FORA],
    }));

    openMilitarDialog({
      militar: MILITAR, ano: 2026,
      periodos: [PASSAGEM], impedimentos: [DENTRO, FORA],
      onSaved,
    });

    const linhaDentro = linhaDo('Chefe do S5');
    const linhaFora = linhaDo('Curso PCE-EECN');
    expect(linhaDentro.textContent).toContain('50%');

    // Uma exclusao de PASSAGEM dispara a mesma repintura da ficha.
    const excluirPassagem = [...document.querySelectorAll('button')]
      .find(b => b.title === 'Excluir');
    excluirPassagem.click();
    await flush();
    await flush();

    const depoisDentro = linhaDo('Chefe do S5');
    expect(depoisDentro).not.toBe(linhaDentro);
    expect(depoisDentro.textContent).toContain('80%');
    // A vizinha nao mudou de conteudo, entao continua sendo o mesmo no.
    expect(linhaDo('Curso PCE-EECN')).toBe(linhaFora);
  });

  // 9. Corte de texto
  test('o estado vazio nao afirma resultado que a ficha nao conferiu', async () => {
    openMilitarDialog({
      militar: MILITAR, ano: 2026, periodos: [PASSAGEM], impedimentos: [],
    });

    const corpo = modalAberta().textContent;
    expect(corpo).toContain('Nenhum impedimento neste ano.');
    expect(corpo).not.toContain('rendeu 100%');
  });

  test('a ajuda do percentual nao repete o rotulo do campo', async () => {
    openImpedimentoDialog({ usuarioUuid: 'u1' });

    const ajudas = [...document.querySelectorAll('.form-field__help')]
      .map(a => a.textContent);
    expect(ajudas.some(a => a.includes('Afastamento integral é 100'))).toBe(true);
    expect(ajudas.some(a => a.includes('Quanto do tempo este impedimento consome'))).toBe(false);
  });
});
