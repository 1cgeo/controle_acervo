import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createTextField, createTextareaField } from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { getEtiquetaEnvio, salvarEtiquetaEnvio } from '@modules/mapoteca/services/mapoteca-service.js';

/**
 * Etiqueta de endereço do envio por Correios, salva no pedido.
 *
 * O procedimento (wiki_DGEO, mapoteca > Envio por Correios > Embalagem) manda
 * colar quatro documentos no rolo: declaração de conteúdo, AR, ESTA etiqueta e
 * o folder. A etiqueta era um .doc preenchido à mão, e o endereço do
 * destinatário já está cadastrado no pedido: é o único dos quatro que o sistema
 * consegue montar sozinho.
 *
 * O diálogo mostra os campos EDITÁVEIS antes de imprimir, de propósito. O
 * endereço do pedido é texto livre, digitado do DIEx, e o próprio procedimento
 * manda conferir o endereço antes de imprimir. Imprimir direto do cadastro
 * transformaria erro de digitação em pacote devolvido.
 *
 * A etiqueta NÃO é descartável: ela é gravada em `mapoteca.etiqueta_envio` (uma
 * por pedido), e o botão Imprimir só libera quando a tela bate com o que está
 * salvo. Montando o HTML e imprimindo sem gravar, quem tira a segunda via
 * redigita a mesma correção.
 */

/**
 * Remetente fixo: é sempre a mapoteca da DGEO do 1º CGEO.
 *
 * Endereço POSTAL público, o mesmo que vai impresso em todo pacote que sai
 * daqui e no folder que acompanha o pedido. Não é informação de conexão (host,
 * IP, pasta de rede) nem segredo, então mora no código e não no `config.env`.
 * Se a OM mudar de endereço, o conserto é aqui, num lugar só.
 */
export const REMETENTE = {
  nome: '1º Centro de Geoinformação - Mapoteca',
  linhas: [
    'Rua Cleveland, 250 - Santa Tereza',
    '90850-240 - Porto Alegre - RS',
  ],
  telefone: '(51) 3232-0742',
};

/** Só os dígitos do primeiro CEP que aparecer no texto ('' quando não houver). */
export function extrairCep(texto) {
  const achado = String(texto || '').match(/(\d{5})-?(\d{3})/);
  return achado ? achado[1] + achado[2] : '';
}

