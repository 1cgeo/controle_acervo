let containerEl = null;

function getContainer() {
  if (!containerEl) {
    containerEl = document.createElement('div');
    containerEl.className = 'toast-container';
    containerEl.setAttribute('role', 'status');
    containerEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(containerEl);
  }
  return containerEl;
}

/**
 * Show a toast notification (never use alert()).
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type]
 * @param {number} [durationMs]
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  const container = getContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(16px)';
    toast.style.transition = 'opacity 250ms, transform 250ms';
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

/** Show a success toast. */
export function showSuccess(message) { showToast(message, 'success'); }

/** Show an error toast (longer duration; server messages shown verbatim). */
export function showError(message) { showToast(message, 'error', 6000); }

/** Show a warning toast. */
export function showWarning(message) { showToast(message, 'warning'); }

/** Show an info toast. */
export function showInfo(message) { showToast(message, 'info'); }
