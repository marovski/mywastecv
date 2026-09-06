// Validação do formulário de perfil do reciclador (/perfil).
//
// A localização é opcional — nem toda a gente sabe as suas coordenadas de
// cor — mas latitude e longitude só fazem sentido em par: uma sem a outra
// não localiza nada.
const match = require("./match")

function trimmedOrNull(value) {
    const text = String(value || "").trim()
    return text || null
}

// Devolve { value } com um número dentro do intervalo, { value: null } se o
// campo vier vazio, ou { error: true } se vier preenchido mas inválido.
function parseCoordinate(raw, min, max) {
    if (raw === undefined || raw === null || String(raw).trim() === "") return { value: null }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || n > max) return { error: true }
    return { value: n }
}

function parseFields(fields) {
    const errors = []

    const lat = parseCoordinate(fields.latitude, -90, 90)
    if (lat.error) errors.push("Latitude inválida (tem de estar entre -90 e 90).")

    const lng = parseCoordinate(fields.longitude, -180, 180)
    if (lng.error) errors.push("Longitude inválida (tem de estar entre -180 e 180).")

    if (!lat.error && !lng.error && (lat.value === null) !== (lng.value === null)) {
        errors.push("Indique latitude e longitude, ou deixe as duas em branco.")
    }

    if (errors.length) return { errors }

    const { accepted_items, service_zones } = match.serialise(fields.accepted_items, fields.service_zones)

    return {
        values: {
            org_name: trimmedOrNull(fields.org_name),
            contact_name: trimmedOrNull(fields.contact_name),
            description: trimmedOrNull(fields.description),
            accepted_items,
            service_zones,
            does_pickup: fields.does_pickup ? 1 : 0,
            does_dropoff: fields.does_dropoff ? 1 : 0,
            hours: trimmedOrNull(fields.hours),
            image: trimmedOrNull(fields.image),
            address: trimmedOrNull(fields.address),
            latitude: lat.value,
            longitude: lng.value
        }
    }
}

module.exports = { parseFields }
