'use strict'

/**
 * Constantes que espelham os valores das tabelas de domínio do banco de dados.
 * Referência: er/dominio.sql, er/mapoteca.sql
 */

// dominio.tipo_status_arquivo
const STATUS_ARQUIVO = {
  CARREGADO: 1,
  ERRO_CARREGAMENTO: 2,
  EXCLUIDO: 3,
  ERRO_EXCLUSAO: 4
}

// dominio.tipo_arquivo
const TIPO_ARQUIVO = {
  ARQUIVO_PRINCIPAL: 1,
  FORMATO_ALTERNATIVO: 2,
  INSUMO: 3,
  METADADO: 4,
  JSON_EDICAO: 5,
  DOCUMENTOS: 6,
  PROJETO_QGIS: 7,
  COMPLEMENTAR: 8,
  TILESERVER: 9
}

// dominio.tipo_versao
const TIPO_VERSAO = {
  REGULAR: 1,
  REGISTRO_HISTORICO: 2,
  // Folha que ainda vai ser produzida. Nasce sem arquivo, e o arquivo entra na
  // MESMA versao quando a producao terminar.
  PLANEJADA: 3
}

// dominio.tipo_escala
const TIPO_ESCALA = {
  ESCALA_25K: 1,
  ESCALA_50K: 2,
  ESCALA_100K: 3,
  ESCALA_250K: 4,
  ESCALA_PERSONALIZADA: 5
}

// dominio.situacao_carregamento
const SITUACAO_CARREGAMENTO = {
  NAO_CARREGADO: 1,
  CARREGADO_BDGEX_OSTENSIVO: 2,
  CARREGADO_BDGEX_OPERACOES: 3,
  CARREGADO_IGW: 4,
  CARREGADO_GEDW: 5,
  // O EBGeo entrou em 2026-08-31: e o destino do Modelo 3D e da Panoramica 360,
  // e sem ele a 2.4 do RPCMTec nao podia listar nenhum dos dois. O GEDW ao lado
  // e o portal da Airbus do TREx, e nao serve de sinonimo.
  CARREGADO_EBGEO: 6
}

// dominio.subtipo_produto: os TRINTA codes, e não mais um subconjunto.
//
// Ele nasceu aqui com cinco, que eram os que as consultas do acervo comparavam.
// Passou a trinta em 2026-08-09, com o core de produção: a escolha do template
// de XML do metadado despacha por subtipo, e sete dos que ela precisa estavam
// fora. Meio catálogo é pior que catálogo nenhum, porque quem procura um code e
// não o encontra conclui que ele não existe e escreve o número solto.
//
// O SUBTIPO É A IDENTIDADE DO PRODUTO, e não um refinamento do tipo:
// `acervo.produto` chaveia por ele, e é por isso que a Carta Topográfica
// Militar (24) é produto distinto da carta civil no mesmo MI. Ver o
// `define_produto` de `er/dominio.sql`.
//
// Os nomes saem do DDL, code a code. CDGV é 'Conjunto de dados geoespaciais
// vetoriais', escrito por extenso na tabela; o sufixo é a especificação técnica
// (ET-EDGV 2.1.3, ET-EDGV 3.0, MGCP, MUVD).
const SUBTIPO_PRODUTO = {
  CDGV_ET_EDGV_213: 1,
  CARTA_TOPOGRAFICA_T34_700: 2,
  CARTA_ORTOIMAGEM: 3,
  ORTOIMAGEM: 4,
  MODELO_DIGITAL_SUPERFICIE: 5,
  MODELO_DIGITAL_TERRENO: 6,
  CDGV_ET_EDGV_30: 7,
  CDGV_MGCP: 8,
  FOTOTRIANGULACAO: 9,
  IMAGEM_AEREA_SATELITE: 10,
  PONTO_CONTROLE: 11,
  CARTA_TOPOGRAFICA_ET_RDG: 12,
  CARTA_TEMATICA: 13,
  MAPA_DE_UNIDADES: 14,
  CARTA_DE_TRAFEGABILIDADE: 15,
  REDE_DE_TRANSPORTE: 16,
  MAPA_DE_GEOGRAFIA_HUMANA: 17,
  LEVANTAMENTO_TOPOGRAFICO: 18,
  CARTA_ORTOIMAGEM_SARP: 19,
  CDGV_MUVD: 20,
  MODELO_DIGITAL_SUPERFICIE_TREX: 21,
  CDGV_ORTOIMAGEM_ET_EDGV_30: 22,
  CDGV_TRAFEGABILIDADE: 23,
  CARTA_TOPOGRAFICA_MILITAR: 24,
  MODELO_3D_TILES: 25,
  MODELO_3D: 26,
  CARTA_ORTOIMAGEM_ESPECIAL: 27,
  CARTA_TOPOGRAFICA_NAO_SCN: 28,
  CARTA_AERONAUTICA: 29,
  CDGV_ESPECIAL: 30,
  // O 31 nasceu com o tipo 14 (Panoramica 360) em 2026-08-28 e ficou de fora
  // desta lista. Ele nomeia a REPRESENTACAO, como o 25 faz para o Modelo 3D.
  PANORAMICA_360_TILES: 31
}

