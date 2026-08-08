'use strict'

// O RPCMTec de ponta a ponta, contra o banco de teste.
//
// O que este arquivo protege:
//
//  1. O PISO DA GUARDA. O relatório cruza os cinco módulos e traz valor de
//     crédito, de empenho e de liquidação. Desde 2026-08-08 ele não é mais
//     admin-only: qualquer GERENTE lê o relatório inteiro, e a escrita de
//     subseção é recortada pelo módulo dela. O que este arquivo prova, contra o
//     banco, é o PISO -- quem tem consulta no acervo e operador na mapoteca não
//     entra por porta nenhuma --, e o risco que ele guarda é alguém trocar a
//     guarda por um `verifyPerfil('consulta', 'acervo')` e entregar o orçamento
//     a quem só cataloga carta. O recorte fino (gerente do módulo X escreve a
//     subseção de X e não a de Y) é de `routes/rpcmtec_guarda.test.js`, com o
//     banco dublê: aqui a semente não tem gerente para encenar os cinco casos.
//
//  2. A ESTRUTURA. São 33 blocos em nove seções, na numeração do documento da
//     Divisão. Uma subseção que muda de número, ou some, quebra o documento sem
//     dar erro nenhum.
//
//  3. A DIVISÃO ENTRE CALCULADO E DIGITADO. Vinte subseções saem do banco e
//     treze o gestor preenche. Uma calculada que vire digitada por descuido
//     faria alguém redigitar todo mês um número que o sistema tem.
//
//  4. O CICLO DE FECHAMENTO, que é o coração do desenho: aberta o calculado
//     recalcula, fechada tudo congela, e o congelado não muda quando o banco
//     mudar. Com a conferência mostrando a diferença, para congelar não virar
//     esquecer.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateAdminToken, generateUserToken, ADMIN_UUID, USER_UUID
} = require('../helpers/auth')
const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

// O supertest NAO acumula corpo binario sozinho: sem isto, `res.body` chega
// como objeto vazio e a assercao de "e um PDF" passa a testar nada.
const comoBinario = (req) => req
  .buffer()
  .parse((res, cb) => {
    const partes = []
    res.on('data', (p) => partes.push(p))
    res.on('end', () => cb(null, Buffer.concat(partes)))
  })

const criarEdicao = async (corpo = {}) => {
  const res = await request(app)
    .post('/api/rpcmtec')
    .set('Authorization', admin())
    .send({ ano: 2026, mes: 7, assinante_uuid: ADMIN_UUID, ...corpo })
  expect(res.status).toBe(201)
  return res.body.dados.id
}

const documento = async id => {
  const res = await request(app)
    .get(`/api/rpcmtec/${id}/documento`)
    .set('Authorization', admin())
  expect(res.status).toBe(200)
  return res.body.dados
}

const blocos = doc => doc.secoes.flatMap(s => s.subsecoes)

