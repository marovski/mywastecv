const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addProfile, addListing } = require("./helpers")
const visibility = require("../src/domain/visibility")

function scenario({ claimStatus = null, listingStatus = "aberta" } = {}) {
    const db = freshDb()
    const citizen = addUser(db, "cidadao", "Ana", { phone: "9911111" })
    const rec = addProfile(db, addUser(db, "reciclador", "Eco", { phone: "9922222" }))
    const other = addProfile(db, addUser(db, "reciclador", "Outro", { phone: "9933333" }))
    const listing = addListing(db, citizen, { status: listingStatus, address: "Rua Secreta, 9" })
    if (claimStatus) {
        db.prepare(`INSERT INTO claims (listing_id, recycler_id, status) VALUES (?, ?, ?)`)
          .run(listing, rec, claimStatus)
    }
    return { db, citizen, rec, other, listing }
}

const asUser = (id, role) => ({ id, role, name: "N" })

test("sem match: nem o dono vê contactos do reciclador, e o dono vê os seus", () => {
    const s = scenario()
    const v = visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao"))
    assert.strictEqual(v.isOwner, true)
    assert.strictEqual(v.canSeeContact, true)
    assert.strictEqual(v.listing.address, "Rua Secreta, 9")
})

test("reciclador sem claim aceite não vê morada nem telefone", () => {
    const s = scenario({ claimStatus: "pendente" })
    const v = visibility.forListing(s.db, s.listing, asUser(s.rec, "reciclador"))
    assert.strictEqual(v.canSeeContact, false)
    assert.strictEqual(v.listing.address, null)
    assert.strictEqual(v.listing.citizen_phone, null)
})

test("reciclador aceite vê morada e telefone", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "reservada" })
    const v = visibility.forListing(s.db, s.listing, asUser(s.rec, "reciclador"))
    assert.strictEqual(v.canSeeContact, true)
    assert.strictEqual(v.listing.address, "Rua Secreta, 9")
    assert.strictEqual(v.listing.citizen_phone, "9911111")
})

test("outro reciclador não vê nada, mesmo havendo um match", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "reservada" })
    const v = visibility.forListing(s.db, s.listing, asUser(s.other, "reciclador"))
    assert.strictEqual(v.canSeeContact, false)
    assert.strictEqual(v.listing.address, null)
    assert.strictEqual(v.listing.citizen_phone, null)
})

test("um cidadão que não é o dono não vê contactos", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "reservada" })
    const intruso = addUser(s.db, "cidadao", "Intruso")
    const v = visibility.forListing(s.db, s.listing, asUser(intruso, "cidadao"))
    assert.strictEqual(v.isOwner, false)
    assert.strictEqual(v.canSeeContact, false)
    assert.strictEqual(v.listing.address, null)
})

test("links WhatsApp: o dono recebe o link para o reciclador aceite", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "reservada" })
    const v = visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao"))
    assert.match(v.waToRecycler, /^https:\/\/wa\.me\/2389922222\?text=/)
    assert.strictEqual(v.waToCitizen, null)
})

test("links WhatsApp: o reciclador aceite recebe o link para o cidadão", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "reservada" })
    const v = visibility.forListing(s.db, s.listing, asUser(s.rec, "reciclador"))
    assert.match(v.waToCitizen, /^https:\/\/wa\.me\/2389911111\?text=/)
    assert.strictEqual(v.waToRecycler, null)
})

test("links WhatsApp: nada antes de haver match", () => {
    const s = scenario({ claimStatus: "pendente" })
    const v = visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao"))
    assert.strictEqual(v.waToRecycler, null)
    assert.strictEqual(v.waToCitizen, null)
})

test("claims só são listados ao dono", () => {
    const s = scenario({ claimStatus: "pendente" })
    assert.strictEqual(visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao")).claims.length, 1)
    assert.strictEqual(visibility.forListing(s.db, s.listing, asUser(s.rec, "reciclador")).claims.length, 0)
})

test("myClaim só existe para recicladores", () => {
    const s = scenario({ claimStatus: "pendente" })
    assert.ok(visibility.forListing(s.db, s.listing, asUser(s.rec, "reciclador")).myClaim)
    assert.strictEqual(visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao")).myClaim, null)
})

test("canConclude: só as duas partes, e só com anúncio reservado", () => {
    const ok = scenario({ claimStatus: "aceite", listingStatus: "reservada" })
    assert.strictEqual(visibility.forListing(ok.db, ok.listing, asUser(ok.citizen, "cidadao")).canConclude, true)
    assert.strictEqual(visibility.forListing(ok.db, ok.listing, asUser(ok.rec, "reciclador")).canConclude, true)
    assert.strictEqual(visibility.forListing(ok.db, ok.listing, asUser(ok.other, "reciclador")).canConclude, false)

    const aberta = scenario({ claimStatus: "pendente" })
    assert.strictEqual(visibility.forListing(aberta.db, aberta.listing, asUser(aberta.citizen, "cidadao")).canConclude, false)
})

test("anúncio inexistente devolve null", () => {
    const s = scenario()
    assert.strictEqual(visibility.forListing(s.db, 9999, asUser(s.citizen, "cidadao")), null)
})

test("a recolha registada vem com os pesos já descodificados", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "recolhida" })
    s.db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json)
        VALUES (?, ?, ?, ?)
    `).run(s.listing, s.rec, s.citizen, '{"Plástico":3.5}')
    const v = visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao"))
    assert.deepStrictEqual(v.collection.weights, { "Plástico": 3.5 })
})

test("weights_json corrompido não rebenta", () => {
    const s = scenario({ claimStatus: "aceite", listingStatus: "recolhida" })
    s.db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json)
        VALUES (?, ?, ?, ?)
    `).run(s.listing, s.rec, s.citizen, "{nao-e-json")
    const v = visibility.forListing(s.db, s.listing, asUser(s.citizen, "cidadao"))
    assert.deepStrictEqual(v.collection.weights, {})
})