// dominio.tipo_produto (subconjuntos usados em relatórios da mapoteca)
//
// PONTO_CONTROLE não é um produto do acervo: um CHECK em acervo.produto barra o
// tipo 10 (ver er/ponto_controle.sql). Ele fica aqui porque o schema
// ponto_controle usa a MESMA infraestrutura de volume, e
// acervo.volume_tipo_produto chaveia por tipo_produto_id.
const TIPO_PRODUTO = {
  CARTA_TOPOGRAFICA: 2,
  CARTA_ORTOIMAGEM: 3,
  // Ortoimagem crua (sem moldura de carta). É o que o Anuário Estatístico conta
  // na linha "Imagem de Satélite" / "Imagem de Satélite / Fotografia aérea".
  ORTOIMAGEM: 4,
  CARTA_TEMATICA: 7,
  PONTO_CONTROLE: 10
}

// mapoteca.tipo_cliente
const TIPO_CLIENTE = {
  OM_EB: 1,
  OM_AERONAUTICA: 2,
  OM_MARINHA: 3,
  ORGAO_PUBLICO_FEDERAL: 4,
  ORGAO_PUBLICO_ESTADUAL: 5,
  ORGAO_PUBLICO_MUNICIPAL: 6,
  PESSOA_JURIDICA: 7,
  PESSOA_FISICA: 8,
  LAI: 9
}

// mapoteca.situacao_pedido
//
// NAO COMECA EM 1, e o buraco e deliberado. O code 1 era 'Pre cadastramento do
// pedido realizado' e saiu em 2026-08-08 com ZERO pedidos: a mapoteca nunca
// trabalhou o estagio "alguem avisou que vem um pedido". Renumerar as outras
// seis reescreveria a situacao dos 166 pedidos e mentiria sobre o que ja esta
// gravado em `auditoria.evento`, entao a lacuna fica.
//
// O 2 se chamava DOCUMENTO_RECEBIDO ('DIEx/Oficio do pedido recebido') e virou
// PEDIDO_RECEBIDO no mesmo dia. So o rotulo mudou: o code e o mesmo, porque o
// estagio existe -- ele so estava nomeado pelo DOCUMENTO, e o pedido de civil
// chega por e-mail, sem DIEx nenhum.
//
// O 8 (Aguardando envio) entrou em 2026-08-24: o pedido impresso, embalado e
// ainda nao despachado. NAO se confunde com o 7 (Aguardando producao), que
// espera CARTA que ainda nao existe; este espera so o DESPACHO do que ja esta
// pronto.
const SITUACAO_PEDIDO = {
  PEDIDO_RECEBIDO: 2,
  EM_ANDAMENTO: 3,
  REMETIDO: 4,
  CONCLUIDO: 5,
  CANCELADO: 6,
  AGUARDANDO_PRODUCAO: 7,
  AGUARDANDO_ENVIO: 8
}

