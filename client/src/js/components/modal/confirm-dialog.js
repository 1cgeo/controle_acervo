import { openModal } from './modal-base.js';

/**
 * Show a confirmation dialog. Every destructive action must use this.
 *
 * @param {Object} options
 * @param {string} options.title - e.g. 'Excluir cliente'
 * @param {string} options.message - e.g. 'Tem certeza? Esta ação não pode ser desfeita.'
 * @param {string} [options.confirmLabel] - default 'Confirmar'
 * @param {string} [options.cancelLabel] - default 'Cancelar'
 * @param {boolean} [options.danger] - red confirm button for destructive actions
 * @returns {Promise<boolean>} - true when confirmed, false otherwise (cancel/ESC/backdrop)
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
}) {
  return new Promise((resolve) => {
    let confirmed = false;

    openModal({
      title,
      content: message,
      width: '420px',
      onClose: () => resolve(confirmed),
      actions: [
        {
          label: cancelLabel,
          variant: 'text',
          onClick: ({ close }) => close(),
        },
        {
          label: confirmLabel,
          variant: danger ? 'danger' : 'primary',
          onClick: ({ close }) => {
            confirmed = true;
            close();
          },
        },
      ],
    });
  });
}
