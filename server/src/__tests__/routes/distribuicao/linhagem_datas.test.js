'use strict'

// A LINHAGEM DO PACOTE SAI EM PORTUGUÊS DO BRASIL, E NÃO NO LOCALE DO PROCESSO.
//
// `getInfoLinhagem` formata as duas datas que o operador lê no QGIS com
// `toLocaleString`. Sem argumento, o Node usa o locale do PROCESSO, e num
// serviço sob PM2 ou systemd com `LANG` não definido -- o caso comum num
// servidor Linux -- ele cai em `en-US`: a atividade concluída em 1 de agosto de
// 2026 chega ao plugin como "8/1/2026, 5:00:00 PM". O revisor que abre a folha
// lê "8/1" e entende 8 de janeiro. É a mesma armadilha que o `CLAUDE.md`
// descreve para `Joi.date()` sem `.iso()`, agora na SAÍDA -- e a interface
// passaria a falar inglês, contra a regra de que toda string de interface é em
// português do Brasil.
//
// O FUSO É FIXADO NO ARQUIVO INTEIRO, e antes de qualquer `Date` existir: o que
// se mede aqui é a FORMA da data, e uma máquina em UTC+13 viraria o dia e faria
// o caso passar ou falhar por motivo que não é o defeito.
process.env.TZ = 'America/Sao_Paulo'

const { db } = require('../../../database')

const ctrl = require('../../../distribuicao/distribuicao_ctrl')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'

// 1 de agosto de 2026, meio-dia UTC. A data é escolhida para que o dia (01) e o
// mês (08) sejam DIFERENTES entre si: com 08/08 nenhum locale se distinguiria do
// outro, e o caso não provaria nada.
const INICIO = new Date('2026-08-01T12:00:00Z')
const FIM = new Date('2026-08-01T20:00:00Z')

// A linha que `retornaDadosProducao` devolve, com o mínimo que `dadosProducao`
// lê. `tipo_fase_id` NÃO é a Edição (code 2), para o metadado por folha ficar
// de fora: ele não tem nada a ver com o que este arquivo mede.
const DADOS_UT = {
  usuario_uuid: UUID,
  login: 'fulano',
  nome_guerra: 'Fulano',
  epsg: '31982',
  projeto: 'Projeto',
  lote: 'Lote 1',
  bloco: 'Bloco A',
  subtipo_produto: 'Carta Topográfica',
  dificuldade: 1,
  tempo_estimado_minutos: 60,
  observacao_atividade: null,
  observacao_unidade_trabalho: null,
  unidade_trabalho_geom: null,
  unidade_trabalho_id: 13,
  ut_id: 13,
  lote_id: 5,
  linha_producao_id: 2,
  fase_id: 3,
  tipo_fase_id: 1,
  subfase_id: 4,
  subfase_nome: 'Edição',
  etapa_id: 11,
  etapa_nome: 'Execução',
  tipo_etapa_id: 1,
  configuracao_producao: 'servidor_de_teste:5432/banco_de_teste',
  tipo_dado_producao_id: 1
}

const ehLinhagem = texto => texto.includes('st_relate(ut.geom, ut_ref.geom')

const fabricarBanco = () => {
  const conn = {
    any: async query => {
      if (ehLinhagem(String(query))) {
        return [
          {
            data_inicio: INICIO,
            data_fim: FIM,
            fase: 'Edição',
            subfase: 'Edição',
            lote_id: 5,
            etapa: 'Execução',
            situacao: 'Finalizada'
          }
        ]
      }
      return []
    },
    one: async () => ({}),
    oneOrNone: async query => {
      // O perfil de linhagem ausente é o caso normal: sem ele, o nome de quem
      // executou não sai, e as colunas de data são as mesmas.
      if (String(query).includes('producao.perfil_linhagem')) return null
      return { ...DADOS_UT }
    },
    none: async () => null
  }

  conn.tx = async cb => cb(conn)
  conn.task = async cb => cb(conn)

  return conn
}

let original

beforeEach(() => {
  original = db.conn
  db.conn = fabricarBanco()
})

afterEach(() => {
  db.conn = original
})

const linhagem = async () => {
  const dados = await ctrl.getDadosAtividade(7, null, null)
  return dados.atividade.linhagem
}

describe('as datas da linhagem', () => {
  it('saem no dia/mês/ano do Brasil, e não no mês/dia do inglês', async () => {
    const [linha] = await linhagem()

    expect(linha.data_inicio).toMatch(/^01\/08\/2026/)
    expect(linha.data_fim).toMatch(/^01\/08\/2026/)
    // Controle negativo do que sairia sob `LANG` não definido.
    expect(linha.data_inicio).not.toMatch(/^8\/1\/2026/)
  })

  it('e a hora não fala inglês', async () => {
    const [linha] = await linhagem()

    expect(linha.data_inicio).not.toMatch(/AM|PM/)
    // 12h UTC são 09h em America/Sao_Paulo, e o relógio é de 24 horas.
    expect(linha.data_inicio).toContain('09:00:00')
  })

  // A DATA NULA CONTINUA NULA. A atividade pausada tem `data_fim` vazia, e
  // `new Date(null)` daria 01/01/1970 -- uma data inventada é pior que campo
  // vazio no pacote que o operador abre.
  it('a data ausente não vira 1970', async () => {
    const conn = fabricarBanco()
    const anyOriginal = conn.any
    conn.any = async (query, values) => {
      const linhas = await anyOriginal(query, values)
      if (linhas.length > 0 && 'data_fim' in linhas[0]) linhas[0].data_fim = null
      return linhas
    }
    db.conn = conn

    const [linha] = await linhagem()

    expect(linha.data_fim).toBeNull()
    expect(linha.data_inicio).toMatch(/^01\/08\/2026/)
  })
})

// O CONTROLE QUE NÃO DEPENDE DA MÁQUINA. Os casos acima só ficam vermelhos numa
// máquina cujo locale de processo NÃO seja o brasileiro -- que é justamente o
// servidor sob PM2 com `LANG` não definido, e não a máquina de quem desenvolve.
// Este último lê o FONTE e cobra o argumento, que é o defeito em si.
describe('o locale é escrito, e não herdado', () => {
  it('nenhum toLocaleString do módulo sai sem locale', () => {
    const fs = require('fs')
    const path = require('path')

    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'distribuicao', 'distribuicao_ctrl.js'),
      'utf8'
    )

    expect(fonte).toContain("toLocaleString('pt-BR')")

    // AS LINHAS DE COMENTÁRIO SAEM ANTES: o comentário do próprio conserto cita
    // a chamada sem argumento para explicar o defeito, e casar nele deixaria
    // este caso vermelho por causa da prosa que documenta a correção.
    const codigo = fonte
      .split(/\r?\n/)
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')

    // Chamada sem argumento nenhum: é ela que herda o locale do processo.
    expect(codigo).not.toMatch(/toLocaleString\(\s*\)/)
  })
})
