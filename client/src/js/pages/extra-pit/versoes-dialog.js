import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createTextField } from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getVersoesExtraPit,
  getVersoesCandidatasExtraPit,
  associarVersaoExtraPit,
  desassociarVersaoExtraPit,
  codigoMetaPit,
} from '@services/plataforma-service.js';
import { isAdmin } from '@store/auth-store.js';
import './versoes.css';

/**
 * As versões do acervo que materializam uma demanda Extra-PIT.
 *
 * O EXTRA-PIT É PRODUÇÃO, e não entrega: a demanda só fecha quando a versão
 * existe. O vínculo mora em `acervo.versao.demanda_extra_id` (er/acervo.sql:148)
 * e é EXCLUSIVO com `meta_pit_id`, pelo CHECK `versao_plano_ou_excecao`
 * (er/acervo.sql:163). A folha cumpre o plano OU é a exceção autorizada, nunca
 * as duas, e essa exclusão é o que impede a contagem dupla.
 *
 * O VÍNCULO É DA VERSÃO, E NÃO DO LOTE, e isso foi medido: o lote 2026-1a tem
 * seis cartas, quatro da meta 1.1 e duas do CMS para a Op. Arandu. A produção
 * Extra-PIT mora DENTRO de um lote do PIT, e só a versão separa as duas.
 *
 * A FOLHA QUE JÁ CUMPRE META APARECE NA BUSCA, e não some dela: some-a e a
 * pessoa procuraria para sempre uma versão que existe. Ela vem com o motivo
 * escrito e sem botão. Deixar o clique passar entregaria a violação do CHECK,
 * que nomeia a constraint e não diz o que fazer.
 *
 * LIGAR NÃO RECONSTRÓI O DIÁLOGO: só as duas listas se repintam. O termo
 * buscado, o foco e a rolagem sobrevivem, senão ligar cinco folhas obrigaria a
 * digitar a busca cinco vezes.
 *
 * @param {Object} options
 * @param {Object} options.demanda - a demanda Extra-PIT
 * @param {Function} [options.onChanged] - chamada quando um vínculo muda
 */
