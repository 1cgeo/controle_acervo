'use strict'

// O CONTRATO DE `/api/producao`, INTEIRO, medido no router MONTADO.
//
// As cinco fatias (`dominio_qgis`, `fluxo`, `perfil`, `trabalho`, `insumo`) tem
// cada uma o seu arquivo de teste, que prova o schema e a guarda de dentro
// dela. Este arquivo prova o que NENHUM deles alcanca: que as cinco somadas dao
// exatamente as 146 rotas que atravessaram do SAP 2.3.5, que nenhuma das 13 que
// NAO atravessaram voltou pela porta dos fundos, e que o `producao_route.js`
// monta as cinco.
//
// POR QUE O ROUTER MONTADO, e nao a leitura do fonte. `perfil_route.js` declara
// 48 das suas 49 rotas por uma FABRICA (`crudDePerfil`), entao uma varredura de
// texto contaria quatro `router.get/post/put/delete` para 48 caminhos e nao
// veria nenhum deles. O `router.stack` do Express e a unica fonte que sabe o que
// de fato foi declarado.
//
// ESTE ARQUIVO NAO ABRE CONEXAO, e por isso roda no pacote `rapido`. Montar o
// router carrega `login/verify_perfil.js`, que faz `require` da camada de banco
// mas nao se conecta a nada enquanto ninguem chamar a rota -- e aqui ninguem
// chama. O `jest.config.js` classifica o pacote por varredura de TEXTO a procura
// dos dois auxiliares de teste que abrem conexao; nomea-los aqui, ainda que so
// em prosa para dizer que nao se usa, jogaria este arquivo para o pacote de
// banco, onde ele sumiria da rodada do dia a dia sem falhar. Custou uma rodada a
// tres agentes desta mesma onda, em 2026-08-09.

const producaoRoute = require('../../../producao/producao_route')

/** Todo par (metodo, caminho) declarado no router e nos routers montados nele. */
const rotasDe = router => {
  const achadas = []
  const varrer = camadas => {
    for (const camada of camadas) {
      if (camada.route) {
        for (const metodo of Object.keys(camada.route.methods)) {
          achadas.push(`${metodo.toUpperCase()} ${camada.route.path}`)
        }
      } else if (camada.handle && camada.handle.stack) {
        varrer(camada.handle.stack)
      }
    }
  }
  varrer(router.stack)
  return achadas
}

