const buttonSearch = document.querySelector("#open-search")
const modal = document.querySelector("#modal")
const close = document.querySelector("#close-search")

buttonSearch.addEventListener("click", (event) => {
    event.preventDefault()
    modal.classList.remove("hide")
})

close.addEventListener("click", (event) => {
    event.preventDefault()
    modal.classList.add("hide")
})
