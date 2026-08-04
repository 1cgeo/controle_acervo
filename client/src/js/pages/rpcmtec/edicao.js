import { el, svgIcon, ICONS, clearChildren } from '@utils/dom.js';
import { monthName, formatDateTime, formatDate } from '@utils/format.js';
import { showError, showSuccess, showWarning } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { criarHistorico } from '@components/historico/historico.js';
import { getUsuarios } from '@services/plataforma-service.js';
import {
  getDocumento, downloadRpcmtecPdf, fecharEdicao, reabrirEdicao, conferirHoje,
  copiarMesAnterior, limparSubsecao, listarAnexos, enviarAnexo, excluirAnexo,
  downloadAnexo, downloadAnuarioOds, downloadRtmOds,
} from '@services/rpcmtec-service.js';
import { abrirEditorSubsecao } from './subsecao-editor.js';
import { abrirDialogoEdicao } from './edicao-dialog.js';

/**
 * A EDICAO do RPCMTec (#/rpcmtec/:id): o documento inteiro, numa tela so.
 *
 * O QUE ELA MOSTRA e exatamente o que vai para o PDF. As celulas chegam do
 * servidor ja em texto, e esta tela nao formata nada por conta: com a tela
 * arredondando de um jeito e o arquivo de outro, quem confere ve diferenca onde
 * nao ha.
 *
 * A DIVISAO ENTRE CALCULADO E DIGITADO e visual e constante, e nao uma legenda
 * escondida (pedido do chefe, 2026-08-05). Cada subseccao carrega uma etiqueta:
 * a calculada diz de onde sai, e a digitada diz que e o gestor quem a preenche.
 * Sem isso, a tabela vazia de uma subsecao calculada e a de uma esquecida se
 * parecem, e so uma delas e problema.
 *
 * DOIS ESTADOS mudam a tela inteira:
 *
 *   ABERTA   o calculado sai do banco a cada abertura, o digitado se edita, e o
 *            PDF sai com a marca RASCUNHO;
 *   FECHADA  tudo vem congelado, nada se edita, e aparece o "conferir hoje" --
 *            que recalcula o calculado e mostra a diferenca contra o congelado.
 *
 * O "conferir hoje" e o contrapeso do congelamento: um pedido de marco
 * corrigido em agosto nao muda a edicao de marco, e esta certo, mas a
 * divergencia ficaria invisivel.
 */

const ORIGEM = { CALCULADA: 1, DIGITADA: 2, FIXA: 3 };

