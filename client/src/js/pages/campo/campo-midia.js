import {
  criarGaleriaMidia,
  abrirTelaCheia as abrirTelaCheiaMidia,
  MAX_BYTES_ARQUIVO,
} from '@components/midia/galeria-midia.js';
import {
  listarImagensCampo, enviarImagemCampo, excluirImagemCampo, urlDaImagemCampo,
  atualizarImagemCampo,
} from '@services/campo-service.js';
import './campo.css';

/**
 * A galeria de fotos e vídeos de um CAMPO.
 *
 * A GALERIA EM SI NÃO MORA MAIS AQUI, desde 2026-09-15: ela é
 * `components/midia/galeria-midia.js`, e a capacitação (a 2.6 ministrada e a
 * 6.2 recebida) monta a MESMA. O que ficou neste arquivo é a única coisa que é
 * do campo -- o endereço das cinco rotas e as duas frases de tela vazia.
 *
 * A DIVISÃO ENTRE VER E MEXER É DE 2026-08-09, por decisão do chefe, e continua
 * valendo: abrir a ficha é VER, e tudo o que muda o campo -- inclusive
 * acrescentar e remover foto, vídeo e trajeto -- mora em "Editar o campo". Antes
 * disso a ficha tinha botão de enviar e de remover, e a pessoa mudava o cadastro
 * sem nunca ter dito que ia editar. Quem carrega isso é o `podeEditar` que a
 * ficha e o formulário passam.
 */

// AS CINCO ROTAS DO CAMPO, no formato que o componente lê. O `campo-service.js`
// continua sendo quem sabe o endereço; este objeto só o apresenta.
//
// CADA UMA É UMA SETA, e não a função nua. Passar `listar: listarImagensCampo`
// LÊ o export na hora em que este módulo carrega, e as suítes que dublam
// `campo-service.js` só declaram as funções que o caso delas usa: um dublê sem
// `enviarImagemCampo` derrubava três arquivos de teste de campo no import, antes
// de o primeiro caso rodar. Dentro da seta a leitura acontece na CHAMADA, e quem
// nunca abre a galeria nunca a faz.
const SERVICO_CAMPO = {
  listar: (id) => listarImagensCampo(id),
  enviar: (id, body) => enviarImagemCampo(id, body),
  atualizar: (imagemId, body) => atualizarImagemCampo(imagemId, body),
  excluir: (imagemId) => excluirImagemCampo(imagemId),
  url: (imagemId) => urlDaImagemCampo(imagemId),
};

const TEXTOS_CAMPO = {
  alt: 'Foto de campo',
  vazio: 'Nenhuma foto ou vídeo neste campo.',
  vazioEditavel: 'Nenhuma foto ou vídeo. Use o botão acima para enviar.',
};

/**
 * @param {Object} opts
 * @param {number} opts.campoId
 * @param {boolean} [opts.podeEditar] - mostra enviar e remover
 * @param {Function} [opts.aoMudar] - houve escrita; quem chamou recarrega
 * @returns {{element:HTMLElement, recarregar:Function, cleanup:Function}}
 */
export function criarGaleriaCampo({ campoId, podeEditar = false, aoMudar = null }) {
  return criarGaleriaMidia({
    id: campoId,
    servico: SERVICO_CAMPO,
    podeEditar,
    aoMudar,
    textos: TEXTOS_CAMPO,
  });
}

/**
 * A tela cheia, já apontada para as rotas do campo.
 *
 * ENVOLVIDA, e não reexportada crua: o componente passou a exigir de quem a
 * chama a função que busca os bytes (`urlDoArquivo`), porque ela é o que muda
 * entre um dono de mídia e outro. Reexportar a versão crua daqui entregaria a
 * quem importa deste arquivo uma função que quebra sem um argumento que só o
 * campo sabe qual é.
 *
 * @param {Object} opts - `itens` e `indice`, como antes
 */
export const abrirTelaCheia = ({ itens, indice = 0 }) => abrirTelaCheiaMidia({
  itens,
  indice,
  urlDoArquivo: urlDaImagemCampo,
  alt: TEXTOS_CAMPO.alt,
});

// O TETO DO ARQUIVO continua saindo daqui porque é daqui que os testes do envio
// do campo o leem, e ele é o mesmo para toda mídia do SAP.
export { MAX_BYTES_ARQUIVO };
