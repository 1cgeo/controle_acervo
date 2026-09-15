import { openModal } from '@components/modal/modal-base.js';
import { criarGaleriaMidia } from '@components/midia/galeria-midia.js';
import {
  midiaCapacitacaoMinistrada, midiaCapacitacaoRecebida,
} from '@services/plataforma-service.js';
import { MINISTRADA } from './capacitacao-dialog.js';

/**
 * As fotos e os vídeos de uma capacitação, num modal próprio.
 *
 * POR QUE MODAL PRÓPRIO, e não uma seção do formulário de edição. Duas razões,
 * nesta ordem:
 *
 *   1. QUEM SÓ CONSULTA TEM DE VER. O formulário é do OPERADOR, e a foto da
 *      instrução que a Divisão deu não é segredo dentro dela -- é justamente o
 *      que se quer mostrar. Pendurada no formulário, ela ficaria invisível para
 *      todo o resto do PIT e do Efetivo.
 *   2. A GALERIA GRAVA NA HORA, e o formulário grava no "Salvar". Os dois no
 *      mesmo diálogo dariam a impressão de que a foto enviada espera o Salvar, e
 *      que Cancelar a desfaz. Nenhuma das duas é verdade.
 *
 * É a mesma divisão que o campo faz entre a ficha (VER) e o "Editar o campo"
 * (MEXER), com uma diferença: a capacitação não tem ficha, então este modal é o
 * lugar onde se vê.
 *
 * A CAPACITAÇÃO PRECISA EXISTIR. Sem id não há onde pendurar arquivo, e por isso
 * a ação abre pela LINHA da lista, e nunca do formulário de cadastro novo.
 *
 * @param {Object} opts
 * @param {Object} opts.capacitacao - a linha da lista (id, nome, ano, tipo_id)
 * @param {boolean} [opts.podeEditar] - operador do módulo desta tela
 * @param {Function} [opts.aoMudar] - houve escrita; a lista recarrega a contagem
 */
export function abrirMidiaCapacitacao({
  capacitacao, podeEditar = false, aoMudar = null,
}) {
  // O SERVIÇO VEM DO TIPO DA LINHA, e não da tela que abriu: as rotas são duas
  // (a ministrada é do PIT, a recebida é do Efetivo) e mandar o id de uma para o
  // caminho da outra responde 404, que na tela apareceria como "não foi possível
  // carregar" sem dizer por quê.
  const ministrada = Number(capacitacao.tipo_id) === MINISTRADA;
  const servico = ministrada ? midiaCapacitacaoMinistrada : midiaCapacitacaoRecebida;

  // SE HOUVE ESCRITA, e não a cada abertura: a lista recarrega para a contagem
  // da coluna acompanhar, e recarregá-la depois de quem só olhou seria uma ida
  // ao banco por curiosidade.
  let mudou = false;

  const galeria = criarGaleriaMidia({
    id: capacitacao.id,
    servico,
    podeEditar,
    aoMudar: () => { mudou = true; },
    textos: {
      alt: ministrada ? 'Foto da capacitação ministrada' : 'Foto da capacitação recebida',
      vazio: 'Nenhuma foto ou vídeo nesta capacitação.',
      vazioEditavel: 'Nenhuma foto ou vídeo. Use o botão acima para enviar.',
    },
  });

  openModal({
    title: `Fotos e vídeos - ${capacitacao.nome} (${capacitacao.ano})`,
    content: galeria.element,
    width: '820px',
    // O `cleanup` REVOGA OS BLOBS das miniaturas e fecha a tela cheia que tenha
    // ficado aberta. Sem ele, cada abertura deixaria os bytes de toda a galeria
    // presos na memória do navegador até recarregar a página.
    onClose: () => {
      galeria.cleanup();
      if (mudou && aoMudar) aoMudar();
    },
    actions: [
      { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
    ],
  });

  galeria.recarregar();
}
