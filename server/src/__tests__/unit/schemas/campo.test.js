'use strict'

// O CONTRATO DO SCHEMA DE CAMPO.
//
// Todo caso de recusa prova o MOTIVO (`recusaPor`), e não só que houve recusa:
// um caso que só exige `error` definido continua verde depois de a regra sumir,
// desde que a fixtura falhe por qualquer outra coisa.

const campoSchema = require('../../../campo/campo_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const poligono = (anel) => JSON.stringify({ type: 'Polygon', coordinates: [anel] })

const QUADRADO = [[-53, -29], [-52, -29], [-52, -28], [-53, -28], [-53, -29]]

const VALIDO = {
  nome: 'Reambulação (EBGeo) Santiago 2026',
  descricao: null,
  ano: 2026,
  situacao_id: 3,
  data_inicio: '2026-07-28',
  data_fim: '2026-08-03',
  placas_vtr: 'EB-1234',
  militares_externos: null,
  categorias: [1, 5],
  militares: [],
  versoes: [],
  geometria: poligono(QUADRADO)
}

describe('campo: o corpo do cadastro', () => {
  it('aceita o caso completo', () => {
    const valor = aceita(campoSchema.campo.validate(VALIDO))
    expect(valor.nome).toBe('Reambulação (EBGeo) Santiago 2026')
  })

  it('exige o nome', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, nome: undefined }),
      'nome', 'any.required'
    )
  })

  it('exige o ano, que é o exercício do PIT', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, ano: undefined }),
      'ano', 'any.required'
    )
  })

  // AS DUAS DATAS SÃO OBRIGATÓRIAS, e não é rigor: nos 54 campos do dump do SAP
  // não há uma linha sem elas, e as colunas nasceram NOT NULL por causa disso.
  it('exige as duas datas', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, data_inicio: undefined }),
      'data_inicio', 'any.required'
    )
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, data_fim: undefined }),
      'data_fim', 'any.required'
    )
  })

  // O BANCO TEM O MESMO CHECK (`campo_fim_apos_inicio`). O Joi cobra ANTES
  // porque a mensagem dele diz o campo; a do banco cita o nome da restrição, que
  // não ajuda quem acabou de digitar.
  it('recusa o término antes do início, e a mensagem diz qual campo', () => {
    const { error } = campoSchema.campo.validate({
      ...VALIDO, data_inicio: '2026-08-03', data_fim: '2026-07-28'
    })
    expect(error).toBeDefined()
    expect(error.message).toMatch(/data_fim precisa ser igual ou posterior/)
  })

  // `.raw()` NÃO É PREFERÊNCIA. Sem ele o Joi devolve um Date e a coluna DATE
  // guarda o DIA ANTERIOR em UTC-3, e o campo de 1º de agosto vira 31 de julho
  // no banco sem nada acusar. O que este caso prende é o TIPO do valor que sai.
  it('a data sai como STRING, e não como Date', () => {
    const valor = aceita(campoSchema.campo.validate(VALIDO))
    expect(typeof valor.data_inicio).toBe('string')
    expect(valor.data_inicio).toBe('2026-07-28')
  })

  // Sem o `.iso()`, '01/08/2026' vira 8 de janeiro.
  it('recusa data fora do formato ISO', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, data_inicio: '01/08/2026' }),
      'data_inicio', 'date.format'
    )
  })
})

describe('campo: a finalidade', () => {
  // CAMPO SEM FINALIDADE não tem o que escrever na coluna "Finalidade Campo" da
  // subseção 2.5, e a subseção sairia com célula vazia.
  it('exige ao menos uma categoria', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, categorias: [] }),
      'categorias', 'array.min'
    )
  })

  it('recusa categoria repetida', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, categorias: [1, 1] }),
      ['categorias', 1], 'array.unique'
    )
  })
})

describe('campo: militares e versões', () => {
  // A LISTA VAZIA É VÁLIDA nas duas, e não é descuido. Um campo pode ser todo de
  // gente de fora (e aí o efetivo vive em `militares_externos`), e viagem
  // internacional não gera produto a apontar -- no dump do SAP, 3 campos de 54
  // tinham vínculo com produto.
  it('aceita as duas listas vazias, e elas têm default', () => {
    const valor = aceita(campoSchema.campo.validate({
      ...VALIDO, militares: undefined, versoes: undefined
    }))
    expect(valor.militares).toEqual([])
    expect(valor.versoes).toEqual([])
  })

  it('o militar é uuid', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, militares: ['nao-e-uuid'] }),
      ['militares', 0], 'string.guid'
    )
  })

  it('recusa militar repetido', () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, militares: [uuid, uuid] }),
      ['militares', 1], 'array.unique'
    )
  })
})

