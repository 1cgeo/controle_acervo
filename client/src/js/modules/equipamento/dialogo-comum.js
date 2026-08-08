import { showError } from '@utils/toast.js';

/**
 * Peças que os cinco diálogos do módulo repetem.
 *
 * Existe por uma razão só: o par `data_inicio` / `data_fim` aparece em TRÊS
 * tabelas (indisponibilidade, afastamento e manutenção), e o schema do servidor
 * cobra `data_fim >= data_inicio` nas três. Repetir a checagem à mão em três
 * diálogos é como as três mensagens ficam diferentes entre si.
 */

/**
 * Confere o período e escreve o erro NO CAMPO, e não num toast.
 *
 * O servidor recusa de qualquer jeito (é ele quem manda), mas a recusa dele
 * chega como frase solta: quem a lê não sabe qual dos dois campos corrigir.
 *
 * @param {{getValue:Function, setError:Function}} inicio
 * @param {{getValue:Function, setError:Function}} fim
 * @param {string} [rotuloFim] - como o campo de fim se chama nesta tela
 * @returns {boolean} verdadeiro quando o período serve
 */
export function periodoValido(inicio, fim, rotuloFim = 'A data de término') {
  inicio.setError(null);
  fim.setError(null);

  const de = inicio.getValue();
  const ate = fim.getValue();

  if (!de) {
    inicio.setError('Informe a data de início');
    return false;
  }
  if (ate && ate < de) {
    // Comparação de STRING 'YYYY-MM-DD', que é o formato que `createDateField`
    // devolve: nesse formato a ordem alfabética é a ordem cronológica, e não há
    // fuso horário no meio para deslocar o dia.
    fim.setError(`${rotuloFim} não pode ser anterior à de início`);
    return false;
  }
  return true;
}

/**
 * Grava e fecha, com o modal OCUPADO durante a requisição.
 *
 * O padrão está em `components/modal/modal-base.js`: sem `setOcupado`, um
 * segundo clique em "Salvar" manda o mesmo POST duas vezes, e Escape com a
 * requisição em voo joga fora o formulário antes de o erro chegar.
 *
 * @param {Object} opcoes
 * @param {Function} opcoes.gravar - async () => void
 * @param {Function} opcoes.close
 * @param {Function} opcoes.setOcupado
 * @param {Function} opcoes.aoGravar - chamado depois do sucesso
 * @param {string} opcoes.erroPadrao
 */
export async function gravarNoModal({ gravar, close, setOcupado, aoGravar, erroPadrao }) {
  setOcupado(true);
  try {
    await gravar();
    close();
    if (aoGravar) aoGravar();
  } catch (err) {
    showError(err.message || erroPadrao);
  } finally {
    setOcupado(false);
  }
}