// Marca TODAS as digitadas como "sem ocorrência no mês", que é a forma legítima
// de declarar o vazio. Sem isso a edição não fecha, e é justamente essa recusa
// que o teste seguinte exercita.
const preencherTudo = async id => {
  for (const numero of estrutura.NUMEROS_DIGITADOS) {
    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/${numero}`)
      .set('Authorization', admin())
      .send({ sem_ocorrencia: true })
    expect(res.status).toBe(200)
  }
}

// A numeração do documento da Divisão, medida no OOXML da edição de
// julho/2026. São 33 blocos: 29 tabelas mais a 1.1 e as três da seção 9.
// Eram 34 até 2026-08-08, quando a 7.3 (Tintas) foi fundida na 7.2 (Papel).
const SUBSECOES_CALCULADAS = [
  // A 2.2 e a 2.4 entraram em 2026-08-05, por decisao do chefe: as duas
  // reportam a versao Regular que ficou pronta no mes, e isso o acervo sabe
  // sozinho. Estavam digitadas com fonte 'SAP' sem precisar, e enquanto
  // estiveram o numero do relatorio e o do acervo podiam divergir calados.
  '2.1', '2.2', '2.4', '2.6', '2.7',
  '3.1', '3.2', '3.3', '3.4',
  '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7',
  '6.1', '6.2',
  // UMA tabela de insumos desde 2026-08-08, e a 7.3 sumiu.
  '7.2'
]

// As que o gestor digita. Nove vêm de outro sistema ou de fora (2.3 e 2.5 do
// SAP, 5.1 do painel do GitHub, 8.3 do doc_dgeo) e quatro não têm cadastro em
// lugar nenhum.
//
// A 2.3 (lote) e a 2.5 (campo) FICAM digitadas, e a diferença para as duas que
// saíram é real: as duas são do SAP e não têm entidade no SCA que as prove. A
// régua não é "veio do SAP", é "o SCA sabe provar".
const SUBSECOES_DIGITADAS = [
  '2.3', '2.5',
  '5.1', '5.2',
  '7.1',
  '8.1', '8.2', '8.3', '8.4', '8.5',
  '9.1', '9.2', '9.3'
]

describe('RPCMTec: a estrutura do documento', () => {
  test('são 33 blocos em nove seções, na numeração do documento', async () => {
    const id = await criarEdicao()
    const doc = await documento(id)

    expect(doc.secoes.map(s => s.titulo)).toEqual([
      '1. FINALIDADE',
      '2. EXECUÇÃO DO PIT',
      '3. MAPOTECA',
      '4. EXECUÇÃO DO PDR',
      // O 'e' minúsculo é do documento.
      '5. DESENVOLVIMENTO e TI',
      '6. RECURSOS HUMANOS',
      '7. EQUIPAMENTO E MATERIAL',
      '8. DIVULGAÇÃO DAS ATIVIDADES',
      '9. BOAS PRÁTICAS, LIÇÕES APRENDIDAS E OPORTUNIDADES DE MELHORIA'
    ])

    expect(blocos(doc)).toHaveLength(33)
    expect(blocos(doc).filter(b => b.cabecalhos)).toHaveLength(29)
  })

  test('dezenove subseções são calculadas e treze são digitadas', async () => {
    const id = await criarEdicao()
    const doc = await documento(id)

    const porOrigem = origem => blocos(doc)
      .filter(b => b.origem === origem).map(b => b.numero)

    expect(porOrigem(1)).toEqual(SUBSECOES_CALCULADAS)
    expect(porOrigem(2)).toEqual(SUBSECOES_DIGITADAS)
    // A 1.1 é texto fixo, igual em toda edição desde fevereiro de 2025.
    expect(porOrigem(3)).toEqual(['1.1'])
  })

  test('toda calculada declara de onde sai, e nenhuma fica sem gerador', async () => {
    // Subseção declarada calculada e não implementada sairia como tabela vazia,
    // indistinguível de "não houve". O servidor a marca, e este teste cobra que
    // não haja nenhuma.
    const id = await criarEdicao()
    const doc = await documento(id)

    for (const b of blocos(doc).filter(b => b.origem === 1)) {
      expect(b.fonte).toBeTruthy()
      expect(b.semGerador).toBe(false)
    }
  })

  test('toda linha calculada tem uma célula por coluna', async () => {
    // Linha com menos células que colunas sai desalinhada no PDF, e o
    // desenhador não reclama: a última coluna simplesmente fica vazia.
    const id = await criarEdicao()
    const doc = await documento(id)

    for (const b of blocos(doc).filter(b => b.origem === 1)) {
      expect(Array.isArray(b.linhas)).toBe(true)
      for (const linha of b.linhas) {
        expect(linha).toHaveLength(b.cabecalhos.length)
      }
    }
  })

  test('a 2.7 traz as quatro escalas nos dois tipos de produto', async () => {
    // Oito linhas: 1:25.000, 1:50.000, 1:100.000 e 1:250.000, para Carta
    // Topográfica e Carta Ortoimagem. É a forma da tabela no documento, e ela
    // não depende de haver produto cadastrado.
    const id = await criarEdicao()
    const doc = await documento(id)
    const estadoAcervo = blocos(doc).find(b => b.numero === '2.7')

    expect(estadoAcervo.linhas).toHaveLength(8)
    expect(estadoAcervo.linhas.map(l => l[1])).toEqual([
      ...Array(4).fill('Carta Topográfica'),
      ...Array(4).fill('Carta Ortoimagem')
    ])
    // A escala sai SEM o "1:", como o documento escreve.
    expect(estadoAcervo.linhas.map(l => l[0])).toEqual([
      '25.000', '50.000', '100.000', '250.000',
      '25.000', '50.000', '100.000', '250.000'
    ])
  })

  test('a 3.1 traz os cinco indicadores que o SCA apura, na ordem do documento', async () => {
    const id = await criarEdicao()
    const doc = await documento(id)
    const totais = blocos(doc).find(b => b.numero === '3.1')

    // Sem as duas linhas de Extra-PIT do modelo: derivadas de `previsto_pit`
    // elas diziam 485 produtos onde a edição real diz 0.
    expect(totais.linhas.map(l => l[0])).toEqual([
      'Mapoteca - produtos entregues',
      'Mapoteca - quantidade de pedidos',
      'Mapoteca - OM atendidas',
      'LAI e órgãos públicos - produtos entregues',
      'LAI e órgãos públicos - quantidade de pedidos'
    ])
  })

  test('a 4.1 tem uma linha por natureza de despesa, e nenhuma de TOTAL', async () => {
    // O documento da Divisão NÃO tem linha de total na 4.1. Quem precisa dela é
    // o painel do orçamento, que tem rota própria por causa disso.
    const id = await criarEdicao()
    const doc = await documento(id)
    const execucao = blocos(doc).find(b => b.numero === '4.1')

    const { rows } = await conn.result('SELECT code FROM dominio.natureza_despesa')
    expect(execucao.linhas).toHaveLength(rows.length)
    expect(execucao.linhas.map(l => l[0])).not.toContain('TOTAL')
  })

  test('valor sem nenhum documento sai como traço, e não como zero', async () => {
    // Na 4.1, '-' quer dizer "não há documento nenhum nesta ND" e '0,00' quer
    // dizer "há, e somam zero". Com o banco de teste vazio, tudo é traço --
    // menos o previsto, que vem do PDR e é zero de verdade.
    const id = await criarEdicao()
    const doc = await documento(id)
    const execucao = blocos(doc).find(b => b.numero === '4.1')

    const primeira = execucao.linhas[0]
    expect(primeira[1]).toBe('0,00')
    expect(primeira.slice(2)).toEqual(['-', '-', '-', '-'])
  })
})

describe('RPCMTec: a 4.4 e a 4.5 dizem a MESMA fase que a tela de Licitações', () => {
  // O DEFEITO, relatado pelo chefe em 2026-08-06: "o item 4.4 GCALC DSG não
  // está aparecendo a mesma coisa de licitações, pois fornecimento de imagens
  // está homologado".
  //
  // A MEDIÇÃO NA PRODUÇÃO, no mesmo dia: a licitação id 1 (ano 2026, tipo 1,
  // "licenciamento e fornecimento de imagens satelitais") tem `fase_id = 3`
  // (Homologado) e `fase_atual = 'Renovando o contrato vigente'`. A tela lê
  // `fase_nome || fase_atual` (`licitacoes/list.js`) e mostrava "Homologado". O
  // gerador lia só o `fase_atual` e mostrava a outra coisa, para a MESMA linha.
  //
  // O código classifica e o texto narra, por decisão registrada no DDL. Quem
  // tem os dois manda pelo código, nos dois lugares.
  const semear = async ({
    ano = 2026, tipoId = 1, objeto = 'Objeto', faseId = null, faseAtual = null,
    estimado = null, homologado = null
  }) => conn.none(
    `INSERT INTO orcamento.licitacao
       (ano, tipo_id, objeto, fase_id, fase_atual, valor_total_estimado,
        valor_final_homologado, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [ano, tipoId, objeto, faseId, faseAtual, estimado, homologado, ADMIN_UUID]
  )

  const linhasDa = async (id, numero) => {
    const doc = await documento(id)
    return blocos(doc).find(b => b.numero === numero).linhas
  }

  test('com fase_id, a 4.4 mostra o nome do CÓDIGO, e não o texto livre', async () => {
    await semear({
      objeto: 'Contratação de serviço de licenciamento e fornecimento de imagens satelitais',
      faseId: 3,
      faseAtual: 'Renovando o contrato vigente',
      estimado: 739875.0,
      homologado: 739875.0
    })
    const id = await criarEdicao()

    const linhas = await linhasDa(id, '4.4')
    expect(linhas).toHaveLength(1)
    expect(linhas[0][0]).toContain('imagens satelitais')
    expect(linhas[0][1]).toBe('Homologado')
    // O BLOCO INTEIRO, e não só a coluna do defeito: os dois valores continuam
    // saindo com o símbolo, como a 4.4 do modelo escreve.
    expect(linhas[0][2]).toContain('739.875,00')
    expect(linhas[0][3]).toContain('739.875,00')
  })

  test('sem fase_id, a 4.4 continua narrando pelo texto livre', async () => {
    // VARIÂNCIA: sem este caso, um gerador que lesse SÓ o código passaria no
    // caso acima e apagaria os 103 caracteres que explicam o processo. Metade
    // das licitações da produção tem `fase_id` nulo.
    const narrativa = 'Homologado. Vencedor não entregou os softwares licitados, '
      + 'o que implica que o pregão se tornou fracassado'
    await semear({ objeto: 'Contratação de Softwares (TI)', faseAtual: narrativa })
    const id = await criarEdicao()

    const linhas = await linhasDa(id, '4.4')
    expect(linhas[0][1]).toBe(narrativa)
  })

  test('sem código e sem texto, a fase sai como traço', async () => {
    await semear({ objeto: 'Licitação recém-cadastrada' })
    const id = await criarEdicao()

    expect((await linhasDa(id, '4.4'))[0][1]).toBe('-')
  })

  test('a mesma regra vale na 4.5, e as duas subseções não se misturam', async () => {
    await semear({ tipoId: 1, objeto: 'GCALC', faseId: 3 })
    await semear({ tipoId: 2, objeto: 'Insumos de impressão', faseId: 1 })
    await semear({ tipoId: 3, objeto: 'Pregão como participante', faseId: 4 })
    const id = await criarEdicao()

    const gcalc = await linhasDa(id, '4.4')
    const demais = await linhasDa(id, '4.5')

    expect(gcalc.map(l => [l[0], l[1]])).toEqual([['GCALC', 'Homologado']])
    expect(demais.map(l => [l[0], l[1]])).toEqual([
      ['Insumos de impressão', 'Previsto'],
      ['Pregão como participante', 'Fracassado']
    ])
  })

  test('a licitação de OUTRO ano não entra na edição deste', async () => {
    await semear({ ano: 2025, objeto: 'Imagens de 2025', faseId: 3 })
    await semear({ ano: 2026, objeto: 'Imagens de 2026', faseId: 3 })
    const id = await criarEdicao()

    const linhas = await linhasDa(id, '4.4')
    expect(linhas.map(l => l[0])).toEqual(['Imagens de 2026'])
  })
})

