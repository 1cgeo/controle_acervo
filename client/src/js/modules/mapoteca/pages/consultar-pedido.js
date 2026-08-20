import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { getPedidoPorLocalizador } from '@modules/mapoteca/services/mapoteca-service.js';
import { chipSituacaoPedido } from '@components/status-chip.js';
import { formatDate } from '@utils/format.js';
import { isValidLocalizador, normalizeLocalizador } from '@utils/localizador.js';
import { randomBackground } from '@utils/backgrounds.js';
import { PREFIXO_API } from '@utils/base-path.js';

// Situacao a partir da qual o material JA SAIU: 4 Remetido, 5 Concluido.
const SITUACAO_REMETIDO = 4;
const SITUACAO_CONCLUIDO = 5;
const SITUACAO_CANCELADO = 6;

/**
 * Numero mais substantivo no plural certo.
 *
 * O "(s)" e o "(es)" eram do gerador, e nao do portugues: numa tela que o
 * solicitante le, "1 carta(s)" denuncia texto montado por maquina. O plural de
 * `exemplar` e `exemplares`, e nao serve o `s` colado, entao a forma plural vem
 * escrita e nao deduzida.
 *
 * Zero vai no PLURAL ("0 cartas"), que e o portugues corrente.
 */
function plural(n, singular, pluralForma) {
  return `${n} ${Number(n) === 1 ? singular : pluralForma}`;
}

function infoRow(label, value) {
  return el('div', { className: 'consulta-info__row' }, [
    el('span', { className: 'consulta-info__label', textContent: label }),
    value instanceof Node
      ? el('span', { className: 'consulta-info__value' }, [value])
      : el('span', { className: 'consulta-info__value', textContent: value ?? '-' }),
  ]);
}

/**
 * Consulta publica de pedido, sem sessao (RN04). Rota de PLATAFORMA, registrada
 * em src/js/index.js como '#/consultar-pedido' e '#/consultar-pedido/:localizador'.
 * Valida o formato XXXX-XXXX-XXXX, busca o pedido e mostra o cartao com a
 * situacao, as datas, o cliente, o rastreio e o motivo do cancelamento.
 * Sem localizador na URL, a tela abre so com o campo de busca.
 * @param {HTMLElement} container
 * @param {{params: {localizador?: string}}} ctx
 */