// mapoteca.tipo_midia
const TIPO_MIDIA = {
  BANNER: 1,
  GLOSSY: 2,
  COUCHE: 3,
  VERGE: 4,
  SULFITE_90G: 5,
  SULFITE_120G: 6,
  DIGITAL: 7,
  TYVEK: 8,
  SULFITE_75G: 9
}

// mapoteca.forma_entrega
const FORMA_ENTREGA = {
  CORREIOS: 1,
  ENTREGA_EM_MAOS: 2,
  RETIRADO_NO_CGEO: 3,
  EMAIL: 4,
  OUTROS: 5
}

// NÃO EXISTE `CATEGORIA_MATERIAL`, desde 2026-08-08. Ela espelhava
// `dominio.categoria_material`, e a única coisa que a categoria decidia era em
// qual das duas tabelas de insumo do RPCMTec o material sairia: a 7.2 (Papel) ou
// a 7.3 (Tintas). O chefe fundiu as duas na 7.2, e a 7.3 sumiu -- a tabela de
// domínio, a coluna e esta constante foram junto. Ver
// migrations/2026-08-08_livro_de_movimentos.sql.

// dominio.tipo_licitacao (4.4 GCALC DSG / 4.5 demais licitações)
const TIPO_LICITACAO = {
  GCALC_DSG: 1,
  PROPRIA: 2,
  PARTICIPANTE: 3
}

// dominio.classificacao_nc (4.2 PDR / 4.7 Extra-PDR)
const CLASSIFICACAO_NC = {
  PDR: 1,
  EXTRA_PDR: 2
}

// A CHAVE DO SIAFI DA NOTA DE EMPENHO: UG + GESTÃO + ANO + NÚMERO
// (`160382000012026NE000005`). É ela que `uniq_nota_empenho_chave_siafi` cobra,
// e o servidor DERIVA as duas primeiras: elas não são campo de formulário.
//
// A REGRA SAI DO DADO, e é a mesma que o backfill de
// `migrations/2026-08-07_identidade_da_nota_empenho.sql` mediu: quem empenha é a
// UG que RECEBEU o crédito, e o crédito da 167382 é emitido pela UG 167035, do
// mesmo modo que o da 160382 vem da 160035. A 167382 é unidade gestora distinta,
// com numeração própria começando do 1: as duas têm legitimamente uma
// 2026NE000005, e sem a UG na chave uma recusaria a outra.
//
// Os códigos são de `dominio.ug`, e não segredo nenhum: eles já estão no DDL e
// na migração, os dois versionados.
const CHAVE_SIAFI_NE = {
  // UG emitente da NC representativa -> UG que emite o empenho.
  UG_POR_EMITENTE: {
    167035: '167382'
  },
  // Qualquer outra emitente cai aqui. É o 1º CGEO.
  UG_PADRAO: '160382',
  // Hoje só existe a 00001. A coluna guarda a gestão mesmo assim, porque ela faz
  // parte da chave e o dia em que aparecer outra não pode custar outra migração.
  GESTAO_PADRAO: '00001'
}

// mapoteca.tipo_localizacao
const TIPO_LOCALIZACAO = {
  SECAO: 1,
  ALMOXARIFADO: 2,
  AQUISICAO_REALIZADA: 3,
  SALDO_NO_EMPENHO: 4
}

// ONDE O MATERIAL ESTÁ DE VERDADE. As quatro localizações são ETAPAS da vida do
// material, e não prateleiras: 'Aquisição realizada' e 'Saldo no empenho' são
// material COMPRADO e ainda não entregue. Somá-las ao estoque faria a Divisão
// contar, como disponível, resma que ainda está com o fornecedor -- e é por isso
// que tanto a coluna "Estoque atual" da 7.2 do RPCMTec quanto o alerta de
// estoque mínimo contam só estas duas.
const LOCALIZACOES_NA_CASA = [
  TIPO_LOCALIZACAO.SECAO,
  TIPO_LOCALIZACAO.ALMOXARIFADO
]