describe('campo: a geometria', () => {
  it('exige a geometria', () => {
    recusaPor(
      campoSchema.campo.validate({ ...VALIDO, geometria: undefined }),
      'geometria', 'any.required'
    )
  })

  // NORMALIZA PARA MultiPolygon, sempre. A coluna é MULTIPOLYGON, e obrigar quem
  // importa a embrulhar o polígono seria pedir a ele um detalhe que é do banco.
  it('o Polygon vira MultiPolygon', () => {
    const valor = aceita(campoSchema.campo.validate(VALIDO))
    const geo = JSON.parse(valor.geometria)
    expect(geo.type).toBe('MultiPolygon')
    expect(geo.coordinates).toEqual([[QUADRADO]])
  })

  it('o MultiPolygon de UMA parte passa como está', () => {
    const multi = JSON.stringify({ type: 'MultiPolygon', coordinates: [[QUADRADO]] })
    const valor = aceita(campoSchema.campo.validate({ ...VALIDO, geometria: multi }))
    expect(JSON.parse(valor.geometria).type).toBe('MultiPolygon')
  })

  // UM POLÍGONO SÓ, e é decisão do chefe de 2026-08-09, MEDIDA antes de tomada:
  // dos 47 polígonos do dump de produção do SAP, os 47 têm UMA parte
  // (`ST_NumGeometries` = 1) e nenhum tem buraco. A coluna continua MULTIPOLYGON
  // e o estreitamento é aqui, na porta: um GeoJSON com duas partes por engano
  // entraria calado, e a área do campo passaria a ser outra.
  it('recusa MultiPolygon de DUAS partes, e a mensagem diz quantas vieram', () => {
    const outro = [[-51, -27], [-50, -27], [-50, -26], [-51, -26], [-51, -27]]
    const duas = JSON.stringify({ type: 'MultiPolygon', coordinates: [[QUADRADO], [outro]] })
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: duas })
    expect(error.message).toMatch(/UM polígono só/)
    expect(error.message).toMatch(/vieram 2/)
  })

  it('recusa GeoJSON que não é polígono', () => {
    const ponto = JSON.stringify({ type: 'Point', coordinates: [-53, -29] })
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: ponto })
    expect(error.message).toMatch(/precisa ser um Polygon ou um MultiPolygon/)
  })

  it('recusa texto que não é JSON', () => {
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: 'nada disso' })
    expect(error.message).toMatch(/precisa ser um GeoJSON válido/)
  })

  // ANEL ABERTO entra no PostGIS como geometria inválida, e o erro que ele
  // devolve não diz qual anel nem por quê.
  it('recusa anel aberto', () => {
    const aberto = [[-53, -29], [-52, -29], [-52, -28], [-53, -28]]
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: poligono(aberto) })
    expect(error.message).toMatch(/precisa ser fechado/)
  })

  it('recusa anel com menos de três vértices', () => {
    const curto = [[-53, -29], [-52, -29], [-53, -29]]
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: poligono(curto) })
    expect(error.message).toMatch(/ao menos três vértices/)
  })

  it('recusa coordenada fora do mundo', () => {
    const fora = [[-53, -29], [200, -29], [200, -28], [-53, -28], [-53, -29]]
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: poligono(fora) })
    expect(error.message).toMatch(/coordenada inválida/)
  })

  // O BURACO CONTINUA PERMITIDO, ao contrário do validador compartilhado
  // (`utils/geometria_schema.js`), que aceita UM anel só. Um polígono com ilha
  // interna ainda é UM polígono, e o estreitamento acima é sobre PARTES, não
  // sobre anéis. Nenhum campo do SAP tem ilha, e recusá-la seria inventar uma
  // restrição que nem os dados nem o chefe pediram.
  it('aceita polígono com buraco', () => {
    const buraco = [[-52.8, -28.8], [-52.6, -28.8], [-52.6, -28.6], [-52.8, -28.6], [-52.8, -28.8]]
    const comBuraco = JSON.stringify({ type: 'Polygon', coordinates: [QUADRADO, buraco] })
    const valor = aceita(campoSchema.campo.validate({ ...VALIDO, geometria: comBuraco }))
    expect(JSON.parse(valor.geometria).coordinates[0]).toHaveLength(2)
  })

  it('recusa o desenho acima do teto de vértices', () => {
    const muitos = []
    for (let i = 0; i < campoSchema.MAX_VERTICES + 5; i += 1) {
      muitos.push([-53 + (i % 100) / 1000, -29])
    }
    muitos.push(muitos[0])
    const { error } = campoSchema.campo.validate({ ...VALIDO, geometria: poligono(muitos) })
    expect(error.message).toMatch(new RegExp(`excede ${campoSchema.MAX_VERTICES} vértices`))
  })
})

