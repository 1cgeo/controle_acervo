import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  createNumberField,
  createTextField,
  createTextareaField,
  createDateField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { corrigirTranscricaoMeta, codigoMetaPit } from '@services/plataforma-service.js';

/**
 * CORRIGIR A TRANSCRIÇÃO de uma meta do PIT.
 *
 * POR QUE ESTA TELA EXISTE. Salvar o diálogo de meta exige uma revisão ABERTA:
 * mudar descrição, quantidade, prazo ou demandante é ato da DSG. Sem revisão
 * aberta o servidor recusa com 400, e a própria mensagem dele diz "para
 * consertar um erro de digitação, use a correção de transcrição". Até aqui essa
 * correção não tinha tela nenhuma: o sistema mandava a pessoa usar algo que não
 * existia, e a única saída que sobrava era inventar uma revisão que a DSG não
 * emitiu.
 *
 * O QUE ELA FAZ, E O QUE NÃO FAZ. Ela reescreve a linha que a revisão EM VIGOR
 * declara para esta meta (`pit.meta_revisao`, er/pit.sql:219). Não cria revisão,
 * não muda a data de vigência e não toca a identidade da meta (ano, número,
 * item, unidade e origem vivem em `pit.meta`, e o diálogo de meta é que os
 * edita). É por isso que o aviso do topo separa as duas listas: o que muda e o
 * que fica.
 *
 * AÇÃO DE CONSEQUÊNCIA. O que ela reescreve foi declarado por um documento
 * ASSINADO. Por isso: o motivo é obrigatório (o Joi do servidor cobra 5
 * caracteres, `pit_schema.js`), a tela mostra campo a campo o que vai mudar
 * enquanto se digita, e a gravação só sai depois de uma confirmação que repete
 * essas mudanças.
 *
 * SÓ ADMINISTRADOR GLOBAL. A rota é `verifyAdmin` (`pit_route.js`), e a lista
 * espelha a mesma regra ao oferecer a ação.
 *
 * OS CINCO CAMPOS VÃO SEMPRE, inclusive `cancelada`. O servidor grava a
 * declaração inteira e trata campo ausente como padrão: sem `cancelada` no
 * corpo, corrigir uma vírgula DESCANCELARIA a meta que a DSG cancelou.
 *
 * @param {Object} opcoes
 * @param {Object} opcoes.meta - a linha de `pit.meta_vigente` que a lista tem.
 * @param {Function} [opcoes.onSaved] - chamado após a gravação dar certo.
 */
