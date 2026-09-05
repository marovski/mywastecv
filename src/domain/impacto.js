// Números do painel público de impacto, calculados a partir das recolhas
// confirmadas e dos workshops realizados.
const { co2eByLabel } = require("../data/materials")

function now() {
    return new Date().toISOString().slice(0, 16).replace("T", " ")
}

function parseWeights(json) {
    try {
        const parsed = JSON.parse(json || "{}")
        return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
        return {}
    }
}

function metrics(db) {
    const workshops = db.prepare(`SELECT COUNT(*) AS total FROM workshops WHERE date < ?`).get(now()).total

    const recyclers = db.prepare(`
        SELECT COUNT(*) AS total FROM (
            SELECT user_id FROM recycler_profiles WHERE verified_at IS NOT NULL
            UNION
            SELECT recycler_id FROM collection_records
        )
    `).get().total

    const citizens = db.prepare(`
        SELECT COUNT(*) AS total FROM (
            SELECT citizen_id AS k FROM collection_records
            UNION
            SELECT COALESCE(CAST(user_id AS TEXT), email) AS k FROM workshop_signups
        )
    `).get().total

    // Um "fluxo" é um par reciclador + material que já circulou pelo menos uma vez.
    const flows = new Set()
    let kg = 0
    let co2e = 0
    for (const record of db.prepare(`SELECT recycler_id, weights_json FROM collection_records`).all()) {
        for (const [label, amount] of Object.entries(parseWeights(record.weights_json))) {
            flows.add(`${record.recycler_id}:${label}`)
            kg += amount
            co2e += amount * (co2eByLabel[label] || 0)
        }
    }

    return {
        workshops,
        flows: flows.size,
        recyclers,
        citizens,
        kg: Math.round(kg),
        co2e: Math.round(co2e)
    }
}

module.exports = { metrics }
