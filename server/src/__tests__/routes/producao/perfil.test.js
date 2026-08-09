'use strict'

// OS PERFIS DE CONFIGURAÇÃO DA SUBFASE NO LOTE: o contrato do corpo, a guarda de
// toda rota e os 49 caminhos.
//
// RODA NO PACOTE `rapido`, e de propósito: nada aqui abre conexão. O
// `jest.config.js` decide o pacote LENDO O FONTE do teste à procura dos dois
// auxiliares que abrem PostgreSQL, e este arquivo não usa nenhum deles.
//
// ELE MONTA O ROUTER DE VERDADE, e não varre o fonte à procura de
// `verifyPerfil`. As 48 rotas dos doze grupos saem de uma FÁBRICA
// (`crudDePerfil`), então no fonte há quatro chamadas de `router.*` para 48
// caminhos: uma varredura de texto contaria quatro e não teria como dizer que o
// grupo 9 existe. Montado, o `router.stack` tem as 49 camadas de verdade, com o
// método e o caminho que o Express vai casar.
//
// E A GUARDA É PROVADA ROTA A ROTA, trocando `login` por um dublê que ETIQUETA o
// middleware com o nível e o módulo que recebeu. Sem isso, `router.stack` só
// mostra funções anônimas, e não haveria como distinguir a rota guardada da rota
// que alguém esqueceu de guardar. O módulo de verdade entra num caso próprio,
// abaixo: é ele que prova que 'producao' é nome conhecido.

const fs = require('fs')
const path = require('path')

const { recusaPor, aceita } = require('../../helpers/joi')

const perfilSchema = require('../../../producao/perfil_schema')

// O DUBLÊ DE `verifyPerfil` NÃO AUTORIZA NADA: ele só carimba no middleware o
// par (nível, módulo) com que foi chamado, para o caso da guarda poder lê-lo do
// `router.stack`. Quem barra escrita de verdade continua sendo o `verifyPerfil`
// do servidor, que lê o banco a cada requisição.
jest.mock('../../../login', () => ({
  verifyPerfil: (nivel, modulo) => {
    const guarda = (req, res, next) => next()
    guarda.perfilExigido = { nivel, modulo }
    return guarda
  }
}))

const perfilRoute = require('../../../producao/perfil_route')

// ---------------------------------------------------------------------------
// 1. O CONTRATO DO CORPO
// ---------------------------------------------------------------------------

const menuValido = () => ({
  menu_id: 3,
  menu_revisao: false,
  subfase_id: 7,
  lote_id: 12
})

describe('perfil_schema: a forma comum dos doze grupos', () => {
  it('aceita um POST bem formado', () => {
    const resultado = perfilSchema.grupos.menu.criar.validate({
      perfis_menu: [menuValido()]
    })
    expect(aceita(resultado).perfis_menu).toHaveLength(1)
  })

  it('exige lote_id: toda tabela deste bloco aponta o lote', () => {
    const { lote_id: _ignorado, ...semLote } = menuValido()
    const resultado = perfilSchema.grupos.menu.criar.validate({
      perfis_menu: [semLote]
    })
    recusaPor(resultado, 'perfis_menu.0.lote_id', 'any.required')
  })

  it('exige subfase_id', () => {
    const { subfase_id: _ignorado, ...semSubfase } = menuValido()
    const resultado = perfilSchema.grupos.menu.criar.validate({
      perfis_menu: [semSubfase]
    })
    recusaPor(resultado, 'perfis_menu.0.subfase_id', 'any.required')
  })

  // `.strict()` em todo número, como no SAP: sem ele o Joi converte '12' em 12 e
  // um corpo com aspas sobrando grava sem ninguém perceber.
  it('recusa o id que vem como texto, em vez de convertê-lo', () => {
    const resultado = perfilSchema.grupos.menu.criar.validate({
      perfis_menu: [{ ...menuValido(), lote_id: '12' }]
    })
    recusaPor(resultado, 'perfis_menu.0.lote_id', 'number.base')
  })

  it('recusa o array vazio: gravação em massa de nada é engano de quem chamou', () => {
    const resultado = perfilSchema.grupos.menu.criar.validate({ perfis_menu: [] })
    recusaPor(resultado, 'perfis_menu', 'array.min')
  })

  // O validador da rota é o ESTRITO: chave desconhecida vira 400 em vez de ser
  // descartada em silêncio. Aqui se prova que o schema a marca.
  it('recusa a chave desconhecida dentro da linha', () => {
    const resultado = perfilSchema.grupos.menu.criar.validate({
      perfis_menu: [{ ...menuValido(), lote_linha_id: 4 }]
    })
    recusaPor(resultado, 'perfis_menu.0.lote_linha_id', 'object.unknown')
  })

  it('o PUT exige o id de cada linha', () => {
    const resultado = perfilSchema.grupos.menu.atualizar.validate({
      perfis_menu: [menuValido()]
    })
    recusaPor(resultado, 'perfis_menu.0.id', 'any.required')
  })

  // O SAP tem este `.unique('id')` em quatro dos doze grupos. Dois objetos com o
  // mesmo id no mesmo corpo são dois UPDATEs na mesma linha, e o segundo apaga o
  // primeiro em silêncio.
  it('o PUT recusa o mesmo id duas vezes no mesmo corpo', () => {
    const resultado = perfilSchema.grupos.menu.atualizar.validate({
      perfis_menu: [
        { id: 5, ...menuValido() },
        { id: 5, ...menuValido(), menu_id: 9 }
      ]
    })
    recusaPor(resultado, 'perfis_menu.1', 'array.unique')
  })

  it('o DELETE exige a lista de ids no corpo', () => {
    const resultado = perfilSchema.grupos.menu.ids.validate({})
    recusaPor(resultado, 'perfil_menu_ids', 'any.required')
  })

  it('o DELETE recusa id repetido', () => {
    const resultado = perfilSchema.grupos.menu.ids.validate({
      perfil_menu_ids: [3, 3]
    })
    recusaPor(resultado, 'perfil_menu_ids.1', 'array.unique')
  })
})

