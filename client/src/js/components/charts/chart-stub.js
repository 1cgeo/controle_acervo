// Dublê do 'chart.js' para os testes (vitest + jsdom).
//
// POR QUE: o jsdom nao implementa canvas.getContext('2d') e devolve null. O
// Chart real explode com "Cannot read properties of null" no primeiro update
// que tem dado, entao toda tela com grafico ficaria intestavel, ou passaria so
// porque um try/catch engole a falha (que foi o caso do dashboard do orcamento).
//
// COMO USAR, no topo do arquivo de teste:
//   vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));
//
// O dublê guarda a config recebida em `chart.config`, entao o teste pode
// conferir labels, datasets e opcoes sem desenhar nada.

/** Instancias vivas, na ordem de criacao. Util para conferir o que foi montado. */
export const instanciasChart = [];

export class Chart {
  /**
   * @param {*} ctx - o contexto 2d (null no jsdom, e tudo bem)
   * @param {Object} config - { type, data, options }
   */
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.data = config && config.data;
    this.options = config && config.options;
    this.destroyed = false;
    instanciasChart.push(this);
  }

  update() {}

  resize() {}

  destroy() {
    this.destroyed = true;
    const i = instanciasChart.indexOf(this);
    if (i >= 0) instanciasChart.splice(i, 1);
  }
}

/** O Chart.register do original so registra plugins; aqui nao faz nada. */
Chart.register = () => {};

// Controllers, elementos, escalas e plugins que os graficos registram.
export const BarController = {};
export const BarElement = {};
export const PieController = {};
export const ArcElement = {};
export const LineController = {};
export const LineElement = {};
export const PointElement = {};
export const CategoryScale = {};
export const LinearScale = {};
export const Tooltip = {};
export const Legend = {};
export const Filler = {};

// O jsdom loga "Not implemented: HTMLCanvasElement.prototype.getContext" a cada
// chamada e polui a saida do teste. Como o dublê nao desenha nada, devolver um
// objeto vazio basta. So o teste importa este modulo, entao o patch nao vaza
// para o build.
if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.__dubleDeContexto) {
  HTMLCanvasElement.prototype.getContext = function getContext() { return {}; };
  HTMLCanvasElement.prototype.__dubleDeContexto = true;
}