describe('RPCMTec: o que o gestor digita', () => {
  test('grava linhas e as devolve no documento', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({
        linhas: [
          ['GPS de Navegação', '26/07/2023', 'Falta conexão com pilhas', '-']
        ]
      })
    expect(res.status).toBe(200)

    const bloco = blocos(await documento(id)).find(b => b.numero === '7.1')
    expect(bloco.preenchida).toBe(true)
    expect(bloco.linhas).toEqual([
      ['GPS de Navegação', '26/07/2023', 'Falta conexão com pilhas', '-']
    ])
  })

  test('recusa linha com número de células diferente do cabeçalho', async () => {
    // A grade tem cabeçalho fixo. Linha curta gravada aqui viraria coluna
    // vazia no PDF, sem erro nenhum.
    const id = await criarEdicao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({ linhas: [['GPS', '26/07/2023']] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/2 células.*4 colunas/)
  })

  test('recusa gravar numa subseção calculada', async () => {
    // Digitar por cima do que o banco calcula criaria duas verdades sobre o
    // mesmo número, e nada diria qual delas o relatório afirma.
    const id = await criarEdicao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/2.1`)
      .set('Authorization', admin())
      .send({ linhas: [] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/calculada pelo sistema/)
  })

  test('recusa subseção que não existe no documento', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/9.9`)
      .set('Authorization', admin())
      .send({ linhas: [] })

    expect(res.status).toBe(404)
  })

  test('"sem ocorrência" conta como preenchida, e limpar a torna pendente de novo', async () => {
    // A distinção que o documento em Word não fazia: vazio POR DECISÃO e vazio
    // por esquecimento saíam iguais.
    const id = await criarEdicao()

    await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/8.4`)
      .set('Authorization', admin())
      .send({ sem_ocorrencia: true })

    let bloco = blocos(await documento(id)).find(b => b.numero === '8.4')
    expect(bloco.preenchida).toBe(true)
    expect(bloco.semOcorrencia).toBe(true)

    const limpa = await request(app)
      .delete(`/api/rpcmtec/${id}/subsecao/8.4`)
      .set('Authorization', admin())
    expect(limpa.status).toBe(200)

    bloco = blocos(await documento(id)).find(b => b.numero === '8.4')
    expect(bloco.preenchida).toBe(false)
  })

  test('a prosa da seção 9 grava texto, e não linhas', async () => {
    const id = await criarEdicao()

    await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/9.1`)
      .set('Authorization', admin())
      .send({ texto: 'A revisão do PIT passou a ser rastreável.' })

    const bloco = blocos(await documento(id)).find(b => b.numero === '9.1')
    expect(bloco.cabecalhos).toBeNull()
    expect(bloco.texto).toBe('A revisão do PIT passou a ser rastreável.')
  })
})

