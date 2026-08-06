import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createTextField,
  createTextareaField,
  createDateField,
  createSelectField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { criarHistorico } from '@components/historico/historico.js';
import { isAdmin } from '@store/auth-store.js';
import { declararNaRevisao, createMetaPit } from '@services/plataforma-service.js';

/**
 * A META COMO ESTA REVISÃO A DECLARA. É o ÚNICO formulário de meta do PIT.
 *
 * O PRINCÍPIO, e dele decorre a tela inteira: o texto assinado é o rei, e o que
 * está no sistema é TRANSCRIÇÃO dele. Por isso todo ato sobre uma meta acontece
 * DENTRO de uma revisão, que é o documento que o autoriza.
 *
 * AS QUATRO OPERAÇÕES CABEM AQUI, porque `pit.meta_item_revisao` é esparsa
 * (er/pit.sql:219) e as linhas de uma revisão SÃO as alterações dela:
 *
 *   ACRESCENTA  sem `meta`: cria a identidade e a primeira declaração.
 *   ALTERA      a quantidade, o prazo, o demandante ou a frase mudaram.
 *   CANCELA     a caixa "Meta cancelada", o único ato de situação da DSG.
 *   CORRIGE     a mesma edição, numa revisão já PUBLICADA, com motivo.
 *
 * A IDENTIDADE ESTÁ NO MESMO FORMULÁRIO. Número, item e unidade são
 * classificação NOSSA, e revisão nenhuma as menciona; mas existiam num botão
 * "Corrigir cadastro" ao lado de outro que alterava a promessa, e ninguém
 * distinguia os dois. Agora as duas coisas gravam na MESMA transação do
 * servidor: ou a meta sai inteira certa, ou nada sai.
 *
 * A REVISÃO PUBLICADA ACEITA A EDIÇÃO, com MOTIVO. Editar o R0 publicado não
 * muda o PIT nem move a vigência: conserta a nossa cópia do documento assinado.
 * O motivo é o que separa esse conserto de uma mudança de plano, e ele desce
 * para o rastro da auditoria. Era isso que o botão "Corrigir transcrição" fazia,
 * numa tela separada que ninguém achava.
 *
 * @param {Object} opcoes
 * @param {{id:number, codigo:string, ano:number, rascunho:boolean}} opcoes.revisao
 * @param {Object|null} [opcoes.meta] - a meta normalizada pelo chamador:
 *   { metaId, codigo, numero_meta, item, unidade_id, descricao,
 *     quantidade_prevista, prazo, demandante, cancelada, jaNaRevisao,
 *     revisaoAnterior }. Nulo acrescenta uma meta nova.
 * @param {Function} [opcoes.onSaved] - chamado após a gravação dar certo.
 */
