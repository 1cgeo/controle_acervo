// Contexto de ANO do modulo ORCAMENTO. Substitui a ideia de "exercicio ativo":
// o ano selecionado e o contexto de todas as telas do modulo, persistido em
// localStorage. A troca dispara 'anochange:orcamento' para as paginas
// recarregarem.
//
// A mecanica esta em @store/year-store.js, compartilhada com a mapoteca. Este
// arquivo continua existindo porque e por ele que as telas do orcamento
// importam, e trocar a importacao em dezenas de paginas nao traria nada.

import { criarYearStore } from '@store/year-store.js';

const store = criarYearStore('orcamento');

export const { getAno, setAno, initAno, onAnoChange } = store;
