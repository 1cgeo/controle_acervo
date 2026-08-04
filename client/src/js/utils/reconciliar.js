/**
 * Reconciliacao de lista por CHAVE, no DOM cru.
 *
 * Recriar a lista inteira a cada carga e simples, mas cobra caro em tres
 * lugares: o foco do teclado morre com o no que o continha, a rolagem salta e
 * o navegador repinta o que nao mudou. Este utilitario compara a lista de itens
 * com os nos ja montados e so insere, remove, move ou repinta o que mudou.
 *
 * O padrao ja existia na casa (o mapa de cartoes da busca do acervo). Aqui ele
 * vira funcao, para o data-table e as listas seguintes usarem o mesmo desenho.
 *
 * @param {Element} container - o pai direto dos nos da lista (ex.: um <tbody>).
 * @param {Array} itens - a lista nova, na ordem em que ela deve aparecer.
 * @param {Object} opcoes
 * @param {(item:*, indice:number)=>*} [opcoes.chave] - identidade ESTAVEL do
 *        item (id, uuid, codigo). Sem ela a reconciliacao cai para a POSICAO, e
 *        toda linha que trocar de lugar e repintada.
 * @param {(item:*, indice:number)=>Node} opcoes.criar - monta o no do item novo.
 * @param {(no:Node, item:*, indice:number)=>(Node|void)} [opcoes.atualizar] -
 *        repinta o no reaproveitado com o dado novo. Devolver um Node troca o
 *        no antigo por ele. Sem atualizar, o no reaproveitado fica como estava.
 * @returns {Map<*, Node>} chave -> no montado, na ordem final.
 */

// Mapa vivo por container: chave -> no. Fica FORA do DOM de proposito. Guardar
// a chave num atributo exporia detalhe interno, e qualquer pagina que reescreve
// o atributo quebraria a reconciliacao em silencio. O WeakMap solta o container
// junto com a pagina, sem vazar memoria.
const montadosPorContainer = new WeakMap();

export function reconciliar(container, itens, opcoes = {}) {
  const { chave = (item, indice) => indice, criar, atualizar = null } = opcoes;

  if (!container) throw new Error('reconciliar: informe o container');
  if (typeof criar !== 'function') throw new Error('reconciliar: informe a funcao criar');

  const lista = Array.isArray(itens) ? itens : [];
  const anteriores = montadosPorContainer.get(container) || new Map();

  // O foco so interessa quando ele esta DENTRO do container: mover um no com
  // insertBefore tira o foco dele, e quem operava pelo teclado perde o lugar.
  const doc = container.ownerDocument;
  const focado = doc ? doc.activeElement : null;
  const focoInterno = Boolean(focado && focado !== doc.body && container.contains(focado));

  const atuais = new Map();
  const ordem = [];

  lista.forEach((item, indice) => {
    const k = chave(item, indice);
    // Chave repetida na mesma lista: a primeira ocorrencia fica com o no
    // reaproveitado, e a segunda ganha no proprio. Sem isso os dois itens
    // apontariam para o MESMO no, e um deles sumiria da tela.
    const repetida = atuais.has(k);
    let no = null;

    if (!repetida) {
      const anterior = anteriores.get(k);
      // O no so serve se ainda for filho deste container. Quem esvaziou a lista
      // por fora invalida o mapa, e o item volta a ser criado.
      if (anterior && anterior.parentNode === container) {
        no = anterior;
        if (atualizar) {
          const devolvido = atualizar(no, item, indice);
          if (devolvido instanceof Node) no = devolvido;
        }
      }
    }

    if (!no) no = criar(item, indice);
    if (!repetida) atuais.set(k, no);
    ordem.push(no);
  });

  const finais = new Set(ordem);

  // 1. Tira o que saiu. A varredura e pelos filhos REAIS, e nao pelo mapa: no
  // de um render antigo, ou injetado por fora, tambem tem de sair.
  for (const filho of Array.from(container.childNodes)) {
    if (!finais.has(filho)) container.removeChild(filho);
  }

  // 2. Poe na ordem pedida. O ponteiro anda pelos filhos e so move quem esta
  // fora do lugar. Quem ja esta certo nao e tocado, e por isso o foco fica.
  let referencia = container.firstChild;
  for (const no of ordem) {
    if (no === referencia) {
      referencia = referencia.nextSibling;
      continue;
    }
    container.insertBefore(no, referencia);
  }

  montadosPorContainer.set(container, atuais);

  // 3. Devolve o foco a quem sobreviveu. O passo 2 move nos, e mover tira o
  // foco de quem foi movido.
  if (focoInterno && container.contains(focado)
      && doc.activeElement !== focado && typeof focado.focus === 'function') {
    focado.focus();
  }

  return atuais;
}
