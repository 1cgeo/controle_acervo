'use strict'

// Contratos de entrada da GERENCIA DA PRODUCAO.
//
// TRADUCAO DO SAP 2.3.5, e ela nao e cosmetica. Tres trocas valem para todo
// arquivo deste modulo, e cada uma muda o TIPO do campo:
//
//   `usuario_id` (INTEGER)      -> `usuario_uuid` (UUID)
//   `perfil_producao_id`        -> `habilitacao_id`
//   `tipo_situacao_id`          -> `tipo_situacao_atividade_id`
//
// A primeira e a que mais dói se passar batido: um `Joi.number()` onde a coluna
// e UUID recusa todo corpo bem formado, e um `Joi.string()` sem `.guid()` deixa
// a recusa para a chave estrangeira, que responde 500 em vez de 400.
//
// `.strict()` EM TODO NUMERO, como no SAP e como no PIT: a escrita tambem vem
// de carga e de CLI, e um BIGSERIAL viaja como string no JSON. Sem o estrito, o
// Joi converteria '12' em 12 em silencio e o contrato deixaria de ser contrato.

const Joi = require('joi')

const models = {}

// --- Pecas compartilhadas ----------------------------------------------------

const inteiro = () => Joi.number().integer().strict()

// O `id` de rota. `.positive()` porque SERIAL comeca em 1: `/0` e `/-3` sao erro
// de quem chamou, e nao um 404 depois de ir ao banco.
models.idParams = Joi.object().keys({
  id: Joi.number().integer().positive().required()
})

// Lista de ids, sempre com pelo menos um: uma operacao em massa sobre lista
// vazia responderia "sucesso" sem ter feito nada.
//
// O ITEM NAO LEVA `.required()`, e a ausencia e o que faz a recusa dizer a
// verdade: com ele, a lista VAZIA reprova por `array.includesRequiredUnknowns`
// ("does not contain 1 required value") em vez de `array.min`, e a mensagem
// passa a falar de um valor obrigatorio que ninguem declarou. O `.min(1)` e quem
// cobra o tamanho, e `Joi.number()` ja recusa nulo por si.
const listaDeIds = () =>
  Joi.array().items(inteiro()).unique().required().min(1)

// A PESSOA E UM UUID, e o `.guid()` e o que faz a recusa chegar como 400. Sem
// ele o texto qualquer atravessa o Joi e morre no `22P02` do Postgres, que vira
// 500 e nao diz qual campo estava errado.
const usuarioUuid = () => Joi.string().guid({ version: 'uuidv4' })

// EWKT de poligono, que e o formato que o plugin do QGIS manda e que o
// `ST_GeomFromEWKT` do banco le. NAO e o GeoJSON de `utils/geometria_schema.js`:
// aquele e o desenho da tela de busca do acervo, e este e a geometria que a
// alteracao de fluxo ja tem gravada e devolve por `ST_AsEWKT`. Converter um no
// outro aqui obrigaria a tela a redesenhar o poligono que ela acabou de ler.
const geomEwkt = () => Joi.string().min(1)

// --- Habilitacao -------------------------------------------------------------
//
// SE CHAMAVA `perfil_producao*` NO SAP. Aqui "perfil" e AUTORIZACAO
// (`dominio.tipo_perfil`), e habilitacao e o que a DISTRIBUICAO pode entregar a
// quem ja esta autorizado. Ver `er/producao.sql`.

models.habilitacao = Joi.object().keys({
  habilitacao: Joi.array()
    .items(Joi.object().keys({ nome: Joi.string().max(255).required() }))
    .required()
    .min(1)
})

