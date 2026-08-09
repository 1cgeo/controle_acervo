'use strict'

/**
 * Mapa de auditoria do modulo PRODUCAO (code 7), que atravessou do
 * `macrocontrole` do SAP 2.3.5 na 3.0.0.
 *
 * O contrato de uma entrada esta em `../index.js`.
 *
 * SEIS AGREGADOS PARA 34 TABELAS, e a regra e a da casa: o agregado e a FICHA
 * QUE A PESSOA ABRE. Ninguem abre "perfil de menu n.o 812"; abre O LOTE e olha
 * como a subfase dele esta configurada. Ninguem abre "fase n.o 4"; abre A LINHA
 * DE PRODUCAO e olha a sequencia dela. Dai:
 *
 *   linha_producao  <- linha_producao, fase, subfase
 *   camada          <- camada, propriedades_camada
 *   grupo_insumo    <- grupo_insumo, insumo
 *   dado_producao   <- dado_producao
 *   catalogo_qgis   <- as nove tabelas do schema `qgis`
 *   lote            <- etapa, bloco, unidade_trabalho, atividade,
 *                      insumo_unidade_trabalho, as onze `perfil_*` e a
 *                      habilitacao_dificuldade
 *
 * O LOTE E O DO ACERVO, e nao um lote de producao: `producao.lote` nao existe
 * neste banco, e `producao.lote_linha` foi removida por decisao do chefe em
 * 2026-08-09, antes de chegar a banco nenhum. Todo `lote_id` daqui aponta
 * `acervo.lote (id)`. A entidade 'lote' ja e usada por `acervo.versao` e por
 * `ponto_controle`, e e a mesma ficha: um lote so na plataforma inteira.
 *
 * O CATALOGO DO QGIS ENTRA NESTE MODULO, e nao num modulo proprio, porque ele
 * nao tem autorizacao propria: quem publica menu, tema, estilo e modelo do QGIS
 * e quem responde pela producao, e as rotas dele moram em `/api/producao`. Um
 * modulo de auditoria a mais obrigaria a conceder perfil de novo para ler o
 * historico do que a mesma pessoa acabou de gravar.
 *
 * `catalogo_qgis` E UMA ENTIDADE SO PARA AS NOVE TABELAS, e isto e escolha. As
 * nove sao listas curtas, publicadas em massa pelo SAP Gerente e lidas por uma
 * tela so; nove fichas de uma linha cada dariam nove historicos que ninguem
 * abriria separados. O `resumo` de cada uma diz de qual catalogo a linha e.
 * O `agregado` das nove e o proprio `id`, EXCETO `qgis.layer_styles`, cujo dono
 * e o GRUPO: o estilo camada a camada nunca e escolhido sozinho.
 *
 * NAO HA ENTRADA PARA `producao.relacionamento_ut` NEM
 * `producao.relacionamento_versao`, e a ausencia e a modelagem: as duas sao
 * CACHE ESPACIAL mantido por gatilho, sem porta de escrita nenhuma. Tabela sem
 * escrita nao gera evento, e declara-la aqui prometeria um historico que nunca
 * teria linha. Mesma razao de `producao.login_temporario`, que e credencial
 * efemera criada e destruida pelo servidor, e das tabelas de `dominio`, que sao
 * code fixo semeado pelo `er/`.
 *
 * ANTES HAVIA AQUI UM AVISO DE QUE `pre_requisito_subfase` E `restricao_etapa`
 * FALTAVAM. Elas entraram no mesmo dia: `POST /api/producao/linha_producao`
 * cria os pre-requisitos junto com as subfases, e `POST /api/producao/etapas/padrao`
 * cria as restricoes junto com as etapas. Sem declaracao, as duas rotas
 * estouravam em `entradaDe()` no meio da transacao.
 *
 * A REGRA QUE ELE DEIXOU CONTINUA VALENDO: tabela do DDL que ainda nao tem rota
 * fica de fora, e quem a trouxer declara-a aqui. O modulo delas e este.
 *
 * A GERENCIA DA PRODUCAO ACRESCENTOU O SEU BLOCO NO FIM DESTE ARQUIVO, com as
 * nove tabelas que `/api/gerencia_producao` escreve (as quatro `habilitacao*`,
 * as duas de fila prioritaria, o problema, a alteracao de fluxo e o relatorio de
 * alteracao) e as quatro do schema `qgis` que faltavam. Cada bloco tem cabecalho
 * proprio, e a razao e a mesma do "um arquivo por modulo" de `../index.js`: sao
 * sete arquivos de rota escrevendo o mesmo schema, e o cabecalho e o que diz a
 * quem pertence cada linha quando dois deles se cruzarem.
 *
 * AS GEOMETRIAS SAO 4674 (SIRGAS 2000), e nao o 4326 do SAP. Elas saem em EWKT
 * pelo `geometrias`, e o `sanitizar.js` as resume quando passam de 8 kB.
 */