// mapoteca.tipo_movimento_material: o livro de movimentos do material.
//
// São as três coisas que acontecem com o material: ele CHEGA, MUDA de lugar e
// ACABA. Não há ajuste de saldo, e a ausência é a regra: o saldo tem de estar
// certo por estes três, e lançamento errado se conserta editando a linha errada.
//
// O CODE 4 NÃO EXISTE, nem aqui nem no banco. Ele foi a Contagem, extinta em
// 2026-08-08, e a linha do domínio caiu junto na 1.48.0
// (`migrations/2026-08-08_apagar_a_contagem_do_dominio.sql`): sobreviveu por
// algumas horas para a auditoria antiga se traduzir, e a medição do mesmo dia
// mostrou que não havia auditoria antiga nenhuma. Ressuscitá-lo neste mapa daria
// ao Joi um valor que o `ELSE FALSE` do CHECK `movimento_material_forma` e a
// chave estrangeira recusam, e a recusa chegaria como 500 em vez de 400.
const TIPO_MOVIMENTO_MATERIAL = {
  ENTRADA: 1,
  TRANSFERENCIA: 2,
  CONSUMO: 3
}

// dominio.tipo_relacionamento
const TIPO_RELACIONAMENTO = {
  INSUMO: 1,
  COMPLEMENTAR: 2,
  CONJUNTO: 3
}

// mapoteca.tipo_anexo_pedido
const TIPO_ANEXO_PEDIDO = {
  DOCUMENTO_SOLICITACAO: 1,
  ANEXO_DOCUMENTO: 2,
  COMPROVANTE_ENTREGA: 3,
  OUTROS: 4
}

// mapoteca.canal_recebimento (por onde a demanda de civil chega)
const CANAL_RECEBIMENTO = {
  OUVIDORIA_LAI: 1,
  EMAIL: 2,
  OFICIO: 3,
  OUTRO: 4
}

// dominio.situacao_extra_pit (3.3 do RPCMTec)
const SITUACAO_EXTRA_PIT = {
  PREVISTO: 1,
  EM_PRODUCAO: 2,
  ENVIADO: 3,
  CONCLUIDO: 4,
  CANCELADO: 5
}

// dominio.tipo_capacitacao: MINISTRADA sai na 2.6 e RECEBIDA na 6.2. São duas
// subseções do relatório e um cadastro só.
const TIPO_CAPACITACAO = {
  MINISTRADA: 1,
  RECEBIDA: 2
}

// dominio.tipo_status_execucao (projeto e lote)
const STATUS_EXECUCAO = {
  NAO_INICIADO: 1,
  EM_EXECUCAO: 2,
  CONCLUIDO: 3,
  CONCLUIDO_PARCIALMENTE: 4,
  PAUSADO: 5
}

// dominio.situacao_capacitacao
const SITUACAO_CAPACITACAO = {
  PREVISTA: 1,
  EM_EXECUCAO: 2,
  CONCLUIDA: 3,
  CANCELADA: 4
}

// equipamento.classe_suprimento
//
// OS CÓDIGOS SÃO OS ALGARISMOS ROMANOS, e não uma sequência: VI é 6 e IX é 9. As
// duas são as classes de suprimento que a Divisão movimenta (VI com 102 bens e
// IX com 3, medido na planilha do Relatório DMT de 2026-08-03), e no dia em que
// aparecer a VII o código dela é 7, sem renumerar nada.
const CLASSE_SUPRIMENTO = {
  VI: 6,
  IX: 9
}