/** Linhas não vazias do endereço, na ordem digitada. */
export function linhasEndereco(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Documento HTML autossuficiente da etiqueta, pronto para impressão em A4.
 *
 * Autossuficiente porque ele é impresso num iframe próprio: nada do CSS da
 * interface entra ali, e assim o tema escuro, a sidebar e a tipografia da tela
 * não têm como vazar para o papel.
 * @param {{destinatario:string, aosCuidados?:string, endereco?:string,
 *   cep?:string, referencia?:string}} dados
 * @returns {string}
 */
export function montarEtiquetaHtml({ destinatario, aosCuidados, endereco, cep, referencia } = {}) {
  const digitos = extrairCep(cep) || String(cep || '').replace(/\D/g, '').slice(0, 8);
  const celulas = digitos.length === 8
    ? digitos.split('').map((d, i) => (
      `${i === 5 ? '<span class="cep__traco">-</span>' : ''}<span class="cep__digito">${escapar(d)}</span>`
    )).join('')
    : '';

  const linhas = linhasEndereco(endereco)
    .map((linha) => `<div class="bloco__linha">${escapar(linha)}</div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Etiqueta de envio${referencia ? ' - ' + escapar(referencia) : ''}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  .etiqueta { border: 2px solid #000; padding: 8mm; }
  .rotulo { font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: .5pt; }
  .bloco { margin-bottom: 10mm; }
  .bloco__ac { font-size: 13pt; font-weight: bold; margin-top: 2mm; }
  .bloco__nome { font-size: 20pt; font-weight: bold; line-height: 1.2; margin-top: 2mm; }
  .bloco__linha { font-size: 14pt; line-height: 1.5; }
  .cep { margin-top: 4mm; display: flex; align-items: center; gap: 1.5mm; }
  .cep__digito { border: 1px solid #000; width: 8mm; height: 10mm; font-size: 14pt;
    display: inline-flex; align-items: center; justify-content: center; }
  .cep__traco { font-size: 14pt; padding: 0 1mm; }
  .remetente { border-top: 1px solid #000; padding-top: 5mm; }
  .remetente__nome { font-size: 12pt; font-weight: bold; }
  .remetente__linha { font-size: 11pt; line-height: 1.4; }
  .referencia { margin-top: 4mm; font-size: 9pt; color: #333; }
</style>
</head>
<body>
  <div class="etiqueta">
    <div class="bloco">
      <div class="rotulo">Destinatário</div>
      ${aosCuidados ? `<div class="bloco__ac">A/C ${escapar(aosCuidados)}</div>` : ''}
      <div class="bloco__nome">${escapar(destinatario)}</div>
      ${linhas}
      ${celulas ? `<div class="cep">${celulas}</div>` : ''}
    </div>
    <div class="remetente">
      <div class="rotulo">Remetente</div>
      <div class="remetente__nome">${escapar(REMETENTE.nome)}</div>
      ${REMETENTE.linhas.map((l) => `<div class="remetente__linha">${escapar(l)}</div>`).join('')}
      <div class="remetente__linha">Tel.: ${escapar(REMETENTE.telefone)}</div>
    </div>
    ${referencia ? `<div class="referencia">${escapar(referencia)}</div>` : ''}
  </div>
</body>
</html>`;
}

/**
 * Imprime o HTML num iframe descartável.
 *
 * Iframe, e não `window.open`: aba nova morre no bloqueador de pop-up e o
 * `document.write` numa janela filha depende de o navegador manter o mesmo
 * documento. O iframe é do nosso documento, então a impressão sai na hora e o
 * elemento se remove depois.
 * @param {string} html
 */
export function imprimirHtml(html) {
  const frame = el('iframe', {
    style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' },
  });
  frame.setAttribute('aria-hidden', 'true');
  frame.srcdoc = html;

  frame.addEventListener('load', () => {
    const janela = frame.contentWindow;
    if (!janela || typeof janela.print !== 'function') return;
    janela.focus();
    janela.print();
    // A remoção espera o fim do diálogo do navegador: remover no mesmo tique
    // cancela a impressão em alguns navegadores, porque o documento morre antes
    // de o diálogo abrir.
    setTimeout(() => frame.remove(), 1000);
  });

  document.body.appendChild(frame);
  return frame;
}

/**
 * Os quatro campos da etiqueta, com o mesmo formato dos dois lados da comparação.
 *
 * A tela e o banco usam nomes diferentes (aosCuidados x aos_cuidados) e o banco
 * guarda NULL onde a tela tem ''. Sem normalizar, a etiqueta recém-salva já
 * apareceria como "diferente do salvo" e o botão Imprimir nunca liberaria.
 * @param {Object} origem
 * @returns {{destinatario:string, aosCuidados:string, endereco:string, cep:string}}
 */
function normalizarCampos(origem) {
  const texto = (valor) => String(valor === null || valor === undefined ? '' : valor).trim();
  return {
    destinatario: texto(origem.destinatario),
    aosCuidados: texto(origem.aosCuidados !== undefined ? origem.aosCuidados : origem.aos_cuidados),
    endereco: texto(origem.endereco),
    cep: texto(origem.cep),
  };
}

/** Verdadeiro quando os quatro campos batem. */
function camposIguais(a, b) {
  if (!a || !b) return false;
  return a.destinatario === b.destinatario
    && a.aosCuidados === b.aosCuidados
    && a.endereco === b.endereco
    && a.cep === b.cep;
}

/**
 * Diálogo da etiqueta: campos editáveis, prévia, gravação e impressão.
 * @param {Object} pedido - o pedido da rota GET /mapoteca/pedido/:id
 */
export function openEtiquetaEnvioDialog(pedido = {}) {
  // O endereço do PEDIDO manda; o do cadastro do cliente é a reserva. É a mesma
  // ordem dos dois pontos de contato, e pela mesma razão: o do pedido veio no
  // documento que pediu.
  const enderecoInicial = pedido.endereco_entrega || pedido.cliente_endereco_entrega || '';
  const contatoInicial = pedido.ponto_contato || pedido.cliente_ponto_contato || '';

  const destinatario = createTextField({
    label: 'Destinatário',
    value: pedido.cliente_nome || '',
    required: true,
  });
  const aosCuidados = createTextField({
    label: 'A/C (ao cuidado de)',
    value: contatoInicial,
    helpText: 'Militar que pediu a carta, quando houver. Ex.: Cap Ronaldo.',
  });
  const endereco = createTextareaField({
    label: 'Endereço',
    value: enderecoInicial,
    rows: 4,
    helpText: 'Uma linha por linha da etiqueta. Confira o endereço antes de imprimir.',
  });
  const cep = createTextField({
    label: 'CEP',
    value: (() => {
      const digitos = extrairCep(enderecoInicial);
      return digitos ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : '';
    })(),
    helpText: 'Sai nos oito quadrados da etiqueta. Em branco, os quadrados não aparecem.',
  });

  const previa = el('iframe', {
    className: 'etiqueta-previa',
    title: 'Prévia da etiqueta',
  });

  // A referência sai do PEDIDO, e não da etiqueta salva: ela é o localizador que
  // liga o papel ao registro, e não um campo que alguém corrige.
  const referencia = pedido.localizador_pedido
    ? `Pedido ${pedido.localizador_pedido}`
    : (pedido.id ? `Pedido #${pedido.id}` : '');

  function camposDaTela() {
    return normalizarCampos({
      destinatario: destinatario.getValue(),
      aosCuidados: aosCuidados.getValue(),
      endereco: endereco.getValue(),
      cep: cep.getValue(),
    });
  }

  function atualizarPrevia() {
    // A prévia acompanha a EDIÇÃO, e não o que está salvo: ela existe para a
    // pessoa ver o efeito do conserto antes de gravar.
    previa.srcdoc = montarEtiquetaHtml({ ...camposDaTela(), referencia });
  }

  // --- A trava do botão Imprimir --------------------------------------------
  //
  // A trava vale SEMPRE, inclusive na primeira abertura e sem edição nenhuma.
  // Liberar a primeira impressão "porque nada
  // mudou" criaria a exceção que ninguém lembra: o papel colado no pacote
  // deixaria de ter registro, e a segunda via sairia de outra fonte. Com a trava
  // sem exceção, o que foi impresso é sempre o que está registrado.
  //
  // `salvo` é o que o SERVIDOR devolveu, nunca o que a tela mandou. Campo que o
  // banco recusou ou truncou aparece como diferença e mantém o botão travado,
  // em vez de imprimir um endereço que não foi gravado.
  let salvo = null;
  let carregando = Boolean(pedido.id);
  let salvando = false;
  // Só sobrescreve os campos com a etiqueta salva se a pessoa ainda não digitou:
  // a leitura é assíncrona, e apagar o que ela acabou de escrever seria pior do
  // que exigir um Salvar a mais.
  let tocado = false;

  const aviso = el('div', { className: 'form-field__help etiqueta-dialogo__aviso' });

  function mensagemDaTrava() {
    if (!pedido.id) {
      return 'Este pedido não foi identificado, então a etiqueta não pode ser salva nem impressa.';
    }
    if (carregando) {
      return 'Carregando a etiqueta salva deste pedido. Imprimir libera em seguida.';
    }
    if (salvando) {
      return 'Salvando a etiqueta.';
    }
    if (!salvo) {
      return 'Imprimir libera depois de Salvar: este pedido ainda não tem etiqueta salva. '
        + 'O sistema só imprime o que está registrado.';
    }
    if (!camposIguais(camposDaTela(), salvo)) {
      return 'Imprimir libera depois de Salvar: há mudanças na tela que ainda não foram salvas.';
    }
    return 'Etiqueta salva. O que sai impresso é o que está registrado no pedido.';
  }

  function atualizarTrava() {
    const liberado = Boolean(pedido.id) && !carregando && !salvando
      && camposIguais(camposDaTela(), salvo);
    btnImprimir.disabled = !liberado;
    btnSalvar.disabled = !pedido.id || carregando || salvando;
    aviso.textContent = mensagemDaTrava();
    // O aviso de botão travado é a explicação, não um erro do preenchimento.
    aviso.classList.toggle('etiqueta-dialogo__aviso--ok', liberado);
  }

  const semEndereco = el('div', {
    className: 'form-field__help',
    textContent: 'O pedido não tem endereço de entrega, e o cadastro do cliente '
      + 'também não. Digite o endereço abaixo.',
  });

  function atualizarAvisoEndereco() {
    // Recalculado, e não decidido só na abertura: o endereço pode chegar depois,
    // vindo da etiqueta salva, e o aviso mentiria na tela.
    semEndereco.classList.toggle('hidden', Boolean(endereco.getValue()));
  }

  [destinatario, aosCuidados, endereco, cep].forEach((campo) => {
    campo.input.addEventListener('input', () => {
      tocado = true;
      atualizarPrevia();
      atualizarAvisoEndereco();
      atualizarTrava();
    });
  });
  atualizarPrevia();
  atualizarAvisoEndereco();

  const content = el('div', { className: 'etiqueta-dialogo' }, [
    el('div', { className: 'etiqueta-dialogo__campos' }, [
      semEndereco,
      destinatario.element,
      aosCuidados.element,
      endereco.element,
      cep.element,
      aviso,
    ]),
    el('div', { className: 'etiqueta-dialogo__previa' }, [
      el('div', { className: 'form-field__label', textContent: 'Prévia' }),
      previa,
    ]),
  ]);

  async function salvar() {
    destinatario.setError(null);
    if (!destinatario.getValue()) {
      destinatario.setError('Campo obrigatório');
      return;
    }

    salvando = true;
    atualizarTrava();

    try {
      const atual = camposDaTela();
      const gravado = await salvarEtiquetaEnvio(pedido.id, {
        destinatario: atual.destinatario,
        aos_cuidados: atual.aosCuidados,
        endereco: atual.endereco,
        cep: atual.cep,
      });
      // Lê o que o servidor devolveu, e não o que se mandou: é o que prova a
      // gravação. Se o destino ignorar um campo, a diferença aparece aqui e o
      // botão Imprimir continua travado.
      salvo = normalizarCampos(gravado || {});
      showSuccess('Etiqueta salva');
    } catch (err) {
      showError(err.message || 'Erro ao salvar a etiqueta');
    } finally {
      salvando = false;
      atualizarTrava();
    }
  }

  const modal = openModal({
    title: 'Etiqueta de envio',
    content,
    width: '900px',
    actions: [
      { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
      { label: 'Salvar', variant: 'secondary', onClick: () => salvar() },
      {
        label: 'Imprimir',
        variant: 'primary',
        onClick: () => {
          // Imprime o que está SALVO, e não o que está na tela. Com a trava, os
          // dois são iguais neste ponto; imprimir do registro deixa isso valendo
          // mesmo se um caminho novo esquecer de travar o botão.
          imprimirHtml(montarEtiquetaHtml({ ...salvo, referencia }));
        },
      },
    ],
  });

  // O openModal monta os botões do rodapé a partir das ações e não devolve
  // referência a eles. Achar pelo rótulo dentro do PRÓPRIO diálogo é estável e
  // não alcança botão de outra tela.
  const acao = (rotulo) => [...modal.element.querySelectorAll('.modal__footer button')]
    .find((b) => b.textContent.trim() === rotulo);
  const btnSalvar = acao('Salvar');
  const btnImprimir = acao('Imprimir');

  atualizarTrava();

  if (pedido.id) {
    getEtiquetaEnvio(pedido.id)
      .then((etiqueta) => {
        if (etiqueta) {
          salvo = normalizarCampos(etiqueta);
          if (!tocado) {
            destinatario.setValue(salvo.destinatario);
            aosCuidados.setValue(salvo.aosCuidados);
            endereco.setValue(salvo.endereco);
            cep.setValue(salvo.cep);
            atualizarPrevia();
            atualizarAvisoEndereco();
          }
        }
      })
      .catch((err) => {
        // Falha na leitura mantém o botão travado, e o texto diz o porquê. Sem a
        // etiqueta salva não há como afirmar que o papel bate com o registro.
        showError(err.message || 'Erro ao carregar a etiqueta salva');
      })
      .finally(() => {
        carregando = false;
        atualizarTrava();
      });
  }

  return modal;
}
