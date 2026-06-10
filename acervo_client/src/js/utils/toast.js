let containerEl = null;

function getContainer() {
  if (!containerEl) {
    containerEl = document.createElement('div');
    containerEl.className = 'toast-container';
    document.body.appendChild(containerEl);
  }
  return containerEl;
}

function showToast(message, type = 'info', durationMs = 4000) {
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

export function showSuccess(message) { showToast(message, 'success'); }
export function showError(message) { showToast(message, 'error', 6000); }
export function showWarning(message) { showToast(message, 'warning'); }
export function showInfo(message) { showToast(message, 'info'); }
