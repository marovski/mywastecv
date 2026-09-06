// Pede confirmação antes de submeter formulários marcados com data-confirm.
// Evita handlers inline e serve qualquer formulário que precise de um aviso.
document.addEventListener("submit", (event) => {
    const message = event.target.dataset && event.target.dataset.confirm
    if (message && !window.confirm(message)) {
        event.preventDefault()
    }
})
