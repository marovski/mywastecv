const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addProfile, addListing } = require("./helpers")
const impacto = require("../src/domain/impacto")

function addCollection(db, listingId, recyclerId, citizenId, weights) {
    db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json)
        VALUES (?, ?, ?, ?)
    `).run(listingId, recyclerId, citizenId, JSON.stringify(weights))
}

test("base vazia dá tudo a zero", () => {
    assert.deepStrictEqual(impacto.metrics(freshDb()), {
        workshops: 0, flows: 0, recyclers: 0, citizens: 0, kg: 0, co2e: 0
    })
})

test("kg e co2e somam os pesos com os fatores do material", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    // Metal 4.0/kg, Vidro 0.3/kg
    addCollection(db, addListing(db, c), r, c, { "Metal / Latas": 10, "Vidro": 20 })
    const m = impacto.metrics(db)
    assert.strictEqual(m.kg, 30)
    assert.strictEqual(m.co2e, Math.round(10 * 4.0 + 20 * 0.3))
})

test("material desconhecido conta em kg mas não em co2e", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    addCollection(db, addListing(db, c), r, c, { "Kryptonite": 10 })
    const m = impacto.metrics(db)
    assert.strictEqual(m.kg, 10)
    assert.strictEqual(m.co2e, 0)
})

test("flows conta pares reciclador+material distintos", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    addCollection(db, addListing(db, c), r, c, { "Vidro": 1 })
    addCollection(db, addListing(db, c), r, c, { "Vidro": 2, "Plástico": 1 })
    assert.strictEqual(impacto.metrics(db).flows, 2)
})

test("recyclers junta verificados e quem já recolheu, sem duplicar", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const verificado = addProfile(db, addUser(db, "reciclador", "Eco"))
    addProfile(db, addUser(db, "reciclador", "PorVerificar"), { verified_at: null })
    addCollection(db, addListing(db, c), verificado, c, { "Vidro": 1 })
    assert.strictEqual(impacto.metrics(db).recyclers, 1)
})

test("citizens junta quem doou e quem se inscreveu em workshops", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    addCollection(db, addListing(db, c), r, c, { "Vidro": 1 })
    db.prepare(`INSERT INTO workshops (title, date, capacity) VALUES ('W', '2026-01-01 10:00', 10)`).run()
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (1, 'Zé', 'ze@t.cv')`).run()
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (1, 'Zé', 'ze@t.cv')`).run()
    assert.strictEqual(impacto.metrics(db).citizens, 2)
})

test("workshops conta só os que já aconteceram", () => {
    const db = freshDb()
    db.prepare(`INSERT INTO workshops (title, date, capacity) VALUES ('Passado', '2020-01-01 10:00', 10)`).run()
    db.prepare(`INSERT INTO workshops (title, date, capacity) VALUES ('Futuro', '2099-01-01 10:00', 10)`).run()
    assert.strictEqual(impacto.metrics(db).workshops, 1)
})

test("weights_json corrompido é ignorado, o resto continua a contar", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json)
        VALUES (?, ?, ?, '{partido')
    `).run(addListing(db, c), r, c)
    addCollection(db, addListing(db, c), r, c, { "Vidro": 5 })
    assert.strictEqual(impacto.metrics(db).kg, 5)
})
