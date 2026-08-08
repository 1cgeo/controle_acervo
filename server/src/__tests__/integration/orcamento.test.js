'use strict'

// A LACUNA QUE ESTE ARQUIVO FECHA.
//
// Ate hoje NENHUM SQL do modulo orcamento era executado em teste. As 55 rotas e
// os 13 controllers tinham cobertura, mas toda ela contra `helpers/orcamento/
// mockDb`: os testes afirmavam coisas como
//
//     expect(mockDb.conn.one).toHaveBeenCalledWith(
//       expect.stringContaining('INSERT INTO orcamento.rpnp'), ...)
//
// o que prova o MAPEAMENTO DE PARAMETRO (nota_empenho_id -> notaEmpenhoId, que e
// bug real com o `$<param>` do pg-promise) e nada sobre a consulta. Passaria com
// o SQL inteiro quebrado, desde que comecasse com aquele texto. Coluna
// inexistente, JOIN errado, CHECK do banco violado: nada disso aparecia.
//
// O que se testa AQUI e so o que exige banco de verdade:
//   - as regras que vivem dentro de `db.conn.tx`, com agregacao lida do banco
//     (o teto da liquidacao e a soma das alocacoes da NE);
//   - a traducao de erro do PostgreSQL (UNIQUE e FK) para 400 com mensagem
//     legivel, que so acontece quando o banco de fato recusa;
//   - o encadeamento NC -> NE -> liquidacao, que atravessa tres tabelas.
//
// O resto (validacao Joi, 404 de id inexistente) continua no pacote mockado,
// que roda em milissegundos: repetir aqui so tornaria a suite lenta sem provar
// mais nada.

const { db } = require('../../database')
const { cleanTestData, closeConnection } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const ncCtrl = require('../../orcamento/nota_credito/nota_credito_ctrl')
const neCtrl = require('../../orcamento/nota_empenho/nota_empenho_ctrl')
const liqCtrl = require('../../orcamento/nota_empenho/liquidacao_ctrl')
const pdrCtrl = require('../../orcamento/pdr/pdr_ctrl')
const dfdCtrl = require('../../orcamento/dfd/dfd_ctrl')
const pitCtrl = require('../../pit/pit_ctrl')

const ANO = 2026
const ND_CONSUMO = '339030'
const ND_DIARIAS = '339014'
const PDR = 1 // dominio.classificacao_nc

// Os controllers do orcamento leem `db.conn` no momento da chamada, e quem o
// cria e o `db.createConn()`. Sem esta linha eles encontrariam `undefined` --
// e essa e a razao de o modulo nunca ter tido teste de integracao: o caminho
// existia so dentro do `helpers/app`, que os testes do orcamento nao usam.
beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const novaNc = (extra = {}) => ncCtrl.criar(
  {
    numero: 'NC-001',
    ano: ANO,
    cod_nd: ND_CONSUMO,
    valor_nc: 10000,
    classificacao_id: PDR,
    ...extra
  },
  ADMIN_UUID
)

