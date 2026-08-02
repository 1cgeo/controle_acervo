import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  atualizarViewsMaterializadas,
  criarViewsMaterializadas,
  limparDownloadsExpirados,
  renomearPadrao,
  atualizarChecksum,
} from '@modules/acervo/services/admin-service.js';

/**
 * Aba "Manutenção": as quatro ações de ADMINISTRADOR GLOBAL do acervo.
 *
 * Não é uma tabela, e sim um cartão por ação, porque não são registros que se
 * leem: são operações que se disparam, e o que cada uma precisa dizer não é uma
 * coluna, é uma frase. Duas mexem no banco inteiro, uma mexe no DISCO e uma relê
 * byte do volume -- e nenhuma delas é reversível pelo botão ao lado.
 *
 * TODO CARTÃO TEM TRÊS PARTES, e a ordem importa: o que a ação faz, o que ela
 * NÃO faz (que é onde mora o susto), e o acompanhamento. Sem a terceira, ações
 * que levam minutos pareceriam travadas, e a pessoa apertaria de novo.
 *
 * Guarda: `verifyAdmin` nas quatro rotas. A aba só é montada para o administrador
 * global (ver `pages/administracao/index.js`), e quem barra continua sendo o
 * servidor.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function}>}
 */
export async function renderManutencaoTab(container) {
  let disposed = false;

  /** Uma linha de estado por cartão, lida por leitor de tela conforme muda. */
  const criarStatus = () => el('p', {
    className: 'manutencao__status',
    role: 'status',
    'aria-live': 'polite',
  });

  /**
   * Monta um cartão.
   * @param {{titulo:string, descricao:string, avisos:Array<string>,
   *   corpo?:Array<Node>, acoes:Array<Node>, status:Node, saida?:Node}} cfg
   */
  function cartao({ titulo, descricao, avisos = [], corpo = [], acoes, status, saida }) {
    return el('section', { className: 'manutencao__cartao' }, [
      el('h3', { className: 'manutencao__titulo', textContent: titulo }),
      el('p', { className: 'manutencao__desc', textContent: descricao }),
      avisos.length
        ? el('ul', { className: 'manutencao__avisos' },
          avisos.map(a => el('li', { textContent: a })))
        : null,
      ...corpo,
      el('div', { className: 'manutencao__acoes' }, acoes),
      status,
      saida || null,
    ].filter(Boolean));
  }

  /** Tabela simples a partir de uma lista de objetos (as colunas saem dela). */
  function tabelaDe(linhas, colunas) {
    return el('div', { className: 'manutencao__tabela-scroll' }, [
      el('table', { className: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, colunas.map(c => el('th', { textContent: c.label }))),
        ]),
        el('tbody', {}, linhas.map(linha =>
          el('tr', {}, colunas.map(c => el('td', {
            textContent: c.valor(linha) ?? '',
          }))))),
      ]),
    ]);
  }

  /**
   * Roda uma ação de um clique: desabilita o botão, conta o que aconteceu e
   * devolve o controle. O `finally` é o que impede o botão de ficar morto
   * quando a rota falha.
   */
  async function acaoSimples(btn, status, { confirmar, executar, feito }) {
    if (confirmar) {
      const ok = await confirmDialog(confirmar);
      if (!ok) return;
    }
    btn.disabled = true;
    status.textContent = 'Executando no servidor...';
    try {
      const dados = await executar();
      if (disposed) return;
      status.textContent = feito(dados);
      showSuccess(feito(dados));
    } catch (err) {
      if (disposed) return;
      status.textContent = `Falhou: ${err.message || 'erro desconhecido'}`;
      showError(err.message || 'A operação falhou');
    } finally {
      if (!disposed) btn.disabled = false;
    }
  }

  // -------------------------------------------------------------------------
  // 1. Visões materializadas
  // -------------------------------------------------------------------------
  const statusViews = criarStatus();

  const atualizarViewsBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => acaoSimples(atualizarViewsBtn, statusViews, {
      executar: atualizarViewsMaterializadas,
      feito: () => 'Visões materializadas atualizadas.',
    }),
  }, [svgIcon(ICONS.dataUsage, 16), 'Atualizar todas']);

  const criarViewsBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => acaoSimples(criarViewsBtn, statusViews, {
      confirmar: {
        title: 'Criar as visões que faltam',
        message: 'Cria uma visão para cada par de tipo de produto e escala que ainda '
          + 'não tem. Não recria nem apaga o que já existe. É a operação da '
          + 'instalação, e do dia em que um código novo entra num dos dois domínios. '
          + 'Continuar?',
        confirmLabel: 'Criar',
      },
      executar: criarViewsMaterializadas,
      feito: () => 'Visões materializadas criadas.',
    }),
  }, [svgIcon(ICONS.add, 16), 'Criar as que faltam']);

  const cartaoViews = cartao({
    titulo: 'Visões materializadas',
    descricao: 'As visões acervo.mv_produto_<tipo>_<escala> alimentam o painel e o '
      + 'acompanhamento. Há gatilhos que já as atualizam a cada escrita.',
    avisos: [
      'Atualizar é o conserto de quando um gatilho falhou: o tratamento de erro deles '
        + 'engole a falha de propósito, para não derrubar a gravação que a disparou.',
      'Criar é só para o par de tipo e escala que ainda não tem visão. Numa base já '
        + 'instalada, ela não faz nada e não é o que corrige número errado.',
    ],
    acoes: [atualizarViewsBtn, criarViewsBtn],
    status: statusViews,
  });

  // -------------------------------------------------------------------------
  // 2. Downloads expirados
  // -------------------------------------------------------------------------
  const statusDownloads = criarStatus();

  const limparBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => acaoSimples(limparBtn, statusDownloads, {
      confirmar: {
        title: 'Limpar downloads expirados',
        message: 'Marca como "failed" todo download que ficou pendente além do prazo. '
          + 'Nenhum arquivo é apagado: o que muda é o registro. Continuar?',
        confirmLabel: 'Limpar',
      },
      executar: limparDownloadsExpirados,
      feito: () => 'Downloads expirados marcados como falhos.',
    }),
  }, [svgIcon(ICONS.delete, 16), 'Limpar expirados']);

  const cartaoDownloads = cartao({
    titulo: 'Downloads expirados',
    descricao: 'O token de download tem prazo. Quem o pediu e nunca confirmou fica '
      + 'pendente para sempre, e esta ação fecha esses registros.',
    avisos: [
      'Não apaga arquivo nenhum, nem no volume nem no banco: só muda o status do '
        + 'registro de download.',
      'Download que deu certo e foi confirmado não é tocado.',
    ],
    acoes: [limparBtn],
    status: statusDownloads,
  });

  // -------------------------------------------------------------------------
  // 3. Padronizar o nome físico dos arquivos
  // -------------------------------------------------------------------------
  //
  // A unica das quatro que nao e um clique. A rota trabalha por LOTE de
  // proposito, e e para chamar em laco ate `restantes` zerar. Um botao unico
  // que fizesse uma chamada e dissesse "pronto" mentiria sobre os milhares
  // restantes -- e e por isso que o acompanhamento aqui e obrigatorio, e nao
  // enfeite.
  const statusRenome = criarStatus();
  const saidaRenome = el('div', { className: 'manutencao__saida' });

  const motivoRenome = el('input', {
    className: 'form-field__input',
    type: 'text',
    placeholder: 'Por que o renome está sendo feito',
  });
  const limiteRenome = el('input', {
    className: 'form-field__input',
    type: 'number',
    value: '500',
    min: '1',
    max: '5000',
  });

  // O Joi da rota cobra 1..5000, e o campo e `type=number`: `min`/`max` no HTML
  // nao impedem digitar 6000 nem 0. Sem isto, 6000 volta um 400 com a mensagem
  // crua do Joi e 0 vira 500 em silencio pelo `|| 500`. Mesmo cuidado que o
  // campo de ids do checksum ja tem, mais abaixo neste arquivo.
  const limiteEscolhido = () => {
    const n = Math.trunc(Number(limiteRenome.value));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 5000);
  };

  let divergentesTotal = null;

  const simularBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => simularRenome(),
  }, [svgIcon(ICONS.visibility, 16), 'Simular']);

  const aplicarBtn = el('button', {
    className: 'btn btn--danger',
    type: 'button',
    onClick: () => aplicarRenome(),
  }, [svgIcon(ICONS.swapHoriz, 16), 'Aplicar']);
  aplicarBtn.disabled = true;

  /** O motivo é exigido pelo servidor (mínimo de 5). Recusar aqui poupa o 400. */
  function motivoValido(campo) {
    const motivo = campo.value.trim();
    if (motivo.length < 5) {
      showError('Descreva em pelo menos 5 caracteres o motivo. Ele fica registrado.');
      return null;
    }
    return motivo;
  }

  async function simularRenome() {
    const motivo = motivoValido(motivoRenome);
    if (!motivo) return;

    simularBtn.disabled = true;
    aplicarBtn.disabled = true;
    statusRenome.textContent = 'Calculando o plano no servidor...';
    saidaRenome.replaceChildren();

    try {
      const d = await renomearPadrao({
        motivo,
        dry_run: true,
        limite: limiteEscolhido(),
      });
      if (disposed) return;

      divergentesTotal = d.divergentes_total;

      if (!divergentesTotal) {
        statusRenome.textContent = 'Nenhum arquivo divergente: todo nome físico já bate '
          + 'com o padrão.';
        return;
      }

      statusRenome.textContent = `${formatNumber(divergentesTotal)} arquivo(s) com nome `
        + `divergente. Esta chamada trataria ${formatNumber(d.nesta_chamada)}, restando `
        + `${formatNumber(d.restantes)}.`;

      // A amostra do plano vem limitada a 20 pelo servidor. Dizer isso evita que
      // alguem confira as 20 e conclua que o plano inteiro esta certo.
      const amostra = d.amostra || [];
      saidaRenome.replaceChildren(
        el('p', {
          className: 'manutencao__legenda',
          textContent: `Plano (${formatNumber(amostra.length)} de `
            + `${formatNumber(divergentesTotal)}):`,
        }),
        tabelaDe(amostra, [
          { label: 'Id', valor: r => String(r.id) },
          { label: 'Nome atual', valor: r => r.de },
          { label: 'Nome padrão', valor: r => r.para },
        ]),
      );
      aplicarBtn.disabled = false;
    } catch (err) {
      if (disposed) return;
      // O servidor responde 409 quando há sessão de upload aberta e 400 quando
      // algum metadado não computa nome. As duas frases dizem o que fazer, e
      // trocá-las por um texto genérico esconderia justamente isso.
      statusRenome.textContent = `Falhou: ${err.message || 'erro desconhecido'}`;
      showError(err.message || 'Não foi possível calcular o plano');
    } finally {
      if (!disposed) simularBtn.disabled = false;
    }
  }

  async function aplicarRenome() {
    const motivo = motivoValido(motivoRenome);
    if (!motivo) return;

    const limite = limiteEscolhido();
    const ok = await confirmDialog({
      title: 'Aplicar o renome',
      message: `Os arquivos serão renomeados NO VOLUME e no banco, em lotes de `
        + `${formatNumber(limite)}, até acabar. São ${formatNumber(divergentesTotal || 0)} `
        + 'arquivo(s) divergentes.\n\n'
        + 'O servidor recusa a operação se houver sessão de upload aberta, e reverte '
        + 'cada renome que falhar. Continuar?',
      confirmLabel: 'Aplicar',
      danger: true,
    });
    if (!ok) return;

    simularBtn.disabled = true;
    aplicarBtn.disabled = true;
    saidaRenome.replaceChildren();

    let renomeados = 0;
    let falhas = 0;

    // O LAÇO é do cliente porque a rota trabalha por lote. Ele para em três
    // casos: acabou (`restantes` zerou), houve falha (insistir repetiria o mesmo
    // erro até o teto de 5.000) ou o lote não andou (`nesta_chamada` zero, que
    // seria laço infinito).
    try {
      for (;;) {
        const d = await renomearPadrao({ motivo, dry_run: false, limite });
        if (disposed) return;

        renomeados += d.renomeados || 0;
        falhas += d.falhas || 0;
        statusRenome.textContent = `${formatNumber(renomeados)} renomeado(s), `
          + `${formatNumber(falhas)} falha(s), ${formatNumber(d.restantes || 0)} restante(s)...`;

        if (d.falhas) {
          mostrarFalhasRenome(d);
          break;
        }
        if (!d.restantes || !d.nesta_chamada) break;
      }

      const resumo = `Renome concluído: ${formatNumber(renomeados)} arquivo(s) `
        + `renomeado(s), ${formatNumber(falhas)} falha(s).`;
      statusRenome.textContent = resumo;
      if (falhas) showError(resumo);
      else showSuccess(resumo);
    } catch (err) {
      if (disposed) return;
      statusRenome.textContent = `Interrompido: ${err.message || 'erro desconhecido'}. `
        + `${formatNumber(renomeados)} arquivo(s) já haviam sido renomeados.`;
      showError(err.message || 'O renome falhou');
    } finally {
      if (!disposed) {
        simularBtn.disabled = false;
        divergentesTotal = null;
        // Depois de aplicar, o plano na tela envelheceu. Aplicar de novo sem
        // simular repetiria uma contagem que ja nao vale.
        aplicarBtn.disabled = true;
      }
    }
  }

  function mostrarFalhasRenome(d) {
    const detalhe = d.detalhe || [];
    saidaRenome.replaceChildren(
      el('p', {
        className: 'manutencao__legenda',
        textContent: `${formatNumber(d.falhas)} arquivo(s) não foram renomeados. O banco `
          + 'e o disco foram revertidos para cada um deles.'
          + (d.interrompido ? ` ${d.interrompido}.` : ''),
      }),
      tabelaDe(detalhe, [
        { label: 'Id', valor: r => String(r.id) },
        { label: 'De', valor: r => r.de },
        { label: 'Para', valor: r => r.para },
        { label: 'Erro', valor: r => r.erro },
      ]),
    );
  }

  const cartaoRenome = cartao({
    titulo: 'Padronizar o nome físico dos arquivos',
    descricao: 'O nome do arquivo no volume é DERIVADO dos metadados, e derivado '
      + 'envelhece: renumerar uma edição ou corrigir um subtipo muda o nome esperado e '
      + 'não toca no arquivo. Esta ação reconcilia os dois, com a mesma regra que o '
      + 'invariante 7a usa para auditar.',
    avisos: [
      'Começa em SIMULAÇÃO. O plano mostra de que nome para qual, e nada muda até você '
        + 'apertar Aplicar.',
      'Aplicar renomeia no volume, em lotes, chamando o servidor quantas vezes for '
        + 'preciso. O acompanhamento abaixo diz quantos faltam.',
      'O servidor recusa enquanto houver sessão de upload aberta: renomear por baixo de '
        + 'uma transferência perderia bytes.',
      'Volume marcado como layout de origem fica de fora, e é irreversível o motivo: '
        + 'renomear um .img do ERDAS quebra a referência interna ao .ige, onde estão os '
        + 'pixels.',
      'Arquivo cujo nome padrão não é computável aborta a operação inteira, com a lista '
        + 'dos culpados. Conserte os metadados primeiro; o invariante 7b os lista.',
    ],
    corpo: [
      el('div', { className: 'manutencao__campos' }, [
        el('label', { className: 'manutencao__campo' }, [
          el('span', { textContent: 'Motivo (fica registrado)' }),
          motivoRenome,
        ]),
        el('label', { className: 'manutencao__campo manutencao__campo--curto' }, [
          el('span', { textContent: 'Arquivos por lote' }),
          limiteRenome,
        ]),
      ]),
    ],
    acoes: [simularBtn, aplicarBtn],
    status: statusRenome,
    saida: saidaRenome,
  });

  // -------------------------------------------------------------------------
  // 4. Atualizar checksum por releitura
  // -------------------------------------------------------------------------
  const statusChecksum = criarStatus();
  const saidaChecksum = el('div', { className: 'manutencao__saida' });

  const idsChecksum = el('textarea', {
    className: 'form-field__input',
    rows: 3,
    placeholder: 'Ids dos arquivos, separados por vírgula, espaço ou quebra de linha',
  });
  const motivoChecksum = el('input', {
    className: 'form-field__input',
    type: 'text',
    placeholder: 'Por que o checksum está sendo remedido',
  });

  const checksumBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => aplicarChecksum(),
  }, [svgIcon(ICONS.check, 16), 'Reler e atualizar']);

  /** Aceita vírgula, espaço ou quebra de linha: colar de qualquer lugar funciona. */
  function idsDigitados() {
    return [...new Set(
      idsChecksum.value.split(/[^0-9]+/).filter(Boolean).map(Number),
    )];
  }

  async function aplicarChecksum() {
    const motivo = motivoValido(motivoChecksum);
    if (!motivo) return;

    const ids = idsDigitados();
    if (!ids.length) {
      showError('Informe ao menos um id de arquivo.');
      return;
    }
    // O teto do schema é 500. Recusar aqui evita um 400 com a mensagem crua do
    // Joi depois de a pessoa colar uma lista longa.
    if (ids.length > 500) {
      showError(`São ${formatNumber(ids.length)} ids, e o limite por chamada é 500. `
        + 'Divida a lista.');
      return;
    }

    const ok = await confirmDialog({
      title: 'Reler e atualizar checksum',
      message: `O servidor vai reler ${formatNumber(ids.length)} arquivo(s) no volume e `
        + 'gravar o checksum e o tamanho que ele mesmo medir. A leitura é longa para '
        + 'arquivo grande.\n\n'
        + 'Se algum dos arquivos não existir no volume, NADA é alterado. Continuar?',
      confirmLabel: 'Reler',
    });
    if (!ok) return;

    checksumBtn.disabled = true;
    statusChecksum.textContent = `Relendo ${formatNumber(ids.length)} arquivo(s) no volume...`;
    saidaChecksum.replaceChildren();

    try {
      const d = await atualizarChecksum({ arquivo_ids: ids, motivo });
      if (disposed) return;

      const economia = Number(d.economia_mb || 0);
      statusChecksum.textContent = `${formatNumber(d.alterados)} alterado(s), `
        + `${formatNumber(d.inalterados)} sem mudança`
        + (economia ? `, ${economia.toFixed(2)} MB de diferença.` : '.');

      saidaChecksum.replaceChildren(
        tabelaDe(d.arquivos || [], [
          { label: 'Id', valor: r => String(r.id) },
          { label: 'Arquivo', valor: r => `${r.nome_arquivo}.${r.extensao}` },
          { label: 'Mudou', valor: r => (r.alterado ? 'Sim' : 'Não') },
          { label: 'MB antes', valor: r => formatNumber(r.tamanho_mb_anterior) },
          { label: 'MB agora', valor: r => formatNumber(r.tamanho_mb_novo) },
        ]),
      );
      showSuccess('Checksum atualizado por releitura do volume.');
    } catch (err) {
      if (disposed) return;
      statusChecksum.textContent = `Falhou: ${err.message || 'erro desconhecido'}`;
      showError(err.message || 'Não foi possível atualizar o checksum');
    } finally {
      if (!disposed) checksumBtn.disabled = false;
    }
  }

  const cartaoChecksum = cartao({
    titulo: 'Atualizar checksum por releitura',
    descricao: 'Depois de recompressão sem perda o pixel é o mesmo e os bytes não são: '
      + 'o SHA-256 gravado deixa de bater com o arquivo. Esta ação manda o servidor reler '
      + 'o arquivo no volume e gravar o que ele mesmo medir.',
    avisos: [
      'Trabalha por ID, e não sozinha: os ids saem da amostra dos invariantes 4a e 4f da '
        + 'tela de Auditoria, ou de quem fez a recompressão.',
      'Se qualquer um dos arquivos não existir no volume, NADA é alterado.',
      'Preserva o id, o uuid e o histórico de download do arquivo, ao contrário de '
        + 'substituir o arquivo por upload.',
      'Até 500 ids por chamada.',
    ],
    corpo: [
      el('div', { className: 'manutencao__campos' }, [
        el('label', { className: 'manutencao__campo manutencao__campo--largo' }, [
          el('span', { textContent: 'Ids dos arquivos' }),
          idsChecksum,
        ]),
        el('label', { className: 'manutencao__campo' }, [
          el('span', { textContent: 'Motivo (fica registrado)' }),
          motivoChecksum,
        ]),
      ]),
    ],
    acoes: [checksumBtn],
    status: statusChecksum,
    saida: saidaChecksum,
  });

  container.appendChild(el('div', {}, [
    el('p', {
      className: 'page__subtitle',
      textContent: 'Operações de administrador sobre o acervo inteiro. Cada uma diz o que '
        + 'faz e o que não faz antes de perguntar; nenhuma se desfaz pelo botão ao lado.',
    }),
    el('div', { className: 'manutencao' }, [
      cartaoViews,
      cartaoDownloads,
      cartaoRenome,
      cartaoChecksum,
    ]),
  ]));

  return {
    cleanup: () => { disposed = true; },
  };
}
