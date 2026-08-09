'use strict'

// OS CONTRATOS DE ENTRADA DA GERENCIA DA PRODUCAO.
//
// TODO CASO DE RECUSA PROVA O MOTIVO, e nao so que houve recusa: `recusaPor`
// prende o CAMPO e a REGRA do Joi. Sem isso, um caso sobre a troca de
// `usuario_id` por `usuario_uuid` continuaria verde depois de a regra sumir,
// desde que a fixtura falhasse por qualquer outro motivo.

const { recusaPor, aceita } = require('../../helpers/joi')

const schema = require('../../../gerencia_producao/gerencia_producao_schema')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const OUTRO_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9'

describe('a pessoa e UUID, e nunca o inteiro do SAP', () => {
  // A TRADUCAO QUE MAIS DOI SE PASSAR BATIDO. No SAP `perfil_producao_operador`
  // guardava `usuario_id INTEGER`; aqui `producao.habilitacao_usuario` guarda
  // `usuario_uuid UUID`. Um Joi que aceitasse numero deixaria a recusa para a
  // chave estrangeira, que responde 500 e nao diz qual campo estava errado.
  it('recusa o usuario_id inteiro na habilitacao', () => {
    const r = schema.habilitacaoUsuario.validate({
      habilitacao_usuario: [{ usuario_uuid: 42, habilitacao_id: 1 }]
    })
    recusaPor(r, 'habilitacao_usuario.0.usuario_uuid', 'string.base')
  })

  it('recusa texto que nao e UUID', () => {
    const r = schema.habilitacaoUsuario.validate({
      habilitacao_usuario: [{ usuario_uuid: 'fulano', habilitacao_id: 1 }]
    })
    recusaPor(r, 'habilitacao_usuario.0.usuario_uuid', 'string.guid')
  })

  it('aceita o UUID', () => {
    aceita(
      schema.habilitacaoUsuario.validate({
        habilitacao_usuario: [{ usuario_uuid: UUID, habilitacao_id: 1 }]
      })
    )
  })

  // UMA HABILITACAO POR PESSOA, e o UNIQUE do banco so ve uma linha por vez: a
  // lista que repete a mesma pessoa quebraria no meio do INSERT em massa.
  it('recusa a mesma pessoa duas vezes na mesma lista', () => {
    const r = schema.habilitacaoUsuario.validate({
      habilitacao_usuario: [
        { usuario_uuid: UUID, habilitacao_id: 1 },
        { usuario_uuid: UUID, habilitacao_id: 2 }
      ]
    })
    recusaPor(r, 'habilitacao_usuario.1', 'array.unique')
  })

  // O BLOCO NAO TEM UNIQUE, e a ausencia acompanha o DDL: trabalhar em dois
  // blocos e o caso comum, e recusar a segunda linha impediria o normal.
  it('aceita a mesma pessoa em dois blocos', () => {
    aceita(
      schema.habilitacaoBloco.validate({
        habilitacao_bloco: [
          { usuario_uuid: UUID, bloco_id: 1 },
          { usuario_uuid: UUID, bloco_id: 2 }
        ]
      })
    )
  })
})

describe('a fila prioritaria fala de habilitacao, e nao de perfil de producao', () => {
  it('a fila de grupo aceita habilitacao_id', () => {
    aceita(
      schema.filaPrioritariaGrupo.validate({
        atividade_ids: [1, 2],
        habilitacao_id: 3,
        prioridade: 1
      })
    )
  })

  // O NOME DO SAP NAO ATRAVESSA. O validador ESTRITO deste modulo recusa a chave
  // desconhecida com 400 e sugere o nome declarado mais parecido; aqui, no Joi
  // cru, ela aparece como chave nao permitida. Sem isto, um cliente que ainda
  // mandasse `perfil_producao_id` teria o campo descartado em silencio e a
  // entrada seria gravada sem a habilitacao.
  it('recusa o perfil_producao_id do SAP', () => {
    const r = schema.filaPrioritariaGrupo.validate({
      atividade_ids: [1],
      perfil_producao_id: 3,
      prioridade: 1
    })
    recusaPor(r, 'habilitacao_id', 'any.required')
  })

  it('a fila de uma pessoa cobra o UUID do beneficiario', () => {
    const r = schema.filaPrioritaria.validate({
      atividade_ids: [1],
      usuario_uuid: 7,
      prioridade: 1
    })
    recusaPor(r, 'usuario_uuid', 'string.base')
  })

  it('recusa a lista de atividades vazia', () => {
    const r = schema.filaPrioritaria.validate({
      atividade_ids: [],
      usuario_uuid: UUID,
      prioridade: 1
    })
    recusaPor(r, 'atividade_ids', 'array.min')
  })
})

