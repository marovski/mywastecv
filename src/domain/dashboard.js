// Estado operacional da plataforma, para a equipa ver o que precisa de
// atenção. Deliberadamente não repete o /impacto: aqui não há kg nem CO2e,
// só o que está parado ou à espera de alguém.
const STATUSES = ["aberta", "reservada", "recolhida", "expirada"]
const STALE_AFTER_DAYS = 14
const RECENT_LIMIT = 8

// Contagem por estado, com os quatro estados sempre presentes.
function listingsByStatus(db) {
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]))
    for (const row of db.prepare(`SELECT status, COUNT(*) AS total FROM listings GROUP BY status`).all()) {
        if (row.status in byStatus) byStatus[row.status] = row.total
    }
    return byStatus
}

// Anúncios abertos com pedidos por responder — o cidadão tem a bola.
function claimsAwaitingAnswer(db) {
    return db.prepare(`
        SELECT l.id AS listing_id, l.items, l.zone, u.name AS citizen_name,
               COUNT(c.id) AS pending,
               CAST(julianday('now') - julianday(MIN(c.created_at)) AS INTEGER) AS days_waiting
        FROM claims c
        JOIN listings l ON l.id = c.listing_id
        JOIN users u ON u.id = l.citizen_id
        WHERE c.status = 'pendente' AND l.status = 'aberta'
        GROUP BY l.id
        ORDER BY days_waiting DESC, l.id
    `).all()
}

// Abertos há muito e sem um único pedido: ninguém os quis.
function staleOpenListings(db, days = STALE_AFTER_DAYS) {
    return db.prepare(`
        SELECT l.id, l.items, l.zone, u.name AS citizen_name,
               CAST(julianday('now') - julianday(l.created_at) AS INTEGER) AS days_open
        FROM listings l
        JOIN users u ON u.id = l.citizen_id
        WHERE l.status = 'aberta'
          AND julianday('now') - julianday(l.created_at) >= ?
          AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.listing_id = l.id)
        ORDER BY days_open DESC, l.id
    `).all(days)
}

function totalKg(weightsJson) {
    let weights
    try {
        weights = JSON.parse(weightsJson || "{}")
    } catch {
        return 0
    }
    if (!weights || typeof weights !== "object") return 0
    return Object.values(weights).reduce((sum, kg) => sum + (Number(kg) || 0), 0)
}

// Últimas recolhas confirmadas, para se ver que a plataforma está viva.
function recentCollections(db, limit = RECENT_LIMIT) {
    return db.prepare(`
        SELECT r.id, r.listing_id, r.collected_at, r.created_at, r.weights_json,
               cu.name AS citizen_name, ru.name AS recycler_name
        FROM collection_records r
        JOIN users cu ON cu.id = r.citizen_id
        JOIN users ru ON ru.id = r.recycler_id
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?
    `).all(limit).map(row => Object.assign(row, { kg: Math.round(totalKg(row.weights_json) * 100) / 100 }))
}

function counts(db) {
    const byRole = {}
    for (const row of db.prepare(`SELECT role, COUNT(*) AS total FROM users GROUP BY role`).all()) {
        byRole[row.role] = row.total
    }
    const porVerificar = db.prepare(`
        SELECT COUNT(*) AS total FROM recycler_profiles WHERE verified_at IS NULL
    `).get().total
    return {
        cidadaos: byRole.cidadao || 0,
        recicladores: byRole.reciclador || 0,
        recicladoresPorVerificar: porVerificar,
        admins: byRole.admin || 0
    }
}

function overview(db) {
    return {
        byStatus: listingsByStatus(db),
        awaiting: claimsAwaitingAnswer(db),
        stale: staleOpenListings(db),
        collections: recentCollections(db),
        counts: counts(db)
    }
}

module.exports = {
    listingsByStatus, claimsAwaitingAnswer, staleOpenListings,
    recentCollections, counts, overview, STALE_AFTER_DAYS
}