// equipamento.secao_detentora: quem detém o bem hoje. São duas seções, e não a
// estrutura inteira da Divisão, porque o que o Relatório DMT distingue é quem
// guarda o equipamento de levantamento de quem guarda o de produção.
const SECAO_DETENTORA = {
  CIA_LEV: 1,
  CIA_PROD: 2
}

// equipamento.situacao
//
// ESTA CONSTANTE NÃO NOMEIA UMA COLUNA. `equipamento.equipamento` não tem coluna
// de situação: quem responde é a função `equipamento.situacao_em(dia)`, pelo
// degrau de maior `precedencia` que se aplicar no dia perguntado. A prova de que
// gravá-la seria redundante está na planilha de 2026-08-03: as 11 linhas
// marcadas 'Indisponível' eram EXATAMENTE as 11 com motivo de indisponibilidade
// preenchido.
//
// Os códigos aqui servem para LER o que a função devolveu e para filtrar a
// lista, nunca para escrever.
const SITUACAO_EQUIPAMENTO = {
  DISPONIVEL: 1,
  AFASTADO: 2,
  EM_MANUTENCAO: 3,
  INDISPONIVEL: 4,
  BAIXADO: 5
}

// equipamento.situacao_transferencia: os estágios de uma saída ou entrada de
// carga. A descarga nasce SOLICITADA muito antes de ser concluída, e era assim
// que estavam as 10 da planilha de 2026-08-03: sem OM, sem documento e sem data.
const SITUACAO_TRANSFERENCIA = {
  SOLICITADA: 1,
  AUTORIZADA: 2,
  CONCLUIDA: 3,
  CANCELADA: 4
}

// equipamento.tipo_transferencia
const TIPO_TRANSFERENCIA = {
  RECEBIMENTO: 1,
  CESSAO: 2,
  DESCARGA: 3
}

// campo.situacao: em que pé está a atividade de campo. Os códigos são os do
// SAP, que é a regra da fusão: a linha migrada não precisa de tradução.
const SITUACAO_CAMPO = {
  PREVISTO: 1,
  EM_EXECUCAO: 2,
  FINALIZADO: 3,
  CANCELADO: 4
}

// campo.categoria: a finalidade do campo, e a coluna "Finalidade Campo" da
// subseção 2.5 do RPCMTec.
//
// OS CÓDIGOS SÃO NOVOS, ao contrário da situação ao lado: no SAP isto era um
// `ENUM` do Postgres (`controle_campo.categoria_campo`), que não tem número a
// herdar. A ordem é a da declaração do ENUM de lá.
const CATEGORIA_CAMPO = {
  REAMBULACAO: 1,
  MODELOS_3D: 2,
  PANORAMICAS_360: 3,
  PONTOS_DE_CONTROLE: 4,
  ORTOIMAGENS_DE_DRONE: 5
}

// NÃO EXISTE `TIPO_EQUIPAMENTO` aqui, e a ausência é a regra.
// `equipamento.tipo_equipamento` é CADASTRO, com `id SERIAL` e tela de CRUD:
// decisão do chefe em 2026-08-08, para tipo novo custar uma tela e não uma
// migração. `id` de cadastro não vira constante, e nenhum SQL do módulo compara
// `tipo_id` com número literal: quem precisa de um tipo específico o procura
// pelo nome.

// ---------------------------------------------------------------------------
// Domínios do módulo PRODUÇÃO (code 7), absorvidos do SAP 2.3.5 em 2026-08-09.
//
// OS CÓDIGOS SÃO OS DO SAP, code a code, como já são os de `SITUACAO_CAMPO`: o
// dump do SAP 2.3.5 é o que vai popular o schema `producao`, e linha migrada
// não pode precisar de tradução de código.
//
// SÓ ESTÃO AQUI OS DOZE QUE O SCHEMA `producao` REFERENCIA por chave
// estrangeira. Os outros três domínios que atravessaram
// (`tipo_controle_qualidade`, `tipo_criacao_unidade_trabalho` e
// `tipo_estrategia_associacao`) NÃO viraram constante, e a ausência é a regra:
// eles são argumento das rotinas de criação em massa, nenhuma coluna aponta
// para eles e nenhum SQL compara código com literal. Constante que ninguém lê
// é catálogo para desatualizar.
// ---------------------------------------------------------------------------

