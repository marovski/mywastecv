const buttonSearch = document.querySelector("#open-search")
const modal = document.querySelector("#modal")
const close = document.querySelector("#close-search")

function openModal(event) {
    event.preventDefault()
    modal.classList.remove("hide")
}

function closeModal(event) {
    if (event) event.preventDefault()
    modal.classList.add("hide")
}

buttonSearch.addEventListener("click", openModal)
close.addEventListener("click", closeModal)

// Fecha ao clicar fora do cartão, ou com Esc — o comportamento que
// qualquer modal já é esperado ter.
modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal()
})
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hide")) closeModal()
})
