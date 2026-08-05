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
 *   nota_credito   <- nota_credito
 *   nota_empenho   <- nota_empenho, nota_empenho_nota_credito, liquidacao,
 *                     recebimento_material
 *   licitacao      <- licitacao
 *   rpnp           <- rpnp
 *   configuracao   <- configuracao                 (singleton, id 1)
 *   dominio        <- natureza_despesa, plano_interno, ug
 *
 * E `orcamento.arquivo`, cujo agregado NAO e fixo: o CHECK `arquivo_um_vinculo`
 * garante que ele pertence a exatamente uma NC, um DFD ou o PDR de um ano, e o
 * historico dele tem de aparecer na ficha do dono. E a unica entrada do sistema
 * com `entidade` resolvida por linha (ver o comentario dela abaixo).
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
      justificativa: { rotulo: 'Justificativa' },
      area_requisitante: { rotulo: 'Área requisitante' },
      grau_prioridade_id: { rotulo: 'Grau de prioridade', dominio: 'dominio.grau_prioridade' },
      data_prevista_conclusao: { rotulo: 'Data prevista de conclusão', tipo: 'data' },
      responsavel_cpf: { rotulo: 'CPF do responsável' },
      vinculo_plano_gestao: { rotulo: 'Vínculo com o plano de gestão' },
      // Distingue a demanda que esta no PCA da superveniente (ex.: DFD de IA).
      consta_pca: { rotulo: 'Consta do PCA', tipo: 'booleano' },
      valor_estimado: { rotulo: 'Valor estimado', tipo: 'dinheiro' }
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
      gnd: { rotulo: 'GND', tipo: 'numero' },
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
      meta_pit_id: { rotulo: 'Meta do PIT', entidade: 'meta' },
      // O recebido, que NUNCA muda por devolucao.
      valor_nc: { rotulo: 'Valor da NC', tipo: 'dinheiro' },
      // Informativo: nao altera valor_nc. Sem o rotulo, "valor_recolhido:
      // 0 -> 500" se leria como corte do credito.
      valor_recolhido: { rotulo: 'Valor recolhido (informativo)', tipo: 'dinheiro' },
      doc_ro: { rotulo: 'Documento RO' },
      prazo_empenho: { rotulo: 'Prazo para empenho', tipo: 'data' },
      classificacao_id: { rotulo: 'Classificação', dominio: 'dominio.classificacao_nc' },
      pdr_item_id: { rotulo: 'Item do PDR', entidade: 'pdr' },
      nc_complementada_id: { rotulo: 'NC complementada', entidade: 'nota_credito' },
      marcador: { rotulo: 'Marcador' },
      observacao: { rotulo: 'Observação' }
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
      nup: { rotulo: 'NUP do processo' },
      fase_id: { rotulo: 'Fase', dominio: 'dominio.fase_licitacao' },
      fase_atual: { rotulo: 'Fase atual' },
      fornecedor: { rotulo: 'Fornecedor' },
      data_homologacao: { rotulo: 'Data de homologação', tipo: 'data' },
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
    // `arquivo_um_vinculo` garante que o anexo pertence a exatamente um de
    // nota_credito_id, dfd_id ou pdr_ano, e o historico dele tem de aparecer na
    // ficha do dono: o PDF do SIAFI e parte da NC, e nao um registro que alguem
    // abra por si. Uma entidade fixa mandaria os tres para a mesma ficha
    // inexistente.
    entidade: linha =>
      linha.nota_credito_id != null
        ? 'nota_credito'
        : linha.dfd_id != null
          ? 'dfd'
          : 'pdr',
    agregado: (t, linha) =>
      linha.nota_credito_id != null
        ? linha.nota_credito_id
        : linha.dfd_id != null
          ? linha.dfd_id
          : linha.pdr_ano,
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
      pdr_ano: { rotulo: 'PDR do ano', tipo: 'numero' }
    }
  },

  // --- Agregado: configuracao -----------------------------------------------

  'orcamento.configuracao': {
    modulo: 'orcamento',
    entidade: 'configuracao',
    // Singleton (`CHECK (id = 1)`): a linha nasce no DDL e o backend so faz
    // UPDATE. O agregado e sempre 1, e a ficha e a propria pagina Configuração.
    agregado: () => 1,
    resumo: () => 'Configuração do módulo orçamento',
    campos: {
      uasg: { rotulo: 'UASG' },
      codom: { rotulo: 'CODOM' }
      // SEM `ano_referencia`: nao existe ano padrao guardado. Cada tela tem o
      // seu filtro e comeca no ano atual. Nao confunda com o `ano_referencia` do
      // recebimento_material, logo acima, que decide em que RPCMTec o item
      // aparece e PERMANECE.
    }
  },

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