// dominio.tipo_fase
const TIPO_FASE = {
  EXTRACAO: 1,
  REAMBULACAO: 2,
  VALIDACAO: 3,
  EDICAO: 4,
  DISSEMINACAO: 5,
  VETORIZACAO: 6,
  AVALIACAO: 7,
  GENERALIZACAO: 8,
  FOTOTRIANGULACAO: 9,
  RESTITUICAO: 10,
  PROCESSAMENTO_DIGITAL_IMAGENS: 11,
  MEDICAO_PONTOS_CONTROLE: 12,
  GERACAO_ORTOIMAGEM: 13,
  GERACAO_MDE: 14,
  LEVANTAMENTO_TOPOGRAFICO: 15,
  PREPARO: 16
}

// dominio.tipo_pre_requisito
const TIPO_PRE_REQUISITO = {
  REGIAO_CONCLUIDA: 1,
  REGIAO_NAO_EM_EXECUCAO: 2
}

// dominio.tipo_etapa: o papel da etapa dentro da subfase. É sobre ele que a
// restrição de operador é escrita, e é o que distingue quem produz de quem
// confere.
const TIPO_ETAPA = {
  EXECUCAO: 1,
  REVISAO: 2,
  CORRECAO: 3,
  REVISAO_CORRECAO: 4,
  REVISAO_FINAL: 5
}

// dominio.tipo_exibicao: quanto da linhagem o operador vê.
const TIPO_EXIBICAO = {
  NUNCA_EXIBIR: 1,
  SOMENTE_REVISORES: 2,
  SEMPRE_EXIBIR: 3
}

// dominio.tipo_restricao
//
// NÃO EXISTE O CODE 3, nem aqui nem no banco. Ele era 'Operadores no mesmo
// turno' e dependia de `dominio.tipo_turno`, removida por decisão do chefe em
// 2026-08-09. Medido no dump de produção do SAP em 2026-08-09:
// `restricao_etapa` tem 98 linhas, 49 do tipo 1 e 49 do tipo 2, e ZERO do tipo
// 3. Ressuscitá-lo aqui daria ao Joi um valor que a chave estrangeira recusa, e
// a recusa chegaria como 500 em vez de 400.
const TIPO_RESTRICAO = {
  OPERADORES_DISTINTOS: 1,
  OPERADORES_IGUAIS: 2
}

// dominio.tipo_insumo: COMO o insumo chega ao operador, e não o que ele é. Por
// isso o mesmo arquivo aparece duas vezes, copiado ou aberto pela rede.
const TIPO_INSUMO = {
  ARQUIVO_COPIA_VIA_REDE: 1,
  ARQUIVO_ABERTO_VIA_REDE: 2,
  BANCO_POSTGIS: 3,
  INSUMO_FISICO: 4,
  URL: 5,
  SERVICO_WMS: 6,
  SERVICO_WFS: 7,
  XYZ_TILES: 8,
  DOWNLOAD_HTTP: 9,
  ARCGIS_MAPSERVER: 10
}

// dominio.tipo_dado_producao: quanto o sistema manda no dado da subfase.
//
// POSTGIS_COM_PERMISSAO é o único em que o servidor concede e revoga permissão
// no banco de produção a cada distribuição. Os outros dois são dado que ele
// apenas aponta.
const TIPO_DADO_PRODUCAO = {
  NAO_CONTROLADO: 1,
  POSTGIS_COM_PERMISSAO: 2,
  POSTGIS: 3
}

