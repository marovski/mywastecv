// Avaliações entre as duas partes de uma recolha.
//
// Só existe avaliação depois de uma recolha confirmada, só as duas partes se
// avaliam, e cada uma avalia a outra uma única vez por anúncio. Quem avalia e
// quem é avaliado sai daqui — nunca do formulário.
const { acceptedRecyclerId } = require("./visibility")

const fail = (status, message) => ({ ok: false, status, message })

// A outra parte da recolha, ou uma recusa se este utilizador não é parte dela.
function canRate(db, listingId, userId) {
    const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(listingId)
    if (!listing || listing.status !== "recolhida") {
        return fail(400, "Só é possível avaliar depois de a recolha estar confirmada.")
    }
    const recyclerId = acceptedRecyclerId(db, listing.id)
    if (!recyclerId) return fail(400, "Este anúncio não teve recolha.")

    if (userId === listing.citizen_id) return { ok: true, ratedId: recyclerId }
    if (userId === recyclerId) return { ok: true, ratedId: listing.citizen_id }
    return fail(403, "Só as partes envolvidas na recolha se podem avaliar.")
}

// Uma classificação válida é um inteiro de 1 a 5.
function validStars(stars) {
    return Number.isInteger(stars) && stars >= 1 && stars <= 5
}

function rate(db, listingId, raterId, stars, comment) {
    const allowed = canRate(db, listingId, raterId)
    if (!allowed.ok) return allowed
    if (!validStars(stars)) return fail(400, "Escolha uma classificação de 1 a 5 estrelas.")
    if (myRating(db, listingId, raterId)) return fail(400, "Já avaliou esta recolha.")

    const text = (comment || "").trim()
    db.prepare(`
        INSERT INTO ratings (listing_id, rater_id, rated_id, stars, comment)
        VALUES (?, ?, ?, ?, ?)
    `).run(listingId, raterId, allowed.ratedId, stars, text || null)
    return { ok: true }
}

// O que este utilizador já deixou neste anúncio, ou null.
function myRating(db, listingId, raterId) {
    return db.prepare(`SELECT * FROM ratings WHERE listing_id = ? AND rater_id = ?`)
        .get(listingId, raterId) || null
}

function round1(n) {
    return Math.round(n * 10) / 10
}

// Média e número de avaliações recebidas por um utilizador.
function summaryFor(db, userId) {
    const row = db.prepare(
        `SELECT AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE rated_id = ?`
    ).get(userId)
    if (!row || !row.count) return { average: 0, count: 0 }
    return { average: round1(row.average), count: row.count }
}

// O mesmo para toda a gente de uma vez, indexado por id — para o diretório
// não fazer uma consulta por reciclador.
function summaryByUser(db) {
    const rows = db.prepare(`
        SELECT rated_id, AVG(stars) AS average, COUNT(*) AS count
        FROM ratings GROUP BY rated_id
    `).all()
    const byUser = {}
    for (const row of rows) {
        byUser[row.rated_id] = { average: round1(row.average), count: row.count }
    }
    return byUser
}

// Avaliações recebidas, com o nome de quem avaliou, mais recentes primeiro.
function listFor(db, userId) {
    return db.prepare(`
        SELECT r.*, u.name AS rater_name
        FROM ratings r JOIN users u ON u.id = r.rater_id
        WHERE r.rated_id = ? ORDER BY r.created_at DESC, r.id DESC
    `).all(userId)
}

module.exports = { canRate, rate, myRating, summaryFor, summaryByUser, listFor }