describe('o numero e ESTRITO, porque a escrita tambem vem de carga e de CLI', () => {
  // Sem `.strict()` o Joi converteria '12' em 12 em silencio, e o contrato
  // deixaria de ser contrato. E a mesma escolha do `meta_id` do PIT.
  it('recusa o id que veio como texto', () => {
    const r = schema.habilitacaoEtapa.validate({
      habilitacao_etapa: [
        { habilitacao_id: '1', subfase_id: 2, tipo_etapa_id: 1, prioridade: 1 }
      ]
    })
    recusaPor(r, 'habilitacao_etapa.0.habilitacao_id', 'number.base')
  })

  it('recusa o booleano que veio como texto', () => {
    const r = schema.atividadeVoltar.validate({
      atividade_ids: [1],
      manter_usuarios: 'true'
    })
    recusaPor(r, 'manter_usuarios', 'boolean.base')
  })
})

describe('as duas observacoes sao obrigatorias, e as duas aceitam vazio', () => {
  // A ROTA GRAVA AS DUAS DE UMA VEZ: omitir uma apagaria o texto da outra sem
  // que quem chamou tivesse dito isso. Mandar '' e apagar de proposito.
  it('recusa o corpo que traz so a observacao da atividade', () => {
    const r = schema.observacao.validate({
      atividade_ids: [1],
      observacao_atividade: 'texto'
    })
    recusaPor(r, 'observacao_unidade_trabalho', 'any.required')
  })

  it('aceita as duas vazias', () => {
    aceita(
      schema.observacao.validate({
        atividade_ids: [1],
        observacao_atividade: '',
        observacao_unidade_trabalho: ''
      })
    )
  })
})

describe('as propriedades da unidade de trabalho sao opcionais uma a uma', () => {
  // A TELA REPRIORIZA DEZENAS DE UNIDADES DE UMA VEZ, e nao tem por que reenviar
  // a dificuldade que ninguem tocou. Quem pula o campo nao o zera: o controlador
  // usa COALESCE.
  it('aceita a linha que so muda a prioridade', () => {
    aceita(
      schema.propriedadesAtualizacao.validate({
        unidades_trabalho: [{ id: 1, prioridade: 5 }]
      })
    )
  })

  it('recusa a dificuldade negativa, que o CHECK do banco tambem recusa', () => {
    const r = schema.propriedadesAtualizacao.validate({
      unidades_trabalho: [{ id: 1, dificuldade: -1 }]
    })
    recusaPor(r, 'unidades_trabalho.0.dificuldade', 'number.min')
  })

  it('recusa o id repetido, que faria dois UPDATEs na mesma linha', () => {
    const r = schema.propriedadesAtualizacao.validate({
      unidades_trabalho: [{ id: 1, prioridade: 1 }, { id: 1, prioridade: 2 }]
    })
    recusaPor(r, 'unidades_trabalho.1', 'array.unique')
  })
})