export async function renderRpcmtecEdicao(container, ctx) {
  let disposed = false;
  const edicaoId = Number(ctx?.params?.id);
  let documento = null;
  let usuarios = [];

  const cabecalho = el('div', { className: 'page__header page__header--column' });
  const barra = el('div', { className: 'rpcm-acoes' });
  const avisos = el('div');
  const corpo = el('div');
  const areaAnexos = el('div', { className: 'dashboard-section' });

  // O HISTORICO da edicao, RECOLHIDO. Fechar e reabrir sao os dois atos mais
  // consequentes desta tela -- um congela o documento que o chefe assina, o
  // outro o descongela --, e "quem reabriu a de julho" e pergunta que se faz
  // depois. O agregado `edicao` reune a edicao, as subsecoes digitadas e o
  // anexo assinado.
  //
  // A tela ja e admin-only (`adminLoader`), que e a mesma guarda da rota do
  // historico de 'plataforma': aqui nao ha o descasamento que obrigou a esconder
  // o painel na meta e na capacitacao.
  const areaHistorico = el('div', { className: 'dashboard-section' });

  const page = el('div', { className: 'page' }, [
    cabecalho, barra, avisos, areaAnexos, corpo, areaHistorico,
  ]);
  container.appendChild(page);

  // -------------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------------

  function desenharCabecalho() {
    clearChildren(cabecalho);

    const estado = !documento.fechada
      ? { texto: 'Aberta', classe: 'status-chip--warning' }
      : (documento.anexos > 0
        ? { texto: 'Assinada', classe: 'status-chip--success' }
        : { texto: 'Fechada', classe: 'status-chip--info' });

    const detalhes = [];
    if (documento.assinante_nome) {
      detalhes.push(`Assina: ${documento.assinante_posto || ''} ${documento.assinante_nome}`.trim());
    }
    if (documento.data_assinatura) {
      detalhes.push(`Assinada em ${formatDate(documento.data_assinatura)}`);
    }
    if (documento.data_fechamento) {
      detalhes.push(`Fechada em ${formatDateTime(documento.data_fechamento)}`);
    }

    cabecalho.append(
      el('a', {
        className: 'consulta-card__voltar',
        href: '#/rpcmtec',
        style: { marginBottom: '8px' },
      }, [svgIcon(ICONS.arrowBack, 14), 'Voltar para as edições']),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, [
        el('h1', {
          className: 'page__title',
          textContent: `RPCMTec ${monthName(documento.mes)}/${documento.ano}`,
        }),
        el('span', { className: `status-chip ${estado.classe}`, textContent: estado.texto }),
      ]),
      el('p', {
        className: 'page__subtitle',
        textContent: detalhes.join('  ·  ') || 'Assinante ainda não definido.',
      }),
    );
  }

  function botao(rotulo, icone, aoClicar, { primario = false, titulo = null } = {}) {
    return el('button', {
      className: primario ? 'btn btn--primary' : 'btn',
      type: 'button',
      ...(titulo ? { title: titulo } : {}),
      onClick: aoClicar,
    }, [icone ? svgIcon(icone, 16) : null, rotulo].filter(Boolean));
  }

  function desenharBarra() {
    clearChildren(barra);

    barra.appendChild(botao('Baixar PDF', ICONS.print, baixarPdf, {
      primario: true,
      titulo: documento.fechada
        ? 'O documento congelado, pronto para assinar.'
        : 'A edição está aberta: o PDF sai com a marca RASCUNHO.',
    }));

    if (!documento.fechada) {
      barra.append(
        botao('Copiar tudo do mês anterior', ICONS.contentCopy, () => copiar(null), {
          titulo: 'Traz o que foi digitado no mês passado, sem sobrescrever o que você já preencheu.',
        }),
        botao('Fechar e congelar', ICONS.lock, fechar),
      );
    } else {
      barra.append(
        botao('Conferir hoje', ICONS.swapHoriz, conferir, {
          titulo: 'Recalcula as subseções calculadas e mostra a diferença contra o congelado.',
        }),
        botao('Reabrir', ICONS.edit, reabrir),
      );
    }

    barra.append(
      botao('Editar metadados', ICONS.settings, () => abrirDialogoEdicao({
        edicao: documento, usuarios, onSaved: carregar,
      })),
      el('div', { style: { flex: '1' } }),
      botao('Anuário (ODS)', ICONS.download, baixarAnuario),
      botao(`RTM até ${monthName(documento.mes)} (ODS)`, ICONS.download, baixarRtm, {
        titulo: 'Detalhamento da Meta 4 do PIT, acumulado de janeiro até o mês da edição.',
      }),
    );
  }

  function desenharAvisos() {
    clearChildren(avisos);
    if (documento.fechada || !documento.pendentes.length) return;

    avisos.appendChild(el('div', { className: 'rpcm-aviso' }, [
      svgIcon(ICONS.warning, 18),
      el('div', {}, [
        el('strong', {
          textContent: `${documento.pendentes.length} subseção(ões) por preencher: `,
        }),
        documento.pendentes.join(', '),
        el('div', {
          className: 'rpcm-aviso__nota',
          textContent: 'Preencha cada uma ou marque "sem ocorrência no mês". '
            + 'A edição não fecha com subseção nunca visitada, porque vazio por decisão '
            + 'e vazio por esquecimento sairiam iguais no documento.',
        }),
      ]),
    ]));
  }

  /** A etiqueta que diz quem preenche a subseção. */
  function etiqueta(sub) {
    if (sub.origem === ORIGEM.CALCULADA) {
      return el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--calculada',
        title: sub.fonte ? `Sai de ${sub.fonte}` : 'Calculada pelo sistema',
        textContent: sub.fonte ? `Calculada: ${sub.fonte}` : 'Calculada',
      });
    }
    if (sub.origem === ORIGEM.FIXA) {
      return el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--fixa',
        textContent: 'Texto fixo',
      });
    }
    return el('span', {
      className: 'rpcm-etiqueta rpcm-etiqueta--digitada',
      title: sub.fonte ? `Fonte: ${sub.fonte}` : 'Preenchida à mão nesta tela',
      textContent: sub.fonte ? `Você preenche (${sub.fonte})` : 'Você preenche',
    });
  }

  /** Tabela somente leitura, com as células como o servidor as mandou. */
  function tabelaLeitura(sub) {
    const linhas = sub.linhas || [];
    const corpoTabela = linhas.length
      ? linhas.map((celulas) => el('tr', {}, sub.cabecalhos.map(
        (_, i) => el('td', { textContent: celulas[i] ?? '' }),
      )))
      // A tabela vazia imprime o '-' de cada coluna, que é como o modelo
      // escreve "não houve". A tela mostra o mesmo que o PDF.
      : [el('tr', {}, sub.cabecalhos.map(() => el('td', { textContent: '-' })))];

    return el('div', { className: 'rpcm-grade__wrap' }, [
      el('table', { className: 'rpcm-grade rpcm-grade--leitura' }, [
        el('thead', {}, [
          el('tr', {}, sub.cabecalhos.map((rotulo) => el('th', { textContent: rotulo }))),
        ]),
        el('tbody', {}, corpoTabela),
      ]),
    ]);
  }

  function desenharSubsecao(sub) {
    const acoes = [];

    if (sub.origem === ORIGEM.DIGITADA && !documento.fechada) {
      acoes.push(botao(
        sub.preenchida ? 'Editar' : 'Preencher',
        ICONS.edit,
        () => abrirEditorSubsecao({ edicaoId, subsecao: sub, onSaved: carregar }),
      ));
      acoes.push(botao('Copiar do mês anterior', ICONS.contentCopy,
        () => copiar(sub.numero)));
      if (sub.preenchida) {
        acoes.push(botao('Limpar', ICONS.delete, () => limpar(sub)));
      }
    }

    const marcas = [etiqueta(sub)];
    if (sub.semOcorrencia) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--vazia',
        textContent: 'Sem ocorrência no mês',
      }));
    }
    if (sub.origem === ORIGEM.DIGITADA && !sub.preenchida && !documento.fechada) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--pendente',
        textContent: 'Por preencher',
      }));
    }
    if (sub.semGerador) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--pendente',
        title: 'A estrutura declara esta subseção como calculada, e o gerador não a produz.',
        textContent: 'Lacuna do gerador',
      }));
    }

    let conteudo;
    if (sub.cabecalhos) {
      conteudo = tabelaLeitura(sub);
    } else {
      conteudo = el('p', {
        className: 'rpcm-prosa',
        textContent: sub.texto || '-',
      });
    }

    return el('div', { className: 'rpcm-subsecao' }, [
      el('div', { className: 'rpcm-subsecao__cabecalho' }, [
        el('h3', {
          className: 'rpcm-subsecao__titulo',
          textContent: sub.titulo ? `${sub.numero}. ${sub.titulo}` : `${sub.numero}.`,
        }),
        el('div', { className: 'rpcm-subsecao__marcas' }, marcas),
        el('div', { style: { flex: '1' } }),
        el('div', { className: 'rpcm-subsecao__acoes' }, acoes),
      ]),
      conteudo,
    ]);
  }

  function desenharCorpo() {
    clearChildren(corpo);

    for (const secao of documento.secoes) {
      // `details` aberto por padrão: quem abre a edição quer VER o relatório,
      // e não caçar nove gavetas. Fechar é gesto de quem já se orientou.
      const bloco = el('details', { className: 'rpcm-secao', open: true }, [
        el('summary', { className: 'rpcm-secao__titulo', textContent: secao.titulo }),
      ]);

      for (const sub of secao.subsecoes) bloco.appendChild(desenharSubsecao(sub));
      corpo.appendChild(bloco);
    }
  }

  async function desenharAnexos() {
    clearChildren(areaAnexos);

    let anexos = [];
    try {
      anexos = await listarAnexos(edicaoId);
    } catch {
      anexos = [];
    }
    if (disposed) return;

    const entrada = el('input', {
      type: 'file',
      accept: '.pdf,.p7s',
      className: 'form-field__input',
      style: { maxWidth: '360px' },
    });

    const enviar = el('button', {
      className: 'btn',
      type: 'button',
      onClick: async () => {
        const arquivo = entrada.files && entrada.files[0];
        if (!arquivo) {
          showWarning('Escolha o arquivo do RPCMTec assinado');
          return;
        }
        enviar.disabled = true;
        try {
          const dados = new FormData();
          dados.append('arquivo', arquivo);
          await enviarAnexo(edicaoId, dados);
          showSuccess('RPCMTec assinado anexado com sucesso');
          await carregar();
        } catch (err) {
          showError(err.message || 'Erro ao anexar o arquivo');
        } finally {
          enviar.disabled = false;
        }
      },
    }, [svgIcon(ICONS.add, 16), 'Anexar assinado']);

    const lista = anexos.length
      ? anexos.map((anexo) => el('div', { className: 'rpcm-anexo' }, [
        svgIcon(ICONS.description, 16),
        el('span', { textContent: anexo.nome_original }),
        el('span', {
          className: 'rpcm-anexo__meta',
          textContent: formatDateTime(anexo.data_cadastramento) || '',
        }),
        el('button', {
          className: 'btn btn--icon',
          type: 'button',
          title: 'Baixar',
          onClick: () => downloadAnexo(anexo.id, anexo.nome_original)
            .catch((err) => showError(err.message || 'Erro ao baixar o anexo')),
        }, [svgIcon(ICONS.download, 16)]),
        el('button', {
          className: 'btn btn--icon btn--danger-text',
          type: 'button',
          title: 'Excluir',
          onClick: () => removerAnexo(anexo),
        }, [svgIcon(ICONS.delete, 16)]),
      ]))
      : [el('p', {
        className: 'rpcm-anexo__vazio',
        textContent: 'Nenhum arquivo assinado anexado. '
          + 'O assinado é a fonte primária da edição: o congelado tem de dizer o que ele diz.',
      })];

    areaAnexos.append(
      el('div', { className: 'dashboard-section__header' }, [
        el('h3', { className: 'dashboard-section__title', textContent: 'RPCMTec assinado' }),
      ]),
      ...lista,
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, [
        entrada, enviar,
      ]),
    );
  }

  // -------------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------------

  async function baixarPdf() {
    try {
      await downloadRpcmtecPdf(edicaoId, documento.ano, documento.mes);
    } catch (err) {
      showError(err.message || 'Erro ao baixar o PDF');
    }
  }

  async function baixarAnuario() {
    try {
      await downloadAnuarioOds({ ano: documento.ano, mes: documento.mes });
    } catch (err) {
      showError(err.message || 'Erro ao baixar o Anuário');
    }
  }

  async function baixarRtm() {
    try {
      await downloadRtmOds({ ano: documento.ano, mes: documento.mes });
    } catch (err) {
      showError(err.message || 'Erro ao baixar o RTM');
    }
  }

  async function copiar(numero) {
    try {
      const resposta = await copiarMesAnterior(edicaoId, numero);
      const copiadas = resposta.copiadas || [];
      if (!copiadas.length) {
        showWarning(
          `Nada foi copiado de ${resposta.de}. `
          + 'Ou o mês anterior não tinha essas subseções, ou elas já estão preenchidas aqui.',
        );
      } else {
        showSuccess(`Copiadas de ${resposta.de}: ${copiadas.join(', ')}`);
      }
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao copiar do mês anterior');
    }
  }

  async function limpar(sub) {
    const ok = await confirmDialog({
      title: `Limpar ${sub.numero}`,
      message: 'A subseção volta a contar como NÃO preenchida, e o fechamento vai cobrá-la de novo. '
        + 'É diferente de marcar "sem ocorrência no mês".',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (!ok) return;

    try {
      await limparSubsecao(edicaoId, sub.numero);
      showSuccess(`${sub.numero} limpa`);
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao limpar a subseção');
    }
  }

  async function fechar() {
    const ok = await confirmDialog({
      title: 'Fechar e congelar a edição',
      message: 'Os 34 blocos são gravados como estão AGORA, inclusive os calculados. '
        + 'A partir daí o documento não muda quando o banco mudar, que é o que torna '
        + 'a edição reproduzível. Reabrir depois é possível e fica no rastro.',
      confirmLabel: 'Fechar e congelar',
    });
    if (!ok) return;

    try {
      const resposta = await fecharEdicao(edicaoId);
      showSuccess(`Edição fechada. ${resposta.subsecoes} blocos congelados.`);
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao fechar a edição');
    }
  }

  async function reabrir() {
    const ok = await confirmDialog({
      title: 'Reabrir a edição',
      message: 'O calculado volta a sair do banco e pode mudar. O que você digitou é preservado. '
        + 'Se o documento já foi assinado, o assinado deixa de corresponder ao que a tela mostra.',
      confirmLabel: 'Reabrir',
      danger: true,
    });
    if (!ok) return;

    try {
      await reabrirEdicao(edicaoId);
      showSuccess('Edição reaberta');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao reabrir a edição');
    }
  }

  async function conferir() {
    let resultado;
    try {
      resultado = await conferirHoje(edicaoId);
    } catch (err) {
      showError(err.message || 'Erro ao conferir');
      return;
    }

    const divergentes = resultado.subsecoes.filter((s) => !s.igual);

    const conteudo = divergentes.length
      ? el('div', {}, divergentes.map((s) => el('div', { className: 'rpcm-conferencia' }, [
        el('h4', { textContent: `${s.numero}. ${s.titulo}` }),
        el('div', { className: 'rpcm-conferencia__par' }, [
          el('div', {}, [
            el('strong', { textContent: 'Congelado no fechamento' }),
            tabelaSimples(s.cabecalhos, s.congelado),
          ]),
          el('div', {}, [
            el('strong', { textContent: 'O banco diria hoje' }),
            tabelaSimples(s.cabecalhos, s.hoje),
          ]),
        ]),
      ])))
      : el('p', {
        textContent: `As ${resultado.subsecoes.length} subseções calculadas continuam iguais ao congelado. `
          + 'O que a edição afirma é o que o banco diz hoje.',
      });

    openModal({
      title: `Conferência do RPCMTec ${monthName(resultado.mes)}/${resultado.ano}`,
      content: conteudo,
      width: '1100px',
      actions: [{ label: 'Fechar', variant: 'primary', onClick: ({ close }) => close() }],
    });
  }

  function tabelaSimples(cabecalhos, linhas) {
    return el('div', { className: 'rpcm-grade__wrap' }, [
      el('table', { className: 'rpcm-grade rpcm-grade--leitura' }, [
        el('thead', {}, [
          el('tr', {}, (cabecalhos || []).map((c) => el('th', { textContent: c }))),
        ]),
        el('tbody', {}, (linhas || []).map((celulas) => el('tr', {},
          (cabecalhos || []).map((_, i) => el('td', { textContent: celulas[i] ?? '' }))))),
      ]),
    ]);
  }

  async function removerAnexo(anexo) {
    const ok = await confirmDialog({
      title: 'Excluir anexo',
      message: `Excluir "${anexo.nome_original}"? O documento assinado sai do sistema.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;

    try {
      await excluirAnexo(anexo.id);
      showSuccess('Anexo excluído');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o anexo');
    }
  }

  // -------------------------------------------------------------------------

  async function carregar() {
    try {
      documento = await getDocumento(edicaoId);
      if (disposed) return;
      desenharCabecalho();
      desenharBarra();
      desenharAvisos();
      desenharCorpo();
      await desenharAnexos();
      // Remontado a cada carga porque a edicao muda de estado por baixo (fechar,
      // reabrir, anexar), e o painel tem de trazer o evento que acabou de sair.
      clearChildren(areaHistorico);
      areaHistorico.appendChild(criarHistorico({
        modulo: 'plataforma',
        entidade: 'edicao',
        id: edicaoId,
        titulo: 'Histórico da edição',
        subtitulo: 'Metadados, subseções digitadas, fechamento, reabertura e anexo assinado',
        recolhido: true,
      }).element);
    } catch (err) {
      if (disposed) return;
      clearChildren(corpo);
      showError(err.message || 'Erro ao carregar a edição do RPCMTec');
    }
  }

  try {
    const lista = await getUsuarios();
    if (!disposed) {
      usuarios = (lista || [])
        .filter((u) => u.ativo)
        .sort((a, b) => b.tipo_posto_grad_id - a.tipo_posto_grad_id
          || a.nome_guerra.localeCompare(b.nome_guerra));
    }
  } catch {
    usuarios = [];
  }

  await carregar();

  return () => { disposed = true; };
}
