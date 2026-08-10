const toastEl = document.getElementById('toast');

toastEl.addEventListener('click', () => {
  window.api.dismissToast();
});

window.api.onToast(({ title, body }) => {
  document.getElementById('toast-title').textContent = title || '';
  document.getElementById('toast-body').textContent = body || '';
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // restart the CSS transition on repeated toasts
  toastEl.classList.add('show');
});
