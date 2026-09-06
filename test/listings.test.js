const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addProfile, addListing } = require("./helpers")
const listings = require("../src/domain/listings")

function world({ verified = true, listingStatus = "aberta" } = {}) {
    const db = freshDb()
    const citizen = addUser(db, "cidadao", "Ana")
    const rec = addProfile(db, addUser(db, "reciclador", "Eco"), { verified_at: verified ? "2026-01-01" : null })
    const rec2 = addProfile(db, addUser(db, "reciclador", "Dois"))
    const listing = addListing(db, citizen, { status: listingStatus })
    return { db, citizen, rec, rec2, listing }
}
const statusOf = (db, id) => db.prepare(`SELECT status FROM listings WHERE id = ?`).get(id).status
const claimsOf = (db, id) => db.prepare(`SELECT id, recycler_id, status FROM claims WHERE listing_id = ? ORDER BY id`).all(id)

test("claim: reciclador verificado reivindica um anúncio aberto", () => {
    const w = world()
    assert.deepStrictEqual(listings.claim(w.db, w.listing, w.rec, "olá"), { ok: true })
    assert.strictEqual(claimsOf(w.db, w.listing)[0].status, "pendente")
})

test("claim: reciclador por verificar é recusado", () => {
    const w = world({ verified: false })
    const r = listings.claim(w.db, w.listing, w.rec)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.status, 403)
    assert.strictEqual(claimsOf(w.db, w.listing).length, 0)
})

test("claim: anúncio que não está aberto é recusado", () => {
    const w = world({ listingStatus: "reservada" })
    assert.strictEqual(listings.claim(w.db, w.listing, w.rec).ok, false)
})

test("claim: reivindicar duas vezes não cria um segundo pedido", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.claim(w.db, w.listing, w.rec)
    assert.strictEqual(claimsOf(w.db, w.listing).length, 1)
})

test("accept: reserva o anúncio e recusa os restantes pedidos", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.claim(w.db, w.listing, w.rec2)
    const mine = claimsOf(w.db, w.listing)[0]
    assert.deepStrictEqual(listings.accept(w.db, w.listing, mine.id, w.citizen), { ok: true })
    assert.strictEqual(statusOf(w.db, w.listing), "reservada")
    assert.deepStrictEqual(claimsOf(w.db, w.listing).map(c => c.status), ["aceite", "recusada"])
})

test("accept: só o dono pode aceitar", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    const id = claimsOf(w.db, w.listing)[0].id
    const r = listings.accept(w.db, w.listing, id, addUser(w.db, "cidadao", "Intruso"))
    assert.strictEqual(r.status, 403)
    assert.strictEqual(statusOf(w.db, w.listing), "aberta")
})

test("accept: um pedido já aceite não é aceite outra vez", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    const id = claimsOf(w.db, w.listing)[0].id
    listings.accept(w.db, w.listing, id, w.citizen)
    assert.strictEqual(listings.accept(w.db, w.listing, id, w.citizen).ok, false)
})

test("withdraw: retirar o pedido aceite volta a abrir o anúncio", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    const id = claimsOf(w.db, w.listing)[0].id
    listings.accept(w.db, w.listing, id, w.citizen)
    assert.deepStrictEqual(listings.withdraw(w.db, id, w.rec), { ok: true, listingId: w.listing })
    assert.strictEqual(statusOf(w.db, w.listing), "aberta")
})

test("withdraw: retirar um pedido pendente não mexe no anúncio", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.withdraw(w.db, claimsOf(w.db, w.listing)[0].id, w.rec)
    assert.strictEqual(statusOf(w.db, w.listing), "aberta")
})

test("withdraw: só o autor do pedido o retira", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    assert.strictEqual(listings.withdraw(w.db, claimsOf(w.db, w.listing)[0].id, w.rec2).status, 403)
})

test("expire: o dono expira um anúncio aberto ou reservado", () => {
    const w = world()
    assert.strictEqual(listings.expire(w.db, w.listing, w.citizen).ok, true)
    assert.strictEqual(statusOf(w.db, w.listing), "expirada")
})

test("expire: não é do dono, não expira", () => {
    const w = world()
    assert.strictEqual(listings.expire(w.db, w.listing, addUser(w.db, "cidadao", "X")).status, 403)
    assert.strictEqual(statusOf(w.db, w.listing), "aberta")
})

test("conclude: regista pesos, marca recolhida, qualquer uma das partes", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.accept(w.db, w.listing, claimsOf(w.db, w.listing)[0].id, w.citizen)
    const r = listings.conclude(w.db, w.listing, w.rec, { "Plástico": 4.25 })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(statusOf(w.db, w.listing), "recolhida")
    const rec = w.db.prepare(`SELECT * FROM collection_records WHERE listing_id = ?`).get(w.listing)
    assert.deepStrictEqual(JSON.parse(rec.weights_json), { "Plástico": 4.25 })
    assert.strictEqual(rec.recycler_id, w.rec)
    assert.strictEqual(rec.citizen_id, w.citizen)
})

