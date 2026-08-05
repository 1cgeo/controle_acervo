import { el, svgIcon, ICONS } from '@utils/dom.js';
import { reconciliar } from '@utils/reconciliar.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  createPeriodoEfetivo,
  updatePeriodoEfetivo,
  deletePeriodoEfetivo,
  createImpedimento,
  updateImpedimento,
  deleteImpedimento,
} from '@services/plataforma-service.js';
import { criarHistorico } from '@components/historico/historico.js';
import { isAdmin } from '@store/auth-store.js';

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : null);

// A data do servidor chega como 'AAAA-MM-DD'. Datas ISO comparam como texto.
const iso = (valor) => (valor ? String(valor).slice(0, 10) : null);

/** Dois intervalos se cruzam quando cada um começa antes de o outro acabar. */
function intervalosSeCruzam(a, b) {
  const fimA = iso(a.data_fim) || '9999-12-31';
  const fimB = iso(b.data_fim) || '9999-12-31';
  return iso(a.data_inicio) <= fimB && iso(b.data_inicio) <= fimA;
}

/**
 * O impedimento que NÃO cruza passagem nenhuma no ano.
 *
 * O SQL do mapa descarta esse registro em silêncio: o dia em que a pessoa não
 * estava na Divisão sai NULO, e o impedimento não tem onde descontar. A ficha o
 * mostrava do mesmo jeito que os outros, e ele não mudava número nenhum.
 *
 * A CONTA É DENTRO DO ANO da tela, e não na vida inteira do militar. As duas
 * listas chegam aqui recortadas pelo ano, e afirmar sobre passagem de outro ano
 * seria afirmar sobre o que não está na mesa.
 */
function foraDaPassagem(impedimento, periodos, ano) {
  const inicio = iso(impedimento.data_inicio);
  const fim = iso(impedimento.data_fim) || '9999-12-31';
  const janela = {
    data_inicio: inicio > `${ano}-01-01` ? inicio : `${ano}-01-01`,
    data_fim: fim < `${ano}-12-31` ? fim : `${ano}-12-31`,
  };
  // Impedimento que nem toca o ano da tela não é caso deste aviso.
  if (janela.data_inicio > janela.data_fim) return false;
  return !periodos.some(p => intervalosSeCruzam(janela, p));
}

/**
 * A DATA DE FIM É UM CAMPO MAIS UMA CAIXA, empilhados: o campo em cima, a caixa
 * embaixo.
 *
 * Vazio se lê como "esqueci de preencher", e aqui o nulo é uma afirmação: a
 * pessoa continua na Divisão, ou o impedimento não tem previsão de acabar. A
 * caixa é quem diz isso, e o campo fica DESABILITADO em vez de sumir -- campo
 * que some encolhe a célula da grade e faz o formulário pular.
 *
 * O ESPAÇO ENTRE OS DOIS é o `--space-md`, e não o `--space-xs` que separa o
 * rótulo do campo. Com o espaçamento pequeno a caixa encosta na borda do campo e
 * se lê como parte dele; com o `md` ela se lê como o que é, um controle do campo
 * de cima. Antes disso houve uma margem NEGATIVA aqui, que não é espaçamento
 * apertado, é sobreposição pedida.
 */
function campoFim(rotulo, rotuloCaixa, valorInicial) {
  const campo = createDateField({ label: rotulo, value: valorInicial || '' });

  const aplicar = (marcada) => {
    campo.input.disabled = marcada;
    if (marcada) campo.setValue(null);
  };

  const caixa = createCheckboxField({
    label: rotuloCaixa,
    checked: !valorInicial,
    onChange: aplicar,
  });

  aplicar(!valorInicial);

  return {
    element: el('div', {
      style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' },
    }, [campo.element, caixa.element]),
    getValue: () => (caixa.getValue() ? null : campo.getValue()),
    setError: campo.setError,
  };
}

/**
 * Cadastro de uma PASSAGEM pela DGEO.
 *
 * O militar só se escolhe ao CRIAR. Trocá-lo numa passagem existente reescreveria
 * de quem é o período, e o servidor nem aceita o campo: para isso, exclui-se e
 * cadastra de novo.
 */
