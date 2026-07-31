'use strict'

// Teste unitario do Anuario Estatistico (Tabela 5.4.9), com o banco mockado.
//
// O que este arquivo protege NAO e a query, e a CLASSIFICACAO: cada entrega cai
// numa linha (a escala, ou um balde) e numa coluna (a natureza de quem
// recebeu). Errar essa matriz produz um relatorio plausivel e falso, que sobe
// para a DSG sem ninguem perceber, porque os totais continuam somando.
//
// A distincao mais delicada e entre a celula VAZIA e o ZERO. Vazia quer dizer
// "o SCA nao tem essa fonte" (RM, EE do Exercito, Downloads BDGEx). Zero quer
// dizer "nao houve entrega". Um `?? 0` em qualquer ponto da cadeia apagaria a
// diferenca, e o rodape do arquivo passaria a declarar uma lacuna que a tabela
// nao mostra mais.

const mockDb = {
  conn: {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn(),
    tx: jest.fn()
  }
}

jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const anuarioCtrl = require('../../mapoteca/anuario_ctrl')

// Os codigos vem de mapoteca.tipo_cliente / dominio.tipo_produto (er/).
const OM_EB = 1
const OM_MARINHA = 3
const ORGAO_MUNICIPAL = 6
const LAI = 9
const ORTOIMAGEM = 4
const CARTA_TOPOGRAFICA = 2

// A primeira chamada de db.conn.any e a dos itens; a segunda, a das imagens.
const comBanco = (itens, imagens = []) => {
  mockDb.conn.any.mockReset()
  mockDb.conn.any.mockResolvedValueOnce(itens).mockResolvedValueOnce(imagens)
}

const linha = (bloco, rotulo) => bloco.find(l => l.rotulo === rotulo)

describe('anuario_ctrl', () => {
  describe('classificacao por linha', () => {
    it('a carta cai na linha da sua escala', async () => {
      comBanco([
        { digital: false, denominador: 50000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: OM_EB, quantidade: 14 },
        { digital: false, denominador: 25000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: OM_EB, quantidade: 88 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.convencional, 'Escala 1:50 000').exercito).toBe(14)
      expect(linha(a.convencional, 'Escala 1:25 000').exercito).toBe(88)
      expect(a.total_convencional.exercito).toBe(102)
    })

    it('escala fora da lista cai em Produtos Diversos, e nunca some', async () => {
      // 1:700.000 nao e linha da tabela. Descartar a entrega calada seria pior
      // que classifica-la mal: o total deixaria de bater com a mapoteca.
      comBanco([
        { digital: false, denominador: 700000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: OM_EB, quantidade: 2 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.convencional, 'Produtos Diversos').exercito).toBe(2)
      expect(a.total_convencional.exercito).toBe(2)
    })

    it('item avulso (sem produto no acervo, logo sem escala) cai em Produtos Diversos', async () => {
      comBanco([
        { digital: false, denominador: null, tipo_produto_id: null, tipo_cliente_id: OM_EB, quantidade: 200 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.convencional, 'Produtos Diversos').exercito).toBe(200)
    })

    it('a Ortoimagem sem escala vai para Imagem de Satelite, nao para Diversos', async () => {
      comBanco([
        { digital: false, denominador: null, tipo_produto_id: ORTOIMAGEM, tipo_cliente_id: OM_EB, quantidade: 3 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.convencional, 'Imagem de Satélite').exercito).toBe(3)
      expect(linha(a.convencional, 'Produtos Diversos').exercito).toBe(0)
    })
  })

  describe('classificacao por coluna', () => {
    it('separa Exercito, Outras Forcas, Orgao Publico e Prof. Autonomo', async () => {
      comBanco([
        { digital: false, denominador: 50000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: OM_EB, quantidade: 10 },
        { digital: false, denominador: 50000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: OM_MARINHA, quantidade: 4 },
        { digital: false, denominador: 50000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: ORGAO_MUNICIPAL, quantidade: 2 },
        { digital: false, denominador: 50000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: LAI, quantidade: 1 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })
      const l = linha(a.convencional, 'Escala 1:50 000')

      expect(l.exercito).toBe(10)
      expect(l.outras_forcas).toBe(4)
      expect(l.orgao_publico).toBe(2)
      // O cidadao da LAI e atendido como pessoa, e e assim que a tabela de
      // junho de 2026 o contou.
      expect(l.prof_autonomo).toBe(1)
    })
  })

  describe('convencional x digital', () => {
    it('o item digital nao entra no bloco convencional', async () => {
      comBanco([
        { digital: true, denominador: 25000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: LAI, quantidade: 4 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.digital, 'Escala 1:25 000').prof_autonomo).toBe(4)
      expect(a.total_convencional.prof_autonomo).toBe(0)
      expect(a.total_digital.prof_autonomo).toBe(4)
    })

    it('a foto aerea da LAI, contada no pedido, entra no bloco digital', async () => {
      // Ela nao vira item de acervo: vem de mapoteca.pedido.qtd_imagens.
      comBanco([], [{ tipo_cliente_id: LAI, quantidade: 7 }])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.digital, 'Imagem de Satélite / Fotografia aérea').prof_autonomo).toBe(7)
      expect(a.total_digital.prof_autonomo).toBe(7)
      expect(a.total_convencional.prof_autonomo).toBe(0)
    })
  })

  describe('vazio nao e zero', () => {
    it('RM e EE do Exercito saem NULOS, porque o SCA nao os distingue', async () => {
      comBanco([
        { digital: false, denominador: 50000, tipo_produto_id: CARTA_TOPOGRAFICA, tipo_cliente_id: OM_EB, quantidade: 10 }
      ])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(linha(a.convencional, 'Escala 1:50 000').rm).toBeNull()
      expect(linha(a.convencional, 'Escala 1:50 000').ee_exercito).toBeNull()
      expect(a.total_convencional.rm).toBeNull()
    })

    it('linha sem fonte no acervo sai NULA em todas as colunas', async () => {
      comBanco([])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      for (const rotulo of ['Carta de orientação', 'Mapa Índice', 'Mosaico']) {
        expect(linha(a.convencional, rotulo).exercito).toBeNull()
      }
      expect(linha(a.digital, 'Downloads BDGEx').exercito).toBeNull()
      expect(linha(a.digital, 'Ortofocarta').exercito).toBeNull()
      // E a que TEM fonte sai zero, e nao nulo: nao houve entrega.
      expect(linha(a.convencional, 'Escala 1:50 000').exercito).toBe(0)
    })

    it('declara as lacunas junto do numero', async () => {
      comBanco([])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })

      expect(a.lacunas).toHaveLength(3)
      expect(a.lacunas.join(' ')).toContain('RM e EE do Exército')
    })
  })

  describe('paraPlanilha', () => {
    it('abre cada bloco com o total dele, como no arquivo que sobe para a DSG', async () => {
      comBanco([])
      const a = await anuarioCtrl.getAnuarioEstatistico({ ano: 2026, mes: 6 })
      const linhas = anuarioCtrl.paraPlanilha(a)

      expect(linhas[0].rotulo).toBe('Total (Convencional)')
      expect(linhas[1].rotulo).toBe('Escala 1:1 000 000')
      expect(linhas[a.convencional.length + 1].rotulo).toBe('Total (Digital)')
      expect(linhas).toHaveLength(a.convencional.length + a.digital.length + 2)
    })
  })
})