// AS 146, uma a uma, na ordem alfabetica que o `sort()` produz. A lista e longa
// de proposito: ela E o contrato, e o SAP Gerente e o plugin do QGIS sao
// compilados FORA deste repositorio -- um caminho que mude aqui so aparece no
// dia do deploy, e nunca em teste de ninguem.
const CONTRATO = [
  'DELETE /alias',
  'DELETE /atividades',
  'DELETE /bloco',
  'DELETE /configuracao/camadas',
  'DELETE /configuracao/gerenciador_fme',
  'DELETE /configuracao/perfil_alias',
  'DELETE /configuracao/perfil_configuracao_qgis',
  'DELETE /configuracao/perfil_dificuldade_operador',
  'DELETE /configuracao/perfil_estilos',
  'DELETE /configuracao/perfil_fme',
  'DELETE /configuracao/perfil_linhagem',
  'DELETE /configuracao/perfil_menu',
  'DELETE /configuracao/perfil_modelo',
  'DELETE /configuracao/perfil_regras',
  'DELETE /configuracao/perfil_requisito_finalizacao',
  'DELETE /configuracao/perfil_temas',
  'DELETE /configuracao/perfil_workflow_dsgtools',
  'DELETE /dado_producao',
  'DELETE /estilos',
  'DELETE /grupo_estilos',
  'DELETE /grupo_insumo',
  'DELETE /insumo',
  'DELETE /menus',
  'DELETE /modelos',
  'DELETE /regras',
  'DELETE /temas',
  'DELETE /unidade_trabalho',
  'DELETE /unidade_trabalho/atividades',
  'DELETE /unidade_trabalho/insumos',
  'DELETE /workflow',
  'GET /alias',
  'GET /banco_dados',
  'GET /bloco',
  'GET /configuracao/camadas',
  'GET /configuracao/camadas/linha_producao',
  'GET /configuracao/gerenciador_fme',
  'GET /configuracao/perfil_alias',
  'GET /configuracao/perfil_configuracao_qgis',
  'GET /configuracao/perfil_dificuldade_operador',
  'GET /configuracao/perfil_estilos',
  'GET /configuracao/perfil_fme',
  'GET /configuracao/perfil_linhagem',
  'GET /configuracao/perfil_menu',
  'GET /configuracao/perfil_modelo',
  'GET /configuracao/perfil_regras',
  'GET /configuracao/perfil_requisito_finalizacao',
  'GET /configuracao/perfil_temas',
  'GET /configuracao/perfil_workflow_dsgtools',
  'GET /dado_producao',
  'GET /estilos',
  'GET /etapas',
  'GET /fases',
  'GET /grupo_estilos',
  'GET /grupo_insumo',
  'GET /insumo',
  'GET /linha_producao',
  'GET /login',
  'GET /lote/:lote_id/subfases',
  'GET /menus',
  'GET /modelos',
  'GET /regras',
  'GET /status',
  'GET /subfases',
  'GET /temas',
  'GET /tipo_controle_qualidade',
  'GET /tipo_criacao_unidade_trabalho',
  'GET /tipo_dado_producao',
  'GET /tipo_estrategia_associacao',
  'GET /tipo_etapa',
  'GET /tipo_exibicao',
  'GET /tipo_fase',
  'GET /tipo_insumo',
  'GET /tipo_perfil_dificuldade',
  'GET /tipo_pre_requisito',
  'GET /tipo_restricao',
  'GET /tipo_rotina',
  'GET /todas_subfases',
  'GET /unidade_trabalho',
  'GET /unidade_trabalho/insumos',
  'GET /workflow',
  'POST /alias',
  'POST /atividades',
  'POST /atividades/todas',
  'POST /bloco',
  'POST /bloco/insumos',
  'POST /configuracao/camadas',
  'POST /configuracao/gerenciador_fme',
  'POST /configuracao/lote/copiar',
  'POST /configuracao/perfil_alias',
  'POST /configuracao/perfil_configuracao_qgis',
  'POST /configuracao/perfil_dificuldade_operador',
  'POST /configuracao/perfil_estilos',
  'POST /configuracao/perfil_fme',
  'POST /configuracao/perfil_linhagem',
  'POST /configuracao/perfil_menu',
  'POST /configuracao/perfil_modelo',
  'POST /configuracao/perfil_regras',
  'POST /configuracao/perfil_requisito_finalizacao',
  'POST /configuracao/perfil_temas',
  'POST /configuracao/perfil_workflow_dsgtools',
  'POST /dado_producao',
  'POST /estilos',
  'POST /etapas/padrao',
  'POST /grupo_estilos',
  'POST /grupo_insumo',
  'POST /insumo',
  'POST /linha_producao',
  'POST /menus',
  'POST /modelos',
  'POST /regras',
  'POST /temas',
  'POST /unidade_trabalho',
  'POST /unidade_trabalho/copiar',
  'POST /unidade_trabalho/insumos',
  'POST /workflow',
  'PUT /alias',
  'PUT /bloco',
  'PUT /configuracao/camadas',
  'PUT /configuracao/gerenciador_fme',
  'PUT /configuracao/perfil_alias',
  'PUT /configuracao/perfil_configuracao_qgis',
  'PUT /configuracao/perfil_dificuldade_operador',
  'PUT /configuracao/perfil_estilos',
  'PUT /configuracao/perfil_fme',
  'PUT /configuracao/perfil_linhagem',
  'PUT /configuracao/perfil_menu',
  'PUT /configuracao/perfil_modelo',
  'PUT /configuracao/perfil_regras',
  'PUT /configuracao/perfil_requisito_finalizacao',
  'PUT /configuracao/perfil_temas',
  'PUT /configuracao/perfil_workflow_dsgtools',
  'PUT /dado_producao',
  'PUT /estilos',
  'PUT /grupo_estilos',
  'PUT /grupo_insumo',
  'PUT /insumo',
  'PUT /linha_producao',
  'PUT /menus',
  'PUT /modelos',
  'PUT /regras',
  'PUT /temas',
  'PUT /unidade_trabalho/bloco',
  'PUT /unidade_trabalho/cut',
  'PUT /unidade_trabalho/merge',
  'PUT /unidade_trabalho/reshape',
  'PUT /workflow'
]