// A EDIÇÃO NÃO RECEBE NADA DA ANTERIOR, desde 2026-08-06.
//
// Aqui moravam dois casos que exercitavam a ação de trazer o digitado do mês
// passado. Ela saiu do servidor inteiro (rota, schema e controlador), porque o
// RPCMTec é o relatório DAQUELE mês: a linha que chega pronta não é relida, e o
// documento assinado passava a afirmar sobre agosto o que aconteceu em julho.
//
// Os casos abaixo REPROVAM o estado anterior. Com a ação viva, a 7.1 de julho
// nascia com a linha de junho e o POST respondia 200.
describe('RPCMTec: a edição de julho não recebe nada de junho', () => {
  test('o digitado de junho não aparece na edição de julho', async () => {
    const junho = await criarEdicao({ mes: 6 })
    await request(app)
      .put(`/api/rpcmtec/${junho}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({ linhas: [['GPS de Navegação', '26/07/2023', 'Conector serial', '-']] })

    // VARIÂNCIA: junho tem mesmo a linha. Sem esta conferência, "julho está
    // vazio" passaria com as duas edições vazias.
    expect(blocos(await documento(junho)).find(b => b.numero === '7.1').linhas)
      .toEqual([['GPS de Navegação', '26/07/2023', 'Conector serial', '-']])

    const julho = await criarEdicao({ mes: 7 })

    const bloco = blocos(await documento(julho)).find(b => b.numero === '7.1')
    expect(bloco.preenchida).toBe(false)
    // `null`, e nao `[]`: a subsecao DIGITADA sem linha gravada nao existe como
    // registro, e `montar` devolve nulo. Cobrar `[]` aqui seria uma assercao
    // mais estrita que o contrato, e ela reprovaria o comportamento certo.
    //
    // O poder de reprovar continua inteiro: com a copia viva, este campo trazia
    // a linha de junho.
    expect(bloco.linhas).toBeNull()
  })

  test('não existe rota que traga o mês anterior', async () => {
    const id = await criarEdicao({ mes: 7 })

    // 404 do Express, porque nenhuma rota casa. Antes esta chamada respondia
    // 200 com a lista das subseções copiadas.
    const res = await request(app)
      .post(`/api/rpcmtec/${id}/copiar-mes-anterior`)
      .set('Authorization', admin())
      .send({})

    expect(res.status).toBe(404)
  })
})

describe('RPCMTec: fechar, congelar e conferir', () => {
  test('recusa fechar com subseção nunca visitada, e diz quais faltam', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
      .send({ ciente_revisao: true })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Faltam subseções/)
    for (const numero of SUBSECOES_DIGITADAS) {
      expect(res.body.message).toContain(numero)
    }
  })

  test('recusa fechar sem assinante', async () => {
    // Sem assinante o PDF sairia com o bloco de assinatura em branco, e uma
    // linha vazia onde vai a assinatura convida a preenchê-la à caneta.
    const id = await criarEdicao({ assinante_uuid: null })
    await preencherTudo(id)

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
      .send({ ciente_revisao: true })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/assinante/i)
  })

  test('fechar congela os 33 blocos, e o congelado não muda quando o banco muda', async () => {
    const id = await criarEdicao()
    await preencherTudo(id)

    const antes = blocos(await documento(id)).find(b => b.numero === '4.1')

    const fechada = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
      .send({ ciente_revisao: true })
    expect(fechada.status).toBe(200)
    expect(fechada.body.dados.subsecoes).toBe(33)

    const gravadas = await conn.any(
      'SELECT numero FROM rpcmtec.subsecao WHERE edicao_id = $1 ORDER BY ordem', [id]
    )
    expect(gravadas).toHaveLength(33)

    const doc = await documento(id)
    expect(doc.fechada).toBe(true)
    expect(doc.pendentes).toEqual([])
    // O congelado é o que estava lá no instante do fechamento.
    expect(blocos(doc).find(b => b.numero === '4.1').linhas).toEqual(antes.linhas)
  })

  test('edição fechada recusa alterar o conteúdo', async () => {
    const id = await criarEdicao()
    await preencherTudo(id)
    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())
      .send({ ciente_revisao: true })

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({ linhas: [] })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/fechada/i)
  })

  test('edição fechada não pode ser excluída', async () => {
    // Excluir levaria o documento assinado e o anexo junto, pelo CASCADE.
    const id = await criarEdicao()
    await preencherTudo(id)
    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())
      .send({ ciente_revisao: true })

    const res = await request(app)
      .delete(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Reabra/)
  })

  test('a conferência acusa a divergência entre o congelado e o banco de hoje', async () => {
    // É o contrapeso do congelamento: sem ela, um número corrigido depois do
    // fechamento ficaria invisível.
    const id = await criarEdicao()
    await preencherTudo(id)
    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())
      .send({ ciente_revisao: true })

    const igual = await request(app)
      .get(`/api/rpcmtec/${id}/conferir`)
      .set('Authorization', admin())
    expect(igual.status).toBe(200)
    expect(igual.body.dados.divergentes).toEqual([])
    expect(igual.body.dados.subsecoes).toHaveLength(SUBSECOES_CALCULADAS.length)

    // Mexe no CONGELADO para simular o banco tendo andado: o efeito é o mesmo,
    // e não depende de cadastrar orçamento no meio do teste.
    await conn.none(
      `UPDATE rpcmtec.subsecao SET linhas = '[["9999","-","-","-","-","-"]]'::jsonb
       WHERE edicao_id = $1 AND numero = '4.1'`, [id]
    )

    const divergente = await request(app)
      .get(`/api/rpcmtec/${id}/conferir`)
      .set('Authorization', admin())
    expect(divergente.body.dados.divergentes).toEqual(['4.1'])

    const quatroUm = divergente.body.dados.subsecoes.find(s => s.numero === '4.1')
    expect(quatroUm.congelado[0][0]).toBe('9999')
    expect(quatroUm.hoje[0][0]).not.toBe('9999')
  })

  test('a conferência só existe em edição fechada', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .get(`/api/rpcmtec/${id}/conferir`)
      .set('Authorization', admin())

    expect(res.status).toBe(400)
  })

  test('reabrir descongela o calculado e PRESERVA o digitado', async () => {
    // Reabrir para corrigir um número do banco não é razão para o gestor
    // redigitar as treze subseções que são dele.
    const id = await criarEdicao()
    await preencherTudo(id)
    await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({ linhas: [['GPS', '26/07/2023', 'Conector', '-']] })
    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())
      .send({ ciente_revisao: true })

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/reabrir`)
      .set('Authorization', admin())
    expect(res.status).toBe(200)

    const restantes = await conn.any(
      'SELECT numero, origem_id FROM rpcmtec.subsecao WHERE edicao_id = $1', [id]
    )
    // Só as digitadas sobrevivem, e são as 13.
    expect(restantes).toHaveLength(SUBSECOES_DIGITADAS.length)
    expect(restantes.every(r => r.origem_id === 2)).toBe(true)

    const doc = await documento(id)
    expect(doc.fechada).toBe(false)
    expect(doc.pendentes).toEqual([])
    expect(blocos(doc).find(b => b.numero === '7.1').linhas)
      .toEqual([['GPS', '26/07/2023', 'Conector', '-']])
  })

  test('reabrir uma edição já aberta responde 400', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/reabrir`)
      .set('Authorization', admin())

    expect(res.status).toBe(400)
  })
})

describe('RPCMTec: o PDF', () => {
  test('sai como anexo PDF, e não como envelope JSON', async () => {
    const id = await criarEdicao()

    const res = await comoBinario(request(app)
      .get(`/api/rpcmtec/${id}/pdf`)
      .set('Authorization', admin()))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('RPCMTec-2026-07.pdf')
    // Todo PDF começa com '%PDF'.
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF')
  })

  test('a edição aberta sai marcada como rascunho, e a fechada não', async () => {
    // Um PDF de edição aberta pode ser assinado, e aí o documento assinado
    // afirma números que ainda vão mudar.
    const id = await criarEdicao()

    const rascunho = await comoBinario(request(app)
      .get(`/api/rpcmtec/${id}/pdf`).set('Authorization', admin()))

    await preencherTudo(id)
    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())
      .send({ ciente_revisao: true })

    const definitivo = await comoBinario(request(app)
      .get(`/api/rpcmtec/${id}/pdf`).set('Authorization', admin()))

    // O texto do PDF é comprimido, então o que se compara é o TAMANHO: a marca
    // sai em toda página, e some inteira quando a edição fecha.
    expect(rascunho.body.length).toBeGreaterThan(definitivo.body.length)
  })
})

describe('RPCMTec: o assinado', () => {
  test('anexa, lista, baixa e apaga', async () => {
    const id = await criarEdicao()

    const enviado = await request(app)
      .post(`/api/rpcmtec/${id}/anexos`)
      .set('Authorization', admin())
      .attach('arquivo', Buffer.from('%PDF-1.4 assinado'), 'RPCMTec-2026-07-assinado.pdf')
    expect(enviado.status).toBe(201)

    const lista = await request(app)
      .get(`/api/rpcmtec/${id}/anexos`).set('Authorization', admin())
    expect(lista.body.dados).toHaveLength(1)
    expect(lista.body.dados[0].nome_original).toBe('RPCMTec-2026-07-assinado.pdf')
    // A listagem NUNCA traz os bytes.
    expect(lista.body.dados[0].conteudo).toBeUndefined()

    const anexoId = lista.body.dados[0].id
    const baixado = await comoBinario(request(app)
      .get(`/api/rpcmtec/anexo/${anexoId}/download`).set('Authorization', admin()))
    expect(baixado.body.toString()).toBe('%PDF-1.4 assinado')

    const apagado = await request(app)
      .delete(`/api/rpcmtec/anexo/${anexoId}`).set('Authorization', admin())
    expect(apagado.status).toBe(200)
  })

  test('recusa extensão fora de PDF e P7S', async () => {
    // O sistema é quem emite o documento: aceitar .docx reabriria a porta de
    // um documento montado fora dele.
    const id = await criarEdicao()

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/anexos`)
      .set('Authorization', admin())
      .attach('arquivo', Buffer.from('PK'), 'relatorio.docx')

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/não permitido/i)
  })

  test('a edição conta os anexos na listagem', async () => {
    const id = await criarEdicao()
    await request(app)
      .post(`/api/rpcmtec/${id}/anexos`)
      .set('Authorization', admin())
      .attach('arquivo', Buffer.from('%PDF'), 'assinado.pdf')

    const lista = await request(app).get('/api/rpcmtec').set('Authorization', admin())
    expect(lista.body.dados[0].anexos).toBe(1)
  })
})

