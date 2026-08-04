import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { createTextField, createSelectField } from '@components/form-fields/form-fields.js';
import { getDominioTipoCliente, getClientes, createCliente, updateCliente } from '@modules/mapoteca/services/mapoteca-service.js';
import { showSuccess, showError } from '@utils/toast.js';

const DIACRITICOS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
const NAO_ALFANUMERICO_RE = new RegExp('[^a-z0-9]+', 'g');

/**
 * Forma de COMPARAÇÃO de um nome ou de uma sigla. Não serve para exibir.
 *
 * Tira a caixa, o acento, o indicador de ordinal, o espaço e a pontuação. É o
 * que faz "3º GAC Ap", "3o GAC AP" e "3° G.A.C. Ap" darem a mesma forma. As
 * duas primeiras grafias existem no cadastro, e comparar o texto cru deixaria a
 * duplicata passar.
 */
function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .replace(/[º°]/g, 'o')
    .replace(/ª/g, 'a')
    .normalize('NFD')
    .replace(DIACRITICOS_RE, '')
    .replace(NAO_ALFANUMERICO_RE, '');
}

/**
 * Clientes que parecem ser o MESMO que se vai criar.
 *
 * Compara o nome e a sigla, e também cruzado: quem digita a sigla no campo do
 * nome cai no mesmo caso. O critério é a IGUALDADE da forma normalizada, nunca
 * parecença aproximada. Alerta que dispara para quase todo mundo deixa de ser
 * lido, e homônimo legítimo existe.
 *
 * @param {Array<Object>} clientes - cadastro já conhecido pela tela
 * @param {string} nome
 * @param {string} sigla
 * @returns {Array<Object>}
 */
function acharParecidos(clientes, nome, sigla) {
  const alvos = new Set([normalizar(nome), normalizar(sigla)].filter(Boolean));
  if (!alvos.size) return [];

  return clientes.filter((c) => {
    const chaves = [normalizar(c.nome), normalizar(c.sigla)].filter(Boolean);
    return chaves.some((chave) => alvos.has(chave));
  });
}

/**
 * Create/edit client dialog, shared by the list and details pages.
 * @param {Object} options
 * @param {Object|null} [options.cliente] - existing client for edit mode
 * @param {Function} [options.onSaved] - called after a successful save
 * @param {Array<Object>|null} [options.clientesExistentes] - cadastro que a tela
 *        já tem em memória, usado para avisar sobre duplicata na CRIAÇÃO. Quem
 *        não passa a lista faz o diálogo buscá-la na hora de gravar.
 */
export async function openClienteDialog({ cliente = null, onSaved, clientesExistentes = null }) {
  let tipos;
  try {
    tipos = await getDominioTipoCliente();
  } catch (err) {
    showError(err.message || 'Erro ao carregar os tipos de cliente');
    return;
  }

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    value: (cliente && cliente.nome) || '',
    maxLength: 255,
  });
  // Opcional de propósito: 6 dos 180 clientes não são OM (órgão público,
  // cidadão da LAI) e não têm sigla. Inventar uma seria pior que deixar vazio.
  const siglaField = createTextField({
    label: 'Sigla',
    value: (cliente && cliente.sigla) || '',
    maxLength: 50,
    helpText: 'Sigla da OM (ex.: 10º B Log). Deixe vazio para quem não é OM.',
  });
  const tipoField = createSelectField({
    label: 'Tipo de cliente',
    required: true,
    options: tipos.map(t => ({ value: t.code, label: t.nome })),
    value: cliente ? cliente.tipo_cliente_id : undefined,
  });
  const contatoField = createTextField({
    label: 'Ponto de contato principal',
    value: (cliente && cliente.ponto_contato_principal) || '',
    maxLength: 255,
  });
  const enderecoField = createTextField({
    label: 'Endereço de entrega principal',
    value: (cliente && cliente.endereco_entrega_principal) || '',
    maxLength: 255,
  });

  nomeField.element.classList.add('form-grid__full');
  // O contato passou a ocupar a linha inteira quando a sigla entrou: sigla e
  // tipo dividem uma linha, e sem isto o contato ficaria sozinho, ao lado de um
  // buraco.
  contatoField.element.classList.add('form-grid__full');
  enderecoField.element.classList.add('form-grid__full');

  const content = el('div', { className: 'form-grid' }, [
    nomeField.element,
    siglaField.element,
    tipoField.element,
    contatoField.element,
    enderecoField.element,
  ]);

  let submitting = false;

  openModal({
    title: cliente ? `Editar cliente — ${cliente.nome}` : 'Novo cliente',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: cliente ? 'Salvar' : 'Criar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (submitting) return;

          nomeField.setError(null);
          tipoField.setError(null);

          let ok = true;
          if (!nomeField.getValue()) {
            nomeField.setError('Campo obrigatório');
            ok = false;
          }
          if (tipoField.getValue() === null) {
            tipoField.setError('Campo obrigatório');
            ok = false;
          }
          if (!ok) return;

          const payload = {
            nome: nomeField.getValue(),
            sigla: siglaField.getValue() || null,
            tipo_cliente_id: tipoField.getValue(),
            ponto_contato_principal: contatoField.getValue() || null,
            endereco_entrega_principal: enderecoField.getValue() || null,
          };

          submitting = true;

          // Cliente NOVO passa pela checagem de duplicata. Edição não: o próprio
          // registro casaria consigo mesmo, e o aviso não faria sentido.
          //
          // O aviso PEDE confirmação, e não bloqueia. Homônimo legítimo existe,
          // e travar a criação empurraria a pessoa para um nome torto.
          if (!cliente) {
            let existentes = clientesExistentes;
            if (!existentes) {
              // Quem abriu o diálogo não passou o cadastro. Buscar aqui, e não
              // na abertura, mantém o formulário instantâneo.
              try {
                existentes = await getClientes();
              } catch {
                existentes = [];
              }
            }

            const parecidos = acharParecidos(existentes, payload.nome, payload.sigla);
            if (parecidos.length) {
              const mostrados = parecidos.slice(0, 3);
              const resto = parecidos.length - mostrados.length;
              const amostra = mostrados
                .map((c) => (c.sigla ? `${c.nome} (${c.sigla})` : c.nome))
                .join('; ')
                + (resto > 0 ? ` e mais ${resto}` : '');
              const seguir = await confirmDialog({
                title: 'Cliente parecido já cadastrado',
                message: `Já existe cliente com este nome ou esta sigla: ${amostra}. Criar mesmo assim?`,
                confirmLabel: 'Criar assim mesmo',
              });
              if (!seguir) {
                submitting = false;
                return;
              }
            }
          }

          try {
            if (cliente) {
              await updateCliente({ id: cliente.id, ...payload });
              showSuccess('Cliente atualizado com sucesso');
            } else {
              await createCliente(payload);
              showSuccess('Cliente criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            submitting = false;
            showError(err.message || 'Erro ao salvar o cliente');
          }
        },
      },
    ],
  });
}
