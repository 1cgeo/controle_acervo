import { describe, test, expect } from 'vitest';

// O CONTRATO do servico do RPCMTec, do lado do cliente.
//
// O que este arquivo fixa e uma AUSENCIA: em 2026-08-06 saiu daqui a chamada
// que trazia as subsecoes digitadas do mes passado, junto com os dois botoes da
// tela e a rota do servidor. O RPCMTec e o relatorio DAQUELE mes: a linha que
// chega pronta nao e relida, e o documento assinado passava a afirmar sobre
// agosto o que aconteceu em julho.
//
// O modulo entra SEM MOCK, de proposito: quem se afirma aqui e a lista de
// exportacoes do arquivo real, e um mock com spread esconderia justamente isso.

import * as servico from '@services/rpcmtec-service.js';

describe('rpcmtec-service: o que ele exporta', () => {
  test('nao exporta mais a copia do mes anterior', () => {
    // VARIANCIA: o modulo carregou e continua exportando o resto. Sem isto, um
    // import quebrado deixaria todo `toBeUndefined` passar.
    expect(typeof servico.getDocumento).toBe('function');
    expect(typeof servico.gravarSubsecao).toBe('function');
    expect(typeof servico.limparSubsecao).toBe('function');

    expect(servico.copiarMesAnterior).toBeUndefined();
  });

  test('nenhuma exportacao do modulo fala em copiar', () => {
    const nomes = Object.keys(servico);

    expect(nomes.length).toBeGreaterThan(5);
    expect(nomes.filter(n => /copiar|copia/i.test(n))).toEqual([]);
  });
});
