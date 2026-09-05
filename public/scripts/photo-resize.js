// Reduz a fotografia no browser antes do upload.
// Poupa dados móveis a quem publica e evita servir originais de 3 MB no board.
// Se algo falhar, o ficheiro original segue na mesma (o servidor mantém o limite).
(function () {
    var MAX_SIDE = 1600
    var QUALITY = 0.82

    var input = document.getElementById("photo")
    var form = input && input.form
    if (!input || !form || typeof DataTransfer === "undefined") return

    var hint = document.createElement("p")
    hint.className = "field-hint"
    input.insertAdjacentElement("afterend", hint)

    var busy = false
    var done = false

    function loadImage(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file)
            var img = new Image()
            img.onload = function () {
                URL.revokeObjectURL(url)
                resolve(img)
            }
            img.onerror = function () {
                URL.revokeObjectURL(url)
                reject(new Error("decode"))
            }
            img.src = url
        })
    }

    function shrink(file) {
        return loadImage(file).then(function (img) {
            var scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
            if (scale === 1 && file.size < 600 * 1024) return null

            var canvas = document.createElement("canvas")
            canvas.width = Math.round(img.width * scale)
            canvas.height = Math.round(img.height * scale)
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)

            return new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                    // Só vale a pena se ficar mesmo mais pequeno.
                    if (!blob || blob.size >= file.size) return resolve(null)
                    resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
                        type: "image/jpeg"
                    }))
                }, "image/jpeg", QUALITY)
            })
        })
    }

    input.addEventListener("change", function () {
        done = false
        hint.textContent = ""
    })

    form.addEventListener("submit", function (event) {
        var file = input.files && input.files[0]
        if (!file || done || busy || !/^image\//.test(file.type)) return

        event.preventDefault()
        busy = true
        hint.textContent = "A otimizar a imagem…"

        shrink(file).then(function (smaller) {
            if (smaller) {
                var dt = new DataTransfer()
                dt.items.add(smaller)
                input.files = dt.files
                hint.textContent = "Imagem otimizada ("
                    + Math.round(smaller.size / 1024) + " kB)."
            } else {
                hint.textContent = ""
            }
        }).catch(function () {
            hint.textContent = ""
        }).then(function () {
            busy = false
            done = true
            form.submit()
        })
    })
})()