export function openTranscricaoDialog({ meta, onSaved = null } = {}) {
  const codigo = codigoMetaPit(meta);
  const revisao = meta.revisao || 'em vigor';

  // O ESTADO ANTERIOR, normalizado. É contra ele que o painel de mudanças
  // compara, então ele precisa ter a mesma forma que os campos devolvem: data
  // fatiada em 'AAAA-MM-DD', texto sem nulo, booleano de verdade.
  const antes = {
    descricao: meta.descricao ?? '',
    quantidade_prevista: meta.quantidade_prevista == null
      ? null
      : Number(meta.quantidade_prevista),
    prazo: meta.prazo ? String(meta.prazo).slice(0, 10) : null,
    demandante: meta.demandante ?? '',
    cancelada: Boolean(meta.cancelada),
  };

  const descricaoField = createTextareaField({
    label: 'Descrição',
    required: true,
    rows: 3,
    value: antes.descricao,
    helpText: 'A frase como o documento assinado a escreve.',
  });

  const quantidadeField = createNumberField({
    label: 'Quantidade prevista',
    min: 0,
    step: 1,
    value: antes.quantidade_prevista ?? undefined,
    helpText: 'Vazio na meta que se subdivide: quem promete são os itens.',
  });

  const prazoField = createDateField({
    label: 'Previsão de término',
    value: antes.prazo || '',
  });

  const demandanteField = createTextField({
    label: 'Demandante',
    maxLength: 255,
    value: antes.demandante,
    placeholder: 'Ex.: COTER/DECEX',
  });

  const canceladaField = createCheckboxField({
    label: 'Meta cancelada',
    checked: antes.cancelada,
    helpText: 'Cancelar é ato da DSG. Marque aqui só para consertar a transcrição do que ela já cancelou.',
  });

  const motivoField = createTextareaField({
    label: 'Motivo da correção',
    required: true,
    rows: 2,
    placeholder: 'Ex.: o R1 assinado diz 35, e a transcrição ficou 53.',
    helpText: 'O motivo vai para o rastro da auditoria. Ele é o que separa um erro de digitação de uma mudança da DSG.',
  });

  // ---------------------------------------------------------------------------
  // O painel "o que muda", vivo.
  //
  // O aviso do topo diz o que a operação faz em geral; este painel diz o que
  // ELA vai fazer com ESTA meta, com o valor de antes ao lado. Sem ele, quem
  // corrige a quantidade não vê que também mexeu no prazo sem querer.
  // ---------------------------------------------------------------------------
  const listaMudancas = el('ul', { className: 'transcricao__mudancas' });
  const painelMudancas = el('div', { className: 'transcricao__painel' }, [
    el('p', { className: 'transcricao__painel-titulo', textContent: 'O que esta correção muda' }),
    listaMudancas,
  ]);

  /** O valor vazio se escreve por extenso: '-' se leria como o traço digitado. */
  const mostrar = (valor) => {
    if (valor === null || valor === undefined || valor === '') return 'vazio';
    if (valor === true) return 'sim';
    if (valor === false) return 'não';
    return `"${valor}"`;
  };

  const CAMPOS = [
    { chave: 'descricao', rotulo: 'Descrição', ler: () => descricaoField.getValue() },
    { chave: 'quantidade_prevista', rotulo: 'Quantidade prevista', ler: () => quantidadeField.getValue() },
    { chave: 'prazo', rotulo: 'Previsão de término', ler: () => prazoField.getValue() },
    { chave: 'demandante', rotulo: 'Demandante', ler: () => demandanteField.getValue() },
    { chave: 'cancelada', rotulo: 'Cancelada', ler: () => canceladaField.getValue() },
  ];

  /** As mudanças pendentes, na ordem dos campos do formulário. */
  function mudancas() {
    return CAMPOS
      .map(campo => ({ ...campo, depois: campo.ler() }))
      .filter(campo => campo.depois !== antes[campo.chave])
      .map(campo => ({
        rotulo: campo.rotulo,
        texto: `${campo.rotulo}: de ${mostrar(antes[campo.chave])} para ${mostrar(campo.depois)}`,
      }));
  }

  function pintarMudancas() {
    const pendentes = mudancas();

    if (!pendentes.length) {
      listaMudancas.replaceChildren(el('li', {
        className: 'transcricao__mudancas-vazio',
        textContent: 'Nada mudou. Corrija o campo que diverge do documento assinado.',
      }));
      return;
    }

    listaMudancas.replaceChildren(
      ...pendentes.map(m => el('li', { textContent: m.texto }))
    );
  }

  // Um ouvinte por campo, no `input` cru. `change` sozinho não pega a digitação
  // no texto, e a pessoa só veria a mudança ao sair do campo.
  for (const campo of [descricaoField, quantidadeField, prazoField, demandanteField]) {
    campo.input.addEventListener('input', pintarMudancas);
  }
  canceladaField.input.addEventListener('change', pintarMudancas);
  pintarMudancas();

  const aviso = el('div', { className: 'transcricao__aviso' }, [
    svgIcon(ICONS.warning, 20),
    el('div', {}, [
      el('p', { className: 'transcricao__aviso-titulo', textContent: 'Isto reescreve o que uma revisão assinada declarou.' }),
      el('p', {}, [
        `MUDA: o que a revisão ${revisao} declara para esta meta. A lista, a grade do PIT e o relatório passam a mostrar o valor corrigido.`,
      ]),
      el('p', {}, [
        `FICA: a revisão ${revisao} continua sendo a que rege, com a mesma data de vigência. O SCA não emite revisão nova. O ano, o número, o item, a unidade e a origem não mudam aqui.`,
      ]),
      el('p', {}, [
        'Use isto quando a transcrição divergir do documento assinado. Se a DSG mudou o que o PIT promete, abra uma revisão.',
      ]),
    ]),
  ]);

  const content = el('div', {}, [
    aviso,
    el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [descricaoField.element]),
      quantidadeField.element,
      prazoField.element,
      demandanteField.element,
      canceladaField.element,
      el('div', { className: 'form-grid__full' }, [motivoField.element]),
      el('div', { className: 'form-grid__full' }, [painelMudancas]),
    ]),
  ]);

  openModal({
    title: `Corrigir transcrição da meta ${codigo} (${meta.ano})`,
    content,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Corrigir transcrição',
        variant: 'danger',
        onClick: async ({ close, setOcupado }) => {
          descricaoField.setError(null);
          motivoField.setError(null);

          const descricao = descricaoField.getValue();
          if (!descricao) {
            descricaoField.setError('Informe a descrição da meta');
            return;
          }

          // O mesmo mínimo do Joi do servidor. Cobrar aqui evita gastar a
          // confirmação para receber 400 depois.
          const motivo = motivoField.getValue();
          if (motivo.length < 5) {
            motivoField.setError('Escreva o motivo, com pelo menos 5 caracteres');
            return;
          }

          const pendentes = mudancas();
          if (!pendentes.length) {
            motivoField.setError(null);
            showError('Nenhum campo mudou. Não há transcrição a corrigir.');
            return;
          }

          const ok = await confirmDialog({
            title: 'Corrigir a transcrição',
            message: `Meta ${codigo} de ${meta.ano}. A correção reescreve a revisão ${revisao}, `
              + `que já está em vigor. ${pendentes.map(m => m.texto).join('; ')}. `
              + `A revisão ${revisao} continua a mesma, e o SCA não emite revisão nova.`,
            confirmLabel: 'Corrigir transcrição',
            danger: true,
          });
          if (!ok) return;

          setOcupado(true);
          try {
            await corrigirTranscricaoMeta(meta.id, {
              descricao,
              quantidade_prevista: quantidadeField.getValue(),
              prazo: prazoField.getValue(),
              demandante: demandanteField.getValue() || null,
              cancelada: canceladaField.getValue(),
              motivo,
            });
            setOcupado(false);
            showSuccess('Transcrição corrigida');
            close();
            if (onSaved) onSaved();
          } catch (err) {
            // O modal FICA ABERTO: o que a pessoa digitou continua na tela, e o
            // motivo do servidor diz o que corrigir.
            setOcupado(false);
            showError(err.message || 'Erro ao corrigir a transcrição');
          }
        },
      },
    ],
  });
}
