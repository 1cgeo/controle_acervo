'use strict'

/**
 * Mapa de auditoria do modulo EQUIPAMENTO.
 *
 * O contrato de uma entrada esta em `../index.js`.
 *
 * DOIS AGREGADOS, E SEIS TABELAS. A regra e a da casa: o agregado e a FICHA QUE
 * A PESSOA ABRE. Ninguem abre "indisponibilidade n.o 12"; abre o BEM e olha por
 * que ele esta parado, quem o levou, quanto custou o conserto e para onde ele
 * foi. Dai:
 *
 *   equipamento      <- equipamento, indisponibilidade, afastamento,
 *                       manutencao, transferencia
 *   tipo_equipamento <- tipo_equipamento
 *
 * O TIPO TEM FICHA PROPRIA porque tem TELA propria (`#/equipamento/tipos`) e
 * porque nao pertence a bem nenhum: ele e o cadastro que os bens apontam, e
 * mudar a vida util de um tipo muda o numero que aparece em TODO bem que a
 * herda. Mandar esse evento para a ficha de um bem esconderia justamente o
 * alcance da mudanca.
 *
 * ESTE E UM MODULO DE DATAS, e por isso toda coluna DATE sai com `tipo: 'data'`:
 * sem isso a tela mostraria '2026-05-11T00:00:00.000Z' onde a pergunta e "desde
 * quando esta maquina esta parada". As tres colunas de dinheiro da manutencao
 * saem com `tipo: 'dinheiro'` pelo mesmo motivo, e as duas do SIAFI com
 * `tipo: 'booleano'`.
 *
 * NAO HA ENTRADA PARA `equipamento.situacao`, `classe_suprimento`,
 * `secao_detentora`, `situacao_transferencia` nem `tipo_transferencia`: as cinco
 * sao dominio de code FIXO, semeadas pelo `er/equipamento.sql`, e nao tem porta
 * de escrita nenhuma. Tabela sem escrita nao gera evento, e declara-la aqui
 * prometeria um historico que nunca teria linha.
 */