describe('perfil_schema: perfil FME', () => {
  const fme = extra => ({
    gerenciador_fme_id: 1,
    rotina: 'validaCamadas',
    requisito_finalizacao: true,
    tipo_rotina_id: 1,
    ordem: 1,
    subfase_id: 7,
    lote_id: 12,
    ...extra
  })

  // A COLUNA É `VARCHAR(255)` nos dois bancos, e o Joi do SAP declara
  // `Joi.number().integer()` sobre ela: o schema de lá está errado em relação ao
  // DDL de lá. Aceitar os dois preserva o que o SAP Gerente manda hoje sem
  // mentir sobre a coluna -- o controlador grava texto nos dois casos.
  it('aceita a rotina como texto', () => {
    aceita(perfilSchema.grupos.fme.criar.validate({ perfis_fme: [fme()] }))
  })

  it('aceita a rotina como número, que é o que o SAP Gerente manda', () => {
    aceita(
      perfilSchema.grupos.fme.criar.validate({ perfis_fme: [fme({ rotina: 42 })] })
    )
  })

  it('recusa a rotina que não é nem texto nem número', () => {
    const resultado = perfilSchema.grupos.fme.criar.validate({
      perfis_fme: [fme({ rotina: { nome: 'x' } })]
    })
    recusaPor(resultado, 'perfis_fme.0.rotina', 'alternatives.types')
  })

  it('recusa a rotina ausente', () => {
    const { rotina: _ignorada, ...semRotina } = fme()
    const resultado = perfilSchema.grupos.fme.criar.validate({
      perfis_fme: [semRotina]
    })
    recusaPor(resultado, 'perfis_fme.0.rotina', 'any.required')
  })

  it('recusa requisito_finalizacao como texto', () => {
    const resultado = perfilSchema.grupos.fme.criar.validate({
      perfis_fme: [fme({ requisito_finalizacao: 'true' })]
    })
    recusaPor(resultado, 'perfis_fme.0.requisito_finalizacao', 'boolean.base')
  })
})

describe('perfil_schema: parâmetros anuláveis', () => {
  const modelo = parametros => ({
    perfis_modelo: [
      {
        qgis_model_id: 2,
        parametros,
        requisito_finalizacao: true,
        tipo_rotina_id: 3,
        ordem: 1,
        subfase_id: 7,
        lote_id: 12
      }
    ]
  })

  // `parametros` é TEXT anulável no DDL. No SAP a CRIAÇÃO aceitava null e a
  // ATUALIZAÇÃO não, sobre a mesma coluna: aqui os dois aceitam.
  it('o modelo aceita parametros nulo na criação', () => {
    aceita(perfilSchema.grupos.modelo.criar.validate(modelo(null)))
  })

  it('o modelo aceita parametros nulo na atualização', () => {
    const corpo = modelo(null)
    corpo.perfis_modelo[0].id = 1
    aceita(perfilSchema.grupos.modelo.atualizar.validate(corpo))
  })

  it('a configuração do QGIS aceita parametros vazio', () => {
    aceita(
      perfilSchema.grupos.configuracaoQgis.criar.validate({
        perfis_configuracao_qgis: [
          { tipo_configuracao_id: 1, parametros: '', subfase_id: 7, lote_id: 12 }
        ]
      })
    )
  })
})