describe('GET /api/rpcmtec/anuario', () => {
  test('devolve os dois blocos com as linhas de total', async () => {
    const res = await request(app)
      .get('/api/rpcmtec/anuario?ano=2026&mes=7')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados.total_convencional.rotulo).toBe('Total (Convencional)')
    expect(res.body.dados.total_digital.rotulo).toBe('Total (Digital)')
    expect(res.body.dados.convencional).toHaveLength(18)
    expect(res.body.dados.digital).toHaveLength(16)
    // As lacunas viajam com o dado: o rodapé do arquivo e a tela as declaram.
    expect(res.body.dados.lacunas.length).toBeGreaterThan(0)
  })

  test('o .ods sai da planilha-semente, com o nome que a DSG recebe', async () => {
    const res = await comoBinario(request(app)
      .get('/api/rpcmtec/anuario/ods?ano=2026&mes=7')
      .set('Authorization', admin()))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('opendocument.spreadsheet')
    expect(res.headers['content-disposition'])
      .toContain('Anuario_Estatistico_1CGEO_07_Julho_2026.ods')
    expect(res.body.subarray(0, 2).toString()).toBe('PK')
  })
})

// A 2.4 diz ENTREGA, e entrega é ter chegado ao destino final. Antes de
// 2026-08-07 ela listava toda versão Regular do mês, carregada ou não, e assim
// prometia no BDGEx folha que ninguém tinha subido lá: em julho/2026 ela
// mostrava 8 produtos, e nenhum dos 8 tinha registro no BDGEx.
//
// O teste tem de REPROVAR o comportamento anterior, e é por isso que ele cria o
// par: duas versões idênticas no mesmo mês, separadas SÓ pela situação de
// carregamento do arquivo. Com o filtro removido, a asserção da não-carregada
// falha na hora.
describe('RPCMTec 2.4: só entra o que foi entregue', () => {
  const { createFullProduct } = require('../helpers/fixtures')

  // A 2.4 recorta por `data_edicao` no mês da edição (julho de 2026).
  const NO_MES = { data_edicao: '2026-07-15', data_criacao: '2026-07-01' }

  const linhas24 = async () => {
    const doc = await documento(await criarEdicao())
    return blocos(doc).find(b => b.numero === '2.4').linhas
  }

  test('a versão com arquivo carregado aparece; a não carregada, não', async () => {
    const entregue = await createFullProduct({
      produto: { mi: '2965-1-NE' },
      versao: NO_MES,
      // 2 = Carregado BDGEx Ostensivo
      arquivo: { situacao_carregamento_id: 2 }
    })
    const naoEntregue = await createFullProduct({
      produto: { mi: '2965-1-NO' },
      versao: NO_MES,
      // 1 = Não carregado
      arquivo: { situacao_carregamento_id: 1 }
    })

    const uuids = (await linhas24()).map(l => l[2])

    expect(uuids).toContain(entregue.versao.uuid_versao)
    expect(uuids).not.toContain(naoEntregue.versao.uuid_versao)
  })

  test('o destino não importa: Operações conta como entrega', async () => {
    // O título da subseção cobre BDGEx, IGW e EBGeo, então o filtro é
    // "diferente de Não carregado", e não "igual a BDGEx Ostensivo".
    const op = await createFullProduct({
      produto: { mi: '2965-3-SE' },
      versao: NO_MES,
      // 3 = Carregado BDGEx Operações
      arquivo: { situacao_carregamento_id: 3 }
    })

    expect((await linhas24()).map(l => l[2])).toContain(op.versao.uuid_versao)
  })

  test('basta UM arquivo carregado na versão', async () => {
    // O registro do BDGEx agrega o conjunto da folha (GeoTIFF, PDF e XML), e o
    // JSON de edição nunca sobe. Exigir todos os arquivos carregados sumiria
    // com a folha inteira por causa do insumo que não é produto.
    const { versao } = await createFullProduct({
      produto: { mi: '2965-4-NO' },
      versao: NO_MES,
      arquivo: { situacao_carregamento_id: 2 }
    })
    const { createArquivo } = require('../helpers/fixtures')
    await createArquivo(versao.id, { situacao_carregamento_id: 1, extensao: '.json' })

    expect((await linhas24()).map(l => l[2])).toContain(versao.uuid_versao)
  })
})