describe('campo: imagem', () => {
  const IMAGEM = {
    descricao: 'Marco de concreto',
    data_imagem: '2026-07-29',
    tipo: 'foto',
    mime_type: 'image/jpeg',
    conteudo_base64: Buffer.from('conteudo').toString('base64')
  }

  it('aceita o caso completo', () => {
    aceita(campoSchema.imagem.validate(IMAGEM))
  })

  it('o tipo padrão é foto', () => {
    const valor = aceita(campoSchema.imagem.validate({ ...IMAGEM, tipo: undefined }))
    expect(valor.tipo).toBe('foto')
  })

  it('só aceita foto e vídeo', () => {
    recusaPor(
      campoSchema.imagem.validate({ ...IMAGEM, tipo: 'audio' }),
      'tipo', 'any.only'
    )
  })

  // 133 DAS 143 IMAGENS DO DUMP DO SAP estão sem `mime_type`, e inventar
  // 'image/jpeg' para todas seria gravar um palpite.
  it('o mime_type pode faltar', () => {
    aceita(campoSchema.imagem.validate({ ...IMAGEM, mime_type: null }))
  })

  it('exige o conteúdo', () => {
    recusaPor(
      campoSchema.imagem.validate({ ...IMAGEM, conteudo_base64: undefined }),
      'conteudo_base64', 'any.required'
    )
  })

  it('recusa conteúdo que não é base64', () => {
    recusaPor(
      campoSchema.imagem.validate({ ...IMAGEM, conteudo_base64: 'não é base64!!' }),
      'conteudo_base64', 'string.base64'
    )
  })

  // O TETO VEIO MEDIDO: o maior vídeo do dump do SAP tem 37 MB, e base64 cresce
  // o binário em um terço. O teto do `express.json` em `server/app.js` TEM DE
  // caber este número: com ele menor, o corpo grande morre com um 413 do body
  // parser e o Joi nunca roda.
  it('recusa acima do teto de base64', () => {
    const grande = 'a'.repeat(campoSchema.MAX_BASE64 + 4)
    recusaPor(
      campoSchema.imagem.validate({ ...IMAGEM, conteudo_base64: grande }),
      'conteudo_base64', 'string.max'
    )
  })
})

describe('campo: track', () => {
  const PONTO = { longitude: -53.1, latitude: -29.1, elevacao: 120, momento: '2026-07-28T13:00:00Z' }
  const TRACK = {
    chefe_vtr: '2º Sgt Ramos',
    motorista: 'Cb Bueno',
    placa_vtr: 'EB-1234',
    dia: '2026-07-28',
    pontos: [PONTO, { ...PONTO, longitude: -53.2 }]
  }

  it('aceita o caso completo', () => {
    aceita(campoSchema.track.validate(TRACK))
  })

  // MENOS DE DOIS PONTOS NÃO É TRAJETO. A view `campo.track_linha` descarta o
  // track de um ponto só pelo HAVING, porque `ST_MakeLine` com um ponto devolve
  // um ponto e a coluna se declara LineString.
  it('exige ao menos dois pontos', () => {
    recusaPor(
      campoSchema.track.validate({ ...TRACK, pontos: [PONTO] }),
      'pontos', 'array.min'
    )
  })

  it('recusa coordenada fora do mundo', () => {
    recusaPor(
      campoSchema.track.validate({ ...TRACK, pontos: [PONTO, { ...PONTO, latitude: 91 }] }),
      ['pontos', 1, 'latitude'], 'number.max'
    )
  })

  // O `dia` É DIA DE CALENDÁRIO e sai como string, pela mesma razão das datas do
  // campo. O `momento` do PONTO, não: ali a hora é o dado, e é ela que ordena o
  // trajeto.
  it('o dia sai como string e o momento como Date', () => {
    const valor = aceita(campoSchema.track.validate(TRACK))
    expect(typeof valor.dia).toBe('string')
    expect(valor.pontos[0].momento).toBeInstanceOf(Date)
  })
})
