// Setup do `npm run test:relogio`: roda a suite inteira num DIA ESCOLHIDO, para
// achar o caso que só passa porque hoje é hoje.
//
// POR QUE ELE EXISTE. Em 04/09/2026 três casos caíram sem que uma linha de
// código tivesse mudado: o `efetivo-tab` derivava `DIAS_DO_MES` do relógio e
// comparava com um `dias_do_mes: 31` escrito à mão na fixture, e o
// `execucao-pit` congelava o relógio no PRIMEIRO `describe` e deixava os outros
// dois no relógio de parede, com um comentário afirmando um congelamento que não
// existia. Os dois vinham verdes desde sempre, porque tinham nascido num mês de
// 31 dias.
//
// Rodada contra os testes de antes do conserto, esta régua reprova em fevereiro
// (7 casos), em abril (5) e em setembro (3), e passa só num agosto. É a prova de
// que ela pega o que existe para pegar, e não uma régua vista só passar.
//
// COMO USAR:
//     npm run test:relogio                       # 15/02/2027, mês de 28 dias
//     SONDA_DATA=2029-06-01 npm run test:relogio # qualquer outro dia
//
// NÃO entra no `npm test` de todo dia: ele mede o código, e esta aqui mede a
// dependência dos CASOS do calendário. Vale antes de virar o ano e ao escrever
// caso que fale de mês, de prazo ou de "hoje".
//
// TROCA SÓ O CONSTRUTOR DE `Date`, e não chama `vi.useFakeTimers`. Faltou pouco
// para o instrumento mentir: a primeira versão instalava o relógio falso do
// vitest por cima, e derrubava 40 casos que não têm nada com data -- o debounce
// da busca do acervo e o auto-refresh dos dashboards ficavam sem `setInterval`.
// A régua acusava o próprio defeito dela. Quem instala o próprio relógio no
// arquivo (`execucao-pit`, `efetivo-tab`) continua mandando, e é o certo: o caso
// que declara o dia dele não deve depender deste arquivo.

const QUANDO = new Date(process.env.SONDA_DATA || '2027-02-15T10:00:00').getTime();

if (Number.isNaN(QUANDO)) {
  throw new Error('SONDA_DATA não é uma data ISO válida (ex.: 2029-06-01)');
}

const DateReal = globalThis.Date;

class DateFixo extends DateReal {
  constructor(...args) {
    if (args.length === 0) super(QUANDO);
    else super(...args);
  }

  static now() {
    return QUANDO;
  }
}

globalThis.Date = DateFixo;