describe('a versao minima do QGIS obedece ao CHECK do DDL', () => {
  // A EXPRESSAO E A DO CHECK, letra por letra. O cliente compara a versao por
  // PARTE NUMERICA: um '3.22-beta' escrito a mao faria a comparacao decidir
  // errado sem erro nenhum. Aqui vira 400 com frase; sem isto, o CHECK
  // responderia 500.
  it.each(['3', '3.22', '3.22.2'])('aceita %s', versao => {
    aceita(schema.versaoQGIS.validate({ versao_minima: versao }))
  })

  it.each(['3.22-beta', 'v3.22', '3.22.2.1', ''])('recusa %s', versao => {
    const r = schema.versaoQGIS.validate({ versao_minima: versao })
    // O vazio cai em `string.empty` e o resto no padrao: os dois sao recusa no
    // MESMO campo, que e o que este caso prende.
    expect(r.error).toBeDefined()
    expect(r.error.details[0].path.join('.')).toBe('versao_minima')
  })

  it('a mensagem do padrao sai em portugues', () => {
    const r = schema.versaoQGIS.validate({ versao_minima: '3.22-beta' })
    recusaPor(r, 'versao_minima', 'string.pattern.base')
    expect(r.error.message).toContain('numérica')
  })

  it('o plugin cobra a mesma regra', () => {
    const r = schema.plugins.validate({
      plugins: [{ nome: 'sap', versao_minima: '3.22-beta' }]
    })
    recusaPor(r, 'plugins.0.versao_minima', 'string.pattern.base')
  })
})

describe('o atalho vazio DESLIGA a tecla, e nao e erro', () => {
  // O `er/qgis.sql` nasce com onze linhas assim. Recusar o vazio obrigaria a
  // apagar a linha para desligar a tecla, e a linha e o que diz que a ferramenta
  // esta na lista.
  it('aceita o atalho vazio', () => {
    aceita(
      schema.atalhos.validate({
        atalhos: [{ ferramenta: 'Sair do QGIS', idioma: 'português', atalho: '' }]
      })
    )
  })

  it('aceita o atalho ausente', () => {
    aceita(
      schema.atalhos.validate({
        atalhos: [{ ferramenta: 'Salvar', idioma: 'português' }]
      })
    )
  })

  it('cobra a ferramenta', () => {
    const r = schema.atalhos.validate({
      atalhos: [{ idioma: 'português', atalho: 'M' }]
    })
    recusaPor(r, 'atalhos.0.ferramenta', 'any.required')
  })
})

describe('o caminho do plugin aceita vazio, porque a coluna nasce vazia', () => {
  // O valor e uma pasta de rede DA INSTALACAO, e este repositorio e publico:
  // quem instala preenche por esta rota. Recusar o vazio impediria de limpar um
  // caminho que mudou.
  it('aceita vazio', () => {
    aceita(schema.pluginPath.validate({ plugin_path: '' }))
  })

  it('cobra o campo', () => {
    const r = schema.pluginPath.validate({})
    recusaPor(r, 'plugin_path', 'any.required')
  })
})

describe('o modo local recebe as datas do TRABALHO, e nao as do lancamento', () => {
  it('aceita o par completo', () => {
    aceita(
      schema.finalizaAtividadeModoLocal.validate({
        atividade_id: 1,
        usuario_uuid: UUID,
        data_inicio: '2026-08-09T08:00:00-03:00',
        data_fim: '2026-08-09T17:00:00-03:00'
      })
    )
  })

  // O FIM NAO PODE SER ANTES DO INICIO, e a mensagem sai em portugues: a do Joi
  // diria 'must be greater than or equal to "ref:data_inicio"', que e o que a
  // tela mostraria para quem lanca.
  it('recusa o fim anterior ao inicio', () => {
    const r = schema.finalizaAtividadeModoLocal.validate({
      atividade_id: 1,
      usuario_uuid: UUID,
      data_inicio: '2026-08-09T17:00:00-03:00',
      data_fim: '2026-08-09T08:00:00-03:00'
    })
    recusaPor(r, 'data_fim', 'date.min')
    expect(r.error.message).toContain('posterior')
  })

  // `.iso()` PORQUE SEM ELE o Joi cai no parser tolerante do JavaScript, que le
  // o primeiro numero como MES: '01/08/2026' viraria 8 de janeiro.
  it('recusa a data em formato nao ISO', () => {
    const r = schema.finalizaAtividadeModoLocal.validate({
      atividade_id: 1,
      usuario_uuid: UUID,
      data_inicio: '01/08/2026',
      data_fim: '2026-08-09T17:00:00-03:00'
    })
    recusaPor(r, 'data_inicio', 'date.format')
  })

  // O INICIO NAO RECEBE PESSOA, e e deliberado: quem inicia em modo local e o
  // proprio gerente, e o uuid dele sai do token. Um campo aqui aceitaria dizer
  // que outra pessoa comecou um trabalho que ela nao comecou.
  it('o inicio nao aceita usuario_uuid', () => {
    const r = schema.iniciaAtividadeModoLocal.validate({
      atividade_id: 1,
      usuario_uuid: UUID
    })
    recusaPor(r, 'usuario_uuid', 'object.unknown')
  })
})