describe('perfil_schema: a habilitação por dificuldade', () => {
  const linha = extra => ({
    usuario_uuid: '3f1c6a7e-5b2d-4c8a-9e0f-1a2b3c4d5e6f',
    tipo_perfil_dificuldade_id: 3,
    subfase_id: 7,
    lote_id: 12,
    ...extra
  })

  it('aceita a pessoa por uuid', () => {
    aceita(
      perfilSchema.grupos.dificuldadeOperador.criar.validate({
        perfis_dificuldade_operador: [linha()]
      })
    )
  })

  it('recusa o uuid mal formado', () => {
    const resultado = perfilSchema.grupos.dificuldadeOperador.criar.validate({
      perfis_dificuldade_operador: [linha({ usuario_uuid: '17' })]
    })
    recusaPor(
      resultado,
      'perfis_dificuldade_operador.0.usuario_uuid',
      'string.guid'
    )
  })

  // NO SCA TODA COLUNA DE PESSOA É `usuario_uuid` apontando `dgeo.usuario
  // (uuid)`. O `usuario_id` INTEGER do SAP não existe nesta tabela, e mandá-lo
  // tem de doer: aceitá-lo em silêncio gravaria a linha sem dono.
  //
  // O `usuario_uuid` VAI JUNTO no caso, e é preciso: o Joi para no PRIMEIRO
  // erro, e sem ele a recusa seria pela falta do uuid em vez de pela sobra do
  // `usuario_id`, que é a regra que este caso guarda.
  it('recusa o usuario_id do SAP como campo desconhecido', () => {
    const resultado = perfilSchema.grupos.dificuldadeOperador.criar.validate({
      perfis_dificuldade_operador: [linha({ usuario_id: 4 })]
    })
    recusaPor(
      resultado,
      'perfis_dificuldade_operador.0.usuario_id',
      'object.unknown'
    )
  })
})

describe('perfil_schema: a cópia de configuração entre lotes', () => {
  const copia = extra => ({
    lote_id_origem: 1,
    lote_id_destino: 2,
    copiar_estilo: true,
    copiar_menu: true,
    copiar_regra: false,
    copiar_modelo: false,
    copiar_workflow: false,
    copiar_alias: false,
    copiar_linhagem: false,
    copiar_finalizacao: false,
    copiar_tema: false,
    copiar_fme: false,
    copiar_configuracao_qgis: false,
    copiar_monitoramento: false,
    ...extra
  })

  it('aceita os doze interruptores', () => {
    aceita(perfilSchema.configuracaoLoteCopiar.validate(copia()))
  })

  // TODOS OBRIGATÓRIOS, e sem default: um default silencioso aqui faria a tela
  // copiar o que ninguém pediu.
  it('exige cada interruptor, sem default', () => {
    const { copiar_tema: _ignorado, ...semTema } = copia()
    recusaPor(
      perfilSchema.configuracaoLoteCopiar.validate(semTema),
      'copiar_tema',
      'any.required'
    )
  })

  // A CHAVE COPIA DESDE 2026-08-09, quando o microcontrole atravessou: ela leva
  // `microcontrole.perfil_monitoramento` pela mesma fábrica dos outros onze. Até
  // ali era aceita e não copiava nada, e recusá-la faria o validador estrito
  // responder 400 a um corpo que o SAP Gerente monta hoje.
  it('aceita copiar_monitoramento, o décimo segundo grupo copiável', () => {
    aceita(
      perfilSchema.configuracaoLoteCopiar.validate(
        copia({ copiar_monitoramento: true })
      )
    )
  })

  it('exige os dois lotes', () => {
    const { lote_id_destino: _ignorado, ...semDestino } = copia()
    recusaPor(
      perfilSchema.configuracaoLoteCopiar.validate(semDestino),
      'lote_id_destino',
      'any.required'
    )
  })
})

// ---------------------------------------------------------------------------
// 2. AS 49 ROTAS, LIDAS DO ROUTER MONTADO
// ---------------------------------------------------------------------------

// Cada camada de `router.stack` que tem `route` é uma rota declarada. O `route`
// traz o caminho que o Express vai casar e o mapa de métodos, e o
// `route.stack` traz a fila de middlewares -- é nele que o dublê de
// `verifyPerfil` deixou a etiqueta.
const rotasMontadas = () =>
  perfilRoute.stack
    .filter(camada => camada.route)
    .flatMap(camada => {
      const guarda = camada.route.stack
        .map(m => m.handle && m.handle.perfilExigido)
        .find(Boolean)

      return Object.keys(camada.route.methods).map(metodo => ({
        metodo: metodo.toUpperCase(),
        caminho: camada.route.path,
        guarda
      }))
    })

