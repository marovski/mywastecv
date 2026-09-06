// Operações da equipa Nôs Lixu: verificar recicladores e ver quem se
// inscreveu nos workshops.
const fail = (status, message) => ({ ok: false, status, message })

// Um perfil de reciclador, ou nada se o id não for de um reciclador.
function recyclerProfile(db, userId) {
    return db.prepare(`
        SELECT p.user_id
        FROM recycler_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? AND u.role = 'reciclador'
    `).get(userId)
}

// As duas listas partilham as mesmas colunas; só diferem no filtro e na
// ordem, por isso a query é escrita por extenso em vez de montada por
// concatenação (a convenção do projeto é SQL literal com parâmetros ligados).
const RECYCLER_COLUMNS = `
    SELECT u.id, u.name, u.email, u.phone, u.zone, u.created_at,
           p.org_name, p.description, p.accepted_items, p.service_zones,
           p.does_pickup, p.does_dropoff, p.address, p.verified_at
    FROM users u JOIN recycler_profiles p ON p.user_id = u.id
    WHERE u.role = 'reciclador'
`

function pendingRecyclers(db) {
    return db.prepare(RECYCLER_COLUMNS + `
        AND p.verified_at IS NULL
        ORDER BY u.created_at
    `).all()
}

function verifiedRecyclers(db) {
    return db.prepare(RECYCLER_COLUMNS + `
        AND p.verified_at IS NOT NULL
        ORDER BY p.verified_at DESC
    `).all()
}

function verify(db, userId) {
    if (!recyclerProfile(db, userId)) return fail(404, "Reciclador não encontrado.")
    db.prepare(`UPDATE recycler_profiles SET verified_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(userId)
    return { ok: true }
}

function revoke(db, userId) {
    if (!recyclerProfile(db, userId)) return fail(404, "Reciclador não encontrado.")
    db.prepare(`UPDATE recycler_profiles SET verified_at = NULL WHERE user_id = ?`).run(userId)
    return { ok: true }
}

// Workshops com as respetivas inscrições — a única forma de a equipa saber
// quem aparece. Duas consultas em vez de uma por workshop.
function workshopsWithSignups(db) {
    const workshops = db.prepare(`SELECT * FROM workshops ORDER BY date DESC`).all()
    const signups = db.prepare(`
        SELECT * FROM workshop_signups ORDER BY workshop_id, created_at, id
    `).all()

    const byWorkshop = new Map(workshops.map(w => [w.id, []]))
    for (const signup of signups) {
        const list = byWorkshop.get(signup.workshop_id)
        if (list) list.push(signup)
    }

    return workshops.map(workshop => {
        const list = byWorkshop.get(workshop.id)
        return Object.assign({}, workshop, {
            signups: list,
            total: list.length,
            spotsLeft: Math.max(workshop.capacity - list.length, 0)
        })
    })
}

module.exports = { pendingRecyclers, verifiedRecyclers, verify, revoke, workshopsWithSignups }