models.habilitacaoAtualizacao = Joi.object().keys({
  habilitacao: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        nome: Joi.string().max(255).required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.habilitacaoIds = Joi.object().keys({
  habilitacao_ids: listaDeIds()
})

models.habilitacaoEtapa = Joi.object().keys({
  habilitacao_etapa: Joi.array()
    .items(
      Joi.object().keys({
        habilitacao_id: inteiro().required(),
        subfase_id: inteiro().required(),
        tipo_etapa_id: inteiro().required(),
        prioridade: inteiro().required()
      })
    )
    .required()
    .min(1)
})

models.habilitacaoEtapaAtualizacao = Joi.object().keys({
  habilitacao_etapa: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        habilitacao_id: inteiro().required(),
        subfase_id: inteiro().required(),
        tipo_etapa_id: inteiro().required(),
        prioridade: inteiro().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.habilitacaoEtapaIds = Joi.object().keys({
  habilitacao_etapa_ids: listaDeIds()
})

// UMA POR PESSOA, e quem cobra e o UNIQUE de `usuario_uuid` no banco. O
// `.unique('usuario_uuid')` aqui recusa a lista que repete a mesma pessoa DENTRO
// do mesmo corpo, que e o caso que a chave do banco nao chega a ver: o INSERT em
// massa quebraria no meio, com metade gravada, se nao houvesse transacao.
models.habilitacaoUsuario = Joi.object().keys({
  habilitacao_usuario: Joi.array()
    .items(
      Joi.object().keys({
        usuario_uuid: usuarioUuid().required(),
        habilitacao_id: inteiro().required()
      })
    )
    .unique('usuario_uuid')
    .required()
    .min(1)
})

models.habilitacaoUsuarioAtualizacao = Joi.object().keys({
  habilitacao_usuario: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        usuario_uuid: usuarioUuid().required(),
        habilitacao_id: inteiro().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.habilitacaoUsuarioIds = Joi.object().keys({
  habilitacao_usuario_ids: listaDeIds()
})

// SEM `.unique()` na dupla (pessoa, bloco), e a ausencia acompanha o banco:
// `producao.habilitacao_bloco` nao tem UNIQUE de proposito, porque trabalhar em
// dois blocos e o caso comum. O que se recusa aqui e id repetido na ATUALIZACAO,
// que faria dois UPDATEs disputarem a mesma linha.
models.habilitacaoBloco = Joi.object().keys({
  habilitacao_bloco: Joi.array()
    .items(
      Joi.object().keys({
        usuario_uuid: usuarioUuid().required(),
        bloco_id: inteiro().required()
      })
    )
    .required()
    .min(1)
})

models.habilitacaoBlocoAtualizacao = Joi.object().keys({
  habilitacao_bloco: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        usuario_uuid: usuarioUuid().required(),
        bloco_id: inteiro().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.habilitacaoBlocoIds = Joi.object().keys({
  habilitacao_bloco_ids: listaDeIds()
})

// --- Unidade de trabalho e atividade -----------------------------------------

models.unidadeTrabalhoDisponivel = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds(),
  disponivel: Joi.boolean().strict().required()
})

models.atividadePausar = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds()
})

models.atividadeReiniciar = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds()
})

models.atividadeVoltar = Joi.object().keys({
  atividade_ids: listaDeIds(),
  manter_usuarios: Joi.boolean().strict().required()
})

models.atividadeAvancar = Joi.object().keys({
  atividade_ids: listaDeIds(),
  concluida: Joi.boolean().strict().required()
})

// AS DUAS OBSERVACOES SAO OBRIGATORIAS, e aceitam vazio e nulo. E deliberado, e
// vem do SAP: a rota GRAVA as duas de uma vez, entao omitir uma apagaria o texto
// da outra sem que quem chamou tivesse dito isso. Mandar '' e apagar de
// proposito; nao mandar o campo e erro de quem chamou.
models.observacao = Joi.object().keys({
  atividade_ids: listaDeIds(),
  observacao_atividade: Joi.string().allow('', null).required(),
  observacao_unidade_trabalho: Joi.string().allow('', null).required()
})

// As tres propriedades sao OPCIONAIS, e o controlador pula a que nao veio: a
// tela de acompanhamento reprioriza dezenas de unidades de trabalho de uma vez
// e nao tem por que reenviar a dificuldade que ninguem tocou.
models.propriedadesAtualizacao = Joi.object().keys({
  unidades_trabalho: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        dificuldade: inteiro().min(0),
        tempo_estimado_minutos: inteiro().min(0),
        prioridade: inteiro()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

// O MODO LOCAL e a atividade executada FORA do fluxo (em campo, sem rede), e
// lancada depois pelo gerente. Por isso ela recebe as datas em vez de as marcar:
// o instante que interessa e o do trabalho, e nao o do lancamento.
//
// NAO leva `.raw()`, ao contrario do dia de calendario do resto do sistema:
// `producao.atividade.data_inicio` e `data_fim` sao TIMESTAMP WITH TIME ZONE, e
// o instante em UTC e o valor certo. `.raw()` aqui entregaria a string crua e o
// `DateStyle` do banco decidiria o que ela significa.
models.iniciaAtividadeModoLocal = Joi.object().keys({
  atividade_id: inteiro().required()
})

models.finalizaAtividadeModoLocal = Joi.object().keys({
  atividade_id: inteiro().required(),
  usuario_uuid: usuarioUuid().required(),
  data_inicio: Joi.date().iso().required(),
  data_fim: Joi.date().iso().min(Joi.ref('data_inicio')).required().messages({
    'date.min': 'A data de fim deve ser igual ou posterior à data de início'
  })
})

// --- Fila prioritaria --------------------------------------------------------

models.filaPrioritaria = Joi.object().keys({
  atividade_ids: listaDeIds(),
  usuario_uuid: usuarioUuid().required(),
  prioridade: inteiro().required()
})

models.filaPrioritariaAtualizacao = Joi.object().keys({
  fila_prioritaria: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        atividade_id: inteiro().required(),
        usuario_uuid: usuarioUuid().required(),
        prioridade: inteiro().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.filaPrioritariaIds = Joi.object().keys({
  fila_prioritaria_ids: listaDeIds()
})

models.filaPrioritariaGrupo = Joi.object().keys({
  atividade_ids: listaDeIds(),
  habilitacao_id: inteiro().required(),
  prioridade: inteiro().required()
})

models.filaPrioritariaGrupoAtualizacao = Joi.object().keys({
  fila_prioritaria_grupo: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        atividade_id: inteiro().required(),
        habilitacao_id: inteiro().required(),
        prioridade: inteiro().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.filaPrioritariaGrupoIds = Joi.object().keys({
  fila_prioritaria_grupo_ids: listaDeIds()
})

// --- Problema e alteracao de fluxo -------------------------------------------
//
// SO O `resolvido` MUDA no problema, e e o SAP que manda: a descricao, o tipo, o
// autor e o poligono sao o que o OPERADOR apontou durante a execucao, e a
// gerencia responde se o caso foi tratado. Reescrever o apontamento pela tela de
// gerencia apagaria a versao de quem viu o problema.

models.problemaAtividadeAtualizacao = Joi.object().keys({
  problema_atividade: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        resolvido: Joi.boolean().strict().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

// A ALTERACAO DE FLUXO MUDA INTEIRA, e a diferenca para o problema acima e o
// autor: ela e a DECISAO de quem gerencia, escrita a mao, e por isso a mesma
// tela que a le e a que a corrige.
models.alteracaoFluxoAtualizacao = Joi.object().keys({
  alteracao_fluxo: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        atividade_id: inteiro().required(),
        descricao: Joi.string().required(),
        data: Joi.date().iso().required(),
        resolvido: Joi.boolean().strict().required(),
        geom: geomEwkt().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

// --- Relatorio de alteracao --------------------------------------------------

models.relatorioAlteracao = Joi.object().keys({
  relatorio_alteracao: Joi.array()
    .items(
      Joi.object().keys({
        data: Joi.date().iso().required(),
        descricao: Joi.string().required()
      })
    )
    .required()
    .min(1)
})

models.relatorioAlteracaoAtualizacao = Joi.object().keys({
  relatorio_alteracao: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        data: Joi.date().iso().required(),
        descricao: Joi.string().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.relatorioAlteracaoIds = Joi.object().keys({
  relatorio_alteracao_ids: listaDeIds()
})

// --- QGIS: versao minima, plugins, atalhos e caminho -------------------------
//
// A EXPRESSAO REGULAR E A DO CHECK, letra por letra
// (`qgis.plugin` e `qgis.versao_qgis` em `er/qgis.sql`). Ela existe porque o
// cliente compara a versao por PARTE NUMERICA: um '3.22-beta' digitado a mao
// faria a comparacao decidir errado sem erro nenhum. Aqui ela vira 400 com
// frase; sem ela, o CHECK responderia 500.
const VERSAO = /^\d+(\.\d+){0,2}$/

const versaoMinima = () =>
  Joi.string()
    .pattern(VERSAO)
    .messages({
      'string.pattern.base':
        'A versão mínima precisa ser numérica, no formato 3, 3.22 ou 3.22.2'
    })

models.versaoQGIS = Joi.object().keys({
  versao_minima: versaoMinima().required()
})

models.plugins = Joi.object().keys({
  plugins: Joi.array()
    .items(
      Joi.object().keys({
        nome: Joi.string().max(255).required(),
        versao_minima: versaoMinima().required()
      })
    )
    .required()
    .min(1)
})

models.pluginsAtualizacao = Joi.object().keys({
  plugins: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        nome: Joi.string().max(255).required(),
        versao_minima: versaoMinima().required()
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.pluginsIds = Joi.object().keys({
  plugins_ids: listaDeIds()
})

// `atalho` ACEITA VAZIO, e nao e descuido: a linha com atalho vazio e a que
// DESLIGA a tecla de uma ferramenta, e o `er/qgis.sql` nasce com onze delas
// assim. Recusar o vazio obrigaria a apagar a linha para desligar a tecla, e a
// linha e o que diz que a ferramenta esta na lista.
models.atalhos = Joi.object().keys({
  atalhos: Joi.array()
    .items(
      Joi.object().keys({
        ferramenta: Joi.string().max(255).required(),
        idioma: Joi.string().max(255).required(),
        atalho: Joi.string().max(255).allow('', null)
      })
    )
    .required()
    .min(1)
})

models.atalhosAtualizacao = Joi.object().keys({
  atalhos: Joi.array()
    .items(
      Joi.object().keys({
        id: inteiro().required(),
        ferramenta: Joi.string().max(255).required(),
        idioma: Joi.string().max(255).required(),
        atalho: Joi.string().max(255).allow('', null)
      })
    )
    .unique('id')
    .required()
    .min(1)
})

models.atalhosIds = Joi.object().keys({
  atalhos_ids: listaDeIds()
})

// O CAMINHO DE ONDE O CLIENTE BAIXA O PLUGIN. Aceita vazio, que e como a coluna
// nasce: o valor e uma pasta de rede DA INSTALACAO, e este repositorio e
// publico. Quem instala preenche por esta rota, e nada disso entra em arquivo
// versionado.
models.pluginPath = Joi.object().keys({
  plugin_path: Joi.string().allow('').required()
})

// --- Views de acompanhamento -------------------------------------------------
//
// OS TRES FILTROS SAO OPCIONAIS. `em_andamento_*` chega como texto porque e
// query string, e o SAP ja o lia assim; `bloco` e numero porque e id.
models.viewAcompanhamentoQuery = Joi.object().keys({
  em_andamento_projeto: Joi.string().valid('true', 'false'),
  em_andamento_lote: Joi.string().valid('true', 'false'),
  bloco: Joi.number().integer().positive()
})

// --- Permissao no banco de PRODUCAO ------------------------------------------
//
// O ALVO E O `dado_producao_id`, E NAO SERVIDOR, PORTA E BANCO.
//
// A ORIGEM RECEBIA O ENDERECO NO CORPO (`{ servidor, porta, banco }`), e aqui
// isso nao pode: `res.sendJsonAndLog` grava `req.body` no log de TODA chamada, e
// so mascara a chave `senha`. O endereco de um banco de edicao no log e a
// topologia da rede da DGEO em texto claro, num arquivo que sai da maquina em
// backup e em chamado de suporte.
//
// E ELE JA E A FONTE DA VERDADE. `producao.dado_producao.configuracao_producao` e
// de onde o endereco sai em todo o resto do sistema; recebe-lo do cliente
// abriria um segundo caminho, e o segundo caminho aceitaria QUALQUER
// PostgreSQL alcancavel pela maquina do servidor -- uma rota autenticada que
// revoga permissao em banco que este sistema nem conhece.
//
// O DADO TEM DE SER PostGIS COM CONTROLE DE PERMISSAO (code 2), e quem cobra e o
// controller, no `WHERE` da consulta: nos outros dois tipos nao ha papel efemero
// nenhum, e responder "revogado" ali seria mentir.
models.bancoDeProducao = Joi.object().keys({
  dado_producao_id: inteiro().positive().required()
})

models.bancoDeProducaoUsuario = Joi.object().keys({
  dado_producao_id: inteiro().positive().required(),
  usuario_uuid: usuarioUuid().required()
})

module.exports = models
