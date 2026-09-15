'use strict'

// A GUARDA DAS DUAS CAPACITAÇÕES, depois da régua de 2026-08-08.
//
// O QUE MUDOU. O molde `rotasDeCapacitacao` recebia UMA guarda e a repetia nas
// seis rotas do tipo, o que amarrava ler e escrever ao mesmo nível: quem pudesse
// LISTAR os cursos podia também APAGÁ-LOS, e quem não pudesse apagar não podia
// nem olhar. O molde passou a receber DUAS, e a régua dos módulos entra
// aqui inteira: CONSULTA lê, OPERADOR lança.
//
//   MINISTRADA (2.6)  serviço que a Divisão PRESTA. Módulo PRODUÇÃO.
//   RECEBIDA   (6.2)  gente nossa EM CURSO. Módulo EFETIVO.
//
// A TABELA CONTINUA UMA (`rpcmtec.capacitacao`), e só o CAMINHO separa os dois
// tipos. Por isso a guarda de cada lado tem de ser provada de fora: uma troca de
// argumento no molde passaria despercebida, e um dos dois lados ficaria com a
// permissão do outro.
//
// POR QUE ESTE ARQUIVO NÃO MOCKA O LOGIN: quem decide é o `verifyPerfil`, e ele
// lê o perfil do BANCO a cada requisição, e não do token. Aqui o JWT é assinado
// e validado de verdade, e só o banco é dublê.
//
// O RECORTE POR TIPO (o operador de Efetivo não apaga uma ministrada mandando o
// id dela para o caminho da recebida) NÃO se prova aqui: ele é do CONTROLADOR, e
// quem o prova é `pit_efetivo_permissao.test.js`, contra o banco.

const jwt = require('jsonwebtoken')
const request = require('supertest')

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const { buildTestApp } = require('../helpers/orcamento/testApp')
const { JWT_SECRET } = require('../../config')
const { rpcmtecRoute } = require('../../rpcmtec')

const UUID = '11111111-1111-1111-1111-111111111111'

const PERFIL = { consulta: 1, operador: 2, gerente: 3 }

const app = buildTestApp([{ path: '/rpcmtec', router: rpcmtecRoute }])

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID }, JWT_SECRET, { expiresIn: '1h' })

const quemEntra = ({ administrador = false, perfil = null } = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({
    id: 1,
    administrador,
    perfil_id: perfil
  })
}

// Os dois tipos, com o módulo de cada um. Os casos abaixo percorrem os dois: um
// teste que só olhasse a ministrada deixaria a recebida livre para herdar a
// guarda errada do molde.
const TIPOS = [
  ['ministrada', 'pit'],
  ['recebida', 'efetivo']
]

// AS ROTAS DE CADA LADO, e a mídia entrou nas duas em 2026-09-15.
//
// A FOTO SEGUE A REGUA DA CAPACITACAO DONA, e e por isso que ela entra nesta
// varredura em vez de ter uma propria: VER a foto da instrucao e leitura
// (consulta), e enviar, renomear e remover e lancamento (operador). O par de
// rotas mora DENTRO do molde `rotasDeCapacitacao` justamente para herdar as duas
// guardas; um par escrito fora dele ficaria com a permissao de um dos dois tipos
// para os dois, e nada acusaria.
const LEITURAS = ['', '/anos', '/1', '/1/imagem', '/imagem/1/arquivo']
const ESCRITAS = [
  ['post', ''],
  ['put', '/1'],
  ['delete', '/1'],
  ['post', '/1/imagem'],
  ['put', '/imagem/1'],
  ['delete', '/imagem/1']
]

beforeEach(() => mockDb.reset())

describe.each(TIPOS)('Capacitação %s (módulo %s)', (caminho, modulo) => {
  const base = `/rpcmtec/capacitacao/${caminho}`

  describe('LER é de consulta', () => {
    test.each(LEITURAS)(`GET ${base}%s aceita quem tem consulta`, async (sufixo) => {
      quemEntra({ administrador: false, perfil: PERFIL.consulta })
      // `/:id` chama `getPorId`, e as duas de mídia leem a capacitação dona: as
      // três devolvem 404 quando o dublê não acha nada. O que se prova aqui é a
      // AUTORIZAÇÃO, então basta não ter sido 403.
      mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, nome: 'Curso' })

      const res = await request(app).get(base + sufixo).set('Authorization', token())

      expect(res.status).not.toBe(403)
    })

    test.each(LEITURAS)(
      `GET ${base}%s recusa quem não tem linha no módulo`,
      async (sufixo) => {
        quemEntra({ administrador: false, perfil: null })

        const res = await request(app).get(base + sufixo).set('Authorization', token())

        expect(res.status).toBe(403)
        // A mensagem NOMEIA o nível e o módulo: é o que impede o molde de ter
        // trocado os dois tipos de guarda sem ninguém ver.
        expect(res.body.message).toMatch(
          new RegExp(`perfil consulta no módulo ${modulo}`, 'i')
        )
      }
    )
  })

  // O CONTROLE que impede a leitura afrouxada de ter afrouxado a escrita junto.
  // Sem ele, um molde que usasse `leitura` nas seis rotas passaria em tudo acima.
  describe('ESCREVER continua sendo de operador', () => {
    test.each(ESCRITAS)(
      `%s ${base}%s recusa quem só tem consulta`,
      async (metodo, sufixo) => {
        quemEntra({ administrador: false, perfil: PERFIL.consulta })

        const res = await request(app)[metodo](base + sufixo)
          .set('Authorization', token())

        expect(res.status).toBe(403)
        expect(res.body.message).toMatch(
          new RegExp(`perfil operador no módulo ${modulo}`, 'i')
        )
      }
    )

    test.each(ESCRITAS)(
      `%s ${base}%s aceita o operador`,
      async (metodo, sufixo) => {
        quemEntra({ administrador: false, perfil: PERFIL.operador })

        // Corpo vazio: a guarda roda ANTES do `schemaValidation`, então "não foi
        // 403" já diz que ela deixou passar.
        const res = await request(app)[metodo](base + sufixo)
          .set('Authorization', token())

        expect(res.status).not.toBe(403)
      }
    )
  })

  it('a leitura não chega ao banco quando a guarda recusa', async () => {
    quemEntra({ administrador: false, perfil: null })

    const res = await request(app).get(base).set('Authorization', token())

    expect(res.status).toBe(403)
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })
})
