// Contexto de ANO do modulo MAPOTECA (2026-07-28), no mesmo desenho do
// orcamento: o ano escolhido vale para TODA tela da mapoteca que é por ano
// (resumo anual, mapa das entregas, consumo, RPCMTec, consumo do material).
//
// Antes cada uma dessas telas tinha o proprio seletor, e os quatro nasciam no
// ano corrente: trocar o ano no resumo anual e ir ao consumo voltava para 2026
// sem aviso. Agora ha um seletor so, na navbar, e a escolha sobrevive a
// navegacao e ao recarregamento da pagina.
//
// A mecanica esta em @store/year-store.js, compartilhada com o orcamento.

import { criarYearStore } from '@store/year-store.js';

const store = criarYearStore('mapoteca');

export const { getAno, setAno, initAno, onAnoChange } = store;