export function openPeriodoDialog({
  periodo = null, usuarios = [], usuarioUuid = null, nomeMilitar = null, onSaved = null,
} = {}) {
  const isEdit = Boolean(periodo);

  // O SELETOR só existe quando o militar ainda não se sabe, que é o caso do
  // botão do topo da tela. Aberto da ficha de alguém, ele seria um controle com
  // uma opção só, e o nome já está no título.
  const escolhePessoa = !isEdit && !usuarioUuid;

  const pessoaField = escolhePessoa ? createSelectField({
    label: 'Militar',
    required: true,
    options: usuarios.map(u => ({
      value: u.uuid,
      label: `${u.posto_abrev || ''} ${u.nome_guerra}`.trim(),
    })),
  }) : null;

  const inicioField = createDateField({
    label: 'Entrada na DGEO',
    required: true,
    value: periodo?.data_inicio ?? '',
  });

  const fim = campoFim('Saída da DGEO', 'Sem previsão de saída', periodo?.data_fim);

  const observacaoField = createTextareaField({
    label: 'Observação',
    value: periodo?.observacao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    ...(pessoaField ? [el('div', { className: 'form-grid__full' }, [pessoaField.element])] : []),
    inicioField.element,
    fim.element,
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
  ]);

  let saving = false;

  openModal({
    title: (isEdit ? 'Editar passagem pela DGEO' : 'Nova passagem pela DGEO')
      + (nomeMilitar ? ` - ${nomeMilitar}` : ''),
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        // `setOcupado` mantém o modal aberto enquanto a gravação corre: Escape e
        // clique no fundo fechavam o formulário com a requisição em voo, e a
        // recusa do banco (a sobreposição de períodos) chegava a uma tela sem
        // campo nenhum para corrigir.
        onClick: async ({ close, setOcupado }) => {
          if (saving) return;

          inicioField.setError(null);
          fim.setError(null);
          if (pessoaField) pessoaField.setError(null);

          const inicio = inicioField.getValue();
          const dataFim = fim.getValue();

          if (pessoaField && !pessoaField.getValue()) {
            return pessoaField.setError('Escolha o militar');
          }
          if (!inicio) return inicioField.setError('Informe a data de entrada');
          // O banco tem o mesmo CHECK. Cobrar aqui evita o 500 cru.
          if (dataFim && dataFim < inicio) {
            return fim.setError('A saída não pode ser antes da entrada');
          }

          const payload = {
            data_inicio: inicio,
            data_fim: dataFim,
            observacao: observacaoField.getValue() || null,
          };

          saving = true;
          setOcupado(true);
          try {
            if (isEdit) {
              await updatePeriodoEfetivo(periodo.id, payload);
              showSuccess('Passagem atualizada com sucesso');
            } else {
              await createPeriodoEfetivo({
                usuario_uuid: pessoaField ? pessoaField.getValue() : usuarioUuid,
                ...payload,
              });
              showSuccess('Passagem cadastrada com sucesso');
            }
            setOcupado(false);
            close();
            if (onSaved) onSaved();
          } catch (err) {
            // A sobreposição vem do EXCLUDE do banco, já traduzida pelo servidor.
            setOcupado(false);
            showError(err.message || 'Erro ao salvar a passagem');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}

/**
 * Cadastro de um IMPEDIMENTO.
 *
 * Descrição é texto LIVRE, sem catálogo: a lista de motivos
 * não fecha, e classificar antes de escrever atrapalha.
 */
export function openImpedimentoDialog({
  impedimento = null, usuarioUuid = null, nomeMilitar = null, onSaved = null,
} = {}) {
  const isEdit = Boolean(impedimento);

  const descricaoField = createTextField({
    label: 'Impedimento',
    required: true,
    maxLength: 255,
    placeholder: 'Ex.: Chefe do S5, LTSP, Curso PCE-EECN',
    value: impedimento?.descricao ?? '',
  });

  const percentualField = createNumberField({
    label: 'Percentual do tempo',
    required: true,
    min: 1,
    max: 100,
    step: 1,
    value: impedimento?.percentual ?? 100,
    // Só o que o rótulo não diz. "Quanto do tempo este impedimento consome" era
    // o rótulo escrito de novo, uma linha abaixo dele.
    helpText: 'Afastamento integral é 100.',
  });

  const inicioField = createDateField({
    label: 'Início',
    required: true,
    value: impedimento?.data_inicio ?? '',
  });

  const fim = campoFim('Término', 'Sem previsão de término', impedimento?.data_fim);

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    percentualField.element,
    inicioField.element,
    fim.element,
  ]);

  let saving = false;

  openModal({
    title: (isEdit ? 'Editar impedimento' : 'Novo impedimento')
      + (nomeMilitar ? ` - ${nomeMilitar}` : ''),
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        // Ver o comentário do diálogo de passagem: o modal não se fecha com a
        // gravação em voo.
        onClick: async ({ close, setOcupado }) => {
          if (saving) return;

          descricaoField.setError(null);
          percentualField.setError(null);
          inicioField.setError(null);
          fim.setError(null);

          const descricao = descricaoField.getValue();
          const percentual = percentualField.getValue();
          const inicio = inicioField.getValue();
          const dataFim = fim.getValue();

          if (!descricao) return descricaoField.setError('Descreva o impedimento');
          if (percentual === null || percentual < 1 || percentual > 100) {
            return percentualField.setError('Informe um percentual de 1 a 100');
          }
          if (!inicio) return inicioField.setError('Informe a data de início');
          if (dataFim && dataFim < inicio) {
            return fim.setError('O término não pode ser antes do início');
          }

          const payload = {
            descricao,
            percentual,
            data_inicio: inicio,
            data_fim: dataFim,
          };

          saving = true;
          setOcupado(true);
          try {
            if (isEdit) {
              await updateImpedimento(impedimento.id, payload);
              showSuccess('Impedimento atualizado com sucesso');
            } else {
              await createImpedimento({ usuario_uuid: usuarioUuid, ...payload });
              showSuccess('Impedimento cadastrado com sucesso');
            }
            setOcupado(false);
            close();
            if (onSaved) onSaved();
          } catch (err) {
            setOcupado(false);
            showError(err.message || 'Erro ao salvar o impedimento');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}

/**
 * A ficha de UM militar: as passagens dele pela DGEO e os impedimentos, com o
 * que editar cada um.
 *
 * É o que abre ao clicar na linha do mapa. O mapa responde "quanto", e esta
 * ficha responde "por quê", que é a pergunta seguinte e a única que leva a uma
 * correção.
 *
 * A FICHA SE REPINTA SEM FECHAR. Recarregar a tela por baixo e deixar a ficha
 * aberta com a lista velha faz quem acabou de lançar a saída de um militar ver a
 * passagem antiga ali, e lançar de novo. O `onSaved` DEVOLVE as listas novas
 * daquela pessoa, e é com elas que a ficha se repinta; quem não devolver nada
 * mantém a lista que tinha.
 *
 * @param {Object} opcoes
 * @param {Object} opcoes.militar
 * @param {number} [opcoes.ano] - o ano da tela, que recorta as duas listas.
 * @param {Array} [opcoes.periodos]
 * @param {Array} [opcoes.impedimentos]
 * @param {() => Promise<{periodos:Array, impedimentos:Array}|void>} [opcoes.onSaved]
 */
export function openMilitarDialog({
  militar, ano = new Date().getFullYear(),
  periodos = [], impedimentos = [], onSaved = null,
} = {}) {
  const nome = `${militar.posto_abrev} ${militar.nome_guerra}`.trim();

  let listaPeriodos = periodos;
  let listaImpedimentos = impedimentos;

  const corpoPassagens = el('div');
  const corpoImpedimentos = el('div');

  // Recarrega a tela de baixo e repinta ESTA ficha com o que voltou. A ordem
  // importa: pintar antes da resposta mostraria de novo o dado velho.
  async function aposSalvar() {
    const novo = onSaved ? await onSaved() : null;
    if (novo) {
      listaPeriodos = novo.periodos || [];
      listaImpedimentos = novo.impedimentos || [];
    }
    pintar();
  }

  // A LINHA TEM CLASSE PRÓPRIA, e o estilo saiu do JS para o CSS.
  //
  // Não é só arrumação: com a lista reconciliada por chave, é preciso apontar UM
  // registro sem esbarrar no container que o contém (o corpo da seção também é
  // um `div` e o texto dele começa pelo texto da primeira linha). A classe é o
  // que dá esse endereço, à tela e ao teste.
  const linha = (texto, secundario, acoes, aviso = null) => el('div', {
    className: `ficha-militar__linha${aviso ? ' ficha-militar__linha--fora' : ''}`,
  }, [
    el('div', { className: 'ficha-militar__texto' }, [
      el('div', { textContent: texto }),
      el('div', { className: 'ficha-militar__periodo', textContent: secundario }),
      aviso
        ? el('div', { className: 'ficha-militar__aviso', textContent: aviso })
        : null,
    ].filter(Boolean)),
    ...acoes,
  ]);

  const botaoIcone = (icone, titulo, onClick, perigo = false) => el('button', {
    className: `data-table__action-btn${perigo ? ' data-table__action-btn--danger' : ''}`,
    type: 'button',
    title: titulo,
    'aria-label': titulo,
    onClick,
  }, [svgIcon(icone, 16)]);

  // A seção é montada UMA vez; só o corpo dela se repinta. Recriar a seção
  // inteira trocaria o botão "Nova" a cada salvamento, e o foco morreria com o
  // nó que o continha.
  const secao = (titulo, corpo, botaoNovo) => el('div', {
    style: { marginBottom: '20px' },
  }, [
    el('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '4px',
      },
    }, [
      el('h3', { style: { margin: '0', fontSize: '0.9375rem' }, textContent: titulo }),
      botaoNovo,
    ]),
    corpo,
  ]);

  const vazio = (texto) => el('p', {
    style: { color: 'var(--text-secondary)' }, textContent: texto,
  });

  function linhaDaPassagem(p) {
    return linha(
      // "Atual" e "Em curso" são o que o nulo QUER dizer. Um traço aqui se
      // leria como campo em branco.
      `${dia(p.data_inicio)} até ${p.data_fim ? dia(p.data_fim) : 'Atual'}`,
      p.observacao || '',
      [
        botaoIcone(ICONS.edit, 'Editar', () => openPeriodoDialog({
          periodo: p, nomeMilitar: nome, onSaved: aposSalvar,
        })),
        botaoIcone(ICONS.delete, 'Excluir', async () => {
          const ok = await confirmDialog({
            title: 'Excluir passagem',
            message: `Excluir a passagem de ${nome} iniciada em ${dia(p.data_inicio)}?`,
            confirmLabel: 'Excluir',
            danger: true,
          });
          if (!ok) return;
          try {
            await deletePeriodoEfetivo(p.id);
            showSuccess('Passagem excluída');
            await aposSalvar();
          } catch (err) {
            showError(err.message || 'Erro ao excluir a passagem');
          }
        }, true),
      ]
    );
  }

  function linhaDoImpedimento(i) {
    return linha(
      `${i.descricao} (${i.percentual}%)`,
      `${dia(i.data_inicio)} até ${i.data_fim ? dia(i.data_fim) : 'Em curso'}`,
      [
        botaoIcone(ICONS.edit, 'Editar', () => openImpedimentoDialog({
          impedimento: i, nomeMilitar: nome, onSaved: aposSalvar,
        })),
        botaoIcone(ICONS.delete, 'Excluir', async () => {
          const ok = await confirmDialog({
            title: 'Excluir impedimento',
            message: `Excluir "${i.descricao}" de ${nome}?`,
            confirmLabel: 'Excluir',
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteImpedimento(i.id);
            showSuccess('Impedimento excluído');
            await aposSalvar();
          } catch (err) {
            showError(err.message || 'Erro ao excluir o impedimento');
          }
        }, true),
      ],
      foraDaPassagem(i, listaPeriodos, ano)
        ? `Fora de qualquer passagem em ${ano}. Não entra na conta.`
        : null
    );
  }

  /**
   * A ASSINATURA de uma linha: tudo que ela IMPRIME, e nada além.
   *
   * É o que decide se o nó existente serve. Fica num `WeakMap`, fora do DOM,
   * pelo mesmo motivo do `reconciliar`: guardá-la num atributo exporia detalhe
   * interno e quem o reescrevesse quebraria a comparação em silêncio.
   */
  const assinaturas = new WeakMap();

  const assinarPassagem = (p) => [
    iso(p.data_inicio), iso(p.data_fim), p.observacao || '',
  ].join('|');

  // O AVISO ENTRA NA ASSINATURA. Ele depende das PASSAGENS, e não só do
  // impedimento: lançar a saída do militar pode tirar um impedimento de dentro
  // de qualquer passagem, e a linha dele tem de passar a avisar isso.
  const assinarImpedimento = (i) => [
    i.descricao, i.percentual, iso(i.data_inicio), iso(i.data_fim),
    foraDaPassagem(i, listaPeriodos, ano) ? 'fora' : 'dentro',
  ].join('|');

  /**
   * Repinta um corpo SEM recriar o que não mudou.
   *
   * REGRA DE OURO do projeto: salvar não reconstrói a tela. `innerHTML = ''`
   * fazia o oposto dentro desta ficha, e ela se repinta depois de TODA gravação
   * e exclusão: quem apagava o terceiro de oito impedimentos voltava ao topo da
   * lista e perdia o foco do teclado com o nó que o continha.
   *
   * O ESTADO VAZIO É UM ITEM COM CHAVE PRÓPRIA. Assim ele entra e sai pelo mesmo
   * caminho das linhas, e o container nunca precisa ser esvaziado por fora (o
   * que invalidaria o mapa da reconciliação).
   */
  function pintarCorpo(corpo, itens, criarLinha, assinar, textoVazio) {
    if (!itens.length) {
      reconciliar(corpo, [textoVazio], {
        chave: () => '__vazio__',
        criar: (texto) => vazio(texto),
      });
      return;
    }

    reconciliar(corpo, itens, {
      chave: (item) => item.id,
      criar: (item) => {
        const no = criarLinha(item);
        assinaturas.set(no, assinar(item));
        return no;
      },
      atualizar: (no, item) => {
        const nova = assinar(item);
        if (assinaturas.get(no) === nova) return undefined;
        const trocado = criarLinha(item);
        assinaturas.set(trocado, nova);
        return trocado;
      },
    });
  }

  function pintar() {
    pintarCorpo(
      corpoPassagens, listaPeriodos, linhaDaPassagem, assinarPassagem,
      'Nenhuma passagem cadastrada neste ano.'
    );
    pintarCorpo(
      corpoImpedimentos, listaImpedimentos, linhaDoImpedimento, assinarImpedimento,
      'Nenhum impedimento neste ano.'
    );
  }

  pintar();

  openModal({
    title: nome,
    width: '640px',
    content: el('div', {}, [
      secao('Passagens pela DGEO', corpoPassagens, el('button', {
        className: 'btn btn--secondary btn--sm',
        type: 'button',
        onClick: () => openPeriodoDialog({
          usuarioUuid: militar.usuario_uuid,
          nomeMilitar: nome,
          onSaved: aposSalvar,
        }),
        textContent: 'Nova',
      })),
      secao('Impedimentos', corpoImpedimentos, el('button', {
        className: 'btn btn--secondary btn--sm',
        type: 'button',
        onClick: () => openImpedimentoDialog({
          usuarioUuid: militar.usuario_uuid,
          nomeMilitar: nome,
          onSaved: aposSalvar,
        }),
        textContent: 'Novo',
      })),
      // O HISTORICO da PESSOA, RECOLHIDO. As passagens e os impedimentos caem
      // no mesmo agregado `usuario`, e e por isso que um painel so responde as
      // duas perguntas.
      //
      // SO PARA ADMINISTRADOR: a rota do historico de 'plataforma' e
      // verifyAdmin, e esta tela abre para qualquer pessoa logada.
      isAdmin()
        ? criarHistorico({
          modulo: 'plataforma',
          entidade: 'usuario',
          id: militar.usuario_uuid,
          titulo: 'Histórico da pessoa',
          subtitulo: 'Passagens pela DGEO, impedimentos, cadastro e perfis',
          recolhido: true,
        }).element
        : null,
    ].filter(Boolean)),
    actions: [
      // Fechar só fecha: cada salvamento já recarregou a tela de baixo.
      { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
    ],
  });
}