export function abrirDeclaracaoDialog({ revisao, meta = null, onSaved = null } = {}) {
  const criando = !meta;
  const publicada = !revisao.rascunho;

  // O ESTADO ANTERIOR, normalizado. É contra ele que o painel de mudanças
  // compara, então ele precisa ter a mesma forma que os campos devolvem: data
  // fatiada em 'AAAA-MM-DD', texto sem nulo, booleano de verdade.
  const antes = {
    numero_meta: meta && meta.numero_meta != null ? Number(meta.numero_meta) : null,
    item: meta && meta.item && meta.item !== '-' ? String(meta.item) : '',
    unidade_id: meta && meta.unidade_id != null ? Number(meta.unidade_id) : null,
    descricao: (meta && meta.descricao) ?? '',
    quantidade_prevista: meta && meta.quantidade_prevista != null
      ? Number(meta.quantidade_prevista)
      : null,
    prazo: meta && meta.prazo ? String(meta.prazo).slice(0, 10) : null,
    demandante: (meta && meta.demandante) ?? '',
    cancelada: Boolean(meta && meta.cancelada),
  };

  // --- A IDENTIDADE: o que o SCA classifica --------------------------------
  const numeroField = createNumberField({
    label: 'Número da meta',
    required: true,
    min: 1,
    step: 1,
    value: antes.numero_meta ?? undefined,
  });

  const itemField = createTextField({
    label: 'Item',
    required: true,
    maxLength: 20,
    placeholder: 'Ex.: 4.1',
    value: antes.item,
    helpText: 'O código da linha no documento. Toda meta do plano tem um.',
  });

  // O NOME DO GRUPO, e só ao criar. O documento abre cada bloco com "Meta 4 -
  // Serviço de Impressão de Produtos de Geoinformação", e esse nome é do GRUPO,
  // não da linha. Ele só é usado quando a meta daquele número ainda não existe:
  // existindo, o servidor a reaproveita e ignora este campo, para a última linha
  // digitada não mandar no nome do bloco inteiro.
  const nomeField = criando ? createTextField({
    label: 'Nome da meta',
    maxLength: 255,
    placeholder: 'Ex.: Produção de Geoinformação',
    helpText: 'Só é usado quando a meta deste número ainda não existe no ano.',
  }) : null;

  // DOMÍNIO FECHADO (`dominio.unidade_meta`). Em texto livre viram treze valores
  // para cinco coisas ('carta' e 'folha' para a mesma). A coerência com a origem
  // é cobrada no servidor: Produção e Impressão exigem Folha.
  const unidadeField = createSelectField({
    label: 'Unidade',
    options: [
      { value: 1, label: 'Folha' },
      { value: 2, label: 'Marco' },
      { value: 3, label: 'Capacitação' },
      { value: 4, label: 'Item de acervo' },
      { value: 5, label: 'Atividade' },
    ],
    value: antes.unidade_id ?? undefined,
    required: criando,
    helpText: 'O que o item conta. Obrigatória: a coluna do banco é NOT NULL.',
  });

  // --- A DECLARAÇÃO: o que a DSG promete ------------------------------------
  const descricaoField = createTextareaField({
    label: 'Descrição',
    required: true,
    rows: 3,
    value: antes.descricao,
    helpText: 'Só o Produto ou Serviço, sem o solicitante nem a quantidade: '
      + 'os dois têm campo próprio abaixo.',
  });

  const quantidadeField = createNumberField({
    label: 'Quantidade prevista',
    min: 0,
    step: 1,
    value: antes.quantidade_prevista ?? undefined,
    helpText: 'Vazio quando esta revisão só cancela o item.',
  });

  const prazoField = createDateField({
    label: 'Previsão de término',
    value: antes.prazo || '',
    helpText: 'Sai como "AGO 26" no relatório.',
  });

  const demandanteField = createTextField({
    label: 'Demandante',
    maxLength: 255,
    value: antes.demandante,
    placeholder: 'Ex.: COTER/DECEX',
  });

  // CANCELAR É O ÚNICO ATO DE SITUAÇÃO DA DSG. O andamento e a conclusão a grade
  // calcula do que foi lançado. A meta cancelada continua na lista, com a linha
  // desta revisão: cancelar não é apagar.
  //
  // Só no modo de alterar: uma meta que nasce cancelada é confusão, e o caso
  // raro (a 6.9 de 2026, ausente do R0) se resolve criando e cancelando depois.
  const canceladaField = criando ? null : createCheckboxField({
    label: 'Meta cancelada por esta revisão',
    checked: antes.cancelada,
    helpText: 'A meta continua no PIT, marcada como cancelada. Apagar é outra coisa.',
  });

  // O MOTIVO, e só quando a revisão já foi publicada. É o que separa "a cópia
  // saiu errada" de "a DSG mudou o plano", e é a distinção inteira.
  const motivoField = publicada ? createTextareaField({
    label: 'Motivo da correção',
    required: true,
    rows: 2,
    placeholder: `Ex.: o ${revisao.codigo} assinado diz 35, e a transcrição ficou 53.`,
    helpText: 'O motivo vai para o rastro da auditoria. O mínimo é 5 caracteres.',
  }) : null;

  // ---------------------------------------------------------------------------
  // O painel "o que muda", vivo.
  //
  // O aviso do topo diz o que a operação faz em geral; este painel diz o que ELA
  // vai fazer com ESTA meta, com o valor de antes ao lado. Sem ele, quem altera a
  // quantidade não vê que mexeu no prazo sem querer.
  // ---------------------------------------------------------------------------
  const listaMudancas = el('ul', { className: 'transcricao__mudancas' });
  const painelMudancas = criando ? null : el('div', { className: 'transcricao__painel' }, [
    el('p', {
      className: 'transcricao__painel-titulo',
      textContent: `O que a revisão ${revisao.codigo} passa a declarar`,
    }),
    listaMudancas,
  ]);

  const UNIDADES = {
    1: 'Folha', 2: 'Marco', 3: 'Capacitação', 4: 'Item de acervo', 5: 'Atividade',
  };

  /** O valor vazio se escreve por extenso: '-' se leria como o traço digitado. */
  const mostrar = (valor) => {
    if (valor === null || valor === undefined || valor === '') return 'vazio';
    if (valor === true) return 'sim';
    if (valor === false) return 'não';
    return `"${valor}"`;
  };

  const CAMPOS = [
    { chave: 'numero_meta', rotulo: 'Número da meta', ler: () => numeroField.getValue() },
    { chave: 'item', rotulo: 'Item', ler: () => itemField.getValue() },
    {
      chave: 'unidade_id',
      rotulo: 'Unidade',
      ler: () => unidadeField.getValue(),
      escrever: (v) => (v == null ? null : (UNIDADES[v] || v)),
    },
    { chave: 'descricao', rotulo: 'Descrição', ler: () => descricaoField.getValue() },
    { chave: 'quantidade_prevista', rotulo: 'Quantidade prevista', ler: () => quantidadeField.getValue() },
    { chave: 'prazo', rotulo: 'Previsão de término', ler: () => prazoField.getValue() },
    { chave: 'demandante', rotulo: 'Demandante', ler: () => demandanteField.getValue() },
    ...(canceladaField
      ? [{ chave: 'cancelada', rotulo: 'Cancelada', ler: () => canceladaField.getValue() }]
      : []),
  ];

  /** As mudanças pendentes, na ordem dos campos do formulário. */
  function mudancas() {
    return CAMPOS
      .map((campo) => ({ ...campo, depois: campo.ler() }))
      .filter((campo) => campo.depois !== antes[campo.chave])
      .map((campo) => {
        const pinta = campo.escrever || ((v) => v);
        return {
          rotulo: campo.rotulo,
          texto: `${campo.rotulo}: de ${mostrar(pinta(antes[campo.chave]))} `
            + `para ${mostrar(pinta(campo.depois))}`,
        };
      });
  }

  function pintarMudancas() {
    if (!painelMudancas) return;
    const pendentes = mudancas();

    if (!pendentes.length) {
      listaMudancas.replaceChildren(el('li', {
        className: 'transcricao__mudancas-vazio',
        // A meta que já está no rascunho pode não ter mudança pendente e ainda
        // assim ser uma alteração da revisão: a comparação aqui é contra o que
        // ela mesma declara hoje.
        textContent: meta && meta.jaNaRevisao
          ? 'Nada mudou nesta abertura. A meta continua como esta revisão já a declara.'
          : 'Nada mudou. Altere o campo que a revisão muda.',
      }));
      return;
    }

    listaMudancas.replaceChildren(
      ...pendentes.map((m) => el('li', { textContent: m.texto })),
    );
  }

  // Um ouvinte por campo, no `input` cru. `change` sozinho não pega a digitação
  // no texto, e a pessoa só veria a mudança ao sair do campo.
  for (const campo of [
    numeroField, itemField, descricaoField, quantidadeField, prazoField, demandanteField,
  ]) {
    campo.input.addEventListener('input', pintarMudancas);
  }
  unidadeField.input.addEventListener('change', pintarMudancas);
  if (canceladaField) canceladaField.input.addEventListener('change', pintarMudancas);
  pintarMudancas();

  // HISTÓRICO da meta, RECOLHIDO e só na alteração.
  //
  // A pergunta "por que a 4.2 virou 252" se faz com a meta aberta na frente. O
  // agregado 'meta' reúne a identidade, o que cada revisão declarou, a execução
  // lançada e o de-para de mídia.
  //
  // SÓ PARA ADMINISTRADOR, e não por escolha de tela: a rota do histórico de
  // 'plataforma' é `verifyAdmin`, e mostrar o painel a quem ela vai recusar
  // entregaria um 403 no meio do formulário.
  const historico = !criando && isAdmin()
    ? criarHistorico({
      modulo: 'plataforma',
      entidade: 'meta',
      id: meta.metaId,
      titulo: 'Histórico da meta',
      subtitulo: 'Identidade, o que cada revisão do PIT declarou, execução lançada e mídia',
      recolhido: true,
    })
    : null;

  // DE ONDE VÊM OS VALORES QUE JÁ ESTÃO NA TELA. Sem esta frase, quem abre uma
  // meta que a revisão ainda não altera acha que ela já está no rascunho.
  const origem = criando
    ? `A meta nasce dentro da revisão ${revisao.codigo}, que é o documento que a `
      + 'autoriza.'
    : (meta.jaNaRevisao
      ? `Esta revisão já altera a meta ${meta.codigo}. Os valores abaixo são os que ela declara.`
      : (meta.revisaoAnterior
        ? `A revisão ${revisao.codigo} ainda não altera a meta ${meta.codigo}. Os valores `
          + `abaixo são os que a revisão ${meta.revisaoAnterior} declara hoje.`
        : `A meta ${meta.codigo} não foi declarada por revisão nenhuma até aqui. `
          + `Salvar aqui a declara pela revisão ${revisao.codigo}.`));

  // O AVISO QUE EXPLICA O MODELO, e ele muda com o estado da revisão. No
  // rascunho a mensagem é "isto ainda não rege"; na publicada é "isto conserta a
  // transcrição, e não o plano".
  const aviso = el('div', { className: 'transcricao__aviso' }, [
    svgIcon(publicada ? ICONS.description : ICONS.warning, 20),
    el('div', {}, [
      el('p', {
        className: 'transcricao__aviso-titulo',
        textContent: publicada
          ? `A revisão ${revisao.codigo} já está publicada: isto conserta a TRANSCRIÇÃO dela.`
          : `Isto altera o que o PIT PROMETE, pela revisão ${revisao.codigo}.`,
      }),
      el('p', {}, [origem]),
      el('p', {}, [
        publicada
          ? `O texto assinado é o rei. A revisão ${revisao.codigo} continua a mesma, `
            + 'com a mesma data de vigência, e o SCA não emite revisão nova. Se foi a '
            + 'DSG que mudou o plano, abra a revisão seguinte em vez de corrigir aqui.'
          : `A alteração fica no RASCUNHO: ela só passa a valer quando a revisão `
            + `${revisao.codigo} for publicada. Até lá, a tabela de metas continua `
            + 'mostrando o plano sem ela.',
      ]),
    ]),
  ]);

  const content = el('div', {}, [
    aviso,
    el('div', { className: 'form-grid' }, [
      numeroField.element,
      itemField.element,
      unidadeField.element,
      // O nome do GRUPO só aparece ao criar, e ocupa a linha inteira: ele é do
      // bloco, e não da linha ao lado.
      nomeField
        ? el('div', { className: 'form-grid__full' }, [nomeField.element])
        : null,
      el('div', { className: 'form-grid__full' }, [descricaoField.element]),
      quantidadeField.element,
      prazoField.element,
      demandanteField.element,
      canceladaField ? canceladaField.element : null,
      motivoField
        ? el('div', { className: 'form-grid__full' }, [motivoField.element])
        : null,
      painelMudancas
        ? el('div', { className: 'form-grid__full' }, [painelMudancas])
        : null,
      historico
        ? el('div', { className: 'form-grid__full' }, [historico.element])
        : null,
    ].filter(Boolean)),
  ]);

  let salvando = false;

  return openModal({
    title: criando
      ? `Meta nova na revisão ${revisao.codigo} de ${revisao.ano}`
      : `Meta ${meta.codigo} na revisão ${revisao.codigo} de ${revisao.ano}`,
    content,
    width: '660px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: publicada ? 'Corrigir a transcrição' : 'Salvar na revisão',
        variant: publicada ? 'danger' : 'primary',
        // `setOcupado` segura o modal enquanto a gravação corre. Escape ou
        // clique no fundo fechavam o formulário com a requisição em voo, e a
        // recusa do servidor chegava a uma tela sem nada para corrigir.
        onClick: async ({ close, setOcupado }) => {
          if (salvando) return;

          numeroField.setError(null);
          itemField.setError(null);
          unidadeField.setError(null);
          descricaoField.setError(null);
          if (motivoField) motivoField.setError(null);

          const numeroMeta = numeroField.getValue();
          if (numeroMeta === null || numeroMeta <= 0) {
            numeroField.setError('Informe o número da meta');
            return;
          }

          // O ITEM É OBRIGATÓRIO. A coluna `pit.meta_item.item` é NOT NULL, e o
          // item vazio era a linha de cabeçalho, que deixou de ser uma meta.
          const item = itemField.getValue();
          if (!item) {
            itemField.setError('Informe o item (ex.: 4.1)');
            return;
          }

          // A UNIDADE também, e só ao criar: em alteração, omitir é não mexer.
          const unidadeId = unidadeField.getValue();
          if (criando && unidadeId == null) {
            unidadeField.setError('Escolha o que este item conta');
            return;
          }

          const descricao = descricaoField.getValue();
          if (!descricao) {
            descricaoField.setError('Informe a descrição da meta');
            return;
          }

          // O MESMO MÍNIMO DO JOI DO SERVIDOR. Cobrar aqui evita gastar a
          // gravação para receber um 400 que já se sabia.
          let motivo = null;
          if (motivoField) {
            motivo = motivoField.getValue();
            if (!motivo || motivo.trim().length < 5) {
              motivoField.setError('Escreva o motivo, com pelo menos 5 caracteres');
              return;
            }
          }

          // OS CAMPOS VÃO SEMPRE, inclusive `cancelada`. O servidor grava a
          // declaração inteira e trata campo ausente como padrão: sem
          // `cancelada` no corpo, mexer numa vírgula DESCANCELARIA a meta que a
          // DSG cancelou.
          const corpo = {
            numero_meta: numeroMeta,
            item,
            unidade_id: unidadeId,
            descricao,
            quantidade_prevista: quantidadeField.getValue(),
            prazo: prazoField.getValue(),
            demandante: demandanteField.getValue() || null,
          };
          if (canceladaField) corpo.cancelada = canceladaField.getValue();
          if (motivo) corpo.motivo = motivo;

          salvando = true;
          setOcupado(true);
          try {
            if (criando) {
              const nome = nomeField ? (nomeField.getValue() || '').trim() : '';
              await createMetaPit({
                ...corpo,
                ...(nome ? { nome } : {}),
                ano: revisao.ano,
                revisao_id: revisao.id,
              });
              showSuccess(`Meta acrescentada à revisão ${revisao.codigo}`);
            } else {
              await declararNaRevisao(revisao.id, meta.metaId, corpo);
              showSuccess(publicada
                ? `Transcrição corrigida na revisão ${revisao.codigo}`
                : `Meta ${meta.codigo} declarada na revisão ${revisao.codigo}`);
            }
            setOcupado(false);
            close();
            if (onSaved) onSaved();
          } catch (err) {
            // O modal FICA ABERTO: o que a pessoa digitou continua na tela, e o
            // motivo do servidor diz o que corrigir.
            setOcupado(false);
            showError(err.message || 'Erro ao salvar a meta na revisão');
          } finally {
            salvando = false;
          }
        },
      },
    ],
  });
}