describe('/api/producao: as 146 rotas que atravessaram do SAP 2.3.5', () => {
  const rotas = rotasDe(producaoRoute)

  it('são 146, e são estas', () => {
    expect(rotas.slice().sort()).toEqual(CONTRATO)
  })

  it('a lista do contrato não tem repetição', () => {
    expect(new Set(CONTRATO).size).toBe(CONTRATO.length)
  })

  // O SAP declarava o mesmo caminho duas vezes em alguns casos e o Express
  // atendia o primeiro em silêncio. Aqui isso é falha: caminho declarado duas
  // vezes é a rota nova que nunca é chamada.
  it('nenhum par (método, caminho) foi declarado duas vezes', () => {
    const vistos = new Set()
    const repetidos = []
    for (const rota of rotas) {
      if (vistos.has(rota)) repetidos.push(rota)
      vistos.add(rota)
    }
    expect(repetidos).toEqual([])
  })

  it('as cinco fatias estão montadas, e nenhuma ficou de fora', () => {
    // Uma rota-testemunha por fatia. Se alguém remover um `router.use` do
    // `producao_route.js`, a contagem acima já cai, mas esta lista diz QUAL.
    const testemunhas = {
      dominio_qgis: 'GET /grupo_estilos',
      fluxo: 'GET /lote/:lote_id/subfases',
      perfil: 'GET /configuracao/perfil_menu',
      trabalho: 'GET /bloco',
      insumo: 'GET /grupo_insumo'
    }
    for (const [fatia, rota] of Object.entries(testemunhas)) {
      expect({ fatia, tem: rotas.includes(rota) }).toEqual({ fatia, tem: true })
    }
  })
})

// AS 13 QUE NAO ATRAVESSARAM, e a prova de que nenhuma voltou.
//
// O `/api/projeto` do SAP tinha 159 rotas; 13 falavam de projeto, lote, produto
// e tipo de produto, e o SCA ja as responde por `/api/projetos`, `/api/produtos`
// e `/api/gerencia/dominio/subtipo_produto`. Recria-las aqui seria a SEGUNDA
// verdade que esta fusao veio eliminar: dois cadastros do mesmo lote no mesmo
// banco.
//
// A LISTA E DE CAMINHOS, e nao de pares: nem GET nem POST nem nada. Um
// `GET /projetos` que voltasse com outro verbo seria o mesmo erro.
describe('/api/producao: as 13 rotas do SAP que NÃO atravessaram', () => {
  const rotas = rotasDe(producaoRoute)
  const caminhos = new Set(rotas.map(r => r.split(' ')[1]))

  const NAO_ATRAVESSARAM = [
    // 4 rotas: quem responde é /api/projetos/projeto
    '/projetos',
    // 4 rotas: quem responde é /api/projetos/lote
    '/lote',
    // 4 rotas: quem responde é /api/produtos/produto (PUT e DELETE),
    // POST /api/produtos/produtos, POST /api/produtos/produto_versao_planejada
    // e, na leitura, /api/acervo/busca
    '/produto',
    // 1 rota: quem responde é GET /api/gerencia/dominio/subtipo_produto, porque
    // o `dominio.tipo_produto` do SAP é o `dominio.subtipo_produto` do SCA
    '/tipo_produto'
  ]

  it.each(NAO_ATRAVESSARAM)('%s não existe em /api/producao', caminho => {
    expect(caminhos.has(caminho)).toBe(false)
  })

  // `/lote/:lote_id/subfases` EXISTE e não é `/lote`: ela pergunta quais
  // subfases um lote executa, que é pergunta de produção, e não cadastro de
  // lote. O caso está aqui para que ninguém a apague junto ao limpar.
  it('mas /lote/:lote_id/subfases continua existindo, e é outra pergunta', () => {
    expect(caminhos.has('/lote/:lote_id/subfases')).toBe(true)
  })
})