describe('RPCMTec: a guarda', () => {
  // O USUÁRIO DA SEMENTE tem consulta no acervo e operador na mapoteca, e
  // GERENTE em nenhum. Ele é o piso: não lê o relatório nem altera subseção
  // alguma. Não existe "perfil de RPCMTec" porque não existe módulo RPCMTec --
  // ele é rota de PLATAFORMA, como usuários --, e o que abre a leitura desde
  // 2026-08-08 é ser gerente de QUALQUER módulo, que este usuário não é.
  const rotas = [
    '/api/rpcmtec',
    '/api/rpcmtec/anos',
    '/api/rpcmtec/anuario?ano=2026&mes=7',
    '/api/rpcmtec/anuario/ods?ano=2026&mes=7',
    '/api/rpcmtec/1/documento',
    '/api/rpcmtec/1/pdf',
    '/api/rpcmtec/1/conferir',
    '/api/rpcmtec/1/anexos'
  ]

  test.each(rotas)('%s recusa quem não é gerente em módulo nenhum', async (rota) => {
    const res = await request(app).get(rota).set('Authorization', generateUserToken())
    expect(res.status).toBe(403)
  })

  test.each(rotas)('%s recusa quem não está logado', async (rota) => {
    const res = await request(app).get(rota)
    expect(res.status).toBe(401)
  })

  const escritas = [
    ['post', '/api/rpcmtec/1/fechar'],
    ['post', '/api/rpcmtec/1/reabrir'],
    // A rota de trazer o mês anterior saiu da lista em 2026-08-06, com a
    // própria rota: sem ela, a guarda testaria um 404 e não um 403.
    //
    // A 7.1 é de MÓDULO NENHUM (equipamento técnico não tem cadastro em módulo
    // algum), então ela é o caso duplo: o usuário da semente para já na primeira
    // guarda, e nem o gerente mais graduado passaria na segunda.
    ['put', '/api/rpcmtec/1/subsecao/7.1'],
    ['delete', '/api/rpcmtec/1/subsecao/7.1'],
    // E a 3.1, que TEM módulo (mapoteca): o usuário da semente é OPERADOR na
    // mapoteca, e operador não é gerente. Sem esta linha, a lista provaria só o
    // caso em que nem o módulo é consultado.
    ['put', '/api/rpcmtec/1/subsecao/3.1'],
    ['delete', '/api/rpcmtec/1/subsecao/3.1']
  ]

  test.each(escritas)('%s %s recusa quem não é gerente', async (metodo, rota) => {
    const res = await request(app)[metodo](rota)
      .set('Authorization', generateUserToken()).send({})
    expect(res.status).toBe(403)
  })
})