export async function renderConsultarPedido(container, { params = {} } = {}) {
  const localizador = normalizeLocalizador(params.localizador);

  const resultArea = el('div');

  // Lookup another localizador
  const otherInput = el('input', {
    className: 'form-field__input',
    type: 'text',
    placeholder: 'XXXX-XXXX-XXXX',
    maxLength: '14',
    'aria-label': 'Localizador do pedido',
  });

  const otherForm = el('form', { className: 'consulta-card__form' }, [
    otherInput,
    el('button', { className: 'btn btn--primary', type: 'submit', textContent: 'Consultar' }),
  ]);

  otherForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = normalizeLocalizador(otherInput.value);
    if (!isValidLocalizador(value)) {
      showMessage('Formato inválido. Use o padrão XXXX-XXXX-XXXX (letras e números).', 'warning');
      return;
    }
    location.hash = `/consultar-pedido/${value}`;
  });

  const card = el('div', { className: 'consulta-card' }, [
    el('div', { className: 'consulta-card__header' }, [
      el('div', {}, [
        el('div', { className: 'consulta-card__title', textContent: 'Acompanhamento de Pedido' }),
        // A linha do localizador so entra quando ha localizador. Vazia, ela
        // abria uma faixa em branco sob o titulo, na PRIMEIRA tela que o
        // cliente externo ve.
        localizador
          ? el('div', { className: 'consulta-card__localizador', textContent: localizador })
          : null,
      ]),
      svgIcon(ICONS.localShipping, 32),
    ]),
    resultArea,
    // Este rotulo e a UNICA instrucao da tela. Antes a
    // mesma frase saia tres vezes acima do mesmo campo: o rotulo, a mensagem da
    // area de resultado e o exemplo de formato. Ficaram o rotulo e o exemplo,
    // que mostra o formato e nao repete a frase.
    el('div', {
      className: 'consulta-info__label',
      textContent: localizador ? 'Consultar outro localizador:' : 'Informe o localizador do pedido:',
    }),
    otherForm,
    // Saida discreta de volta para a porta de entrada. Quem cai aqui por engano,
    // ou quem e da DGEO e chegou pelo link do comprovante, nao fica sem caminho:
    // a consulta e uma rota publica, e sem isto o unico jeito de voltar e editar
    // a URL. Fica no rodape e em peso leve de proposito, porque a acao principal
    // desta tela e consultar, nao entrar.
    el('a', {
      className: 'consulta-card__voltar',
      href: '#/login',
    }, [svgIcon(ICONS.arrowBack, 14), 'Voltar para a tela de entrada']),
  ]);

  const page = el('div', { className: 'consulta-page' }, [
    el('div', {
      className: 'login-page__background',
      style: { backgroundImage: `url(${randomBackground()})` },
    }),
    card,
  ]);
  container.appendChild(page);

  function showMessage(text, type = 'info') {
    clearChildren(resultArea);
    resultArea.appendChild(el('div', { className: 'consulta-card__message' }, [
      svgIcon(type === 'warning' ? ICONS.warning : ICONS.info, 20),
      el('p', { textContent: text, style: { marginTop: '8px' } }),
    ]));
  }

  function showPedido(pedido) {
    clearChildren(resultArea);

    // Resumo + informações do pedido (sempre visíveis, incluindo a observação)
    const rows = [
      infoRow('Situação', chipSituacaoPedido(pedido.situacao_pedido_id, pedido.situacao_pedido_nome)),
      infoRow('Cliente', pedido.cliente_nome),
      infoRow('Data do pedido', formatDate(pedido.data_pedido)),
      infoRow('Prazo', formatDate(pedido.prazo)),
    ];
    if (pedido.observacao) {
      rows.push(infoRow('Observação', pedido.observacao));
    }
    // A forma de entrega e do PEDIDO, e o servidor a devolve no objeto do
    // pedido. No laco do ITEM ela nao sai, porque nenhum item traz o campo: a
    // linha "Entrega" some para o cliente sem aviso nenhum.
    //
    // O ROTULO muda com o momento: enquanto o material nao saiu, o campo e uma
    // INTENCAO (vamos mandar pelos Correios), e prometer "Forma de entrega"
    // antes de despachar e prometer o que ainda pode mudar. Depois de remetido,
    // e fato.
    if (pedido.forma_entrega_nome) {
      const jaSaiu = Number(pedido.situacao_pedido_id) >= SITUACAO_REMETIDO;
      rows.push(infoRow(jaSaiu ? 'Forma de entrega' : 'Forma de envio prevista',
        pedido.forma_entrega_nome));
    }
    // Situacao do ENVIO, sempre visivel enquanto o pedido vive. Antes disto a
    // tela so falava de envio quando havia rastreio, entao quem consultava um
    // pedido em produção nao tinha como saber se ja tinha sido despachado: a
    // ausencia de linha nao diz "nao enviado", diz apenas nada. Pedido
    // cancelado nao ganha a linha, porque ali envio nao se aplica.
    if (Number(pedido.situacao_pedido_id) !== SITUACAO_CANCELADO) {
      const sit = Number(pedido.situacao_pedido_id);
      let envio = 'Não enviado';
      if (sit === SITUACAO_REMETIDO) envio = 'Enviado';
      else if (sit === SITUACAO_CONCLUIDO) envio = 'Enviado e concluído';
      rows.push(infoRow('Situação do envio', envio));
    }
    // A data que o cliente quer ver e a do envio, e ela e a data_atendimento:
    // o pedido fecha no dia em que o material sai. Nao existe coluna
    // "data_envio" de proposito. O rotulo aqui e o do CLIENTE ("envio/
    // entrega"), e nao o interno ("atendimento"), porque quem le esta tela nao
    // fala a lingua do nosso cadastro.
    if (pedido.data_atendimento) {
      rows.push(infoRow('Data de envio/entrega', formatDate(pedido.data_atendimento)));
    }
    if (pedido.localizador_envio) {
      rows.push(infoRow('Rastreio do envio', pedido.localizador_envio));
    }
    if (pedido.observacao_envio) {
      rows.push(infoRow('Observação de envio', pedido.observacao_envio));
    }
    if (pedido.motivo_cancelamento) {
      rows.push(infoRow('Motivo do cancelamento', pedido.motivo_cancelamento));
    }
    // Por ULTIMO de proposito: e o caminho de VOLTA, e quem chega aqui procura
    // isso depois de ler o resto. E a unica coisa nesta tela que responde "e
    // agora, com quem eu falo?", porque o DIEx de resposta esta na caixa de
    // quem recebeu o documento, e nao com quem consulta meses depois.
    if (pedido.contato_mapoteca) {
      rows.push(infoRow('Dúvidas sobre este pedido', pedido.contato_mapoteca));
    }
    resultArea.appendChild(el('div', { className: 'consulta-info' }, rows));

    // "O que foi pedido" (os itens) é o bloco colapsável
    showItens(pedido.produtos || []);
  }

  function itemMeta(label, value) {
    if (value == null || value === '') return null;
    return el('span', { className: 'consulta-item__meta' }, [
      el('span', { className: 'consulta-item__meta-label', textContent: `${label}: ` }),
      el('span', { className: 'consulta-item__meta-value', textContent: String(value) }),
    ]);
  }

  function showItens(produtos) {
    // Pedido SEM item cadastrado nao mostra bloco nenhum.
    // O colapsavel vazio era um convite a clicar para nao achar nada, e no
    // pedido recem-recebido (situacao 2) e no pedido de LAI, que nao usa folha
    // MI, essa e a situacao NORMAL, nao um cadastro pela metade.
    if (!produtos.length) return;

    const nExemplares = produtos.reduce((soma, r) => soma + (Number(r.quantidade) || 0), 0);
    const resumoItens = `O que foi pedido — ${plural(produtos.length, 'carta', 'cartas')}`
      + ` · ${plural(nExemplares, 'exemplar', 'exemplares')}`;

    const bloco = el('details', {
      className: 'consulta-collapse',
      style: { marginTop: 'var(--space-md)' },
    }, [
      el('summary', {
        className: 'consulta-collapse__summary consulta-info__label',
        textContent: resumoItens,
        style: { cursor: 'pointer', padding: 'var(--space-sm) 0' },
      }),
    ]);
    resultArea.appendChild(bloco);

    const itens = produtos.map((p) => {
      const titulo = p.produto_nome || p.inom || p.mi || 'Produto';
      const meta = [
        itemMeta('Escala', p.escala),
        itemMeta('Tipo', p.tipo_produto_nome),
        // A descricao do avulso e PUBLICA e o servidor a manda de proposito
        // (avulso_descricao). Ela guarda a medida do impresso ("80 x 68 cm,
        // quadricula de 4 x 4 cm"), e e a unica coisa que identifica um item
        // avulso para quem esta de fora: a carta tem MI e escala, ele nao.
        itemMeta('Descrição', p.avulso_descricao),
        itemMeta('MI', p.mi),
        itemMeta('INOM', p.inom),
        itemMeta('Versão', p.versao),
        itemMeta('Edição', p.data_edicao ? formatDate(p.data_edicao) : null),
        itemMeta('Quantidade', p.quantidade),
        itemMeta('Mídia', p.tipo_midia_nome),
      ].filter(Boolean);

      const corpo = [
        el('div', { className: 'consulta-item__title' }, [
          svgIcon(ICONS.description, 18),
          el('span', { textContent: titulo }),
        ]),
        el('div', { className: 'consulta-item__metas' }, meta),
      ];

      if (p.observacao) {
        corpo.push(el('div', { className: 'consulta-item__obs', textContent: p.observacao }));
      }

      const children = [el('div', { className: 'consulta-item__corpo' }, corpo)];

      // A MINIATURA da folha, a esquerda. Vale mais que o texto para quem
      // confere um pedido: reconhece-se a carta pela mancha antes de ler o MI.
      //
      // Vai por `src` direto, e nao pelo `apiImagem` que a ficha do acervo usa:
      // la a rota exige token, e por isso a imagem precisa vir por fetch e virar
      // blob. Aqui a rota e publica, entao o `img` simples basta, o cache do
      // navegador funciona sozinho pela etiqueta, e nao ha blob para liberar
      // depois (o vazamento que o comentario do `apiImagem` descreve).
      //
      // So entra quando `tem_miniatura`: pedir a imagem de quem nao tem gera um
      // 404 por item e um icone quebrado na tela.
      if (p.tem_miniatura && p.versao_id) {
        const url = `${PREFIXO_API}/mapoteca/pedido/localizador/`
          + `${encodeURIComponent(localizador)}/miniatura/${encodeURIComponent(p.versao_id)}`;
        const img = el('img', {
          className: 'consulta-item__thumb',
          src: url,
          alt: `Miniatura de ${titulo}`,
          loading: 'lazy',
          decoding: 'async',
        });
        // Rede fora do ar ou miniatura apagada entre a consulta e o desenho:
        // some com o quadro em vez de deixar o icone de imagem quebrada.
        img.addEventListener('error', () => img.remove());
        children.unshift(img);
      }

      return el('div', { className: 'consulta-item' }, children);
    });

    bloco.appendChild(el('div', { className: 'consulta-itens' }, itens));
  }

  if (!localizador) {
    // Sem mensagem aqui: o rotulo acima do campo ja diz o que fazer, e a frase
    // repetida so empurrava o campo para baixo.
    otherInput.focus();
    return;
  }

  if (!isValidLocalizador(localizador)) {
    showMessage('Localizador em formato inválido. Use o padrão XXXX-XXXX-XXXX (letras e números).', 'warning');
    return;
  }

  showMessage('Consultando pedido...');

  try {
    const pedido = await getPedidoPorLocalizador(localizador);
    showPedido(pedido);
  } catch (err) {
    showMessage(err.message || 'Pedido não encontrado.', 'warning');
  }
}