describe('a alteracao de fluxo muda inteira, e o problema so no resolvido', () => {
  it('o problema aceita id mais resolvido', () => {
    aceita(
      schema.problemaAtividadeAtualizacao.validate({
        problema_atividade: [{ id: 1, resolvido: true }]
      })
    )
  })

  // A DESCRICAO, O TIPO, O AUTOR E O POLIGONO sao o que o OPERADOR apontou
  // durante a execucao. Reescreve-los pela tela de gerencia apagaria a versao de
  // quem viu o problema.
  it('o problema recusa a troca da descricao', () => {
    const r = schema.problemaAtividadeAtualizacao.validate({
      problema_atividade: [{ id: 1, resolvido: true, descricao: 'outra coisa' }]
    })
    recusaPor(r, 'problema_atividade.0.descricao', 'object.unknown')
  })

  it('a alteracao de fluxo cobra a geometria', () => {
    const r = schema.alteracaoFluxoAtualizacao.validate({
      alteracao_fluxo: [
        {
          id: 1,
          atividade_id: 2,
          descricao: 'refazer a restituição da folha',
          data: '2026-08-09T10:00:00-03:00',
          resolvido: false
        }
      ]
    })
    recusaPor(r, 'alteracao_fluxo.0.geom', 'any.required')
  })

  it('a alteracao de fluxo aceita o EWKT que o banco le', () => {
    aceita(
      schema.alteracaoFluxoAtualizacao.validate({
        alteracao_fluxo: [
          {
            id: 1,
            atividade_id: 2,
            descricao: 'refazer a restituição da folha',
            data: '2026-08-09T10:00:00-03:00',
            resolvido: false,
            geom: 'SRID=4674;POLYGON((-45 -22,-45 -21,-44 -21,-44 -22,-45 -22))'
          }
        ]
      })
    )
  })
})

describe('o id de rota e positivo', () => {
  it('aceita 1', () => {
    aceita(schema.idParams.validate({ id: 1 }))
  })

  // SERIAL COMECA EM 1: `/0` e `/-3` sao erro de quem chamou, e nao um 404
  // depois de ir ao banco.
  it.each([0, -3])('recusa %s', id => {
    recusaPor(schema.idParams.validate({ id }), 'id', 'number.positive')
  })
})

describe('a lista de ids nunca chega vazia', () => {
  // Uma operacao em massa sobre lista vazia responderia "sucesso" sem ter feito
  // nada, e quem chamou nao teria como saber.
  const listas = [
    ['habilitacaoIds', 'habilitacao_ids'],
    ['habilitacaoEtapaIds', 'habilitacao_etapa_ids'],
    ['habilitacaoUsuarioIds', 'habilitacao_usuario_ids'],
    ['habilitacaoBlocoIds', 'habilitacao_bloco_ids'],
    ['filaPrioritariaIds', 'fila_prioritaria_ids'],
    ['filaPrioritariaGrupoIds', 'fila_prioritaria_grupo_ids'],
    ['relatorioAlteracaoIds', 'relatorio_alteracao_ids'],
    ['pluginsIds', 'plugins_ids'],
    ['atalhosIds', 'atalhos_ids']
  ]

  it.each(listas)('%s recusa a lista vazia', (nome, chave) => {
    const r = schema[nome].validate({ [chave]: [] })
    recusaPor(r, chave, 'array.min')
  })

  it.each(listas)('%s recusa o id repetido', (nome, chave) => {
    const r = schema[nome].validate({ [chave]: [1, 1] })
    recusaPor(r, [chave, 1], 'array.unique')
  })
})