// O RECORTE POR MÓDULO contra o BANCO DE VERDADE.
//
// Os cinco casos de cada módulo são de `routes/rpcmtec_guarda.test.js`, com o
// banco dublê, e não se repetem aqui. O que ESTE bloco prova é o que aquele não
// pode provar: que o `SELECT EXISTS` de `verify_modulo_subsecao.js` casa com o
// esquema real -- `dgeo.usuario_perfil`, `modulo_id` e `perfil_id` --, e que uma
// concessão feita AGORA vale na requisição seguinte, sem esperar o token
// expirar. Com o dublê, um nome de coluna errado passaria verde.
describe('RPCMTec: o gerente do módulo escreve a subseção do módulo dele', () => {
  const MODULO_PRODUCAO = 4
  const NIVEL_GERENTE = 3

  const daGerenteEmProducao = () => conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, MODULO_PRODUCAO, NIVEL_GERENTE]
  )

  // A CONCESSÃO SE DESFAZ AQUI, e não pelo `cleanTestData`.
  //
  // Havia um comentário nesta linha afirmando que o `afterEach` devolvia o
  // usuário ao perfil da semente. Ele estava errado: `cleanTestData` apaga
  // `dgeo.usuario_perfil` só de quem está FORA da semente (helpers/db.js), e o
  // usuário de teste está DENTRO. A linha de produção ficava, e vazava para todo
  // arquivo que rodasse depois neste worker.
  //
  // Quem pagou foi `perfil_modulo.test.js`, cujo caso `GET /api/usuarios devolve
  // o perfil por módulo` compara o mapa INTEIRO com `{ acervo: 1, mapoteca: 2 }`
  // e passava a ver um terceiro módulo que nenhum teste dele concedeu. O sintoma
  // aparecia só na suíte cheia, e sumia ao rodar qualquer um dos dois sozinho.
  afterEach(() => conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE modulo_id = $2 AND usuario_id = (
        SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, MODULO_PRODUCAO]
  ))

  test('a 2.3, que é de produção, aceita o gerente de produção', async () => {
    const id = await criarEdicao()
    await daGerenteEmProducao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/2.3`)
      .set('Authorization', generateUserToken())
      .send({ linhas: [['Lote 1', '10', '3', '50%']] })

    expect(res.status).toBe(200)
  })

  test('a 4.2, que é do orçamento, recusa o mesmo gerente', async () => {
    const id = await criarEdicao()
    await daGerenteEmProducao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/4.2`)
      .set('Authorization', generateUserToken())
      .send({ linhas: [] })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/módulo orcamento/i)
  })

  // A LEITURA vem junto: ser gerente de UM módulo abre o relatório INTEIRO,
  // inclusive a seção do orçamento que ele não pode alterar.
  test('o gerente de produção lê o documento inteiro', async () => {
    const id = await criarEdicao()
    await daGerenteEmProducao()

    const res = await request(app)
      .get(`/api/rpcmtec/${id}/documento`)
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(200)
    const numeros = res.body.dados.secoes.flatMap(s => s.subsecoes).map(b => b.numero)
    expect(numeros).toContain('4.2')
  })
})