module.exports = {
  // --- Agregado: catalogo_qgis ----------------------------------------------
  //
  // O `owner` e o `update_time` das sete tabelas que os tem NAO sao auditoria da
  // casa: sao colunas do catalogo do SAP, e dizem quem PUBLICOU o conteudo pelo
  // SAP Gerente. Ficam declaradas porque a pergunta "de quem e este menu" e a
  // primeira que se faz quando dois menus divergem.

  'qgis.gerenciador_fme': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    // SEM O `url` NO RESUMO, e a ausencia e a regra do repositorio publico: a
    // url e o endereco de um servidor da instalacao. Ela aparece na lista de
    // mudancas, que e tela de gerente, e nao no resumo, que o indice repete.
    resumo: linha => `Servidor FME #${linha.id}`,
    campos: {
      url: { rotulo: 'Endereço do servidor FME' }
    }
  },

  'qgis.qgis_menus': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Menu do QGIS ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      // A DEFINICAO INTEIRA, que tem dezenas de KB. Ela nao se omite: o
      // `sanitizar.js` corta o que passa de 8 kB e deixa o resumo, e o
      // `campos_alterados` continua acusando que o menu mudou.
      definicao_menu: { rotulo: 'Definição do menu' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  'qgis.qgis_themes': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Tema do QGIS ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      definicao_tema: { rotulo: 'Definição do tema' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  'qgis.layer_alias': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Apelido de campos ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      definicao_alias: { rotulo: 'Definição dos apelidos' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  'qgis.group_styles': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Grupo de estilos ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' }
    }
  },

  // O ESTILO CAMADA A CAMADA E DA FICHA DO GRUPO, e nao de uma ficha propria:
  // uma linha de producao escolhe "o estilo de restituicao", que sao dezenas de
  // QMLs. Abrir a ficha de um QML solto nao e a pergunta que alguem faz.
  'qgis.layer_styles': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.grupo_estilo_id,
    resumo: linha => `Estilo de ${linha.f_table_schema}.${linha.f_table_name}`,
    campos: {
      f_table_schema: { rotulo: 'Schema da camada' },
      f_table_name: { rotulo: 'Camada' },
      f_geometry_column: { rotulo: 'Coluna de geometria' },
      grupo_estilo_id: { rotulo: 'Grupo de estilos', entidade: 'catalogo_qgis' },
      styleqml: { rotulo: 'Estilo QML' },
      stylesld: { rotulo: 'Estilo SLD' },
      ui: { rotulo: 'Formulário (UI)' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  'qgis.layer_rules': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Regra de atributo ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      regra: { rotulo: 'Regra' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  'qgis.qgis_models': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Modelo de processamento ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      descricao: { rotulo: 'Descrição' },
      model_xml: { rotulo: 'Modelo (XML)' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  'qgis.workflow_dsgtools': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Workflow do DSGTools ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      descricao: { rotulo: 'Descrição' },
      workflow_json: { rotulo: 'Workflow (JSON)' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  // --- Agregado: linha_producao ---------------------------------------------

  'producao.linha_producao': {
    modulo: 'producao',
    entidade: 'linha_producao',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Linha de produção ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      nome_abrev: { rotulo: 'Nome abreviado' },
      // APONTA O SUBTIPO, e nao o tipo: 'Carta Topográfica' é tipo, e 'Carta
      // Topográfica - T34-700' é subtipo, que é a especificação técnica que a
      // linha executa. O `dominio.tipo_produto` do SAP É este subtipo daqui.
      subtipo_produto_id: {
        rotulo: 'Subtipo de produto', dominio: 'dominio.subtipo_produto'
      },
      descricao: { rotulo: 'Descrição' },
      // FALSO E APOSENTADORIA, e nao exclusao: a linha some da lista de quem
      // cadastra lote novo e continua valendo para os lotes que já a usam.
      disponivel: { rotulo: 'Disponível', tipo: 'booleano' }
    }
  },

  // A FASE SO AGRUPA, e nao tem nome proprio: o nome vem de `dominio.tipo_fase`
  // e o que ela acrescenta e a ORDEM dentro da linha. Por isso ela e da ficha da
  // linha, e nao de uma ficha propria.
  'producao.fase': {
    modulo: 'producao',
    entidade: 'linha_producao',
    agregado: (t, linha) => linha.linha_producao_id,
    resumo: linha => `Fase de ordem ${linha.ordem}`,
    campos: {
      tipo_fase_id: { rotulo: 'Fase', dominio: 'dominio.tipo_fase' },
      linha_producao_id: {
        rotulo: 'Linha de produção', entidade: 'linha_producao'
      },
      ordem: { rotulo: 'Ordem', tipo: 'numero' }
    }
  },

  // A SUBFASE ESTA A DOIS SALTOS DA LINHA, e por isso o agregado dela e
  // assincrono: subfase -> fase -> linha_producao. E o mesmo caminho que o
  // gatilho de `relacionamento_versao` percorre para descobrir o subtipo que a
  // unidade de trabalho fabrica.
  'producao.subfase': {
    modulo: 'producao',
    entidade: 'linha_producao',
    agregado: async (t, linha) => {
      if (!linha || linha.fase_id == null) return null
      const fase = await t.oneOrNone(
        'SELECT linha_producao_id FROM producao.fase WHERE id = $<faseId>',
        { faseId: linha.fase_id }
      )
      return fase ? fase.linha_producao_id : null
    },
    resumo: linha => `Subfase ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      fase_id: { rotulo: 'Fase', tipo: 'numero' },
      ordem: { rotulo: 'Ordem', tipo: 'numero' }
    }
  },

  // O QUE UMA SUBFASE EXIGE DE OUTRA, espacialmente. Nao e "a subfase B comeca
  // depois da A": e "a REGIAO que B vai trabalhar precisa estar concluida em A"
  // (tipo 1) ou "nao pode estar em execucao em A" (tipo 2).
  //
  // E DA FICHA DA LINHA, e a dois saltos dela: as duas subfases do par sao da
  // mesma linha de producao, e a pergunta que se faz e "por que esta linha
  // travou". O caminho e `subfase_posterior_id -> subfase -> fase`, e a
  // POSTERIOR e a escolhida porque e ela que fica bloqueada.
  'producao.pre_requisito_subfase': {
    modulo: 'producao',
    entidade: 'linha_producao',
    agregado: async (t, linha) => {
      if (!linha || linha.subfase_posterior_id == null) return null
      const achado = await t.oneOrNone(
        `SELECT f.linha_producao_id
           FROM producao.subfase AS s
           INNER JOIN producao.fase AS f ON f.id = s.fase_id
          WHERE s.id = $<subfaseId>`,
        { subfaseId: linha.subfase_posterior_id }
      )
      return achado ? achado.linha_producao_id : null
    },
    resumo: linha =>
      `Pré-requisito entre as subfases ${linha.subfase_anterior_id} e ${linha.subfase_posterior_id}`,
    campos: {
      tipo_pre_requisito_id: {
        rotulo: 'Tipo de pré-requisito', dominio: 'dominio.tipo_pre_requisito'
      },
      subfase_anterior_id: { rotulo: 'Subfase anterior', tipo: 'numero' },
      subfase_posterior_id: { rotulo: 'Subfase posterior', tipo: 'numero' }
    }
  },

  // QUEM PODE (OU NAO) REPETIR ENTRE DUAS ETAPAS. Tipo 1 exige operadores
  // distintos (quem executou nao revisa), tipo 2 exige o mesmo (quem executou e
  // quem corrige). O TIPO 3 DO SAP ("Operadores no mesmo turno") NAO EXISTE
  // MAIS, porque `dominio.tipo_turno` nao atravessou: das 98 linhas do dump de
  // producao de 2026-08-09, ZERO eram dele.
  //
  // E DA FICHA DO LOTE, porque a ETAPA e do lote: a mesma subfase tem etapas
  // diferentes em lotes diferentes, e a restricao e entre etapas.
  'producao.restricao_etapa': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: async (t, linha) => {
      if (!linha || linha.etapa_anterior_id == null) return null
      const etapa = await t.oneOrNone(
        'SELECT lote_id FROM producao.etapa WHERE id = $<etapaId>',
        { etapaId: linha.etapa_anterior_id }
      )
      return etapa ? etapa.lote_id : null
    },
    resumo: linha =>
      `Restrição de operador entre as etapas ${linha.etapa_anterior_id} e ${linha.etapa_posterior_id}`,
    campos: {
      tipo_restricao_id: {
        rotulo: 'Tipo de restrição', dominio: 'dominio.tipo_restricao'
      },
      etapa_anterior_id: { rotulo: 'Etapa anterior', tipo: 'numero' },
      etapa_posterior_id: { rotulo: 'Etapa posterior', tipo: 'numero' }
    }
  },

  // --- Agregado: camada -----------------------------------------------------

  'producao.camada': {
    modulo: 'producao',
    entidade: 'camada',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Camada ${linha.schema}.${linha.nome}`,
    campos: {
      schema: { rotulo: 'Schema' },
      nome: { rotulo: 'Nome' }
    }
  },

  // COMO A CAMADA SE COMPORTA NUMA SUBFASE. E da ficha da CAMADA, e nao da
  // subfase: a pergunta que se faz e "por que esta camada virou de apontamento",
  // e a resposta se le comparando as subfases lado a lado.
  'producao.propriedades_camada': {
    modulo: 'producao',
    entidade: 'camada',
    agregado: (t, linha) => linha.camada_id,
    resumo: linha => `Propriedades da camada na subfase ${linha.subfase_id}`,
    campos: {
      camada_id: { rotulo: 'Camada', entidade: 'camada' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      camada_incomum: { rotulo: 'Camada incomum', tipo: 'booleano' },
      atributo_filtro_subfase: { rotulo: 'Atributo de filtro da subfase' },
      // OS TRES DE APONTAMENTO SAO TUDO OU NADA, e o CHECK
      // `propriedades_camada_apontamento_completo` do DDL cobra: camada de
      // apontamento sem os dois atributos nao tem como registrar apontamento
      // nenhum, e camada comum com eles preenchidos afirma o que ela nao e.
      camada_apontamento: { rotulo: 'Camada de apontamento', tipo: 'booleano' },
      atributo_situacao_correcao: { rotulo: 'Atributo de situação da correção' },
      atributo_justificativa_apontamento: {
        rotulo: 'Atributo de justificativa do apontamento'
      }
    }
  },

  // --- Agregado: dado_producao ----------------------------------------------

  'producao.dado_producao': {
    modulo: 'producao',
    entidade: 'dado_producao',
    agregado: (t, linha) => linha.id,
    // `configuracao_producao` E O NOME DO BANCO de producao, e nunca o endereco
    // dele: o servidor e a porta vem da conexao que o cliente ja tem.
    resumo: linha => `Dado de produção ${linha.configuracao_producao || `#${linha.id}`}`,
    campos: {
      tipo_dado_producao_id: {
        rotulo: 'Tipo de dado', dominio: 'dominio.tipo_dado_producao'
      },
      configuracao_producao: { rotulo: 'Banco de produção' }
    }
  },

  // --- Agregado: grupo_insumo -----------------------------------------------

  'producao.grupo_insumo': {
    modulo: 'producao',
    entidade: 'grupo_insumo',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Grupo de insumos ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      disponivel: { rotulo: 'Disponível', tipo: 'booleano' }
    }
  },

  'producao.insumo': {
    modulo: 'producao',
    entidade: 'grupo_insumo',
    agregado: (t, linha) => linha.grupo_insumo_id,
    resumo: linha => `Insumo ${linha.nome}`,
    geometrias: ['geom'],
    campos: {
      nome: { rotulo: 'Nome' },
      // PASTA DE REDE DA INSTALACAO. Ela mora no banco e aparece no rastro, que
      // e tela de gerente; o que nao pode e valor nenhum em arquivo versionado.
      caminho: { rotulo: 'Caminho' },
      // A PROJECAO DO INSUMO, e nao o SRID da coluna `geom`, que e sempre 4674.
      epsg: { rotulo: 'EPSG' },
      tipo_insumo_id: { rotulo: 'Tipo de insumo', dominio: 'dominio.tipo_insumo' },
      grupo_insumo_id: { rotulo: 'Grupo de insumos', entidade: 'grupo_insumo' },
      // NULA QUER DIZER INSUMO NAO ESPACIAL, e a ausencia e uma afirmacao: uma
      // tabela, um servico ou um documento nao tem recorte, e vale para toda a
      // area. Nao confundir com geometria que faltou.
      geom: { rotulo: 'Geometria', tipo: 'geometria' }
    }
  },

  // --- Agregado: lote (o do ACERVO) -----------------------------------------
  //
  // A ETAPA E QUEM DECLARA QUE UM LOTE EXECUTA UMA LINHA DE PRODUCAO: a subfase
  // pertence a uma fase, a fase a uma linha, e um lote com etapas em subfases de
  // duas linhas executa as duas. E dessa leitura, e nao de um cadastro, que o
  // schema `acompanhamento` tira o par (lote, linha).

  'producao.etapa': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Etapa de ordem ${linha.ordem} na subfase ${linha.subfase_id}`,
    campos: {
      tipo_etapa_id: { rotulo: 'Tipo de etapa', dominio: 'dominio.tipo_etapa' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      // O CHECK `etapa_execucao_e_primeira` obriga a Execução (tipo 1) a ter
      // ordem 1: uma revisão que viesse antes do trabalho revisaria o nada.
      ordem: { rotulo: 'Ordem', tipo: 'numero' }
    }
  },

  'producao.bloco': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Bloco ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      // A ORDEM ENTRE BLOCOS DO MESMO LOTE quando a distribuição escolhe.
      prioridade: { rotulo: 'Prioridade', tipo: 'numero' },
      status_execucao_id: {
        rotulo: 'Situação', dominio: 'dominio.tipo_status_execucao'
      },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.unidade_trabalho': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Unidade de trabalho ${linha.nome || `#${linha.id}`}`,
    geometrias: ['geom'],
    campos: {
      nome: { rotulo: 'Nome' },
      // A PROJECAO DE EDICAO (uma UTM local), e nao o SRID de `geom`, que e
      // 4674 sempre. E o que o cliente usa para abrir o projeto do QGIS.
      epsg: { rotulo: 'EPSG de edição' },
      dado_producao_id: { rotulo: 'Dado de produção', entidade: 'dado_producao' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      bloco_id: { rotulo: 'Bloco', tipo: 'numero' },
      // NASCE FALSO, ao contrario de `linha_producao.disponivel`: a unidade e
      // criada em lote, antes de o insumo estar associado, e libera-la cedo
      // entregaria trabalho sem os dados para faze-lo.
      disponivel: { rotulo: 'Disponível', tipo: 'booleano' },
      // ZERO E "NAO CALIBRADO", e nao "facil".
      dificuldade: { rotulo: 'Dificuldade', tipo: 'numero' },
      tempo_estimado_minutos: { rotulo: 'Tempo estimado (minutos)', tipo: 'numero' },
      prioridade: { rotulo: 'Prioridade', tipo: 'numero' },
      observacao: { rotulo: 'Observação' },
      geom: { rotulo: 'Geometria', tipo: 'geometria' }
    }
  },

  // A ATIVIDADE ESTA A UM SALTO DO LOTE, pela unidade de trabalho. Ela nao tem
  // colunas de auditoria da casa, e a ausencia e deliberada: ela E o registro de
  // execucao, e `usuario_uuid`/`data_inicio`/`data_fim` ja sao o quem e o
  // quando. O que este mapa acrescenta e o que aconteceu DEPOIS que ela nasceu.
  'producao.atividade': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: async (t, linha) => {
      if (!linha || linha.unidade_trabalho_id == null) return null
      const ut = await t.oneOrNone(
        'SELECT lote_id FROM producao.unidade_trabalho WHERE id = $<utId>',
        { utId: linha.unidade_trabalho_id }
      )
      return ut ? ut.lote_id : null
    },
    resumo: linha =>
      `Atividade da etapa ${linha.etapa_id} na unidade de trabalho ${linha.unidade_trabalho_id}`,
    campos: {
      etapa_id: { rotulo: 'Etapa', tipo: 'numero' },
      unidade_trabalho_id: { rotulo: 'Unidade de trabalho', tipo: 'numero' },
      // ANULAVEL porque a atividade existe ANTES de ser distribuida: ela nasce
      // Nao iniciada, sem dono, e a distribuicao e quem escreve o nome.
      usuario_uuid: { rotulo: 'Operador', entidade: 'usuario' },
      tipo_situacao_atividade_id: {
        rotulo: 'Situação', dominio: 'dominio.tipo_situacao_atividade'
      },
      data_inicio: { rotulo: 'Início', tipo: 'data_hora' },
      data_fim: { rotulo: 'Fim', tipo: 'data_hora' },
      observacao: { rotulo: 'Observação' }
    }
  },

  // QUAL INSUMO ALIMENTA QUAL UNIDADE DE TRABALHO. E derivada da estrategia de
  // associacao, e por isso nao tem auditoria propria no DDL -- quem responde por
  // ela e o insumo e a unidade, cada um com as suas colunas. O EVENTO, aqui, e o
  // ATO de associar, que e decisao de quem cadastra e nao se le em lugar nenhum
  // depois.
  'producao.insumo_unidade_trabalho': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: async (t, linha) => {
      if (!linha || linha.unidade_trabalho_id == null) return null
      const ut = await t.oneOrNone(
        'SELECT lote_id FROM producao.unidade_trabalho WHERE id = $<utId>',
        { utId: linha.unidade_trabalho_id }
      )
      return ut ? ut.lote_id : null
    },
    resumo: linha =>
      linha && linha.alvo
        ? `Associação de insumos: ${linha.alvo}`
        : `Insumo ${linha.insumo_id} na unidade de trabalho ${linha.unidade_trabalho_id}`,
    campos: {
      unidade_trabalho_id: { rotulo: 'Unidade de trabalho', tipo: 'numero' },
      insumo_id: { rotulo: 'Insumo', tipo: 'numero' },
      caminho_padrao: { rotulo: 'Caminho padrão' },
      // OS QUATRO SINTETICOS SAO O EVENTO DA ASSOCIACAO EM MASSA, e nao colunas.
      //
      // As duas rotas de associar e a de desassociar escrevem MILHARES de linhas
      // por requisicao: uma cobertura de imagens cruzada com um lote inteiro
      // produz uma linha por par (insumo, unidade de trabalho). Um evento por
      // linha inundaria a trilha e faria a ficha do lote virar um muro de
      // "associou insumo 4711" -- e nenhuma dessas linhas se le sozinha depois,
      // porque a tabela e DERIVADA da estrategia escolhida.
      //
      // O evento e por OPERACAO e POR LOTE, e o por-lote e imposto por este
      // `agregado`: um evento so para uma operacao que alcancasse dois lotes
      // apareceria na ficha de um e sumiria da do outro. Os lotes alvo sao lidos
      // ANTES do INSERT, para que a operacao que nao casou nada tambem deixe
      // rastro de que alguem tentou.
      alvo: {
        rotulo: 'Alvo da associação', sintetico: true
      },
      associacoes: {
        rotulo: 'Associações no lote', tipo: 'numero', sintetico: true
      },
      // SEM `valid()` DO LADO DO SCHEMA, e por isso ele traduz pelo catalogo: as
      // cinco estrategias sao cinco pedacos de SQL no controlador, e uma segunda
      // lista no Joi seria a que ninguem atualizaria.
      estrategia_id: {
        rotulo: 'Estratégia de associação',
        dominio: 'dominio.tipo_estrategia_associacao',
        sintetico: true
      },
      grupo_insumo_id: {
        rotulo: 'Grupo de insumos', entidade: 'grupo_insumo', sintetico: true
      }
    }
  },

  // --- Agregado: lote, os onze perfis de configuracao do QGIS ---------------
  //
  // "PERFIL" AQUI NAO E AUTORIZACAO. Autorizacao e `dominio.tipo_perfil`
  // (consulta, operador, gerente), lida pelo `verifyPerfil` a cada requisicao.
  // Estas onze sao perfil de CONFIGURACAO, no sentido de "perfil do QGIS": elas
  // respondem "quando alguem abrir a subfase X do lote Y, carregue este menu,
  // este tema, este estilo, estas regras, estes modelos e estes atalhos".
  //
  // AS ONZE SAO DA FICHA DO LOTE, e e por isso que elas apontam o lote: a mesma
  // subfase e configurada diferente em lotes diferentes, e a pergunta que se faz
  // e "o que mudou na configuracao DESTE lote".

  'producao.perfil_requisito_finalizacao': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Requisito de finalização: ${String(linha.descricao || '').slice(0, 60)}`,
    campos: {
      descricao: { rotulo: 'Descrição' },
      ordem: { rotulo: 'Ordem', tipo: 'numero' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_fme': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Rotina FME ${linha.rotina}`,
    campos: {
      gerenciador_fme_id: {
        rotulo: 'Servidor FME', entidade: 'catalogo_qgis'
      },
      rotina: { rotulo: 'Rotina' },
      // VERDADE BARRA A FINALIZACAO quando a rotina acusa erro; falso a deixa
      // informativa.
      requisito_finalizacao: { rotulo: 'Requisito de finalização', tipo: 'booleano' },
      tipo_rotina_id: { rotulo: 'Tipo de rotina', dominio: 'dominio.tipo_rotina' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      ordem: { rotulo: 'Ordem', tipo: 'numero' }
    }
  },

  'producao.perfil_configuracao_qgis': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Configuração do DSGTools na subfase ${linha.subfase_id}`,
    campos: {
      tipo_configuracao_id: {
        rotulo: 'Ferramenta', dominio: 'dominio.tipo_configuracao'
      },
      parametros: { rotulo: 'Parâmetros' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_estilo': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Grupo de estilos da subfase ${linha.subfase_id}`,
    campos: {
      grupo_estilo_id: { rotulo: 'Grupo de estilos', entidade: 'catalogo_qgis' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_regras': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Regras de atributo da subfase ${linha.subfase_id}`,
    campos: {
      layer_rules_id: { rotulo: 'Regra de atributo', entidade: 'catalogo_qgis' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_menu': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Menu do QGIS da subfase ${linha.subfase_id}`,
    campos: {
      menu_id: { rotulo: 'Menu', entidade: 'catalogo_qgis' },
      // MARCA O MENU QUE SO APARECE NAS ETAPAS DE REVISAO, e e por isso que o
      // mesmo lote pode ter dois menus para a mesma subfase.
      menu_revisao: { rotulo: 'Menu de revisão', tipo: 'booleano' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_tema': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Tema de camadas da subfase ${linha.subfase_id}`,
    campos: {
      tema_id: { rotulo: 'Tema', entidade: 'catalogo_qgis' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_model_qgis': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Modelo de processamento da subfase ${linha.subfase_id}`,
    campos: {
      qgis_model_id: { rotulo: 'Modelo', entidade: 'catalogo_qgis' },
      parametros: { rotulo: 'Parâmetros' },
      requisito_finalizacao: { rotulo: 'Requisito de finalização', tipo: 'booleano' },
      tipo_rotina_id: { rotulo: 'Tipo de rotina', dominio: 'dominio.tipo_rotina' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      ordem: { rotulo: 'Ordem', tipo: 'numero' }
    }
  },

  // QUANTO DA LINHAGEM O OPERADOR VE. Mostrar quem executou a etapa anterior
  // enviesa a revisao, e esconder sempre impede o revisor de saber com quem
  // falar: `dominio.tipo_exibicao` declara o meio-termo.
  'producao.perfil_linhagem': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Exibição de linhagem da subfase ${linha.subfase_id}`,
    campos: {
      tipo_exibicao_id: { rotulo: 'Exibição', dominio: 'dominio.tipo_exibicao' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  'producao.perfil_workflow_dsgtools': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Workflow do DSGTools da subfase ${linha.subfase_id}`,
    campos: {
      workflow_dsgtools_id: { rotulo: 'Workflow', entidade: 'catalogo_qgis' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      requisito_finalizacao: { rotulo: 'Requisito de finalização', tipo: 'booleano' }
    }
  },

  'producao.perfil_alias': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Apelidos de campo da subfase ${linha.subfase_id}`,
    campos: {
      alias_id: { rotulo: 'Apelido de campos', entidade: 'catalogo_qgis' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  // O DECIMO SEGUNDO PERFIL DE CONFIGURACAO DO LOTE, e o unico que nao mora no
  // schema `producao`: ele diz qual subfase de qual lote e MONITORADA pelo
  // plugin, e como. A forma e a mesma dos onze acima -- (alguma coisa, subfase,
  // lote) mais as quatro colunas de auditoria --, e o agregado e o mesmo LOTE:
  // ninguem abre "perfil de monitoramento n.o 12", abre a ficha do lote.
  //
  // A ROTA DELE E `/api/microcontrole`, e nao `/api/producao`, porque e onde o
  // SAP Gerente o procura desde o SAP 2.3.5. O MODULO de autorizacao e o mesmo
  // (`producao`), e por isso a entrada esta neste arquivo.
  //
  // ELE AUDITA E A TELEMETRIA NAO, e a assimetria e decidida: isto e CADASTRO
  // (alguem ligou o monitoramento de um lote, num dia, e responde por isso), e a
  // telemetria e MEDICAO -- milhares de linhas por turno, em que a propria linha
  // e o registro. Ver `microcontrole/microcontrole_ctrl.js`. As tres tabelas de
  // medicao nem sequer estao neste banco.
  'microcontrole.perfil_monitoramento': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Monitoramento da subfase ${linha.subfase_id}`,
    campos: {
      tipo_monitoramento_id: {
        rotulo: 'Tipo de monitoramento',
        dominio: 'microcontrole.tipo_monitoramento'
      },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' }
    }
  },

  // A HABILITACAO POR DIFICULDADE. Ela se chamava `perfil_dificuldade_operador`
  // no SAP, e o CAMINHO DA ROTA guardou o nome de la porque o SAP Gerente o
  // consome; a TABELA nao guardou, porque aqui "perfil" ja quer dizer
  // autorizacao. Ela NAO substitui o `verifyPerfil`: quem barra a escrita e o
  // perfil do modulo `producao` em `dgeo.usuario_perfil`, e esta linha so diz
  // QUE TRABALHO a distribuicao pode entregar a quem ja esta autorizado.
  'producao.habilitacao_dificuldade': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: (t, linha) => linha.lote_id,
    resumo: linha => `Dificuldade na subfase ${linha.subfase_id}`,
    campos: {
      usuario_uuid: { rotulo: 'Militar', entidade: 'usuario' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      lote_id: { rotulo: 'Lote', entidade: 'lote' },
      tipo_perfil_dificuldade_id: {
        rotulo: 'Perfil de dificuldade', dominio: 'dominio.tipo_perfil_dificuldade'
      }
    }
  },

  // ==========================================================================
  // O QUE `/api/gerencia_producao` ESCREVE
  // ==========================================================================
  //
  // Daqui para baixo sao as tabelas da GERENCIA da producao: quem esta
  // habilitado a receber o que, quem furou a fila de quem, o que deu errado
  // durante a execucao e o que o cliente de producao precisa ter instalado.
  //
  // DOIS AGREGADOS NOVOS, e os dois sao ficha que alguem abre de verdade:
  //
  //   habilitacao    <- habilitacao, habilitacao_etapa, habilitacao_usuario
  //   producao       <- fila_prioritaria, fila_prioritaria_grupo,
  //                     relatorio_alteracao
  //
  // O RESTO CAI EM FICHA QUE JA EXISTE. `habilitacao_bloco` e da ficha do LOTE,
  // pelo bloco: a pergunta e "quem trabalha neste lote", e nao "em que blocos o
  // Fulano trabalha" -- essa segunda a tela responde pela lista, e nao pelo
  // historico. `problema_atividade` e `alteracao_fluxo` sao da ficha do LOTE
  // tambem, pela atividade: elas descrevem o que houve com uma folha, e a folha
  // esta no lote.

  // --- Agregado: habilitacao ------------------------------------------------
  //
  // SE CHAMAVA `perfil_producao*` NO SAP, e o nome mudou porque aqui "perfil" e
  // AUTORIZACAO (`dominio.tipo_perfil`: consulta, operador, gerente), lida pelo
  // `verifyPerfil` a cada requisicao. Estas tabelas NAO concedem acesso: elas
  // dizem QUE TRABALHO a distribuicao pode entregar a quem ja esta autorizado a
  // operar. Quem lia `perfil_producao_operador` achava que aquilo dava acesso.

  'producao.habilitacao': {
    modulo: 'producao',
    entidade: 'habilitacao',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Habilitação ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' }
    }
  },

  'producao.habilitacao_etapa': {
    modulo: 'producao',
    entidade: 'habilitacao',
    agregado: (t, linha) => linha.habilitacao_id,
    resumo: linha =>
      `Etapa da habilitação na subfase ${linha.subfase_id}`,
    campos: {
      habilitacao_id: { rotulo: 'Habilitação', entidade: 'habilitacao' },
      subfase_id: { rotulo: 'Subfase', tipo: 'numero' },
      // E O QUE FAZ UM RESTITUIDOR RECEBER Execucao e um revisor receber a
      // Revisao da MESMA subfase.
      tipo_etapa_id: { rotulo: 'Tipo de etapa', dominio: 'dominio.tipo_etapa' },
      prioridade: { rotulo: 'Prioridade', tipo: 'numero' }
    }
  },

  // UMA POR PESSOA, e o UNIQUE de `usuario_uuid` no DDL e quem cobra: em duas
  // habilitacoes, a pessoa receberia trabalho por dois caminhos com prioridades
  // diferentes e a distribuicao nao teria como desempatar.
  'producao.habilitacao_usuario': {
    modulo: 'producao',
    entidade: 'habilitacao',
    agregado: (t, linha) => linha.habilitacao_id,
    resumo: linha => `Pessoa habilitada ${linha.usuario_uuid}`,
    campos: {
      usuario_uuid: { rotulo: 'Militar', entidade: 'usuario' },
      habilitacao_id: { rotulo: 'Habilitação', entidade: 'habilitacao' }
    }
  },

  // --- Agregado: lote, pelo bloco e pela atividade --------------------------

  // EM QUE BLOCOS A PESSOA TRABALHA. Sem UNIQUE no DDL, de proposito: dois
  // blocos e o caso comum. O agregado esta a UM salto do lote, pelo bloco.
  'producao.habilitacao_bloco': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: async (t, linha) => {
      if (!linha || linha.bloco_id == null) return null
      const bloco = await t.oneOrNone(
        'SELECT lote_id FROM producao.bloco WHERE id = $<blocoId>',
        { blocoId: linha.bloco_id }
      )
      return bloco ? bloco.lote_id : null
    },
    resumo: linha => `Habilitação no bloco ${linha.bloco_id}`,
    campos: {
      usuario_uuid: { rotulo: 'Militar', entidade: 'usuario' },
      bloco_id: { rotulo: 'Bloco', tipo: 'numero' }
    }
  },

  // O QUE O OPERADOR APONTOU DURANTE A EXECUCAO, com o poligono de onde esta.
  // A gerencia so mexe no `resolvido`: reescrever a descricao ou o tipo pela
  // tela de gerencia apagaria a versao de quem viu o problema.
  //
  // SEM COLUNAS DE AUDITORIA NO DDL, e a ausencia e deliberada: `usuario_uuid` e
  // `data` ja sao o quem e o quando do APONTAMENTO. O que este mapa acrescenta e
  // quem o deu por resolvido.
  'producao.problema_atividade': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: async (t, linha) => {
      if (!linha || linha.atividade_id == null) return null
      const alvo = await t.oneOrNone(
        `SELECT ut.lote_id
           FROM producao.atividade AS a
           INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
          WHERE a.id = $<atividadeId>`,
        { atividadeId: linha.atividade_id }
      )
      return alvo ? alvo.lote_id : null
    },
    resumo: linha =>
      `Problema na atividade ${linha.atividade_id}: ${String(linha.descricao || '').slice(0, 60)}`,
    geometrias: ['geom'],
    campos: {
      atividade_id: { rotulo: 'Atividade', tipo: 'numero' },
      usuario_uuid: { rotulo: 'Apontado por', entidade: 'usuario' },
      tipo_problema_atividade_id: {
        rotulo: 'Tipo de problema', dominio: 'dominio.tipo_problema_atividade'
      },
      descricao: { rotulo: 'Descrição' },
      data: { rotulo: 'Data', tipo: 'data_hora' },
      resolvido: { rotulo: 'Resolvido', tipo: 'booleano' },
      // OBRIGATORIA, e e o que torna o apontamento util: "há um problema nesta
      // folha" nao ajuda ninguem, e "há um problema NESTE polígono" manda o
      // revisor direto ao lugar.
      geom: { rotulo: 'Geometria', tipo: 'geometria' }
    }
  },

  // A DECISAO DE ALTERAR O FLUXO por causa de um problema. Ela nao tem tipo,
  // porque o que guarda e a decisao de quem gerencia, escrita a mao -- e por
  // isso a mesma tela que a le e a que a corrige, inteira.
  'producao.alteracao_fluxo': {
    modulo: 'producao',
    entidade: 'lote',
    agregado: async (t, linha) => {
      if (!linha || linha.atividade_id == null) return null
      const alvo = await t.oneOrNone(
        `SELECT ut.lote_id
           FROM producao.atividade AS a
           INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
          WHERE a.id = $<atividadeId>`,
        { atividadeId: linha.atividade_id }
      )
      return alvo ? alvo.lote_id : null
    },
    resumo: linha =>
      `Alteração de fluxo na atividade ${linha.atividade_id}: ${String(linha.descricao || '').slice(0, 60)}`,
    geometrias: ['geom'],
    campos: {
      atividade_id: { rotulo: 'Atividade', tipo: 'numero' },
      usuario_uuid: { rotulo: 'Decidido por', entidade: 'usuario' },
      descricao: { rotulo: 'Descrição' },
      data: { rotulo: 'Data', tipo: 'data_hora' },
      resolvido: { rotulo: 'Resolvido', tipo: 'booleano' },
      geom: { rotulo: 'Geometria', tipo: 'geometria' }
    }
  },

  // --- Agregado: producao (o que nao pertence a lote nenhum) ----------------
  //
  // O FURO DE FILA E O DIARIO DE ALTERACOES NAO SAO DE UM LOTE. A fila
  // prioritaria e da PESSOA (ou do grupo) e atravessa lotes; o relatorio de
  // alteracao nao aponta para nada. Prende-los a um lote pelo caminho da
  // atividade daria uma ficha por lote para uma decisao que e da Divisao.

  // `usuario_uuid` AQUI E O BENEFICIARIO, e nao o autor: quem furou a fila esta
  // em `usuario_cadastramento_uuid`. E a razao de esta tabela ter as quatro
  // colunas de auditoria e `producao.atividade` nao ter nenhuma -- o furo de
  // fila e um ATO de quem gerencia.
  'producao.fila_prioritaria': {
    modulo: 'producao',
    entidade: 'producao',
    agregado: () => 'fila_prioritaria',
    resumo: linha =>
      `Atividade ${linha.atividade_id} priorizada para ${linha.usuario_uuid}`,
    campos: {
      atividade_id: { rotulo: 'Atividade', tipo: 'numero' },
      usuario_uuid: { rotulo: 'Beneficiário', entidade: 'usuario' },
      prioridade: { rotulo: 'Prioridade', tipo: 'numero' }
    }
  },

  'producao.fila_prioritaria_grupo': {
    modulo: 'producao',
    entidade: 'producao',
    agregado: () => 'fila_prioritaria_grupo',
    resumo: linha =>
      `Atividade ${linha.atividade_id} priorizada para a habilitação ${linha.habilitacao_id}`,
    campos: {
      atividade_id: { rotulo: 'Atividade', tipo: 'numero' },
      habilitacao_id: { rotulo: 'Habilitação', entidade: 'habilitacao' },
      prioridade: { rotulo: 'Prioridade', tipo: 'numero' }
    }
  },

  // O DIARIO EM TEXTO das mudancas de fluxo, derivado de nada e apontando para
  // nada. Sem colunas de auditoria no DDL: a `data` e a coluna dele, e quem
  // escreveu so aparece aqui.
  'producao.relatorio_alteracao': {
    modulo: 'producao',
    entidade: 'producao',
    agregado: () => 'relatorio_alteracao',
    resumo: linha => `Alteração: ${String(linha.descricao || '').slice(0, 80)}`,
    campos: {
      data: { rotulo: 'Data', tipo: 'data_hora' },
      descricao: { rotulo: 'Descrição' }
    }
  },

  // --- Agregado: catalogo_qgis, as quatro que faltavam ----------------------
  //
  // O QUE O CLIENTE DE PRODUCAO PRECISA TER INSTALADO, mais os atalhos de
  // teclado. As quatro moram no schema `qgis`, e nao em `dgeo` como no SAP:
  // aqui `dgeo` e GENTE.

  'qgis.plugin': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Plugin ${linha.nome} (mínimo ${linha.versao_minima})`,
    campos: {
      nome: { rotulo: 'Nome' },
      // O CLIENTE ATRAS DESTA VERSAO E RECUSADO NO LOGIN: plugin velho grava
      // atividade com contrato velho, e o estrago so aparece depois.
      versao_minima: { rotulo: 'Versão mínima' }
    }
  },

  // AS DUAS SINGLETON TEM AGREGADO DE TEXTO, e nao o `code`. Elas sao chaveadas
  // por `code = 1` e nao por `id`, entao um agregado numerico as jogaria na
  // mesma ficha do plugin de id 1 e do menu de id 1. 'cliente' e o nome da
  // ficha: "o que o cliente de producao precisa ter".
  'qgis.versao_qgis': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: () => 'cliente',
    resumo: linha => `Versão mínima do QGIS: ${linha.versao_minima}`,
    campos: {
      code: { rotulo: 'Código', tipo: 'numero' },
      versao_minima: { rotulo: 'Versão mínima' }
    }
  },

  // NASCE VAZIA, e e deliberado: o valor e uma pasta de rede DA INSTALACAO, e
  // este repositorio e publico. O caminho aparece no rastro, que e tela de
  // gerente; o que nao pode e valor nenhum em arquivo versionado.
  'qgis.plugin_path': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: () => 'cliente',
    resumo: () => 'Caminho de download do plugin',
    campos: {
      code: { rotulo: 'Código', tipo: 'numero' },
      path: { rotulo: 'Caminho' }
    }
  },

  // A FERRAMENTA E IDENTIFICADA PELO ROTULO TRADUZIDO, e e por isso que `idioma`
  // existe e que a mesma tecla aparece duas vezes ('Mesclar feições
  // selecionadas' e 'Merge Selected Features' sao a MESMA acao). O QGIS nao
  // expoe identificador estavel da acao para quem configura de fora.
  'qgis.qgis_shortcuts': {
    modulo: 'producao',
    entidade: 'catalogo_qgis',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Atalho de ${linha.ferramenta} (${linha.idioma})`,
    campos: {
      ferramenta: { rotulo: 'Ferramenta' },
      idioma: { rotulo: 'Idioma' },
      // VAZIO DESLIGA A TECLA, e nao e o mesmo que apagar a linha: a linha e o
      // que diz que a ferramenta esta na lista.
      atalho: { rotulo: 'Atalho' },
      owner: { rotulo: 'Publicado por' },
      update_time: { rotulo: 'Publicado em', tipo: 'data_hora' }
    }
  },

  // --- Pseudo-tabela: o refresh das views de acompanhamento -----------------
  //
  // `PUT /api/gerencia_producao/refresh_views` refaz TODAS as views
  // materializadas do schema `acompanhamento` de uma vez. A chave nomeia a
  // FAMILIA, e nao uma view: sao `lote_<L>_linha_<P>` e `lote_<L>_subfase_<S>`,
  // uma por par, com nome gerado em tempo de execucao. Citar uma seria escolher
  // arbitrariamente qual representa a operacao, e listar todas seria uma linha
  // de evento por view para uma acao que e uma so. Mesmo desenho de
  // `acervo.mv_produto`.
  'acompanhamento.view_producao': {
    pseudoTabela: true,
    modulo: 'producao',
    entidade: 'manutencao',
    // Nao ha ficha para abrir: a pergunta que a acao produz e "quem mandou
    // rodar, e quando".
    agregado: () => 'operacao',
    resumo: linha => {
      const n = (linha && linha.views_atualizadas) || 0
      if (n === 1) return '1 view de acompanhamento atualizada'
      return `${n} views de acompanhamento atualizadas`
    },
    campos: {
      views_atualizadas: { rotulo: 'Views atualizadas', tipo: 'numero' },
      views: { rotulo: 'Views', tipo: 'lista' }
    }
  },

  // --- Pseudo-tabela: a zona de perigo ---------------------------------------
  //
  // As TRES operacoes em massa de `/api/perigo` (soltar as atividades de uma
  // pessoa, apagar o log combinado e apagar unidade de trabalho sem atividade)
  // mudam estado VARRENDO: nao ha uma linha antes e depois, ha uma decisao e um
  // raio de explosao.
  //
  // ERAM CINCO ATE 2026-08-09: `/produtos_sem_unidade_trabalho` e
  // `/lote_sem_produto` deixaram de existir por decisao do chefe, e as operacoes
  // delas sairam desta lista. A PSEUDO-TABELA FICA, porque as tres restantes
  // continuam gravando aqui.
  //
  // UMA ENTRADA PARA AS TRES, e nao tres. O que muda entre elas e o ALVO, que
  // e um campo; a entidade, o agregado e a pergunta sao os mesmos -- "quem mandou
  // varrer, quando, com que motivo, e quanto levou junto". Tres chaves seriam
  // tres lugares para divergir na primeira coluna acrescentada.
  //
  // E UMA LINHA DE EVENTO POR OPERACAO, e nao por registro. E o mesmo desenho de
  // `acervo.mv_produto` e da limpeza de downloads, e a razao esta escrita no
  // `registrarOperacao`: uma linha por unidade de trabalho apagada faria a
  // trilha crescer mais rapido que a producao, para registrar algo que ninguem
  // decidiu unidade a unidade. O `detalhe` guarda a lista, dentro do evento.
  //
  // O `motivo` NAO E CAMPO DAQUI: ele e coluna de `auditoria.evento`, e as rotas
  // o recebem no corpo, ao lado da confirmacao.
  'producao.zona_perigo': {
    pseudoTabela: true,
    modulo: 'producao',
    entidade: 'manutencao',
    // Nao ha ficha para abrir. A trilha destas acoes se le na tela geral de
    // rastreabilidade, filtrando por modulo.
    agregado: () => 'operacao',
    resumo: linha => {
      const alvo = (linha && linha.alvo) || 'alvo não informado'
      const n = (linha && linha.removidos) || 0
      return `Zona de perigo: ${n} registro(s) removido(s) em ${alvo}`
    },
    campos: {
      operacao: { rotulo: 'Operação' },
      alvo: { rotulo: 'Alvo' },
      removidos: { rotulo: 'Registros removidos', tipo: 'numero' },
      // Quantos a operacao deixou de proposito. So `atividades_do_usuario` o
      // preenche: e o numero de atividades FINALIZADAS da pessoa, que aquela
      // rota nao toca -- e o campo existe para que a ausencia delas na contagem
      // seja lida como escolha, e nao como falha.
      preservados: { rotulo: 'Registros preservados', tipo: 'numero' },
      detalhe: { rotulo: 'Detalhe', tipo: 'lista' }
    }
  },

  // --- Pseudo-tabela: o acesso ao banco de PRODUCAO --------------------------
  //
  // O ATO, E NAO A LINHA, e a diferenca aqui e a razao inteira desta entrada.
  //
  // Existe uma tabela de verdade por tras (`producao.login_temporario`), e ela
  // NAO se declara no mapa. Duas coisas impediriam:
  //
  //   A SENHA. A linha guarda a credencial do papel efemero do PostgreSQL em
  //   CLARO -- ela nao e hash e nem pode ser, porque o servidor precisa
  //   ENTREGA-LA ao plugin para o QGIS abrir a conexao de edicao. Auditar a
  //   tabela faria `lerAntes`/`lerDepois` copiarem a linha inteira para dentro
  //   de `auditoria.evento`, que e append-only e e lida por administrador. O
  //   `omitir` resolveria o JSON, mas resolveria so ele: a copia continuaria
  //   sendo feita, e a proxima coluna acrescentada a tabela entraria sozinha.
  //
  //   A PERGUNTA ERRADA. A linha nao sabe PARA QUAL ATIVIDADE a permissao foi
  //   dada, e e isso que se quer saber meses depois -- "quem deu acesso a quem,
  //   em que folha". Um evento de UPDATE de `login_temporario` responderia
  //   "a senha do papel mudou", que nao e pergunta que alguem faz.
  //
  // O CABECALHO DESTE ARQUIVO DIZ QUE `login_temporario` NAO TEM PORTA DE
  // ESCRITA, e isso deixou de valer quando o subsistema de login temporario
  // atravessou: ela passou a ser escrita pela distribuicao e pelas tres rotas de
  // `/banco_dados` e `/atividades/permissoes` da gerencia. A frase de la
  // continua certa quanto ao efeito -- ninguem abre a ficha de uma credencial
  // efemera -- e e por isso que o rastro dela e este evento de OPERACAO, e nao
  // a tabela.
  //
  // NENHUM CAMPO DAQUI E SEGREDO, e a lista e fechada de proposito: o nome do
  // papel, a quem ele pertence, a atividade e o dado de producao. O ENDERECO do
  // banco tambem nao entra -- `dado_producao_id` e o ponteiro, e quem tem acesso
  // ao banco resolve o endereco por ele. Este repositorio e publico, e o log e a
  // trilha sao os dois lugares por onde um endereco escapa sem ninguem notar.
  'producao.acesso_banco_producao': {
    pseudoTabela: true,
    modulo: 'producao',
    entidade: 'manutencao',
    // Nao ha ficha para abrir: a trilha se le na tela geral de rastreabilidade,
    // filtrando por modulo. Mesmo desenho de `producao.zona_perigo`.
    agregado: () => 'operacao',
    resumo: linha => {
      const acao = (linha && linha.operacao) || 'Operação'
      const papel = (linha && linha.login) || 'papel não informado'
      return `${acao} de acesso ao banco de produção: ${papel}`
    },
    campos: {
      operacao: { rotulo: 'Operação' },
      // O nome do PAPEL do PostgreSQL, que e publico dentro do banco de edicao.
      // A senha dele nao existe neste evento, em nenhuma forma.
      login: { rotulo: 'Papel no banco de produção' },
      usuario_uuid: { rotulo: 'Pessoa', entidade: 'usuario' },
      atividade_id: { rotulo: 'Atividade', tipo: 'numero' },
      dado_producao_id: { rotulo: 'Dado de produção', tipo: 'numero' },
      // Quantas camadas a concessao alcancou, e quantos papeis a revogacao em
      // massa levou. Sao a medida do raio de cada uma.
      camadas: { rotulo: 'Camadas alcançadas', tipo: 'numero' },
      papeis: { rotulo: 'Papéis alcançados', tipo: 'numero' },
      atividades: { rotulo: 'Atividades reaplicadas', tipo: 'numero' },
      detalhe: { rotulo: 'Detalhe', tipo: 'lista' }
    }
  }
}
