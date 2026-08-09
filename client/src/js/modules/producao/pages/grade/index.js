import { el, clearChildren } from '@utils/dom.js';
import { createSelectField, createTextField } from '@components/form-fields/form-fields.js';
import { estadoErro } from '@components/estado-erro.js';
import { getGradeAcompanhamento } from '@services/producao-service.js';
import './grade.css';

/** Timestamp do banco em dia e hora locais. Nulo vira '-'. */
const quando = (valor) => {
  if (!valor) return '-';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * Há quantos dias a atividade está aberta.
 *
 * O NÚMERO É O QUE SE LÊ NESTA TELA. `data_inicio` sozinho responde "quando
 * pegou"; quem olha a grade quer saber "há quanto tempo está nisso", e essa
 * conta ninguém faz de cabeça com trinta cartões na tela.
 */
const diasCorridos = (valor) => {
  if (!valor) return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  return dias >= 0 ? dias : null;
};

const textoDeDias = (dias) => {
  if (dias === null) return '';
  if (dias === 0) return 'hoje';
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
};

const normalizar = (v) => String(v ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

/** Opções de um filtro, a partir dos valores distintos de uma coluna. */
const opcoesDe = (linhas, campo) => [...new Set(
  linhas.map(l => l[campo]).filter(v => v !== null && v !== undefined && v !== ''),
)].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
  .map(v => ({ value: v, label: String(v) }));

/**
 * GRADE DE ACOMPANHAMENTO (#/producao/grade): quem está com o quê, agora.
 *
 * A MALHA NÃO VEM, E A TELA DIZ ISSO NA CARA. `/api/acompanhamento
 * /grade_acompanhamento` devolve toda atividade com `grade: null` e o motivo em
 * `grade_indisponivel`: o quadriculado de revisão mora no banco de PRODUÇÃO, e
 * este servidor tem uma conexão só (`database/db.js` expõe `createConn`, e a
 * decisão de não abrir uma segunda está em `docs/decisoes.md`). O motivo sobe
 * para uma faixa no topo, com as palavras do servidor, e cada cartão marca o
 * lugar onde o quadriculado entraria.
 *
 * A ALTERNATIVA ERA PIOR DE DUAS FORMAS. Esconder as atividades deixaria a tela
 * vazia, e tela vazia aqui se lê como "ninguém está revisando" -- que é a
 * afirmação oposta à verdadeira. E desenhar um quadriculado inventado seria
 * afirmar progresso que ninguém mediu.
 *
 * NENHUMA CÉLULA RECEBE COR, e isso é decisão e não esquecimento. A convenção de
 * cor desta casa é a de `#/execucao_pit`: a cor compara o ACUMULADO com o que
 * foi prometido até ali, e mês corrente e futuro ficam neutros porque não há o
 * que cobrar. Aqui não existe nem acumulado nem promessa -- existe uma
 * atividade aberta e uma malha que não chegou. Pintar por tempo aberto seria uma
 * TERCEIRA convenção de cor no mesmo sistema, com a mesma paleta significando
 * outra coisa. O tempo aberto entra como número, que é o que ele é.
 *
 * OS CARTÕES SÃO A FORMA DA ORIGEM, e ficam. No SAP cada atividade em revisão é
 * um cartão com o projeto e o lote no alto, a malha no meio e a ficha embaixo
 * (operador, fase, bloco, subfase, etapa e início). Quem trabalha no SAP procura
 * a atividade pelo cartão dela.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderGrade(container) {
  let disposed = false;

  let atividades = [];
  const filtros = { projeto: null, lote: null, subfase: null, busca: '' };
  let debounce = null;

  const projetoFilter = createSelectField({
    label: 'Projeto',
    options: [],
    placeholder: 'Todos',
    value: null,
    onChange: (v) => { filtros.projeto = v; desenhar(); },
  });

  const loteFilter = createSelectField({
    label: 'Lote',
    options: [],
    placeholder: 'Todos',
    value: null,
    onChange: (v) => { filtros.lote = v; desenhar(); },
  });

  const subfaseFilter = createSelectField({
    label: 'Subfase',
    options: [],
    placeholder: 'Todas',
    value: null,
    onChange: (v) => { filtros.subfase = v; desenhar(); },
  });

  // A BUSCA É DAQUI, e não do servidor: a rota não recebe filtro nenhum, e o
  // conjunto é o das atividades ABERTAS, que cabe na memória do navegador.
  const buscaFilter = createTextField({
    label: 'Buscar',
    placeholder: 'Operador, etapa, bloco…',
    onInput: (v) => {
      filtros.busca = v;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { if (!disposed) desenhar(); }, 250);
    },
  });

  const aviso = el('div', { className: 'grade-prod__aviso hidden', role: 'status' });
  const resumo = el('p', { className: 'grade-prod__resumo' });
  const galeria = el('div', { className: 'grade-prod__galeria' });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Grade de acompanhamento' }),
    ]),
    el('div', { className: 'page__filters' }, [
      projetoFilter.element, loteFilter.element, subfaseFilter.element, buscaFilter.element,
    ]),
    aviso,
    resumo,
    galeria,
  ]);
  container.appendChild(page);

  /**
   * A faixa que explica a malha que não veio.
   *
   * O TEXTO É O DO SERVIDOR, palavra por palavra. Reescrevê-lo aqui criaria
   * duas explicações para o mesmo fato, e no dia em que a segunda conexão
   * existir a rota deixa de mandar o motivo e a faixa some sozinha -- uma frase
   * escrita nesta tela continuaria mentindo.
   */
  function montarAviso() {
    const motivos = [...new Set(
      atividades.map(a => a.grade_indisponivel).filter(Boolean),
    )];
    clearChildren(aviso);
    if (!motivos.length) {
      aviso.classList.add('hidden');
      return;
    }
    aviso.classList.remove('hidden');
    aviso.append(
      el('p', {
        className: 'grade-prod__aviso-titulo',
        textContent: 'A malha de revisão não veio junto',
      }),
      ...motivos.map(m => el('p', { className: 'grade-prod__aviso-texto', textContent: m })),
      el('p', {
        className: 'grade-prod__aviso-texto',
        textContent: 'As atividades abaixo são reais e estão em execução agora: '
          + 'o que falta é só o quadriculado de cada uma.',
      }),
    );
  }

  const passaNoFiltro = (a) => {
    if (filtros.projeto && a.projeto !== filtros.projeto) return false;
    if (filtros.lote && a.lote !== filtros.lote) return false;
    if (filtros.subfase && a.subfase !== filtros.subfase) return false;
    if (!filtros.busca) return true;
    const alvo = normalizar([
      a.usuario, a.etapa, a.subfase, a.fase, a.bloco, a.lote, a.projeto,
    ].join(' '));
    return alvo.includes(normalizar(filtros.busca));
  };

  /**
   * O lugar do quadriculado, marcado e vazio.
   *
   * A MOLDURA FICA. Sem ela o cartão vira uma ficha de texto, e a tela deixa de
   * dizer que falta alguma coisa ali -- o `title` repete o motivo para quem
   * chegou ao cartão sem passar pela faixa do topo.
   */
  const malhaAusente = (a) => el('div', {
    className: 'grade-prod__malha',
    title: a.grade_indisponivel || 'Malha indisponível',
  }, [
    el('p', { className: 'grade-prod__malha-texto', textContent: 'Malha indisponível' }),
  ]);

  const cartao = (a) => {
    const dias = diasCorridos(a.data_inicio);
    return el('article', { className: 'grade-prod__card' }, [
      el('header', { className: 'grade-prod__cabecalho' }, [
        el('p', { className: 'grade-prod__projeto', textContent: a.projeto || '-' }),
        el('p', { className: 'grade-prod__lote', textContent: a.lote || '-' }),
      ]),
      malhaAusente(a),
      el('footer', { className: 'grade-prod__rodape' }, [
        el('p', { className: 'grade-prod__operador', textContent: a.usuario || '-' }),
        el('p', {
          className: 'grade-prod__linha',
          textContent: [a.fase, a.bloco].filter(Boolean).join(' · ') || '-',
        }),
        el('p', {
          className: 'grade-prod__linha',
          textContent: [a.subfase, a.etapa].filter(Boolean).join(' · ') || '-',
        }),
        el('p', { className: 'grade-prod__inicio' }, [
          el('span', { textContent: `Início: ${quando(a.data_inicio)}` }),
          dias === null ? null : el('span', {
            className: 'grade-prod__dias',
            textContent: textoDeDias(dias),
          }),
        ]),
      ]),
    ]);
  };

  function desenhar() {
    const visiveis = atividades.filter(passaNoFiltro);

    clearChildren(galeria);
    if (!atividades.length) {
      resumo.textContent = '';
      galeria.appendChild(el('p', {
        className: 'grade-prod__vazio',
        textContent: 'Nenhuma atividade em execução com malha de revisão a acompanhar.',
      }));
      return;
    }

    // O RESUMO DIZ OS DOIS NÚMEROS quando há filtro: "12 de 40" separa "há
    // pouca coisa" de "eu escondi o resto", e os dois se leem igual no
    // contador de um número só.
    resumo.textContent = visiveis.length === atividades.length
      ? `${atividades.length} atividade(s) em execução.`
      : `${visiveis.length} de ${atividades.length} atividade(s) em execução.`;

    if (!visiveis.length) {
      galeria.appendChild(el('p', {
        className: 'grade-prod__vazio',
        textContent: 'Nenhuma atividade para estes filtros.',
      }));
      return;
    }
    for (const a of visiveis) galeria.appendChild(cartao(a));
  }

  async function carregar() {
    clearChildren(galeria);
    galeria.appendChild(el('p', { className: 'grade-prod__vazio', textContent: 'Carregando…' }));
    try {
      const dados = await getGradeAcompanhamento();
      if (disposed) return;
      // A rota já ordena por `data_inicio`. A ordem daqui é a INVERSA, como na
      // origem: quem pegou por último aparece primeiro, porque é a atividade
      // que ainda está mudando.
      atividades = [...(dados || [])].reverse();
      projetoFilter.setOptions(opcoesDe(atividades, 'projeto'));
      loteFilter.setOptions(opcoesDe(atividades, 'lote'));
      subfaseFilter.setOptions(opcoesDe(atividades, 'subfase'));
      montarAviso();
      desenhar();
    } catch (err) {
      if (disposed) return;
      // O ERRO FICA NO LUGAR DA GALERIA, e a faixa da malha some: as duas coisas
      // são diferentes. A faixa diz "o quadriculado não veio, o resto veio"; o
      // erro diz "não consegui perguntar nada". Deixar a faixa ao lado do erro
      // sugeriria que a lista abaixo é verdadeira, e ela nem existe.
      atividades = [];
      aviso.classList.add('hidden');
      resumo.textContent = '';
      clearChildren(galeria);
      galeria.appendChild(estadoErro(err, carregar));
    }
  }

  await carregar();

  return () => {
    disposed = true;
    if (debounce) clearTimeout(debounce);
  };
}