export function openVersoesDialog({ demanda, onChanged = null } = {}) {
  const podeEscrever = isAdmin();
  let fechado = false;
  // Verdadeiro assim que um vínculo muda, e é o que decide recarregar a lista de
  // trás: `quantidade_materializada` é calculada na leitura, então a coluna "Qtd
  // materializada" fica velha até a tela reler.
  let mudou = false;
  let buscando = 0;

  const listaLigadas = el('div', { className: 'lista-versoes' });
  const listaCandidatas = el('div', { className: 'lista-versoes' });

  const resumo = el('p', { className: 'form-field__help' });

  const buscaField = createTextField({
    label: 'Procurar no acervo',
    placeholder: 'MI, INOM, nome do produto ou do lote',
    helpText: 'Mostra no máximo 50 folhas. Refine o termo se não achar.',
    onInput: () => agendarBusca(),
  });

  /**
   * A folha como uma pessoa a chama: MI, INOM ou nome.
   *
   * MI e INOM antes do nome, que é como a folha do SCN é chamada; o nome só
   * identifica o produto especial, que é justamente o que não tem MI. Mesma
   * ordem do resumo de auditoria.
   */
  function identidade(v) {
    return v.mi || v.inom || v.produto || v.nome || `Versão ${v.id}`;
  }

  function detalhe(v) {
    const partes = [`Versão ${v.versao}`];
    if (v.nome) partes.push(v.nome);
    if (v.lote) partes.push(`Lote ${v.lote}`);
    if (v.data_edicao) {
      partes.push(String(v.data_edicao).slice(0, 10).split('-').reverse().join('/'));
    }
    return partes.join(' - ');
  }

  /**
   * O motivo de a folha não poder receber esta demanda, ou null.
   *
   * O CHECK do banco recusa `meta_pit_id` e `demanda_extra_id` juntos. Ler o
   * motivo aqui é o que troca "violates check constraint" por uma frase que diz
   * onde desfazer o vínculo.
   */
  function bloqueio(v) {
    if (v.meta_pit_id != null) {
      const codigo = codigoMetaPit({ numero_meta: v.meta_numero, item: v.meta_item });
      const meta = codigo ? `a meta ${codigo}` : 'uma meta';
      return `Já cumpre ${meta} do PIT de ${v.meta_ano}. A mesma folha não conta `
        + 'nos dois lugares: desligue a meta na tela do produto antes.';
    }
    if (v.demanda_extra_id != null) {
      return 'Já materializa outra demanda Extra-PIT. Desligue-a de lá antes.';
    }
    return null;
  }

  function linha(v, { acao, motivo }) {
    return el('div', { className: `lista-versoes__item${motivo ? ' lista-versoes__item--bloqueado' : ''}` }, [
      el('div', { className: 'lista-versoes__texto' }, [
        el('strong', { textContent: identidade(v) }),
        el('span', { className: 'lista-versoes__detalhe', textContent: detalhe(v) }),
        motivo ? el('span', { className: 'lista-versoes__motivo', textContent: motivo }) : null,
      ].filter(Boolean)),
      acao,
    ].filter(Boolean));
  }

  function vazio(texto) {
    return el('p', { className: 'form-field__help', textContent: texto });
  }

  async function carregarLigadas() {
    try {
      const dados = await getVersoesExtraPit(demanda.id);
      if (fechado) return;
      pintarLigadas(dados || []);
    } catch (err) {
      if (fechado) return;
      listaLigadas.replaceChildren(
        vazio(err.message || 'Erro ao carregar as versões da demanda')
      );
    }
  }

  function pintarLigadas(versoes) {
    resumo.textContent = versoes.length === 0
      ? `Nenhuma versão do acervo materializa esta demanda. A demanda promete ${demanda.quantidade} ${demanda.tipo_produto}.`
      : `${versoes.length} versão(ões) materializam esta demanda, que promete ${demanda.quantidade} ${demanda.tipo_produto}.`;

    if (versoes.length === 0) {
      listaLigadas.replaceChildren(
        vazio('Ligue abaixo as folhas do acervo que cumprem esta demanda.')
      );
      return;
    }

    listaLigadas.replaceChildren(...versoes.map(v => linha(v, {
      motivo: null,
      acao: podeEscrever
        ? el('button', {
          className: 'btn btn--text btn--danger',
          type: 'button',
          title: 'Desligar da demanda',
          onClick: () => desligar(v),
        }, [svgIcon(ICONS.delete, 16), 'Desligar'])
        : null,
    })));
  }

  /**
   * A busca com atraso, e o descarte da resposta velha.
   *
   * `buscando` numera as chamadas: quem digita rápido dispara várias, e sem o
   * número a resposta da busca ANTERIOR poderia chegar depois e repintar a
   * lista com o termo errado.
   */
  let timer = null;
  function agendarBusca() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => carregarCandidatas(), 300);
  }

  async function carregarCandidatas() {
    const minha = ++buscando;
    const termo = buscaField.getValue();
    try {
      const dados = await getVersoesCandidatasExtraPit(demanda.id, termo);
      if (fechado || minha !== buscando) return;
      pintarCandidatas(dados || []);
    } catch (err) {
      if (fechado || minha !== buscando) return;
      listaCandidatas.replaceChildren(
        vazio(err.message || 'Erro ao procurar versões no acervo')
      );
    }
  }

  function pintarCandidatas(versoes) {
    if (versoes.length === 0) {
      listaCandidatas.replaceChildren(vazio('Nenhuma folha do acervo casa com o termo.'));
      return;
    }

    listaCandidatas.replaceChildren(...versoes.map(v => {
      const motivo = bloqueio(v);
      return linha(v, {
        motivo,
        acao: podeEscrever && !motivo
          ? el('button', {
            className: 'btn btn--text',
            type: 'button',
            title: 'Ligar a esta demanda',
            onClick: () => ligar(v),
          }, [svgIcon(ICONS.add, 16), 'Ligar'])
          : null,
      });
    }));
  }

  async function ligar(v) {
    try {
      await associarVersaoExtraPit(demanda.id, v.id);
      if (fechado) return;
      mudou = true;
      showSuccess(`${identidade(v)} ligada à demanda`);
      await Promise.all([carregarLigadas(), carregarCandidatas()]);
    } catch (err) {
      showError(err.message || 'Erro ao ligar a versão à demanda');
    }
  }

  async function desligar(v) {
    try {
      await desassociarVersaoExtraPit(demanda.id, v.id);
      if (fechado) return;
      mudou = true;
      showSuccess(`${identidade(v)} desligada da demanda`);
      await Promise.all([carregarLigadas(), carregarCandidatas()]);
    } catch (err) {
      showError(err.message || 'Erro ao desligar a versão da demanda');
    }
  }

  const content = el('div', {}, [
    resumo,
    el('h3', { className: 'form-section__title', textContent: 'Versões ligadas' }),
    listaLigadas,
    podeEscrever
      ? el('div', {}, [
        el('h3', { className: 'form-section__title', textContent: 'Ligar outra versão' }),
        buscaField.element,
        listaCandidatas,
      ])
      : null,
  ].filter(Boolean));

  openModal({
    title: `Acervo da demanda: ${demanda.tipo_produto} (${demanda.demandante})`,
    content,
    width: '720px',
    onClose: () => {
      fechado = true;
      if (timer) clearTimeout(timer);
      // Só recarrega a lista de trás se alguma coisa mudou: recarregar à toa
      // faria a tabela piscar e perder a página em que a pessoa estava.
      if (mudou && onChanged) onChanged();
    },
    actions: [
      { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
    ],
  });

  carregarLigadas();
  if (podeEscrever) carregarCandidatas();
}
