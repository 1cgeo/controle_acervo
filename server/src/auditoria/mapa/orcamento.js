'use strict'

/**
 * Mapa de auditoria do modulo ORCAMENTO.
 *
 * O contrato de uma entrada esta em `../index.js`.
 *
 * ESTE E O MODULO EM QUE "qual era o valor antes" E A PERGUNTA MAIS PROVAVEL:
 * todas as tabelas daqui carregam valor financeiro. Por isso TODA coluna de
 * valor sai com `tipo: 'dinheiro'` e toda data com `tipo: 'data'` -- sem isso a
 * tela mostra "1000.00 -> 1500.00" e "2026-08-02T00:00:00.000Z".
 *
 * OS OITO AGREGADOS. A regra e a da casa: o agregado e a FICHA QUE A PESSOA
 * ABRE. Ninguem abre "liquidacao n.o 812"; abre a nota de empenho e olha as
 * liquidacoes dela. Dai:
 *
 *   dfd            <- dfd, dfd_item
 *   pdr            <- pdr_item                     (o agregado e o ANO)
 *   nota_credito   <- nota_credito, nota_credito_recolhimento
 *   nota_empenho   <- nota_empenho, nota_empenho_nota_credito, liquidacao,
 *                     recebimento_material
 *   licitacao      <- licitacao
 *   rpnp           <- rpnp
 *   configuracao   <- configuracao                 (singleton, id 1)
 *   dominio        <- natureza_despesa, plano_interno, ug
 *
 * E `orcamento.arquivo`, cujo agregado NAO e fixo: o CHECK `arquivo_um_vinculo`
 * garante que ele pertence a exatamente uma NC, um DFD, o PDR de um ano ou um
 * documento de recolhimento, e o historico dele tem de aparecer na ficha do
 * dono. E a unica entrada do sistema com `entidade` resolvida por linha (ver o
 * comentario dela abaixo).
 */

// DUAS TABELAS FILHAS SAO AUDITADAS COMO LISTA, e nao linha a linha:
// `dfd_item` e `nota_empenho_nota_credito` sao reescritas INTEIRAS a cada
// salvamento (apaga tudo e reinsere), entao o id e o carimbo mudam sempre e
// compara-las linha a linha acusaria mudanca em todo salvamento -- o historico
// do DFD viraria "removeu 4 itens, acrescentou 4 itens" toda vez que alguem
// abrisse e salvasse. O evento e do PAI, com o antes e o depois da lista
// inteira, e a lista vai descrita em TEXTO: o que mudou de verdade e o que esta
// escrito nela. Quem monta a descricao e o controller que reescreve a lista
// (`dfd_ctrl` e `nota_empenho_ctrl`), que e o unico chamador de cada uma.

