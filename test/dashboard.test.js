const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addProfile, addListing } = require("./helpers")
const dashboard = require("../src/domain/dashboard")
const listings = require("../src/domain/listings")

function agedListing(db, citizenId, days, extra = {}) {
    const id = addListing(db, citizenId, extra)
    db.prepare(`UPDATE listings SET created_at = datetime('now', ?) WHERE id = ?`)
      .run(`-${days} days`, id)
    return id
}

test("listingsByStatus: os quatro estados aparecem sempre, mesmo a zero", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    addListing(db, c)
    addListing(db, c, { status: "recolhida" })
    addListing(db, c, { status: "recolhida" })
    assert.deepStrictEqual(dashboard.listingsByStatus(db), {
        aberta: 1, reservada: 0, recolhida: 2, expirada: 0
    })
})

test("claimsAwaitingAnswer: anúncios com pedidos pendentes, com quantos e há quanto tempo", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r1 = addProfile(db, addUser(db, "reciclador", "Eco"))
    const r2 = addProfile(db, addUser(db, "reciclador", "Dois"))
    const l = agedListing(db, c, 3)
    listings.claim(db, l, r1)
    listings.claim(db, l, r2)
    const [row] = dashboard.claimsAwaitingAnswer(db)
    assert.strictEqual(row.listing_id, l)
    assert.strictEqual(row.citizen_name, "Ana")
    assert.strictEqual(row.pending, 2)
    assert.ok(row.days_waiting >= 0)
})

test("claimsAwaitingAnswer: ignora anúncios já reservados ou sem pendentes", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    const l = addListing(db, c)
    listings.claim(db, l, r)
    listings.accept(db, l, db.prepare(`SELECT id FROM claims`).get().id, c)
    assert.deepStrictEqual(dashboard.claimsAwaitingAnswer(db), [])
})

test("claimsAwaitingAnswer: a espera conta-se desde o pedido, não desde o anúncio", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    // O anúncio antigo recebeu um pedido hoje; o recente tem um pedido de há
    // uma semana. Quem espera resposta há mais tempo é o segundo.
    const anuncioAntigo = agedListing(db, c, 30)
    const anuncioRecente = agedListing(db, c, 1)
    listings.claim(db, anuncioAntigo, r)
    listings.claim(db, anuncioRecente, r)
    db.prepare(`UPDATE claims SET created_at = datetime('now', '-7 days') WHERE listing_id = ?`)
      .run(anuncioRecente)

    const rows = dashboard.claimsAwaitingAnswer(db)
    assert.deepStrictEqual(rows.map(x => x.listing_id), [anuncioRecente, anuncioAntigo])
    assert.ok(rows[0].days_waiting >= 7, `esperava >= 7, veio ${rows[0].days_waiting}`)
    assert.strictEqual(rows[1].days_waiting, 0)
})

test("staleOpenListings: abertos há muito tempo e sem um único pedido", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    const parado = agedListing(db, c, 20)
    const recente = agedListing(db, c, 2)
    const comPedido = agedListing(db, c, 20)
    listings.claim(db, comPedido, r)
    const rows = dashboard.staleOpenListings(db, 14)
    assert.deepStrictEqual(rows.map(x => x.id), [parado])
    assert.ok(rows[0].days_open >= 14)
    assert.strictEqual(recente !== undefined, true)
})

test("staleOpenListings: só conta os abertos", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const id = agedListing(db, c, 30, { status: "expirada" })
    assert.deepStrictEqual(dashboard.staleOpenListings(db, 14).map(x => x.id), [])
    assert.ok(id)
})

test("recentCollections: mais recentes primeiro, com nomes e total de kg", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    for (const w of [{ "Vidro": 2 }, { "Metal / Latas": 3, "Vidro": 1 }]) {
        const l = addListing(db, c)
        listings.claim(db, l, r)
        listings.accept(db, l, db.prepare(`SELECT id FROM claims WHERE listing_id = ?`).get(l).id, c)
        listings.conclude(db, l, r, w)
    }
    const rows = dashboard.recentCollections(db, 10)
    assert.strictEqual(rows.length, 2)
    assert.strictEqual(rows[0].kg, 4)
    assert.strictEqual(rows[0].citizen_name, "Ana")
    assert.strictEqual(rows[0].recycler_name, "Eco")
})

test("recentCollections: respeita o limite e aguenta weights_json partido", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json)
        VALUES (?, ?, ?, '{partido')
    `).run(addListing(db, c), r, c)
    const rows = dashboard.recentCollections(db, 1)
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].kg, 0)
})

test("counts: utilizadores por papel e recicladores por verificar", () => {
    const db = freshDb()
    addUser(db, "cidadao", "Ana"); addUser(db, "cidadao", "Joao")
    addProfile(db, addUser(db, "reciclador", "Eco"))
    addProfile(db, addUser(db, "reciclador", "Novo"), { verified_at: null })
    addUser(db, "admin", "Equipa")
    assert.deepStrictEqual(dashboard.counts(db), {
        cidadaos: 2, recicladores: 2, recicladoresPorVerificar: 1, admins: 1
    })
})

test("overview: junta tudo numa só chamada", () => {
    const db = freshDb()
    addUser(db, "cidadao", "Ana")
    const o = dashboard.overview(db)
    assert.deepStrictEqual(Object.keys(o).sort(),
        ["awaiting", "byStatus", "collections", "counts", "stale"].sort())
})