describe('RPCMTec: a edição mensal', () => {
  test('cria, lê, atualiza e apaga', async () => {
    const id = await criarEdicao({ data_assinatura: '2026-08-01' })

    const lida = await request(app)
      .get(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
    expect(lida.status).toBe(200)
    expect(lida.body.dados).toMatchObject({
      ano: 2026, mes: 7, assinante_uuid: ADMIN_UUID, fechada: false
    })
    // O nome e o posto vêm do CADASTRO, e não de texto redigitado por edição.
    expect(lida.body.dados.assinante_nome).toBeTruthy()

    const atualizada = await request(app)
      .put(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
      .send({ ano: 2026, mes: 7, assinante_uuid: null, data_assinatura: null })
    expect(atualizada.status).toBe(200)

    const apagada = await request(app)
      .delete(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
    expect(apagada.status).toBe(200)

    const sumiu = await request(app)
      .get(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
    expect(sumiu.status).toBe(404)
  })

  test('recusa duas edições do mesmo mês com 409, e não com 500', async () => {
    // Duas edições do mesmo mês seriam duas verdades sobre o mesmo mês, e nada
    // diria qual foi a assinada. Quem barra é a UNIQUE (ano, mes); o que este
    // teste protege é a TRADUÇÃO dela numa mensagem que diz o que houve.
    const corpo = { ano: 2026, mes: 8 }

    const primeira = await request(app)
      .post('/api/rpcmtec').set('Authorization', admin()).send(corpo)
    expect(primeira.status).toBe(201)

    const segunda = await request(app)
      .post('/api/rpcmtec').set('Authorization', admin()).send(corpo)
    expect(segunda.status).toBe(409)
    expect(segunda.body.message).toMatch(/já existe/i)
  })

  test('a listagem aceita filtro por ano, e /anos lista os que existem', async () => {
    await request(app).post('/api/rpcmtec').set('Authorization', admin())
      .send({ ano: 2025, mes: 1 })
    await request(app).post('/api/rpcmtec').set('Authorization', admin())
      .send({ ano: 2026, mes: 1 })

    const todas = await request(app).get('/api/rpcmtec').set('Authorization', admin())
    expect(todas.body.dados).toHaveLength(2)

    const de2026 = await request(app).get('/api/rpcmtec?ano=2026').set('Authorization', admin())
    expect(de2026.body.dados).toHaveLength(1)
    expect(de2026.body.dados[0].ano).toBe(2026)

    const anos = await request(app).get('/api/rpcmtec/anos').set('Authorization', admin())
    expect(anos.body.dados).toEqual([2026, 2025])
  })
})

// ---------------------------------------------------------------------------
// Rastreabilidade da edição mensal
//
// É o relatório que o chefe assina, e as três escritas dele não tinham nem
// transação: o `exigirExistente` era um `SELECT id` numa conexão e o DELETE
// noutra. "Quem trocou o assinante desta edição" é pergunta que se faz depois
// de o documento ter saído, e até aqui não havia onde respondê-la.
// ---------------------------------------------------------------------------

describe('RPCMTec: o rastro da edição mensal', () => {
  const eventos = id =>
    conn.any(
      `SELECT * FROM auditoria.evento
       WHERE tabela = 'rpcmtec.edicao' AND entidade_id = $<id>
       ORDER BY id`,
      { id: String(id) }
    )

  test('a criação registra o autor e o que foi gravado', async () => {
    const id = await criarEdicao()

    const [criacao] = await eventos(id)

    expect(criacao.operacao).toBe('I')
    expect(criacao.modulo).toBe('plataforma')
    expect(criacao.entidade).toBe('edicao')
    expect(criacao.usuario_uuid).toBe(ADMIN_UUID)
    expect(criacao.dados_antes).toBeNull()
    expect(criacao.dados_depois.assinante_uuid).toBe(ADMIN_UUID)
  })

  test('a troca do assinante registra os DOIS lados', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .put(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
      .send({ ano: 2026, mes: 7, assinante_uuid: null, data_assinatura: null })
    expect(res.status).toBe(200)

    const alteracao = (await eventos(id)).find(e => e.operacao === 'U')

    // O `lerAntes` no lugar do `SELECT id`: sem ele o rastro diria que a edição
    // mudou, sem dizer de quem para quem.
    expect(alteracao.dados_antes.assinante_uuid).toBe(ADMIN_UUID)
    expect(alteracao.dados_depois.assinante_uuid).toBeNull()
    expect(alteracao.campos_alterados).toContain('assinante_uuid')
  })

  test('o fechamento e a reabertura deixam rastro', async () => {
    // Congelar e descongelar o documento que o chefe assina são os dois atos
    // mais consequentes da tela, e "quem reabriu a edição de julho" é pergunta
    // que se faz depois.
    const id = await criarEdicao()
    await preencherTudo(id)

    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())
      .send({ ciente_revisao: true })
    await request(app).post(`/api/rpcmtec/${id}/reabrir`).set('Authorization', admin())

    const alteracoes = (await eventos(id)).filter(e => e.operacao === 'U')
    expect(alteracoes).toHaveLength(2)

    const [fechamento, reabertura] = alteracoes
    expect(fechamento.dados_antes.data_fechamento).toBeNull()
    expect(fechamento.dados_depois.data_fechamento).not.toBeNull()
    expect(reabertura.dados_depois.data_fechamento).toBeNull()
    expect(reabertura.usuario_uuid).toBe(ADMIN_UUID)
  })

  test('a gravação de subseção deixa rastro do que mudou', async () => {
    const id = await criarEdicao()

    await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/8.4`)
      .set('Authorization', admin())
      .send({ linhas: [['Matéria', 'https://exemplo']] })
    await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/8.4`)
      .set('Authorization', admin())
      .send({ linhas: [['Outra matéria', 'https://exemplo']] })

    const rastro = await conn.any(
      "SELECT * FROM auditoria.evento WHERE tabela = 'rpcmtec.subsecao' ORDER BY id"
    )
    expect(rastro).toHaveLength(2)
    expect(rastro[0].operacao).toBe('I')
    expect(rastro[1].operacao).toBe('U')
    expect(rastro[1].dados_antes.linhas[0][0]).toBe('Matéria')
    expect(rastro[1].dados_depois.linhas[0][0]).toBe('Outra matéria')
  })

  test('a exclusão registra o que se perdeu, e sobrevive à edição', async () => {
    const id = await criarEdicao()

    expect(
      (await request(app).delete(`/api/rpcmtec/${id}`).set('Authorization', admin())).status
    ).toBe(200)

    const exclusao = (await eventos(id)).find(e => e.operacao === 'D')

    expect(exclusao.dados_depois).toBeNull()
    expect(exclusao.dados_antes.mes).toBe(7)
    expect(exclusao.usuario_uuid).toBe(ADMIN_UUID)
  })

  test('a edição recusada pela UNIQUE não deixa rastro', async () => {
    const id = await criarEdicao({ mes: 9 })

    const segunda = await request(app)
      .post('/api/rpcmtec').set('Authorization', admin()).send({ ano: 2026, mes: 9 })
    expect(segunda.status).toBe(409)

    // Falhar ao escrever tem de derrubar o rastro junto: uma trilha que registra
    // o que não aconteceu é pior do que trilha nenhuma, porque quem a lê
    // acredita nela. A da primeira edição continua de pé.
    const todos = await conn.any(
      "SELECT * FROM auditoria.evento WHERE tabela = 'rpcmtec.edicao'"
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].entidade_id).toBe(String(id))
  })
})
