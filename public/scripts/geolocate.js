// Preenche latitude/longitude no perfil do reciclador a partir da
// localização do browser. Puramente cliente — nada é enviado a um serviço
// externo, a app só lê o resultado da própria Geolocation API.
(function () {
    const button = document.getElementById("use-my-location")
    if (!button) return

    const status = document.getElementById("location-status")
    const latInput = document.getElementById("latitude")
    const lngInput = document.getElementById("longitude")

    function setStatus(text) {
        if (status) status.textContent = text
    }

    button.addEventListener("click", () => {
        if (!("geolocation" in navigator)) {
            setStatus("Este browser não permite obter a localização automaticamente.")
            return
        }
        setStatus("A obter localização…")
        button.disabled = true

        navigator.geolocation.getCurrentPosition(
            (position) => {
                latInput.value = position.coords.latitude.toFixed(6)
                lngInput.value = position.coords.longitude.toFixed(6)
                setStatus("Localização preenchida. Reveja antes de guardar.")
                button.disabled = false
            },
            (error) => {
                setStatus(
                    error.code === error.PERMISSION_DENIED
                        ? "Permissão de localização recusada. Pode inserir as coordenadas à mão."
                        : "Não foi possível obter a localização. Pode inserir as coordenadas à mão."
                )
                button.disabled = false
            },
            { timeout: 10000 }
        )
    })
})()
