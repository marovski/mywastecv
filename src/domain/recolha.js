// Recolha confirmada: histórico de peso por material.
//
// Consolida o formato JSON de weights_json e a sua descodificação. Nenhum
// outro módulo vê a representação no disco — tudo passa por aqui.
const { co2eByLabel } = require("../data/materials")

// Descodifica pesos de uma string JSON, tolerante a corrupção.
function parseWeights(json) {
    try {
        const parsed = JSON.parse(json || "{}")
        return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
        return {}
    }
}

// Total em kg de uma recolha (ou de um registro com weights_json).
function totalKg(weightsJson) {
    const weights = parseWeights(weightsJson)
    return Object.values(weights).reduce((sum, kg) => sum + (Number(kg) || 0), 0)
}

// Total em CO2e estimado para uma recolha.
function totalCo2e(weightsJson) {
    let co2e = 0
    for (const [label, kg] of Object.entries(parseWeights(weightsJson))) {
        co2e += kg * (co2eByLabel[label] || 0)
    }
    return co2e
}

// Matérias num fluxo reciclador + material (para contar fluxos únicos).
function flows(weightsJson) {
    return Object.keys(parseWeights(weightsJson))
}

// Descodifica um registro de recolha, adicionando os pesos como um objeto.
function loadCollection(db, listingId) {
    const collection = db.prepare(
        `SELECT * FROM collection_records WHERE listing_id = ?`
    ).get(listingId)
    if (!collection) return null
    collection.weights = parseWeights(collection.weights_json)
    return collection
}

module.exports = {
    parseWeights, totalKg, totalCo2e, flows, loadCollection
}
