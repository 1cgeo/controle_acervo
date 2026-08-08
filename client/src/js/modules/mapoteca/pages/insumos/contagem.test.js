import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { openContagemDialog } from '@modules/mapoteca/pages/insumos/movimento-dialogs.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { TIPO_MOVIMENTO, TIPO_LOCALIZACAO } from '@modules/mapoteca/movimento-material.js';

// A CONTAGEM E A PECA CENTRAL DA TELA, e este arquivo e o que a prende.
//
// A Secao CONTA A PRATELEIRA, e nao declara cada uso: `mapoteca.consumo_material`
// ficou com ZERO linhas em nove dias de producao justamente porque pedia o ato
// que ninguem pratica. Contar, a Secao pratica.
//
// A diferenca entre o contado e o saldo vira uma pergunta de uma frase, e a
// pergunta tem DUAS saidas com efeitos diferentes no RPCMTec:
//
//   Sim, foram consumidos  -> CONSUMO (tipo 3). ENTRA na 7.2.
//   Não, foi outra coisa   -> CONTAGEM (tipo 4) com motivo. NAO entra.
//
// Trocar um pelo outro inflaria ou zeraria o gasto que a Divisao reporta, e
// nenhum dos dois erros apareceria na tela.

const MATERIAL = { id: 7, nome: 'Papel A0' };

/** O modal do TOPO da pilha. */
const modalAtual = () => [...document.querySelectorAll('.modal')].pop();