module.exports = {
  // --- Agregado: tipo_equipamento -------------------------------------------

  'equipamento.tipo_equipamento': {
    modulo: 'equipamento',
    entidade: 'tipo_equipamento',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Tipo de equipamento ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      descricao: { rotulo: 'Descrição' },
      // A vida util PADRAO do tipo, que o bem herda quando nao declara a
      // propria. Mudar este numero muda o que a lista mostra em todo bem que
      // dependa dele, e e por isso que o tipo tem ficha.
      vida_util_meses: { rotulo: 'Vida útil (meses)', tipo: 'numero' },
      ativo: { rotulo: 'Ativo', tipo: 'booleano' }
    }
  },

  // --- Agregado: equipamento ------------------------------------------------

  'equipamento.equipamento': {
    modulo: 'equipamento',
    entidade: 'equipamento',
    agregado: (t, linha) => linha.id,
    // O PATRIMONIO E O MODELO, e nao o id: e por eles que o bem e citado no
    // Relatorio DMT e na conferencia de carga.
    resumo: linha => `${linha.modelo} (patrimônio ${linha.nr_patrimonio})`,
    campos: {
      nr_patrimonio: { rotulo: 'Número de patrimônio' },
      classe_id: {
        rotulo: 'Classe de suprimento', dominio: 'equipamento.classe_suprimento'
      },
      tipo_id: { rotulo: 'Tipo', entidade: 'tipo_equipamento' },
      modelo: { rotulo: 'Modelo' },
      nr_serie: { rotulo: 'Número de série' },
      data_entrada_carga: { rotulo: 'Data de entrada em carga', tipo: 'data' },
      // NULO NAO E ZERO: nulo quer dizer "vale a do tipo". O historico mostra o
      // que foi GRAVADO na coluna do bem, e nao o valor resolvido -- mostrar o
      // herdado aqui afirmaria que alguem o digitou.
      vida_util_meses: { rotulo: 'Vida útil (meses)', tipo: 'numero' },
      secao_detentora_id: {
        rotulo: 'Seção detentora', dominio: 'equipamento.secao_detentora'
      },
      // FALSO E O BEM BAIXADO, e a situacao derivada passa a mostrar 'Baixado'
      // (o degrau 50). Nao ha exclusao logica separada disto, e por isso este
      // campo e o que registra a saida do bem do parque.
      ativo: { rotulo: 'Ativo', tipo: 'booleano' },
      observacao: { rotulo: 'Observação' }
    }
  },

  // A INDISPONIBILIDADE, O AFASTAMENTO, A MANUTENCAO E A TRANSFERENCIA sao da
  // ficha do BEM, e nao de fichas proprias, pelo mesmo criterio da liquidacao no
  // orcamento: elas descrevem o que aconteceu com aquele bem.
  //
  // NENHUMA DELAS DECLARA `situacao`, e a ausencia e a modelagem. A situacao do
  // bem e DERIVADA por `equipamento.situacao_em(dia)` a partir destas quatro
  // tabelas mais o `ativo`: ela nao e coluna de lugar nenhum, entao nao ha o que
  // auditar. O que o rastro guarda e a CAUSA (a indisponibilidade que abriu, o
  // afastamento que fechou), e a situacao se relê dela a qualquer momento.

  'equipamento.indisponibilidade': {
    modulo: 'equipamento',
    entidade: 'equipamento',
    agregado: (t, linha) => linha.equipamento_id,
    // SEM A DATA NO RESUMO, e a ausencia e deliberada: `data_inicio` chega aqui
    // como objeto Date do driver, e interpolar um Date numa string produz
    // 'Mon Jul 22 2019 00:00:00 GMT-0300'. A data ja aparece formatada na lista
    // de mudancas, por `tipo: 'data'`.
    resumo: linha => `Indisponibilidade: ${String(linha.motivo || '').slice(0, 60)}`,
    campos: {
      data_inicio: { rotulo: 'Data de início', tipo: 'data' },
      // NULO E O LANCAMENTO ABERTO: o bem ainda esta parado. Medido na planilha
      // da Secao de 2026-08-03, as 11 indisponibilidades estavam todas assim.
      data_fim: { rotulo: 'Data de fim', tipo: 'data' },
      motivo: { rotulo: 'Motivo' },
      previsao_retorno: { rotulo: 'Previsão de retorno', tipo: 'data' },
      equipamento_id: { rotulo: 'Equipamento', entidade: 'equipamento' }
    }
  },

  'equipamento.afastamento': {
    modulo: 'equipamento',
    entidade: 'equipamento',
    agregado: (t, linha) => linha.equipamento_id,
    resumo: linha => `Afastamento para ${linha.om}`,
    campos: {
      // TEXTO LIVRE, e nao dominio: as OMs que recebem o material emprestado nao
      // sao cadastro deste sistema.
      om: { rotulo: 'OM' },
      motivo: { rotulo: 'Motivo' },
      data_inicio: { rotulo: 'Data de início', tipo: 'data' },
      previsao_termino: { rotulo: 'Previsão de término', tipo: 'data' },
      data_fim: { rotulo: 'Data de fim', tipo: 'data' },
      equipamento_id: { rotulo: 'Equipamento', entidade: 'equipamento' }
    }
  },

  'equipamento.manutencao': {
    modulo: 'equipamento',
    entidade: 'equipamento',
    agregado: (t, linha) => linha.equipamento_id,
    resumo: linha =>
      `Manutenção: ${String(linha.descricao || linha.certame || 'sem descrição').slice(0, 60)}`,
    campos: {
      data_inicio: { rotulo: 'Data de início', tipo: 'data' },
      data_fim: { rotulo: 'Data de fim', tipo: 'data' },
      descricao: { rotulo: 'Descrição' },
      // AS TRES SAO VALOR, inclusive `valor_pdr`, e isto parece defeito. Ele
      // NAO e um ano de PDR: a unica linha real preenchida da planilha traz
      // 'Previsto em PDR R$600,00'. O que a coluna diz e quanto do conserto
      // esta previsto no PDR, e nao em qual PDR ele esta.
      valor: { rotulo: 'Valor pago', tipo: 'dinheiro' },
      valor_orcado: { rotulo: 'Valor orçado', tipo: 'dinheiro' },
      valor_pdr: { rotulo: 'Valor previsto no PDR', tipo: 'dinheiro' },
      certame: { rotulo: 'Certame' },
      // O vinculo com a parada que este conserto explica. E ele que faz o
      // Relatorio DMT poder por o valor orcado na mesma linha do motivo da
      // parada, em vez de na linha da ultima manutencao qualquer.
      //
      // SEM `entidade`, ao contrario de `equipamento_id` logo abaixo: a
      // indisponibilidade nao tem ficha propria (ela e da ficha do bem), e um
      // link com o id DELA levaria para a ficha do bem de mesmo numero, que e
      // outro bem. Sai como numero cru, que e o maximo honesto.
      indisponibilidade_id: { rotulo: 'Indisponibilidade', tipo: 'numero' },
      equipamento_id: { rotulo: 'Equipamento', entidade: 'equipamento' }
    }
  },

  'equipamento.transferencia': {
    modulo: 'equipamento',
    entidade: 'equipamento',
    agregado: (t, linha) => linha.equipamento_id,
    // SEM O NOME DO TIPO (Recebimento, Cessão, Descarga): `resumo` recebe so a
    // linha crua, e traduzir o code aqui seria uma segunda copia do catalogo.
    // O tipo aparece traduzido na lista de mudancas, por `dominio`. As 10
    // descargas da carga inicial nao trazem documento nenhum, e por isso o id e
    // a alternativa.
    resumo: linha =>
      `Movimentação de patrimônio ${linha.documento_solicitacao || `#${linha.id}`}`,
    campos: {
      tipo_id: { rotulo: 'Tipo', dominio: 'equipamento.tipo_transferencia' },
      situacao_id: {
        rotulo: 'Situação', dominio: 'equipamento.situacao_transferencia'
      },
      om: { rotulo: 'OM' },
      documento_solicitacao: { rotulo: 'Documento de solicitação' },
      data_solicitacao: { rotulo: 'Data da solicitação', tipo: 'data' },
      data_transferencia: { rotulo: 'Data da transferência', tipo: 'data' },
      transferido_siafi: { rotulo: 'Transferido no SIAFI', tipo: 'booleano' },
      apropriado_siafi: { rotulo: 'Apropriado no SIAFI', tipo: 'booleano' },
      publicacao_autorizacao: { rotulo: 'Publicação da autorização' },
      descricao: { rotulo: 'Descrição' },
      equipamento_id: { rotulo: 'Equipamento', entidade: 'equipamento' }
    }
  }
}
