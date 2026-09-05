// Adaptador em memória: o mesmo esquema, sem tocar no disco.
// Segundo adaptador da mesma interface que os módulos de domínio usam em produção.
const { DatabaseSync } = require("node:sqlite")
const { createSchema } = require("../src/database/schema")

function freshDb() {
    const db = new DatabaseSync(":memory:")
    createSchema(db)
    return db
}

function addUser(db, role, name, extra = {}) {
    const info = db.prepare(`
        INSERT INTO users (role, name, email, phone, zone, password_hash)
        VALUES (?, ?, ?, ?, ?, 'x')
    `).run(role, name, extra.email || `${name.replace(/\W/g, "")}@t.cv`,
           extra.phone || null, extra.zone || "Platô")
    return info.lastInsertRowid
}

function addProfile(db, userId, extra = {}) {
    db.prepare(`
        INSERT INTO recycler_profiles (user_id, org_name, accepted_items, service_zones, verified_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(userId, extra.org_name || "Org", extra.accepted_items || "",
           extra.service_zones || "", extra.verified_at === undefined ? "2026-01-01" : extra.verified_at)
    return userId
}

function addListing(db, citizenId, extra = {}) {
    const info = db.prepare(`
        INSERT INTO listings (citizen_id, items, quantity_kg_est, zone, address, note, status, available_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(citizenId, extra.items || "Plástico", extra.quantity_kg_est || null,
           extra.zone || "Platô", extra.address || "Rua X, 1", extra.note || null,
           extra.status || "aberta", extra.available_until || null)
    return info.lastInsertRowid
}

module.exports = { freshDb, addUser, addProfile, addListing }