module.exports = {
  // --- Agregado: dfd --------------------------------------------------------

  'orcamento.dfd': {
    modulo: 'orcamento',
    entidade: 'dfd',
    agregado: (t, linha) => linha.id,
    // O numero e o ano, e nao o id: e por eles que o DFD e citado no PCA.
    resumo: linha => `DFD ${linha.numero}/${linha.ano}`,
    campos: {
      numero: { rotulo: 'Número' },
      ano: { rotulo: 'Ano', tipo: 'numero' },
      rotulo: { rotulo: 'Rótulo' },
      objeto: { rotulo: 'Objeto' },
      area_requisitante: { rotulo: 'Área requisitante' },
      // Distingue a demanda que esta no PCA da superveniente (ex.: DFD de IA).
      consta_pca: { rotulo: 'Consta do PCA', tipo: 'booleano' },

      // AS SEIS QUE SAIRAM NA 1.43.0, todas HISTORICO pelo mesmo motivo do
      // `meta_pit_id` da NC: `auditoria.evento` e append-only, e o evento ja
      // gravado continua trazendo o campo. Sem a declaracao, a ficha de um DFD
      // antigo exibiria o nome cru da coluna onde hoje exibe o rotulo. Evento
      // NOVO nenhum traz qualquer uma delas.
      //
      // `grau_prioridade_id` perdeu tambem o `dominio`, e nao so por arrumacao:
      // `dominio.grau_prioridade` saiu do banco no mesmo commit, e a varredura
      // de `__tests__/auditoria/mapa.test.js` cobra que todo dominio citado
      // exista nos `er/`. O codigo sai cru (1 Alta, 2 Normal, 3 Baixa), e e o
      // maximo honesto que se pode dizer de um catalogo que nao existe mais.
      justificativa: { rotulo: 'Justificativa (até 1.42.0)', historico: true },
      grau_prioridade_id: {
        rotulo: 'Grau de prioridade (até 1.42.0: 1 Alta, 2 Normal, 3 Baixa)',
        historico: true
      },
      data_prevista_conclusao: {
        rotulo: 'Data prevista de conclusão (até 1.42.0)', tipo: 'data', historico: true
      },
      responsavel_cpf: { rotulo: 'CPF do responsável (até 1.42.0)', historico: true },
      vinculo_plano_gestao: {
        rotulo: 'Vínculo com o plano de gestão (até 1.42.0)', historico: true
      },
      // Ele NAO sumiu da resposta da API: virou a soma dos itens, derivada em
      // consulta. O que saiu foi a COLUNA, e por isso o campo e historico aqui.
      valor_estimado: {
        rotulo: 'Valor estimado (até 1.42.0: coluna)', tipo: 'dinheiro', historico: true
      }
    }
  },

  'orcamento.dfd_item': {
    modulo: 'orcamento',
    entidade: 'dfd',
    agregado: (t, linha) => linha.dfd_id,
    // ESTA ENTRADA DESCREVE A LISTA, e nao a linha: o controller registra UM
    // evento por salvamento, com a lista inteira dos dois lados.
    resumo: linha => `${(linha.itens || []).length} item(ns) do DFD`,
    campos: {
      // SINTETICO: nao ha coluna `itens` em `orcamento.dfd_item`. Ela e montada
      // pelo controller com a lista inteira descrita em texto, que e o que
      // permite o evento ser do PAI (ver o comentario no topo).
      itens: { rotulo: 'Itens', tipo: 'lista', sintetico: true },
      dfd_id: { rotulo: 'DFD', entidade: 'dfd' }
    }
  },

  // --- Agregado: pdr --------------------------------------------------------
  // Nao ha cabecalho de PDR (CLAUDE.md): o PDR do ano E o conjunto dos
  // `pdr_item` daquele ano. Entao o agregado e o proprio ANO, e a ficha do PDR
  // de 2026 traz o historico de todos os seus itens.
  //
  // Consequencia declarada: mudar o `ano` de um item move o evento para a ficha
  // do ano NOVO (o agregado sai de `depois`), e o ano antigo perde aquela linha
  // do historico. E o comportamento certo -- o item passou a ser de outro PDR --
  // e o proprio evento diz "Ano: 2025 -> 2026".
  'orcamento.pdr_item': {
    modulo: 'orcamento',
    entidade: 'pdr',
    agregado: (t, linha) => linha.ano,
    resumo: linha => `Item ${linha.item_label || `#${linha.id}`} do PDR ${linha.ano}`,
    campos: {
      ano: { rotulo: 'Ano', tipo: 'numero' },
      cod_nd: { rotulo: 'Natureza de despesa', dominio: 'dominio.natureza_despesa' },
      meta_pit_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      item_label: { rotulo: 'Item' },
      descricao: { rotulo: 'Descrição' },
      // HISTORICO desde a 1.43.0. O GND deixou de ser coluna do item e passou a
      // vir da natureza de despesa por JOIN: ele era igual ao
      // `natureza_despesa.gnd` do `cod_nd` em 36 de 36 linhas de producao, e o
      // formulario ja o exibia desabilitado. Ele continua SAINDO na leitura com
      // o mesmo nome; o que mudou e a fonte. Evento novo nenhum o traz.
      gnd: { rotulo: 'GND (até 1.42.0: coluna)', tipo: 'numero', historico: true },
      valor_solicitado: { rotulo: 'Valor solicitado', tipo: 'dinheiro' },
      valor_autorizado: { rotulo: 'Valor autorizado', tipo: 'dinheiro' },
      observacao: { rotulo: 'Observação' }
    }
  },

  // --- Agregado: nota_credito -----------------------------------------------

  'orcamento.nota_credito': {
    modulo: 'orcamento',
    entidade: 'nota_credito',
    agregado: (t, linha) => linha.id,
    // O numero SOZINHO nao identifica a NC: o par (numero, ND) e o que se usa no
    // dia a dia, porque a mesma NC pode vir com mais de uma ND e a unicidade e
    // (ano, numero, ND) por UG emitente.
    resumo: linha => `NC ${linha.numero}/${linha.ano} (ND ${linha.cod_nd})`,
    campos: {
      numero: { rotulo: 'Número' },
      ano: { rotulo: 'Ano', tipo: 'numero' },
      data_emissao: { rotulo: 'Data de emissão', tipo: 'data' },
      cod_nd: { rotulo: 'Natureza de despesa', dominio: 'dominio.natureza_despesa' },
      ptres: { rotulo: 'PTRES' },
      fonte: { rotulo: 'Fonte' },
      cod_pi: { rotulo: 'Plano interno', dominio: 'dominio.plano_interno' },
      ug_emitente: { rotulo: 'UG emitente', dominio: 'dominio.ug' },
      finalidade_historico: { rotulo: 'Finalidade / histórico' },
      // HISTORICO, e por isso FICA. A coluna saiu da tabela na 1.31.0 (a meta da
      // NC passou a vir do item do PDR), mas `auditoria.evento` e append-only e
      // nao tem UPDATE nem DELETE para a aplicacao: os eventos gravados antes
      // ainda trazem este campo. Sem a declaracao, `renderizar.js` cai no
      // fallback e a ficha de uma NC de 2025 passaria a exibir "meta_pit_id" cru
      // onde hoje exibe "Meta do PIT". Nenhum evento NOVO traz este campo.
      meta_pit_id: {
        rotulo: 'Meta do PIT (até 1.30.0)', entidade: 'meta', historico: true
      },
      // O recebido, que NUNCA muda por devolucao.
      valor_nc: { rotulo: 'Valor da NC', tipo: 'dinheiro' },
      // HISTORICO, e por isso FICA, pelo mesmo motivo do `meta_pit_id` acima. A
      // coluna saiu na 1.40.0: a devolucao virou DOCUMENTO, em
      // `orcamento.nota_credito_recolhimento`, e o recolhido passou a ser a soma
      // das linhas de la. Os eventos gravados ate a 1.39.0 ainda trazem este
      // campo, e sem a declaracao a ficha de uma NC antiga exibiria
      // "valor_recolhido" cru onde hoje exibe o rotulo. Nenhum evento NOVO o traz.
      valor_recolhido: {
        rotulo: 'Valor recolhido (até 1.39.0)', tipo: 'dinheiro', historico: true
      },
      doc_ro: { rotulo: 'Documento RO' },
      prazo_empenho: { rotulo: 'Prazo para empenho', tipo: 'data' },
      classificacao_id: { rotulo: 'Classificação', dominio: 'dominio.classificacao_nc' },
      pdr_item_id: { rotulo: 'Item do PDR', entidade: 'pdr' },
      nc_complementada_id: { rotulo: 'NC complementada', entidade: 'nota_credito' },
      // HISTORICO, e por isso FICA, pelo mesmo motivo dos dois campos acima. A
      // coluna saiu na 1.43.0: ela era um texto livre de 8 caracteres em que se
      // escrevia 'RECOLH' para marcar a NC devolvida por inteiro, e a pergunta
      // que ela respondia passou a ter resposta exata na 1.40.0 (o recolhido e a
      // soma dos documentos de recolhimento). Medido em 2026-08-08: 8 marcadas
      // de 99, e 11 NCs com recolhimento integral -- o marcador discordava do
      // dado em 3 de 11. Nenhum evento NOVO o traz.
      marcador: { rotulo: 'Marcador (até 1.42.0)', historico: true },
      observacao: { rotulo: 'Observação' }
    }
  },

  // O DOCUMENTO DE RECOLHIMENTO e da ficha da NC, e nao de uma ficha propria.
  // Ninguem abre "recolhimento n.o 12": abre a nota de credito e olha o que dela
  // foi devolvido, com que documento e em que data. E o mesmo criterio da
  // liquidacao, que aparece na ficha da NE.
  'orcamento.nota_credito_recolhimento': {
    modulo: 'orcamento',
    entidade: 'nota_credito',
    agregado: (t, linha) => linha.nota_credito_id,
    // O numero e o ano identificam o documento no SIAFI; o valor entra porque a
    // pergunta que se faz do recolhimento e "de quanto foi".
    resumo: linha => `Recolhimento ${linha.numero}/${linha.ano} de ${linha.valor}`,
    campos: {
      numero: { rotulo: 'Número' },
      ano: { rotulo: 'Ano', tipo: 'numero' },
      data_emissao: { rotulo: 'Data de emissão', tipo: 'data' },
      // A ND da ANULACAO (339000, 449000), e nao a da NC alvo. Sem o rotulo, a
      // ficha da NC mostraria duas NDs diferentes sem dizer que sao coisas
      // distintas.
      cod_nd: {
        rotulo: 'ND da anulação', dominio: 'dominio.natureza_despesa'
      },
      ug_emitente: { rotulo: 'UG emitente', dominio: 'dominio.ug' },
      valor: { rotulo: 'Valor recolhido', tipo: 'dinheiro' },
      finalidade_historico: { rotulo: 'Finalidade / histórico' },
      observacao: { rotulo: 'Observação' },
      nota_credito_id: { rotulo: 'Nota de crédito', entidade: 'nota_credito' }
    }
  },

  // --- Agregado: nota_empenho -----------------------------------------------
  // A NE reune quatro tabelas: ela mesma, o rateio por NC, as liquidacoes e os
  // recebimentos de material. Sao as quatro coisas que a ficha da NE mostra.

  'orcamento.nota_empenho': {
    modulo: 'orcamento',
    entidade: 'nota_empenho',
    agregado: (t, linha) => linha.id,
    resumo: linha => `NE ${linha.numero}/${linha.ano}`,
    campos: {
      numero: { rotulo: 'Número' },
      ano: { rotulo: 'Ano', tipo: 'numero' },
      // AS DUAS METADES QUE FALTAVAM DA CHAVE DO SIAFI. Elas nasceram em
      // 2026-08-07 e o servidor so passou a grava-las em 2026-08-08: ate la
      // nenhum evento as trazia, e o indice unico `uniq_nota_empenho_chave_siafi`
      // aprovava numero repetido porque NULL nao colide com NULL. Sao DERIVADAS
      // (a UG sai da emitente da NC representativa, a gestao e fixa), e por isso
      // nao ha campo de formulario para elas -- mas mudam quando a NC muda, e o
      // historico tem de dizer isso.
      //
      // SEM `dominio: 'dominio.ug'`, e a razão é o dado: a coluna não tem chave
      // estrangeira e a 167382 não está no catálogo (ele lista quem EMITE
      // crédito para nós, e ela é uma unidade gestora nossa). Traduzir pelo
      // catálogo deixaria metade dos empenhos sem rótulo.
      ug: { rotulo: 'UG do empenho' },
      gestao: { rotulo: 'Gestão' },
      data_empenho: { rotulo: 'Data do empenho', tipo: 'data' },
      // A NC representativa: e ela que dirige ND, PI e classificacao.
      nota_credito_id: { rotulo: 'Nota de crédito', entidade: 'nota_credito' },
      finalidade: { rotulo: 'Finalidade' },
      valor_empenhado: { rotulo: 'Valor empenhado', tipo: 'dinheiro' },
      valor_anulado: { rotulo: 'Valor anulado', tipo: 'dinheiro' }
    }
  },

  'orcamento.nota_empenho_nota_credito': {
    modulo: 'orcamento',
    entidade: 'nota_empenho',
    agregado: (t, linha) => linha.nota_empenho_id,
    // Como o `dfd_item`, esta entrada descreve a LISTA: o rateio e regravado
    // inteiro a cada salvamento da NE.
    resumo: linha => `Rateio da NE entre ${(linha.alocacoes || []).length} nota(s) de crédito`,
    campos: {
      // SINTETICO, como o `itens` do DFD: nao ha coluna `alocacoes`. O rateio e
      // regravado inteiro a cada salvamento da NE.
      alocacoes: { rotulo: 'Rateio por nota de crédito', tipo: 'lista', sintetico: true },
      nota_empenho_id: { rotulo: 'Nota de empenho', entidade: 'nota_empenho' }
    }
  },

  'orcamento.liquidacao': {
    modulo: 'orcamento',
    entidade: 'nota_empenho',
    agregado: (t, linha) => linha.nota_empenho_id,
    resumo: linha => `Liquidação de ${linha.valor_liquidado}`,
    campos: {
      valor_liquidado: { rotulo: 'Valor liquidado', tipo: 'dinheiro' },
      data: { rotulo: 'Data', tipo: 'data' },
      documento_ns: { rotulo: 'Documento NS' },
      nota_empenho_id: { rotulo: 'Nota de empenho', entidade: 'nota_empenho' }
    }
  },

  'orcamento.recebimento_material': {
    modulo: 'orcamento',
    entidade: 'nota_empenho',
    agregado: (t, linha) => linha.nota_empenho_id,
    resumo: linha => `Recebimento: ${linha.material}`,
    campos: {
      material: { rotulo: 'Material' },
      prazo_entrega: { rotulo: 'Prazo de entrega' },
      situacao: { rotulo: 'Situação' },
      // Decide em qual RPCMTec (4.6) o item aparece. Nulo cai no ano da NE.
      ano_referencia: { rotulo: 'Ano de referência', tipo: 'numero' },
      nota_empenho_id: { rotulo: 'Nota de empenho', entidade: 'nota_empenho' }
    }
  },

  // --- Agregado: licitacao --------------------------------------------------

  'orcamento.licitacao': {
    modulo: 'orcamento',
    entidade: 'licitacao',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Licitação ${linha.ano}: ${String(linha.objeto || '').slice(0, 60)}`,
    campos: {
      ano: { rotulo: 'Ano', tipo: 'numero' },
      tipo_id: { rotulo: 'Tipo', dominio: 'dominio.tipo_licitacao' },
      objeto: { rotulo: 'Objeto' },
      numero_pregao: { rotulo: 'Número do pregão' },
      fase_id: { rotulo: 'Fase', dominio: 'dominio.fase_licitacao' },
      fase_atual: { rotulo: 'Fase atual' },
      data_homologacao: { rotulo: 'Data de homologação', tipo: 'data' },
      // HISTORICO desde a 1.43.0. As duas nasceram em 2026-08-04 com o
      // `numero_pregao` e a `data_homologacao`, e sairam quatro dias depois com
      // 0 de 11 preenchidas, por decisao do chefe: ele acompanha as licitacoes
      // pelo PREGAO, que ficou. Os dois eventos de licitacao ja gravados trazem
      // as duas colunas no `dados_antes`/`dados_depois`, porque o controller usa
      // `RETURNING *`; sem estas linhas a ficha exibiria o nome cru.
      nup: { rotulo: 'NUP do processo (até 1.42.0)', historico: true },
      fornecedor: { rotulo: 'Fornecedor (até 1.42.0)', historico: true },
      valor_total_estimado: { rotulo: 'Valor total estimado', tipo: 'dinheiro' },
      valor_final_homologado: { rotulo: 'Valor final homologado', tipo: 'dinheiro' },
      om_gestora: { rotulo: 'OM gestora' }
    }
  },

  // --- Agregado: rpnp -------------------------------------------------------

  'orcamento.rpnp': {
    modulo: 'orcamento',
    entidade: 'rpnp',
    agregado: (t, linha) => linha.id,
    resumo: linha => `RPNP ${linha.empenho_label || `#${linha.id}`} (${linha.ano})`,
    campos: {
      ano: { rotulo: 'Ano', tipo: 'numero' },
      nota_empenho_id: { rotulo: 'Nota de empenho', entidade: 'nota_empenho' },
      // O RPNP existe para empenho de ano anterior que pode nao estar cadastrado
      // no SCA; por isso o rotulo livre convive com a FK.
      empenho_label: { rotulo: 'Empenho (rótulo livre)' },
      finalidade: { rotulo: 'Finalidade' },
      valor_empenhado: { rotulo: 'Valor empenhado', tipo: 'dinheiro' },
      valor_a_liquidar: { rotulo: 'Valor a liquidar', tipo: 'dinheiro' }
    }
  },

  // --- Agregado: o VINCULO do anexo -----------------------------------------

  'orcamento.arquivo': {
    modulo: 'orcamento',
    // A UNICA entrada do sistema com `entidade` resolvida por LINHA. O CHECK
    // `arquivo_um_vinculo` garante que o anexo pertence a exatamente um dono, e
    // o historico dele tem de aparecer na ficha desse dono: o PDF do SIAFI e
    // parte da NC, e nao um registro que alguem abra por si. Uma entidade fixa
    // mandaria todos para a mesma ficha inexistente.
    //
    // O ANEXO DO RECOLHIMENTO CAI NA FICHA DA NC, e nao numa ficha propria, pelo
    // mesmo motivo do proprio recolhimento: ele e parte do que aconteceu com
    // aquele credito.
    entidade: linha =>
      linha.nota_credito_id != null || linha.recolhimento_id != null
        ? 'nota_credito'
        : linha.dfd_id != null
          ? 'dfd'
          : 'pdr',
    // ASSINCRONA no caso do recolhimento: o dono esta a UM SALTO de distancia (o
    // anexo aponta o recolhimento, e a NC esta adiante), como o arquivo do
    // acervo que aponta a versao e chega ao produto. A linha ainda existe quando
    // esta consulta roda, inclusive na exclusao em cascata: `auditarCascata` e
    // chamada ANTES do DELETE do dono, na mesma transacao.
    agregado: async (t, linha) => {
      if (linha.nota_credito_id != null) return linha.nota_credito_id
      if (linha.dfd_id != null) return linha.dfd_id
      if (linha.recolhimento_id != null) {
        const dono = await t.oneOrNone(
          `SELECT nota_credito_id FROM orcamento.nota_credito_recolhimento
            WHERE id = $<id>`,
          { id: linha.recolhimento_id }
        )
        return dono ? dono.nota_credito_id : null
      }
      return linha.pdr_ano
    },
    resumo: linha => `Anexo "${linha.nome_original}"`,
    // BYTEA. O `sanitizar` ja trocaria o Buffer por {_omitido, bytes}, mas o
    // controller nem o LE: `SELECT *` traria os bytes inteiros para a memoria so
    // para serem descartados. Declarar aqui e a rede de seguranca.
    omitir: ['conteudo'],
    campos: {
      nome_original: { rotulo: 'Nome do arquivo' },
      extensao: { rotulo: 'Extensão' },
      mimetype: { rotulo: 'Tipo MIME' },
      tamanho_bytes: { rotulo: 'Tamanho em bytes', tipo: 'numero' },
      nota_credito_id: { rotulo: 'Nota de crédito', entidade: 'nota_credito' },
      dfd_id: { rotulo: 'DFD', entidade: 'dfd' },
      pdr_ano: { rotulo: 'PDR do ano', tipo: 'numero' },
      // O sexto dono do vinculo, desde a 1.40.0. `entidade: 'nota_credito'`
      // porque o link da ficha aponta a NC que o recolhimento abate, que e onde
      // o anexo aparece.
      recolhimento_id: { rotulo: 'Recolhimento', entidade: 'nota_credito' }
    }
  },

  // --- Agregado: configuracao -----------------------------------------------


  // --- Agregado: dominio ----------------------------------------------------
  // Tabelas de DOMINIO com CRUD por tela e `verifyAdmin`. Elas entram no rastro
  // porque mudar um codigo de ND RECLASSIFICA NC e NE ja lancadas: e a alteracao
  // com maior alcance do modulo, e ate hoje o proprio controller dizia "Nao ha
  // auditoria nessas tabelas de dominio".
  //
  // As tres compartilham a entidade 'dominio' com `entidade_id` = o `code`. Dois
  // codigos iguais em tabelas diferentes cairiam na mesma ficha; a coluna
  // `tabela` do evento os separa, e criar tres entidades para catalogos de
  // poucas dezenas de linhas daria tres fichas que ninguem abre.

  'dominio.natureza_despesa': {
    modulo: 'orcamento',
    entidade: 'dominio',
    agregado: (t, linha) => linha.code,
    resumo: linha => `Natureza de despesa ${linha.code} - ${linha.nome}`,
    campos: {
      code: { rotulo: 'Código' },
      nome: { rotulo: 'Nome' },
      gnd: { rotulo: 'GND', tipo: 'numero' },
      // Derivado do GND (3 custeio, 4 capital), gravado pelo controller.
      grupo: { rotulo: 'Grupo' }
    }
  },

  'dominio.plano_interno': {
    modulo: 'orcamento',
    entidade: 'dominio',
    agregado: (t, linha) => linha.code,
    resumo: linha => `Plano interno ${linha.code} - ${linha.nome}`,
    campos: {
      code: { rotulo: 'Código' },
      nome: { rotulo: 'Nome' },
      alinea: { rotulo: 'Alínea' }
    }
  },

  'dominio.ug': {
    modulo: 'orcamento',
    entidade: 'dominio',
    agregado: (t, linha) => linha.code,
    resumo: linha => `UG ${linha.code} - ${linha.nome}`,
    campos: {
      code: { rotulo: 'Código' },
      nome: { rotulo: 'Nome' }
    }
  }
}