// A ORDEM DOS QUATRO MÉTODOS É A DA FÁBRICA, e a dela é a do SAP: GET, DELETE,
// POST, PUT.
const METODOS_DO_GRUPO = ['GET', 'DELETE', 'POST', 'PUT']

// OS DOZE CAMINHOS, na ordem em que o arquivo de rota os declara. Cada um vale
// quatro rotas.
//
// SÃO OS CAMINHOS DO SAP, letra por letra, e nenhum deles é escolha nossa: o SAP
// Gerente os chama assim. As irregularidades são de lá e ficam -- `perfil_modelo`
// para a tabela `perfil_model_qgis`, `perfil_estilos` e `perfil_temas` no plural
// para tabelas no singular, e `perfil_dificuldade_operador` para a tabela
// `habilitacao_dificuldade`.
const CAMINHOS_DOS_GRUPOS = [
  '/configuracao/perfil_fme',
  '/configuracao/perfil_menu',
  '/configuracao/perfil_linhagem',
  '/configuracao/perfil_modelo',
  '/configuracao/perfil_regras',
  '/configuracao/perfil_estilos',
  '/configuracao/perfil_requisito_finalizacao',
  '/configuracao/perfil_alias',
  '/configuracao/perfil_temas',
  '/configuracao/perfil_configuracao_qgis',
  '/configuracao/perfil_workflow_dsgtools',
  '/configuracao/perfil_dificuldade_operador'
]

// A 49ª: a cópia de configuração, declarada à mão porque não é um CRUD.
const ROTAS_AVULSAS = ['POST /configuracao/lote/copiar']

const ROTAS_ESPERADAS = [
  ...CAMINHOS_DOS_GRUPOS.flatMap(caminho =>
    METODOS_DO_GRUPO.map(metodo => `${metodo} ${caminho}`)
  ),
  ...ROTAS_AVULSAS
]

describe('perfil_route: os 49 caminhos declarados', () => {
  const declaradas = () => rotasMontadas().map(r => `${r.metodo} ${r.caminho}`)

  it('são exatamente 49', () => {
    expect(declaradas()).toHaveLength(49)
  })

  it('são os do SAP, na ordem, e nenhuma sumiu', () => {
    expect(declaradas()).toEqual(ROTAS_ESPERADAS)
  })

  it('cada grupo tem os quatro métodos', () => {
    for (const caminho of CAMINHOS_DOS_GRUPOS) {
      for (const metodo of METODOS_DO_GRUPO) {
        expect(declaradas()).toContain(`${metodo} ${caminho}`)
      }
    }
  })
})