// dominio.tipo_situacao_atividade (chamava-se `dominio.tipo_situacao` no SAP).
//
// NAO_FINALIZADA (5) não é PAUSADA (3), e confundi-las mente na estatística de
// produção: pausada volta para a mesma mão, e não finalizada foi interrompida
// por fora e não volta.
const SITUACAO_ATIVIDADE = {
  NAO_INICIADA: 1,
  EM_EXECUCAO: 2,
  PAUSADA: 3,
  FINALIZADA: 4,
  NAO_FINALIZADA: 5
}

// dominio.tipo_configuracao: ferramenta de aquisição do DSGTools.
const TIPO_CONFIGURACAO = {
  DSGTOOLS_CENTROIDE: 1,
  DSGTOOLS_MAO_LIVRE: 2,
  DSGTOOLS_SELETOR_GENERICO: 3,
  DSGTOOLS_ANGULO_RETO: 4
}

// dominio.tipo_perfil_dificuldade: como a fila escolhe entre as unidades de
// trabalho disponíveis para um operador.
const TIPO_PERFIL_DIFICULDADE = {
  MAIS_FACEIS: 1,
  MAIS_DIFICEIS: 2,
  BALANCEADO: 3
}

// dominio.tipo_problema_atividade (chamava-se `dominio.tipo_problema` no SAP).
//
// OUTROS é 99, e não 8: a lacuna deixa o catálogo crescer pelo fim sem que
// 'Outros' deixe de ser o último da lista.
const TIPO_PROBLEMA_ATIVIDADE = {
  INSUMO_INSUFICIENTE: 1,
  ETAPA_ANTERIOR: 2,
  ERRO_NA_EXECUCAO: 3,
  UNIDADE_VIZINHA: 4,
  UNIDADE_MUITO_GRANDE: 5,
  PROBLEMA_NAS_ROTINAS: 6,
  FINALIZACAO_INCORRETA: 7,
  OUTROS: 99
}

// dominio.tipo_rotina: para que serve a rotina que o requisito de finalização
// exige. A diferença entre 1 e 2 é se o operador pode marcar apontamento como
// falso positivo e finalizar assim mesmo.
const TIPO_ROTINA = {
  QUALIDADE_SEM_FALSO_POSITIVO: 1,
  QUALIDADE_COM_FALSO_POSITIVO: 2,
  AUXILIAR: 3
}

module.exports = {
  STATUS_ARQUIVO,
  TIPO_ARQUIVO,
  TIPO_VERSAO,
  TIPO_ESCALA,
  SITUACAO_CARREGAMENTO,
  SUBTIPO_PRODUTO,
  TIPO_PRODUTO,
  TIPO_CLIENTE,
  SITUACAO_PEDIDO,
  TIPO_MIDIA,
  FORMA_ENTREGA,
  TIPO_LICITACAO,
  CLASSIFICACAO_NC,
  CHAVE_SIAFI_NE,
  TIPO_LOCALIZACAO,
  LOCALIZACOES_NA_CASA,
  TIPO_MOVIMENTO_MATERIAL,
  TIPO_RELACIONAMENTO,
  TIPO_ANEXO_PEDIDO,
  CANAL_RECEBIMENTO,
  SITUACAO_EXTRA_PIT,
  TIPO_CAPACITACAO,
  SITUACAO_CAPACITACAO,
  STATUS_EXECUCAO,
  CLASSE_SUPRIMENTO,
  SECAO_DETENTORA,
  SITUACAO_EQUIPAMENTO,
  SITUACAO_TRANSFERENCIA,
  TIPO_TRANSFERENCIA,
  SITUACAO_CAMPO,
  CATEGORIA_CAMPO,
  TIPO_FASE,
  TIPO_PRE_REQUISITO,
  TIPO_ETAPA,
  TIPO_EXIBICAO,
  TIPO_RESTRICAO,
  TIPO_INSUMO,
  TIPO_DADO_PRODUCAO,
  SITUACAO_ATIVIDADE,
  TIPO_CONFIGURACAO,
  TIPO_PERFIL_DIFICULDADE,
  TIPO_PROBLEMA_ATIVIDADE,
  TIPO_ROTINA
}
