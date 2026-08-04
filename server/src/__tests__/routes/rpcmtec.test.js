'use strict'

// O RPCMTec de ponta a ponta, contra o banco de teste.
//
// O que este arquivo protege:
//
//  1. A GUARDA. O relatório cruza os três módulos e traz valor de crédito, de
//     empenho e de liquidação. Ele é admin-only, e já houve no repositório o
//     caso oposto -- uma rota fechada por engano numa classificação automática.
//     Aqui o risco é o inverso: alguém trocar `verifyAdmin` por um
//     `verifyPerfil('consulta', 'acervo')` e entregar o orçamento a quem só
//     cataloga carta.
//
//  2. A ESTRUTURA. São 34 blocos em nove seções, na numeração do documento da
//     Divisão. Uma subseção que muda de número, ou some, quebra o documento sem
//     dar erro nenhum.
//
//  3. A DIVISÃO ENTRE CALCULADO E DIGITADO. Dezoito subseções saem do banco e
//     quinze o gestor preenche. Uma calculada que vire digitada por descuido
//     faria alguém redigitar todo mês um número que o sistema tem.
//
//  4. O CICLO DE FECHAMENTO, que é o coração do desenho de 2026-08-05: aberta o
//     calculado recalcula, fechada tudo congela, e o congelado não muda quando o
//     banco mudar. Com a conferência mostrando a diferença, para congelar não
//     virar esquecer.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, ADMIN_UUID } = require('../helpers/auth')
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
// julho/2026. São 34 blocos: 30 tabelas mais a 1.1 e as três da seção 9.
const SUBSECOES_CALCULADAS = [
  '2.1', '2.6', '2.7',
  '3.1', '3.2', '3.3', '3.4',
  '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7',
  '6.1', '6.2',
  '7.2', '7.3'
]

// As que o gestor digita. Onze vêm de outro sistema ou de fora (2.2 a 2.5 do
// SAP, 5.1 do painel do GitHub, 8.3 do doc_dgeo) e quatro não têm cadastro em
// lugar nenhum. Decisão do chefe em 2026-08-05: nada sai do SAP por enquanto, e
// o que o SCA não calcula o gestor preenche na própria tela.
const SUBSECOES_DIGITADAS = [
  '2.2', '2.3', '2.4', '2.5',
  '5.1', '5.2',
  '7.1',
  '8.1', '8.2', '8.3', '8.4', '8.5',
  '9.1', '9.2', '9.3'
]

describe('RPCMTec: a estrutura do documento', () => {
  test('são 34 blocos em nove seções, na numeração do documento', async () => {
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

    expect(blocos(doc)).toHaveLength(34)
    expect(blocos(doc).filter(b => b.cabecalhos)).toHaveLength(30)
  })

  test('dezoito subseções são calculadas e quinze são digitadas', async () => {
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

describe('RPCMTec: copiar do mês anterior', () => {
  test('traz o digitado do mês passado sem sobrescrever o já preenchido', async () => {
    // A edição de julho/2026 traz um GPS indisponível desde 26/07/2023,
    // redigitado mês a mês. É o trabalho que esta ação apaga.
    const junho = await criarEdicao({ mes: 6 })
    await request(app)
      .put(`/api/rpcmtec/${junho}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({ linhas: [['GPS de Navegação', '26/07/2023', 'Conector serial', '-']] })
    await request(app)
      .put(`/api/rpcmtec/${junho}/subsecao/5.2`)
      .set('Authorization', admin())
      .send({ linhas: [['PostgreSQL', '30/06/2026', '120', '400']] })

    const julho = await criarEdicao({ mes: 7 })
    // A 5.2 de julho já foi preenchida à mão: a cópia não pode passar por cima.
    await request(app)
      .put(`/api/rpcmtec/${julho}/subsecao/5.2`)
      .set('Authorization', admin())
      .send({ linhas: [['PostgreSQL', '31/07/2026', '131', '389']] })

    const res = await request(app)
      .post(`/api/rpcmtec/${julho}/copiar-mes-anterior`)
      .set('Authorization', admin())
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.dados.de).toBe('06/2026')
    expect(res.body.dados.copiadas).toContain('7.1')
    expect(res.body.dados.copiadas).not.toContain('5.2')
    expect(res.body.dados.preservadas).toContain('5.2')

    const doc = await documento(julho)
    expect(blocos(doc).find(b => b.numero === '7.1').linhas)
      .toEqual([['GPS de Navegação', '26/07/2023', 'Conector serial', '-']])
    // A preenchida à mão continua como estava.
    expect(blocos(doc).find(b => b.numero === '5.2').linhas[0][1]).toBe('31/07/2026')
  })

  test('sem edição no mês anterior, responde 404 com o mês que faltou', async () => {
    const id = await criarEdicao({ mes: 7 })

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/copiar-mes-anterior`)
      .set('Authorization', admin())
      .send({})

    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/06\/2026/)
  })
})

describe('RPCMTec: fechar, congelar e conferir', () => {
  test('recusa fechar com subseção nunca visitada, e diz quais faltam', async () => {
    const id = await criarEdicao()

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())

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

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/assinante/i)
  })

  test('fechar congela os 34 blocos, e o congelado não muda quando o banco muda', async () => {
    const id = await criarEdicao()
    await preencherTudo(id)

    const antes = blocos(await documento(id)).find(b => b.numero === '4.1')

    const fechada = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
    expect(fechada.status).toBe(200)
    expect(fechada.body.dados.subsecoes).toBe(34)

    const gravadas = await conn.any(
      'SELECT numero FROM rpcmtec.subsecao WHERE edicao_id = $1 ORDER BY ordem', [id]
    )
    expect(gravadas).toHaveLength(34)

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
    // redigitar as quinze subseções que são dele.
    const id = await criarEdicao()
    await preencherTudo(id)
    await request(app)
      .put(`/api/rpcmtec/${id}/subsecao/7.1`)
      .set('Authorization', admin())
      .send({ linhas: [['GPS', '26/07/2023', 'Conector', '-']] })
    await request(app).post(`/api/rpcmtec/${id}/fechar`).set('Authorization', admin())

    const res = await request(app)
      .post(`/api/rpcmtec/${id}/reabrir`)
      .set('Authorization', admin())
    expect(res.status).toBe(200)

    const restantes = await conn.any(
      'SELECT numero, origem_id FROM rpcmtec.subsecao WHERE edicao_id = $1', [id]
    )
    // Só as digitadas sobrevivem, e são as 15.
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
    // O sistema é quem emite o documento agora: aceitar .docx reabriria a porta
    // que a decisão de 2026-08-05 fechou.
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

describe('RPCMTec: a guarda', () => {
  // O relatório traz valor de crédito, de empenho e de liquidação dos três
  // módulos. Não existe "perfil de RPCMTec" porque não existe módulo RPCMTec:
  // ele é rota de PLATAFORMA, como usuários. Quem o gera administra o sistema.
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

  test.each(rotas)('%s recusa quem não é administrador', async (rota) => {
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
    ['post', '/api/rpcmtec/1/copiar-mes-anterior'],
    ['put', '/api/rpcmtec/1/subsecao/7.1'],
    ['delete', '/api/rpcmtec/1/subsecao/7.1']
  ]

  test.each(escritas)('%s %s recusa quem não é administrador', async (metodo, rota) => {
    const res = await request(app)[metodo](rota)
      .set('Authorization', generateUserToken()).send({})
    expect(res.status).toBe(403)
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
// Rastreabilidade da edição mensal (2026-08-02)
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
