import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O CONTRATO DO SERVIÇO DE CAMPO.
//
// O que este arquivo prende é a promessa que a tela faz: a TABELA e o MAPA leem
// o MESMO recorte. Um filtro que valesse só numa faria as duas discordarem sobre
// quantos campos existem, e ninguém saberia qual acreditar -- e o sintoma seria
// mudo, porque as duas responderiam 200.

const chamadas = { get: [], post: [], put: [], del: [] };

vi.mock('@services/api-client.js', () => ({
  apiGet: (endpoint) => { chamadas.get.push(endpoint); return Promise.resolve([]); },
  apiPost: (endpoint, body) => { chamadas.post.push([endpoint, body]); return Promise.resolve({}); },
  apiPut: (endpoint, body) => { chamadas.put.push([endpoint, body]); return Promise.resolve({}); },
  apiDelete: (endpoint) => { chamadas.del.push(endpoint); return Promise.resolve({}); },
}));

vi.mock('@store/auth-store.js', () => ({
  getToken: () => 'token-de-teste',
}));

const servico = await import('./campo-service.js');

beforeEach(() => {
  chamadas.get = [];
  chamadas.post = [];
  chamadas.put = [];
  chamadas.del = [];
});

describe('campo-service: o recorte é o mesmo nas duas visões', () => {
  const FILTROS = { ano: 2026, situacao_id: 3, categoria_id: 1, busca: 'Santiago' };

  it('a lista e o geojson montam a MESMA query', async () => {
    await servico.listarCampos(FILTROS);
    await servico.getCamposGeojson(FILTROS);

    const [lista, geo] = chamadas.get;
    expect(lista.startsWith('/campo?')).toBe(true);
    expect(geo.startsWith('/campo/geojson?')).toBe(true);
    // O QUE IMPORTA É A QUERY, e não o caminho: é ela que decide o conjunto.
    expect(lista.split('?')[1]).toBe(geo.split('?')[1]);
  });

  it('a query traz os quatro filtros', async () => {
    await servico.listarCampos(FILTROS);
    const query = new URLSearchParams(chamadas.get[0].split('?')[1]);
    expect(query.get('ano')).toBe('2026');
    expect(query.get('situacao_id')).toBe('3');
    expect(query.get('categoria_id')).toBe('1');
    expect(query.get('busca')).toBe('Santiago');
  });

  // FILTRO VAZIO NÃO VIRA `?ano=&situacao_id=`: o servidor validaria a string
  // vazia contra `Joi.number()` e responderia 400 numa tela que ninguém filtrou.
  it('sem filtro nenhum, a rota sai limpa', async () => {
    await servico.listarCampos({});
    await servico.getCamposGeojson();
    expect(chamadas.get).toEqual(['/campo', '/campo/geojson']);
  });

  it('o filtro ausente não entra na query', async () => {
    await servico.listarCampos({ ano: 2026 });
    expect(chamadas.get[0]).toBe('/campo?ano=2026');
  });
});

describe('campo-service: as rotas de escrita', () => {
  it('a foto e o trajeto são FILHOS do campo na criação', async () => {
    await servico.enviarImagemCampo(12, { conteudo_base64: 'x' });
    await servico.criarTrackCampo(12, { pontos: [] });
    expect(chamadas.post.map(c => c[0]))
      .toEqual(['/campo/12/imagem', '/campo/12/track']);
  });

  // MAS TÊM ID PRÓPRIO para alterar e remover, e a rota NÃO repete o campo: o id
  // da imagem já a identifica, e um caminho aninhado abriria a porta para
  // apagar a foto de um campo passando o id de outro.
  it('a foto e o trajeto se removem pelo id PRÓPRIO', async () => {
    await servico.excluirImagemCampo(99);
    await servico.excluirTrackCampo(77);
    expect(chamadas.del).toEqual(['/campo/imagem/99', '/campo/track/77']);
  });
});

describe('campo-service: os bytes da imagem', () => {
  const originais = { fetch: global.fetch, criar: global.URL.createObjectURL };

  afterEach(() => {
    global.fetch = originais.fetch;
    global.URL.createObjectURL = originais.criar;
  });

  // `<img>` E `<video>` NÃO MANDAM CABEÇALHO `Authorization`, e o `verifyPerfil`
  // do SCA lê o token SÓ de `req.headers.authorization` -- não há fallback por
  // query como no SAP. Pôr a URL da rota direto no `src` levaria 401 em toda
  // imagem, e a tela mostraria um quadrado quebrado sem dizer por quê.
  it('busca com o cabeçalho e devolve uma URL de blob', async () => {
    let recebido = null;
    global.fetch = (url, opcoes) => {
      recebido = { url, opcoes };
      return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) });
    };
    global.URL.createObjectURL = () => 'blob:fake';

    const url = await servico.urlDaImagemCampo(42);

    expect(recebido.url).toBe('/api/campo/imagem/42/arquivo');
    expect(recebido.opcoes.headers.Authorization).toBe('Bearer token-de-teste');
    expect(url).toBe('blob:fake');
  });

  it('a falha vira erro com o código, e não um blob vazio', async () => {
    global.fetch = () => Promise.resolve({ ok: false, status: 403 });
    await expect(servico.urlDaImagemCampo(42)).rejects.toThrow(/403/);
  });
});