/** Botao do rodape do modal do topo, pelo rotulo. */
function botao(rotulo) {
  return [...modalAtual().querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

/** Campo do modal do topo, pelo rotulo da etiqueta. */
function campo(rotulo) {
  const modal = modalAtual();
  const label = [...modal.querySelectorAll('.form-field__label')]
    .find(l => l.textContent.trim().replace('*', '').trim() === rotulo);
  return label.parentElement.querySelector('input, select, textarea');
}

/** Digita num campo e dispara o `change` que os selects escutam. */
function preencher(rotulo, valor) {
  const input = campo(rotulo);
  input.value = String(valor);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Abre a contagem, preenche e chega no passo da decisao. */
async function contar({ saldos, local, contado, data = '2026-08-08' }) {
  openContagemDialog({ material: MATERIAL, saldos, onSaved: null });
  if (local !== undefined) preencher('Contei em', local);
  preencher('Quantidade contada', contado);
  preencher('Data da contagem', data);
  botao('Conferir').click();
  await flush();
}

describe('a Contagem da prateleira', () => {
  beforeEach(() => {
    svc.createMovimentoMaterial.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('contou MENOS na Seção: a frase pergunta, numa frase so', async () => {
    await contar({ saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 14]]), contado: 12 });

    const texto = modalAtual().textContent;
    expect(texto).toContain('cai de 14 para 12');
    expect(texto).toContain('Foram 2 consumidos?');
    // As DUAS saidas estao na tela, e nenhuma esta escondida atras da outra.
    expect(botao('Sim, foram consumidos')).toBeTruthy();
    expect(botao('Não, foi outra coisa')).toBeTruthy();
  });

  test('"Sim" lança CONSUMO com a data da CONTAGEM, e entra no RPCMTec', async () => {
    await contar({
      saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 14]]),
      contado: 12,
      data: '2026-07-31',
    });

    botao('Sim, foram consumidos').click();
    await flush();

    expect(svc.createMovimentoMaterial).toHaveBeenCalledWith({
      tipo_material_id: 7,
      tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
      quantidade: 2,
      // A DATA E A DA CONTAGEM, e nao a de hoje: e o mes dela que a 7.2 reporta.
      data_movimento: '2026-07-31',
      localizacao_origem_id: TIPO_LOCALIZACAO.SECAO,
      localizacao_destino_id: null,
      motivo: null,
    });
  });

  test('"Não" lança CONTAGEM, e o motivo e obrigatorio', async () => {
    await contar({ saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 14]]), contado: 12 });

    // Sem motivo, nao passa: a contagem e o unico movimento que ninguem viu
    // acontecer, e sem o porque ela vira um ajuste mudo do saldo.
    botao('Não, foi outra coisa').click();
    await flush();
    expect(svc.createMovimentoMaterial).not.toHaveBeenCalled();
    expect(modalAtual().textContent).toContain('Informe o motivo da diferença');

    preencher('Motivo', 'Duas bobinas molharam na chuva');
    botao('Não, foi outra coisa').click();
    await flush();

    expect(svc.createMovimentoMaterial).toHaveBeenCalledWith({
      tipo_material_id: 7,
      tipo_movimento_id: TIPO_MOVIMENTO.CONTAGEM,
      quantidade: 2,
      data_movimento: '2026-08-08',
      // A diferenca SAI: o lado de origem e o preenchido, e o destino fica nulo.
      localizacao_origem_id: TIPO_LOCALIZACAO.SECAO,
      localizacao_destino_id: null,
      motivo: 'Duas bobinas molharam na chuva',
    });
  });

  test('contou MAIS: e sempre Contagem, com o lado de DESTINO', async () => {
    await contar({ saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 12]]), contado: 14 });

    expect(modalAtual().textContent).toContain('sobe de 12 para 14');
    // Nao existe "consumo negativo": a sobra veio de uma entrada que ninguem
    // lancou ou de uma contagem anterior errada, e as duas pedem explicacao.
    expect(botao('Sim, foram consumidos')).toBeUndefined();

    preencher('Motivo', 'Entrada de junho não lançada');
    botao('Registrar contagem').click();
    await flush();

    expect(svc.createMovimentoMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo_movimento_id: TIPO_MOVIMENTO.CONTAGEM,
        quantidade: 2,
        localizacao_origem_id: null,
        localizacao_destino_id: TIPO_LOCALIZACAO.SECAO,
        motivo: 'Entrada de junho não lançada',
      })
    );
  });

  // CONSUMO SO SAI DA SECAO. Material do almoxarifado nao e gasto la: ele e
  // transferido para a Secao antes. A pergunta nem aparece.
  test('falta no ALMOXARIFADO nao oferece a saida de consumo', async () => {
    await contar({
      saldos: new Map([[TIPO_LOCALIZACAO.ALMOXARIFADO, 10]]),
      local: TIPO_LOCALIZACAO.ALMOXARIFADO,
      contado: 8,
    });

    expect(modalAtual().textContent).toContain('cai de 10 para 8');
    expect(modalAtual().textContent).not.toContain('consumidos?');
    expect(botao('Sim, foram consumidos')).toBeUndefined();
    expect(botao('Registrar contagem')).toBeTruthy();
  });

  test('contagem que CONFERE nao lança nada, e diz por que', async () => {
    openContagemDialog({ material: MATERIAL, saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 14]]) });
    preencher('Quantidade contada', 14);
    botao('Conferir').click();
    await flush();

    expect(svc.createMovimentoMaterial).not.toHaveBeenCalled();
    // Continua no primeiro modal, com a explicacao no proprio campo.
    expect(modalAtual().textContent).toContain('A contagem confere');
  });

  test('zero e uma contagem legitima, e a mais urgente delas', async () => {
    await contar({ saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 3]]), contado: 0 });

    expect(modalAtual().textContent).toContain('cai de 3 para 0');
    botao('Sim, foram consumidos').click();
    await flush();

    expect(svc.createMovimentoMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
        quantidade: 3,
      })
    );
  });

  test('o erro do gatilho chega ate o operador, e o dialogo fica aberto', async () => {
    svc.createMovimentoMaterial.mockRejectedValueOnce(
      new Error('Estoque insuficiente na Seção para o material Papel A0')
    );
    await contar({ saldos: new Map([[TIPO_LOCALIZACAO.SECAO, 14]]), contado: 12 });

    botao('Sim, foram consumidos').click();
    await flush();

    // O modal NAO se fecha no erro: quem perdeu o formulario nao tem onde ler o
    // motivo nem o que corrigir.
    expect(botao('Sim, foram consumidos')).toBeTruthy();
  });
});