test("conclude: sem pesos é recusado e nada muda", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.accept(w.db, w.listing, claimsOf(w.db, w.listing)[0].id, w.citizen)
    assert.strictEqual(listings.conclude(w.db, w.listing, w.citizen, {}).status, 400)
    assert.strictEqual(statusOf(w.db, w.listing), "reservada")
})

test("conclude: um anúncio aberto não se conclui", () => {
    const w = world()
    assert.strictEqual(listings.conclude(w.db, w.listing, w.citizen, { "Plástico": 1 }).ok, false)
})

test("conclude: um terceiro não conclui", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.accept(w.db, w.listing, claimsOf(w.db, w.listing)[0].id, w.citizen)
    assert.strictEqual(listings.conclude(w.db, w.listing, w.rec2, { "Plástico": 1 }).status, 403)
})

test("conclude: não se conclui duas vezes", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    listings.accept(w.db, w.listing, claimsOf(w.db, w.listing)[0].id, w.citizen)
    listings.conclude(w.db, w.listing, w.rec, { "Plástico": 1 })
    assert.strictEqual(listings.conclude(w.db, w.listing, w.rec, { "Plástico": 1 }).ok, false)
    assert.strictEqual(w.db.prepare(`SELECT COUNT(*) AS n FROM collection_records`).get().n, 1)
})

test("sweepExpired: fecha os abertos fora de validade e poupa os outros", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const velho = addListing(db, c, { available_until: "2020-01-01" })
    const novo = addListing(db, c, { available_until: "2099-01-01" })
    const semPrazo = addListing(db, c)
    const reservado = addListing(db, c, { status: "reservada", available_until: "2020-01-01" })
    listings.sweepExpired(db)
    assert.strictEqual(statusOf(db, velho), "expirada")
    assert.strictEqual(statusOf(db, novo), "aberta")
    assert.strictEqual(statusOf(db, semPrazo), "aberta")
    assert.strictEqual(statusOf(db, reservado), "reservada")
})

test("accept: a transição é atómica — nada fica meio feito se falhar", () => {
    const w = world()
    listings.claim(w.db, w.listing, w.rec)
    const id = claimsOf(w.db, w.listing)[0].id
    // Apagar o anúncio por baixo faz o UPDATE final não encontrar nada;
    // o pedido não pode ficar aceite sozinho.
    w.db.exec(`PRAGMA foreign_keys = OFF`)
    w.db.prepare(`DELETE FROM listings WHERE id = ?`).run(w.listing)
    const r = listings.accept(w.db, w.listing, id, w.citizen)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(claimsOf(w.db, w.listing)[0].status, "pendente")
})

test("moderate: remove um anúncio aberto, com motivo", () => {
    const w = world()
    assert.strictEqual(listings.moderate(w.db, w.listing, "Conteúdo inapropriado.").ok, true)
    assert.strictEqual(statusOf(w.db, w.listing), "removida")
    assert.strictEqual(
        w.db.prepare(`SELECT moderation_reason FROM listings WHERE id = ?`).get(w.listing).moderation_reason,
        "Conteúdo inapropriado."
    )
})

test("moderate: exige um motivo", () => {
    const w = world()
    for (const bad of [undefined, null, "", "   "]) {
        const r = listings.moderate(w.db, w.listing, bad)
        assert.strictEqual(r.status, 400, `reason=${JSON.stringify(bad)}`)
    }
    assert.strictEqual(statusOf(w.db, w.listing), "aberta")
})

test("moderate: só um anúncio aberto pode ser removido", () => {
    const reservado = world({ listingStatus: "reservada" })
    assert.strictEqual(listings.moderate(reservado.db, reservado.listing, "x").status, 400)
    assert.strictEqual(statusOf(reservado.db, reservado.listing), "reservada")

    const recolhido = world({ listingStatus: "recolhida" })
    assert.strictEqual(listings.moderate(recolhido.db, recolhido.listing, "x").status, 400)
})

test("moderate: anúncio inexistente dá 404", () => {
    const w = world()
    assert.strictEqual(listings.moderate(w.db, 9999, "x").status, 404)
})

test("restore: devolve um anúncio removido ao board, sem o motivo", () => {
    const w = world()
    listings.moderate(w.db, w.listing, "Engano.")
    assert.strictEqual(listings.restore(w.db, w.listing).ok, true)
    assert.strictEqual(statusOf(w.db, w.listing), "aberta")
    assert.strictEqual(
        w.db.prepare(`SELECT moderation_reason FROM listings WHERE id = ?`).get(w.listing).moderation_reason,
        null
    )
})

test("restore: só um anúncio removido pode ser restaurado", () => {
    const w = world()
    assert.strictEqual(listings.restore(w.db, w.listing).status, 400)
    assert.strictEqual(listings.restore(w.db, 9999).status, 404)
})

test("moderate: um anúncio removido some do board do reciclador", () => {
    const w = world()
    listings.moderate(w.db, w.listing, "x")
    const open = w.db.prepare(`SELECT id FROM listings WHERE status = 'aberta'`).all()
    assert.strictEqual(open.length, 0)
})
