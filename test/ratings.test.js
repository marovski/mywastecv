const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addProfile, addListing } = require("./helpers")
const ratings = require("../src/domain/ratings")
const listings = require("../src/domain/listings")

// Um anúncio levado até ao fim: é o único ponto a partir do qual há avaliação.
function concluded() {
    const db = freshDb()
    const citizen = addUser(db, "cidadao", "Ana")
    const rec = addProfile(db, addUser(db, "reciclador", "Eco"))
    const other = addProfile(db, addUser(db, "reciclador", "Outro"))
    const listing = addListing(db, citizen)
    listings.claim(db, listing, rec)
    const claimId = db.prepare(`SELECT id FROM claims WHERE listing_id = ?`).get(listing).id
    listings.accept(db, listing, claimId, citizen)
    listings.conclude(db, listing, rec, { "Plástico": 5 })
    return { db, citizen, rec, other, listing }
}

test("as duas partes podem avaliar-se depois da recolha", () => {
    const w = concluded()
    assert.deepStrictEqual(ratings.canRate(w.db, w.listing, w.citizen), { ok: true, ratedId: w.rec })
    assert.deepStrictEqual(ratings.canRate(w.db, w.listing, w.rec), { ok: true, ratedId: w.citizen })
})

test("um terceiro não pode avaliar", () => {
    const w = concluded()
    assert.strictEqual(ratings.canRate(w.db, w.listing, w.other).ok, false)
    assert.strictEqual(ratings.rate(w.db, w.listing, w.other, 5).status, 403)
})

test("não se avalia um anúncio que não foi recolhido", () => {
    const db = freshDb()
    const c = addUser(db, "cidadao", "Ana")
    const r = addProfile(db, addUser(db, "reciclador", "Eco"))
    const l = addListing(db, c)
    listings.claim(db, l, r)
    listings.accept(db, l, db.prepare(`SELECT id FROM claims`).get().id, c)
    assert.strictEqual(ratings.canRate(db, l, c).ok, false)
    assert.strictEqual(ratings.rate(db, l, c, 5).ok, false)
})

test("rate grava a estrela e o comentário no sentido certo", () => {
    const w = concluded()
    assert.strictEqual(ratings.rate(w.db, w.listing, w.citizen, 5, "Pontuais.").ok, true)
    const row = w.db.prepare(`SELECT * FROM ratings`).get()
    assert.strictEqual(row.rater_id, w.citizen)
    assert.strictEqual(row.rated_id, w.rec)
    assert.strictEqual(row.stars, 5)
    assert.strictEqual(row.comment, "Pontuais.")
})

test("só se avalia uma vez por anúncio", () => {
    const w = concluded()
    ratings.rate(w.db, w.listing, w.citizen, 5)
    assert.strictEqual(ratings.rate(w.db, w.listing, w.citizen, 1).status, 400)
    assert.strictEqual(w.db.prepare(`SELECT COUNT(*) n FROM ratings`).get().n, 1)
    assert.strictEqual(w.db.prepare(`SELECT stars FROM ratings`).get().stars, 5)
})

test("mas as duas partes avaliam-se independentemente", () => {
    const w = concluded()
    assert.strictEqual(ratings.rate(w.db, w.listing, w.citizen, 5).ok, true)
    assert.strictEqual(ratings.rate(w.db, w.listing, w.rec, 4).ok, true)
    assert.strictEqual(w.db.prepare(`SELECT COUNT(*) n FROM ratings`).get().n, 2)
})

test("estrelas fora de 1..5 são recusadas e nada é gravado", () => {
    const w = concluded()
    for (const bad of [0, 6, -1, 2.5, "abc", null, undefined]) {
        assert.strictEqual(ratings.rate(w.db, w.listing, w.citizen, bad).status, 400, `stars=${bad}`)
    }
    assert.strictEqual(w.db.prepare(`SELECT COUNT(*) n FROM ratings`).get().n, 0)
})

test("comentário vazio fica null", () => {
    const w = concluded()
    ratings.rate(w.db, w.listing, w.citizen, 4, "   ")
    assert.strictEqual(w.db.prepare(`SELECT comment FROM ratings`).get().comment, null)
})

test("myRating diz o que este utilizador já deixou", () => {
    const w = concluded()
    assert.strictEqual(ratings.myRating(w.db, w.listing, w.citizen), null)
    ratings.rate(w.db, w.listing, w.citizen, 3, "Ok.")
    assert.strictEqual(ratings.myRating(w.db, w.listing, w.citizen).stars, 3)
})

test("summaryFor: média arredondada a uma casa, e a contagem", () => {
    const w = concluded()
    ratings.rate(w.db, w.listing, w.citizen, 4)
    const l2 = addListing(w.db, w.citizen)
    listings.claim(w.db, l2, w.rec)
    listings.accept(w.db, l2, w.db.prepare(`SELECT id FROM claims WHERE listing_id = ?`).get(l2).id, w.citizen)
    listings.conclude(w.db, l2, w.rec, { "Vidro": 1 })
    ratings.rate(w.db, l2, w.citizen, 5)
    assert.deepStrictEqual(ratings.summaryFor(w.db, w.rec), { average: 4.5, count: 2 })
})

test("summaryFor: sem avaliações devolve zero, não NaN", () => {
    const w = concluded()
    assert.deepStrictEqual(ratings.summaryFor(w.db, w.rec), { average: 0, count: 0 })
})

test("summaryByUser: mapa para o diretório, só com quem tem avaliações", () => {
    const w = concluded()
    ratings.rate(w.db, w.listing, w.citizen, 5)
    const map = ratings.summaryByUser(w.db)
    assert.deepStrictEqual(map[w.rec], { average: 5, count: 1 })
    assert.strictEqual(map[w.other], undefined)
})

test("listFor: avaliações recebidas, mais recentes primeiro, com quem avaliou", () => {
    const w = concluded()
    ratings.rate(w.db, w.listing, w.citizen, 5, "Excelente.")
    const list = ratings.listFor(w.db, w.rec)
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].rater_name, "Ana")
    assert.strictEqual(list[0].comment, "Excelente.")
})