describe('o filtro das views de acompanhamento', () => {
  it('aceita os tres filtros', () => {
    aceita(
      schema.viewAcompanhamentoQuery.validate({
        em_andamento_projeto: 'true',
        em_andamento_lote: 'false',
        bloco: 3
      })
    )
  })

  it('aceita a consulta sem filtro nenhum', () => {
    aceita(schema.viewAcompanhamentoQuery.validate({}))
  })

  it('recusa o em_andamento que nao e true nem false', () => {
    const r = schema.viewAcompanhamentoQuery.validate({
      em_andamento_projeto: 'sim'
    })
    recusaPor(r, 'em_andamento_projeto', 'any.only')
  })
})

// A ROTA DE PERMISSAO NAO RECEBE ENDERECO, e este bloco e o que cobra isso.
//
// A ORIGEM RECEBIA `{ servidor, porta, banco }` no corpo. Aqui o alvo e o
// `dado_producao_id`, e o endereco sai do cadastro. A razao esta no schema:
// `sendJsonAndLog` grava `req.body` no log de TODA chamada e so mascara a chave
// `senha`, entao um endereco no corpo seria a topologia da rede em texto claro
// num arquivo que sai da maquina. O validador deste modulo e o ESTRITO, entao
// uma chave a mais nao e descartada em silencio: ela vira 400.
describe('o alvo da revogacao e o dado de producao, e nunca o endereco', () => {
  it('aceita o dado de producao sozinho', () => {
    aceita(schema.bancoDeProducao.validate({ dado_producao_id: 9 }))
  })

  it('recusa o corpo da origem, com servidor, porta e banco', () => {
    const r = schema.bancoDeProducao.validate({
      servidor: 'servidor_de_teste', porta: 5432, banco: 'banco_de_teste'
    })
    recusaPor(r, 'dado_producao_id', 'any.required')
  })

  // `.strict()` porque a escrita tambem vem de CLI, e um id viaja como string
  // no JSON: sem o estrito o Joi converteria '9' em 9 em silencio.
  it('recusa o id como texto', () => {
    recusaPor(
      schema.bancoDeProducao.validate({ dado_producao_id: '9' }),
      'dado_producao_id',
      'number.base'
    )
  })

  // SERIAL comeca em 1: `0` e `-3` sao erro de quem chamou, e nao um 404 depois
  // de ir ao banco.
  it('recusa id que nao e positivo', () => {
    recusaPor(
      schema.bancoDeProducao.validate({ dado_producao_id: 0 }),
      'dado_producao_id',
      'number.positive'
    )
  })

  it('a revogacao de uma pessoa pede as duas chaves', () => {
    aceita(schema.bancoDeProducaoUsuario.validate({
      dado_producao_id: 9, usuario_uuid: UUID
    }))
    recusaPor(
      schema.bancoDeProducaoUsuario.validate({ dado_producao_id: 9 }),
      'usuario_uuid',
      'any.required'
    )
  })

  // O `.guid()` e o que faz a recusa chegar como 400: sem ele o texto qualquer
  // atravessa o Joi e morre no `22P02` do Postgres, que vira 500 e nao diz qual
  // campo estava errado.
  it('recusa a pessoa que nao e UUID', () => {
    recusaPor(
      schema.bancoDeProducaoUsuario.validate({
        dado_producao_id: 9, usuario_uuid: 'fulano'
      }),
      'usuario_uuid',
      'string.guid'
    )
  })
})