describe('perfil_route: toda rota exige gerente no módulo producao', () => {
  // O SEGUNDO ARGUMENTO É O QUE IMPORTA: o default de `verifyPerfil` é
  // 'acervo', e uma rota daqui que o esquecesse passaria a cobrar perfil no
  // ACERVO -- sem erro de sintaxe, sem teste vermelho e sem nada na tela.
  it('nenhuma rota fica sem guarda, e todas cobram o módulo producao', () => {
    const fora = rotasMontadas()
      .filter(r => !r.guarda || r.guarda.modulo !== 'producao')
      .map(r => `${r.metodo} ${r.caminho}`)

    expect(fora).toEqual([])
  })

  // AS 49 ERAM `verifyAdmin` NO SAP 2.3.5, e a régua da casa (2026-08-08) as
  // põe em gerente: mexer aqui muda como o QGIS abre para todo mundo que
  // trabalha naquela subfase daquele lote. Nenhuma abaixo disso, nem o GET: a
  // lista é o formulário de edição.
  it('nenhuma rota aceita menos que gerente, nem as de leitura', () => {
    const abaixo = rotasMontadas()
      .filter(r => !r.guarda || r.guarda.nivel !== 'gerente')
      .map(r => `${r.metodo} ${r.caminho}`)

    expect(abaixo).toEqual([])
  })

  // CONTROLE NEGATIVO do dublê: se `jest.mock` deixasse de valer, a etiqueta
  // sumiria e os dois casos acima passariam a comparar `undefined` com
  // `undefined` num array vazio. Aqui se prova que a etiqueta existe mesmo.
  it('a etiqueta do dublê chega às 49', () => {
    expect(rotasMontadas().filter(r => r.guarda)).toHaveLength(49)
  })

  // E O MÓDULO DE VERDADE, que o dublê acima esconde: 'producao' tem de ser um
  // nome que o `verifyPerfil` conheça. Ele recusa módulo fora do mapa `MODULO`
  // com "Módulo desconhecido", e a recusa acontece no CARREGAMENTO do arquivo de
  // rota -- com o mapa sem `producao`, o servidor não sobe.
  it('o verifyPerfil de verdade reconhece o módulo producao', () => {
    const { verifyPerfil } = jest.requireActual('../../../login')
    expect(() => verifyPerfil('gerente', 'producao')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. AS CHAVES DO CORPO
// ---------------------------------------------------------------------------
//
// ESTE BLOCO LÊ O FONTE, e é o único que lê. O router montado prova o caminho e
// a guarda, mas não prova de que chave do corpo o manipulador tira o array: isso
// só apareceria exercitando as 49 rotas contra o banco, que é a suíte lenta.
// A chave está escrita uma vez por grupo no arquivo de rota, e é lá que ela se
// prende.

const ROTA = path.resolve(__dirname, '..', '..', '..', 'producao', 'perfil_route.js')

// Tira bloco e linha de comentário, para a varredura ver só código. O `\r` cai
// PRIMEIRO: com `core.autocrlf` ligado o fonte chega em CRLF, o `.` do
// JavaScript não casa `\r`, e a limpeza não apagaria nada -- ver a nota gêmea em
// `routes/modulo_em_toda_rota.test.js`.
const semComentario = fonte =>
  fonte
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(linha => linha.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')

const fonteDaRota = () => semComentario(fs.readFileSync(ROTA, 'utf8'))

// SÃO O CONTRATO COM O SAP GERENTE, e a irregularidade delas é de nascença: sete
// grupos usam `perfil_x_ids` e três usam `perfis_x_ids`, o workflow manda o
// array numa chave SINGULAR, e nada disso é escolha nossa. Um "conserto" bem
// intencionado aqui quebra o cliente sem levantar erro nenhum no servidor, e é
// por isso que as chaves ficam presas.
const CHAVES_ESPERADAS = [
  ['perfis_fme', 'perfil_fme_ids'],
  ['perfis_menu', 'perfil_menu_ids'],
  ['perfis_linhagem', 'perfil_linhagem_ids'],
  ['perfis_modelo', 'perfil_modelo_ids'],
  ['perfis_regras', 'perfil_regras_ids'],
  ['perfis_estilos', 'perfil_estilos_ids'],
  ['perfis_requisito', 'perfil_requisito_ids'],
  ['perfis_alias', 'perfis_alias_ids'],
  ['perfis_temas', 'perfil_temas_ids'],
  ['perfis_configuracao_qgis', 'perfis_configuracao_qgis_ids'],
  ['perfil_workflow_dsgtools', 'perfil_workflow_dsgtools_ids'],
  ['perfis_dificuldade_operador', 'perfis_dificuldade_operador_ids']
]

describe('perfil_route: as chaves do corpo são as do SAP', () => {
  it('a rota lê o array e a lista de ids pelas chaves de lá', () => {
    const fonte = fonteDaRota()
    const listas = [...fonte.matchAll(/chaveLista:\s*'([^']+)'/g)].map(a => a[1])
    const ids = [...fonte.matchAll(/chaveIds:\s*'([^']+)'/g)].map(a => a[1])

    expect(listas.map((lista, i) => [lista, ids[i]])).toEqual(CHAVES_ESPERADAS)
  })

  it('o schema declara exatamente essas chaves', () => {
    const grupos = [
      'fme', 'menu', 'linhagem', 'modelo', 'regras', 'estilos',
      'requisitoFinalizacao', 'alias', 'temas', 'configuracaoQgis',
      'workflowDsgtools', 'dificuldadeOperador'
    ]

    const declaradas = grupos.map((nome, i) => {
      const grupo = perfilSchema.grupos[nome]
      const [chaveLista, chaveIds] = CHAVES_ESPERADAS[i]
      return [
        Object.keys(grupo.criar.describe().keys),
        Object.keys(grupo.atualizar.describe().keys),
        Object.keys(grupo.ids.describe().keys)
      ].map(chaves => chaves.join()).concat([chaveLista, chaveIds])
    })

    for (const [criar, atualizar, ids, chaveLista, chaveIds] of declaradas) {
      expect(criar).toBe(chaveLista)
      expect(atualizar).toBe(chaveLista)
      expect(ids).toBe(chaveIds)
    }
  })
})
