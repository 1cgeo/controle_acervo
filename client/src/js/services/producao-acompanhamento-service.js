/**
 * REEXPORTAÇÃO, e não um serviço.
 *
 * O módulo de produção teve três arquivos de serviço, escritos em paralelo, e em
 * 2026-08-09 os três viraram `producao-service.js`. Este arquivo sobrou como
 * ponte por UM motivo, e só por ele: `modules/producao/pages/microcontrole/`
 * ainda importa daqui, e aquela tela estava sendo trabalhada em outra frente na
 * mesma data. Quebrá-la para ganhar um arquivo a menos seria trocar um problema
 * de arrumação por um defeito.
 *
 * NADA NOVO ENTRA AQUI. Quem escrever tela nova importa de
 * `@services/producao-service.js`, e quem passar por `microcontrole/` com
 * liberdade para editá-lo troca o import lá e APAGA este arquivo.
 */
export { getLotesEmExecucao } from '@services/producao-service.js';