describe('Orcamento contra o banco de verdade', () => {
  describe('Nota de credito', () => {
    it('insere e le de volta pelo proprio controller', async () => {
      const { id } = await novaNc()
      const lida = await ncCtrl.getPorId(id)

      expect(lida.numero).toBe('NC-001')
      expect(lida.ano).toBe(ANO)
      // O valor vem de NUMERIC, que o pg entrega como string: quem consome a
      // rota recebe isto, e nao um number. O teste mockado nao teria como saber.
      expect(Number(lida.valor_nc)).toBe(10000)
    })

    // A UNIQUE e (ano, numero, cod_nd) por UG emitente. O controller mapeia o
    // SQLSTATE 23505 para uma mensagem legivel; sem banco, o mapa nunca roda.
    //
    // O codigo e 409 (Conflict), e nao 400: a requisicao esta bem formada, o
    // que ha e um recurso que ja existe. Escrevi 400 na primeira versao deste
    // teste e o banco me corrigiu -- exatamente o tipo de detalhe que o mock
    // nunca teria como apontar.
    it('a UNIQUE do SIAFI vira 409 com mensagem, e nao 500', async () => {
      await novaNc()
      await expect(novaNc()).rejects.toMatchObject({ statusCode: 409 })
    })

    // Mesma numeracao, ND diferente: a UNIQUE nao alcanca, e as duas coexistem.
    it('mesmo numero com ND diferente coexiste', async () => {
      await novaNc()
      const outra = await novaNc({ cod_nd: ND_DIARIAS })
      expect(outra.id).toBeDefined()
    })

    // FK: cod_nd que nao esta em dominio.natureza_despesa. O SQLSTATE 23503 e
    // traduzido para 400; sem banco a violacao nunca acontece.
    it('ND inexistente vira 400, e nao erro cru do PostgreSQL', async () => {
      await expect(novaNc({ cod_nd: '999999' })).rejects.toMatchObject({
        statusCode: 400
      })
    })
  })

  describe('Nota de empenho', () => {
    it('empenha contra a NC e soma as alocacoes', async () => {
      const nc = await novaNc()
      const ne = await neCtrl.criar(
        { numero: 'NE-001', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 4000 },
        ADMIN_UUID
      )

      const lida = await neCtrl.getPorId(ne.id)
      expect(Number(lida.valor_empenhado)).toBe(4000)
      expect(lida.nota_credito_id).toBe(nc.id)
    })

    // Alocacao em MAIS DE UMA NC. O `validarNcsHomogeneas` faz um SELECT com
    // `IN ($<ids:csv>)` para exigir mesma ND e mesma classificacao. E consulta
    // de verdade, com formatacao de lista do pg-promise: o mock so registrava
    // que ela foi chamada.
    it('aceita empenho repartido entre NCs da mesma ND', async () => {
      const a = await novaNc({ numero: 'NC-A' })
      const b = await novaNc({ numero: 'NC-B' })

      const ne = await neCtrl.criar(
        {
          numero: 'NE-002',
          ano: ANO,
          notas_credito: [
            { nota_credito_id: a.id, valor: 1500 },
            { nota_credito_id: b.id, valor: 2500 }
          ]
        },
        ADMIN_UUID
      )

      const lida = await neCtrl.getPorId(ne.id)
      expect(Number(lida.valor_empenhado)).toBe(4000)
    })

    it('recusa empenho repartido entre NDs diferentes', async () => {
      const a = await novaNc({ numero: 'NC-A' })
      const b = await novaNc({ numero: 'NC-B', cod_nd: ND_DIARIAS })

      await expect(
        neCtrl.criar(
          {
            numero: 'NE-003',
            ano: ANO,
            notas_credito: [
              { nota_credito_id: a.id, valor: 1000 },
              { nota_credito_id: b.id, valor: 1000 }
            ]
          },
          ADMIN_UUID
        )
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    // A NE nasce numa transacao (INSERT na NE mais as alocacoes), e se a segunda
    // parte falha a primeira NAO pode ficar gravada. Quem prova isso e o caso
    // 'ROLLBACK derruba o evento junto com a escrita', mais abaixo: mesma
    // entrada (a FK inexistente), mesmo 400 e a mesma consulta de sobra, mais o
    // evento. O caso que existia aqui era subconjunto estrito dele.
  })

  // -------------------------------------------------------------------------
  // O teto da liquidacao
  // -------------------------------------------------------------------------
  // Esta e a regra que MAIS precisava de banco: o controller abre transacao,
  // SOMA as liquidacoes ja existentes da NE e compara com o empenhado. A soma
  // vem de um agregado do PostgreSQL. Contra mock, o `carregarDisponivel`
  // devolvia o que o proprio teste tivesse mandado devolver.
  describe('Liquidacao nao passa do empenhado', () => {
    const prepara = async () => {
      const nc = await novaNc()
      return neCtrl.criar(
        { numero: 'NE-010', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 1000 },
        ADMIN_UUID
      )
    }

    it('aceita liquidacao dentro do empenhado', async () => {
      const ne = await prepara()
      const liq = await liqCtrl.criar(
        { nota_empenho_id: ne.id, valor_liquidado: 600 },
        ADMIN_UUID
      )
      expect(liq.id).toBeDefined()
    })

    // A liquidacao que SOZINHA passa do empenhado tem prova em 'a regra de
    // negocio que recusa dentro da transacao nao deixa evento': mesmo ramo
    // (valor maior que o empenhado, sem liquidacao anterior), mesmo 400, e la
    // ainda se confere que nenhum evento ficou.

    // O caso que so o banco pega: cada liquidacao cabe, a SOMA nao.
    it('recusa a liquidacao que passa do empenhado SOMADA as anteriores', async () => {
      const ne = await prepara()
      await liqCtrl.criar({ nota_empenho_id: ne.id, valor_liquidado: 600 }, ADMIN_UUID)

      await expect(
        liqCtrl.criar({ nota_empenho_id: ne.id, valor_liquidado: 600 }, ADMIN_UUID)
      ).rejects.toMatchObject({ statusCode: 400 })

      const total = await db.conn.one(
        'SELECT COALESCE(SUM(valor_liquidado), 0)::float AS s FROM orcamento.liquidacao WHERE nota_empenho_id = $1',
        [ne.id]
      )
      expect(total.s).toBe(600)
    })
  })

  // -------------------------------------------------------------------------
  // PDR
  // -------------------------------------------------------------------------
  // Nao existe entidade "PDR": o PDR do ano e o CONJUNTO dos pdr_item daquele
  // ano (CLAUDE.md). Entao o filtro por ano e a definicao do PDR, e vale prova.
  describe('PDR do ano', () => {
    const novoItem = (extra = {}) => pdrCtrl.criar(
      {
        ano: ANO,
        cod_nd: ND_CONSUMO,
        item_label: '1',
        descricao: 'Papel A0',
        gnd: 3,
        valor_solicitado: 5000,
        ...extra
      },
      ADMIN_UUID
    )

    it('lista so os itens do ano pedido', async () => {
      await novoItem()
      await novoItem({ item_label: '2', ano: ANO - 1 })

      const doAno = await pdrCtrl.listar(ANO)
      const anterior = await pdrCtrl.listar(ANO - 1)

      expect(doAno).toHaveLength(1)
      expect(anterior).toHaveLength(1)
      expect(doAno[0].ano).toBe(ANO)
    })

    it('a NC aponta o item do PDR que ela atende', async () => {
      const item = await novoItem()
      const nc = await novaNc({ pdr_item_id: item.id })

      const lida = await ncCtrl.getPorId(nc.id)
      expect(lida.pdr_item_id).toBe(item.id)
    })
  })

  // -------------------------------------------------------------------------
  // A cadeia nota_credito -> pdr_item -> pit.meta (1.31.0)
  // -------------------------------------------------------------------------
  // POR QUE ISTO SO O BANCO PROVA. A meta da NC deixou de ser coluna e virou o
  // resultado de dois LEFT JOIN. Contra o mock, a consulta poderia estar
  // inteiramente errada e o teste passaria do mesmo jeito.
  describe('A meta da NC vem do item do PDR', () => {
    // Duas metas do mesmo ano, para que "a meta certa" seja uma ESCOLHA entre
    // duas e nao a unica que existe: com uma so, qualquer JOIN acerta.
    const duasMetas = async () => {
      await db.conn.none(
        `INSERT INTO pit.exercicio (ano, usuario_cadastramento_uuid)
         VALUES ($<ano>, $<uuid>) ON CONFLICT (ano) DO NOTHING`,
        { ano: ANO, uuid: ADMIN_UUID }
      )
      return db.conn.many(
        `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
         VALUES ($<ano>, 1, 'Producao de Geoinformacao', $<uuid>),
                ($<ano>, 3, 'Producao para o EBGeo', $<uuid>)
         RETURNING id, numero_meta`,
        { ano: ANO, uuid: ADMIN_UUID }
      )
    }

    const itemDoPdr = (metaId, extra = {}) => pdrCtrl.criar(
      {
        ano: ANO,
        cod_nd: ND_CONSUMO,
        item_label: '1',
        descricao: 'Papel A0',
        gnd: 3,
        meta_pit_id: metaId,
        ...extra
      },
      ADMIN_UUID
    )

    it('a NC herda a meta do seu item do PDR', async () => {
      const [meta1] = await duasMetas()
      const item = await itemDoPdr(meta1.id)
      const nc = await novaNc({ pdr_item_id: item.id })

      const lida = await ncCtrl.getPorId(nc.id)
      expect(String(lida.meta_pit_id)).toBe(String(meta1.id))
      expect(Number(lida.numero_meta)).toBe(1)
    })

    // O TESTE QUE REPROVA O DESENHO ANTERIOR, e a razao de ele existir. Ate a
    // 1.30.0 a NC guardava a propria meta, e este corpo gravaria a Meta 3
    // enquanto o item dela financia a Meta 1: a contradicao que o chefe mandou
    // matar. Agora `meta_pit_id` nao e campo de entrada da NC, entao o valor e
    // descartado pelo stripUnknown e a resposta diz a meta DO ITEM.
    it('a meta mandada no corpo da NC nao manda: quem manda e o item', async () => {
      const [meta1, meta3] = await duasMetas()
      const item = await itemDoPdr(meta1.id)
      const nc = await novaNc({ pdr_item_id: item.id, meta_pit_id: meta3.id })

      const lida = await ncCtrl.getPorId(nc.id)
      expect(String(lida.meta_pit_id)).toBe(String(meta1.id))
      expect(Number(lida.numero_meta)).toBe(1)
    })

    it('a NC sem item do PDR nao tem meta', async () => {
      await duasMetas()
      const nc = await novaNc()

      const lida = await ncCtrl.getPorId(nc.id)
      expect(lida.meta_pit_id).toBeNull()
      expect(lida.numero_meta).toBeNull()
    })

    // O item do PDR de um ano transcrito sem vinculo com o PIT. E o caso real de
    // 2025 em producao: os 8 itens daquele ano tem meta nula, e por isso as NCs
    // que apontam para eles seguem sem meta.
    it('a NC cujo item do PDR nao tem meta tambem nao tem', async () => {
      await duasMetas()
      const item = await itemDoPdr(null)
      const nc = await novaNc({ pdr_item_id: item.id })

      const lida = await ncCtrl.getPorId(nc.id)
      expect(lida.meta_pit_id).toBeNull()
    })

    // A LISTAGEM E O DETALHE TEM DE CONCORDAR: sao duas consultas diferentes, e
    // a de listar ja divergiu da de ler antes neste modulo.
    it('a listagem devolve a mesma meta que o detalhe', async () => {
      const [meta1] = await duasMetas()
      const item = await itemDoPdr(meta1.id)
      const nc = await novaNc({ pdr_item_id: item.id })

      const [naLista] = await ncCtrl.listar({ ano: ANO })
      const lida = await ncCtrl.getPorId(nc.id)
      expect(String(naLista.meta_pit_id)).toBe(String(lida.meta_pit_id))
      expect(String(naLista.numero_meta)).toBe(String(lida.numero_meta))
    })

    // A COLUNA `credito_nc` DA GRADE DO PIT, que e onde o chefe le quanto
    // dinheiro chegou para cada meta. Ela somava por `nota_credito.meta_pit_id`
    // e agora soma atravessando `orcamento.pdr_item`.
    //
    // O item do PIT so aparece em `pit.meta_vigente` se uma revisao PUBLICADA o
    // declarar, dai o fixture completo (exercicio, meta, item, revisao,
    // declaracao). Sem ele a grade volta vazia e a soma nao seria exercitada.
    it('credito_nc soma o que chegou pelo item do PDR, e so a meta certa', async () => {
      const [meta1, meta3] = await duasMetas()

      const item1 = await db.conn.one(
        `INSERT INTO pit.meta_item (meta_id, item, unidade_id, usuario_cadastramento_uuid)
         VALUES ($<metaId>, '1.1', 1, $<uuid>) RETURNING id`,
        { metaId: meta1.id, uuid: ADMIN_UUID }
      )
      const item3 = await db.conn.one(
        `INSERT INTO pit.meta_item (meta_id, item, unidade_id, usuario_cadastramento_uuid)
         VALUES ($<metaId>, '3.1', 1, $<uuid>) RETURNING id`,
        { metaId: meta3.id, uuid: ADMIN_UUID }
      )
      const revisao = await db.conn.one(
        `INSERT INTO pit.revisao (ano, codigo, data_vigencia, usuario_cadastramento_uuid)
         VALUES ($<ano>, 'R0', '2026-01-01', $<uuid>) RETURNING id`,
        { ano: ANO, uuid: ADMIN_UUID }
      )
      for (const it of [item1, item3]) {
        await db.conn.none(
          `INSERT INTO pit.meta_item_revisao
             (meta_item_id, revisao_id, descricao, usuario_cadastramento_uuid)
           VALUES ($<itemId>, $<revisaoId>, 'Carta Topografica', $<uuid>)`,
          { itemId: it.id, revisaoId: revisao.id, uuid: ADMIN_UUID }
        )
      }

      // Meta 1 recebe 10.000 pelo item do PDR dela. Meta 3 recebe NADA, e e o
      // contraste que impede um JOIN frouxo de passar: sem o filtro por meta, as
      // duas linhas mostrariam o mesmo total.
      const itemPdr1 = await itemDoPdr(meta1.id)
      await novaNc({ pdr_item_id: itemPdr1.id })
      // Uma segunda NC SEM item nenhum, para provar que ela nao entra em conta
      // nenhuma. No desenho antigo ela entraria, bastando ter meta.
      await novaNc({ numero: 'NC-002' })

      const grade = await pitCtrl.listar(ANO)
      const linha1 = grade.find(l => Number(l.numero_meta) === 1)
      const linha3 = grade.find(l => Number(l.numero_meta) === 3)

      expect(Number(linha1.credito_nc)).toBe(10000)
      expect(Number(linha3.credito_nc)).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Rastreabilidade
  // -------------------------------------------------------------------------
  // O QUE SO O BANCO PROVA. No `helpers/orcamento/mockDb` a "transacao" e o
  // proprio objeto de conexao (`conn.tx = cb => cb(conn)`), entao um `registrar`
  // colocado FORA da transacao passa verde em todo teste mockado do modulo. A
  // linha de rastro TEM de cair junto com a mudanca que ela descreve, ou nao
  // cair: com conexao propria, um rollback deixaria para tras o registro de uma
  // alteracao que nunca aconteceu -- e quem le a trilha acredita nela.
  //
  // Os testes mockados continuam cobrindo a tabela, a operacao e o autor de cada
  // evento; aqui esta so a atomicidade, e o custo do banco se paga por isso.
  describe('Rastreabilidade', () => {
    const eventos = async (tabela, entidadeId) =>
      db.conn.any(
        `SELECT * FROM auditoria.evento
          WHERE tabela = $<tabela>
            AND ($<entidadeId> IS NULL OR entidade_id = $<entidadeId>)
          ORDER BY id`,
        { tabela, entidadeId: entidadeId != null ? String(entidadeId) : null }
      )

    it('a criacao da NC grava o evento com o autor e o estado resultante', async () => {
      const nc = await novaNc()
      const linhas = await eventos('orcamento.nota_credito', nc.id)

      expect(linhas).toHaveLength(1)
      expect(linhas[0].operacao).toBe('I')
      expect(linhas[0].modulo).toBe('orcamento')
      expect(linhas[0].entidade).toBe('nota_credito')
      expect(linhas[0].usuario_uuid).toBe(ADMIN_UUID)
      // `dados_antes` nulo na insercao, por definicao; `dados_depois` sai do
      // BANCO (o RETURNING *), e nao do corpo da requisicao.
      expect(linhas[0].dados_antes).toBeNull()
      expect(Number(linhas[0].dados_depois.valor_nc)).toBe(10000)
    })

    it('a alteracao guarda os DOIS lados, e o diff so acusa o que mudou', async () => {
      const nc = await novaNc()
      await ncCtrl.atualizar(
        nc.id,
        {
          numero: 'NC-001',
          ano: ANO,
          cod_nd: ND_CONSUMO,
          valor_nc: 25000,
          classificacao_id: PDR
        },
        ADMIN_UUID
      )

      const linhas = await eventos('orcamento.nota_credito', nc.id)
      const alteracao = linhas.filter(l => l.operacao === 'U')

      expect(alteracao).toHaveLength(1)
      expect(Number(alteracao[0].dados_antes.valor_nc)).toBe(10000)
      expect(Number(alteracao[0].dados_depois.valor_nc)).toBe(25000)
      // O carimbo de escrituracao muda em todo UPDATE e fica FORA do diff, mas
      // continua nos dois JSONs. Sem isso, toda linha do historico traria
      // "data_modificacao" na frente do que interessa.
      expect(alteracao[0].campos_alterados).toEqual(['valor_nc'])
      expect(alteracao[0].dados_depois).toHaveProperty('data_modificacao')
    })

    // O CASO QUE ESTE ARQUIVO EXISTE PARA GUARDAR.
    //
    // A NE nasce numa transacao: INSERT na NE, evento, e as alocacoes. Se a
    // ultima parte falha (NC inexistente), nem a NE nem o EVENTO podem ficar
    // gravados. Um evento sobrevivente descreveria uma nota de empenho que nunca
    // existiu, e seria indistinguivel de uma que existiu e foi apagada.
    it('ROLLBACK derruba o evento junto com a escrita', async () => {
      const antes = await eventos('orcamento.nota_empenho', null)

      await expect(
        neCtrl.criar(
          { numero: 'NE-ROLLBACK', ano: ANO, nota_credito_id: 999999, valor_empenhado: 100 },
          ADMIN_UUID
        )
      ).rejects.toMatchObject({ statusCode: 400 })

      const depois = await eventos('orcamento.nota_empenho', null)
      expect(depois).toHaveLength(antes.length)

      // E a prova do outro lado: a NE tambem nao ficou.
      const sobrou = await db.conn.one(
        "SELECT COUNT(*)::int AS n FROM orcamento.nota_empenho WHERE numero = 'NE-ROLLBACK'"
      )
      expect(sobrou.n).toBe(0)
    })

    // Mesmo caso, pela regra de NEGOCIO em vez da FK: a liquidacao que estoura o
    // empenhado e recusada dentro da transacao, depois de a soma ser lida do
    // banco. Nem a liquidacao nem o evento podem ficar.
    it('a regra de negocio que recusa dentro da transacao nao deixa evento', async () => {
      const nc = await novaNc()
      const ne = await neCtrl.criar(
        { numero: 'NE-020', ano: ANO, nota_credito_id: nc.id, valor_empenhado: 1000 },
        ADMIN_UUID
      )

      await expect(
        liqCtrl.criar({ nota_empenho_id: ne.id, valor_liquidado: 5000 }, ADMIN_UUID)
      ).rejects.toMatchObject({ statusCode: 400 })

      const linhas = await eventos('orcamento.liquidacao', null)
      expect(linhas).toHaveLength(0)
    })

    // O rastro SOBREVIVE ao registro apagado, e e por isso que `entidade_id` nao
    // referencia nada: a exclusao e justamente o evento que a tabela existe para
    // guardar.
    it('a exclusao deixa o que se perdeu, e a linha sobrevive ao registro', async () => {
      const item = await pdrCtrl.criar(
        {
          ano: ANO,
          cod_nd: ND_CONSUMO,
          item_label: '9',
          descricao: 'Item que vai sair',
          valor_solicitado: 4200
        },
        ADMIN_UUID
      )

      await pdrCtrl.deletar(item.id, ADMIN_UUID)

      const sumiu = await db.conn.oneOrNone(
        'SELECT id FROM orcamento.pdr_item WHERE id = $1',
        [item.id]
      )
      expect(sumiu).toBeNull()

      // O agregado do PDR e o ANO: nao ha cabecalho de PDR, e o PDR do ano E o
      // conjunto dos itens daquele ano.
      const linhas = await eventos('orcamento.pdr_item', ANO)
      const exclusao = linhas.filter(l => l.operacao === 'D')

      expect(exclusao).toHaveLength(1)
      expect(exclusao[0].usuario_uuid).toBe(ADMIN_UUID)
      expect(exclusao[0].dados_depois).toBeNull()
      expect(exclusao[0].dados_antes.descricao).toBe('Item que vai sair')
      expect(Number(exclusao[0].dados_antes.valor_solicitado)).toBe(4200)
    })

    // A lista de itens do DFD e reescrita INTEIRA a cada salvamento, com ids
    // novos. Salvar sem mexer nos itens nao pode produzir "removeu 2 itens,
    // acrescentou 2 itens": e o defeito que o evento por lista existe para
    // evitar, e so o banco prova (os ids reais e o `RETURNING` de verdade).
    it('salvar o DFD sem mexer nos itens nao gera evento de itens', async () => {
      const itens = [
        { tipo_item_id: 1, descricao: 'Papel A0', quantidade: 10, valor_unitario: 5 },
        { tipo_item_id: 1, descricao: 'Tinta', quantidade: 2, valor_unitario: 300 }
      ]
      // `consta_pca` explicito: este arquivo chama o CONTROLLER direto, e o
      // default TRUE mora no Joi da rota. A coluna e NOT NULL.
      const dfd = await dfdCtrl.criar(
        { numero: 'DFD-900', ano: ANO, objeto: 'Aquisicao', consta_pca: true, itens },
        ADMIN_UUID
      )

      // Salva de novo, mudando SO o cabecalho e mandando os mesmos itens.
      await dfdCtrl.atualizar(
        dfd.id,
        { numero: 'DFD-900', ano: ANO, objeto: 'Aquisicao revista', consta_pca: true, itens },
        ADMIN_UUID
      )

      const doCabecalho = await eventos('orcamento.dfd', dfd.id)
      const dosItens = await eventos('orcamento.dfd_item', dfd.id)

      expect(doCabecalho.map(l => l.operacao)).toEqual(['I', 'U'])
      expect(doCabecalho[1].campos_alterados).toEqual(['objeto'])
      // UM evento de itens, o da criacao. A regravacao identica nao produziu
      // nenhum, apesar de ter apagado e reinserido as duas linhas.
      expect(dosItens).toHaveLength(1)
      expect(dosItens[0].operacao).toBe('I')
      expect(dosItens[0].dados_depois.itens).toHaveLength(2)
    })

    it('mudar um item do DFD gera UM evento com a lista dos dois lados', async () => {
      const itens = [
        { tipo_item_id: 1, descricao: 'Papel A0', quantidade: 10, valor_unitario: 5 }
      ]
      const dfd = await dfdCtrl.criar(
        { numero: 'DFD-901', ano: ANO, objeto: 'Aquisicao', consta_pca: true, itens },
        ADMIN_UUID
      )

      await dfdCtrl.atualizar(
        dfd.id,
        {
          numero: 'DFD-901',
          ano: ANO,
          objeto: 'Aquisicao',
          consta_pca: true,
          itens: [
            { tipo_item_id: 1, descricao: 'Papel A0', quantidade: 25, valor_unitario: 5 }
          ]
        },
        ADMIN_UUID
      )

      const dosItens = await eventos('orcamento.dfd_item', dfd.id)
      const alteracao = dosItens.filter(l => l.operacao === 'U')

      expect(alteracao).toHaveLength(1)
      expect(alteracao[0].campos_alterados).toEqual(['itens'])
      expect(alteracao[0].dados_antes.itens[0]).toContain('qtd 10')
      expect(alteracao[0].dados_depois.itens[0]).toContain('qtd 25')
    })
  })
})
