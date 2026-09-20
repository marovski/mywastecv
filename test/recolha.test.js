const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addListing } = require("./helpers")
const recolha = require("../src/domain/recolha")

test("parseWeights: JSON válido é descodificado", () => {
    const json = '{"Plástico": 2.5, "Papel": 1.0}'
    const weights = recolha.parseWeights(json)
    assert.deepStrictEqual(weights, { Plástico: 2.5, Papel: 1.0 })
})

test("parseWeights: JSON vazio é um objeto vazio", () => {
    assert.deepStrictEqual(recolha.parseWeights("{}"), {})
    assert.deepStrictEqual(recolha.parseWeights(null), {})
    assert.deepStrictEqual(recolha.parseWeights(""), {})
})

test("parseWeights: JSON corrompido devolve objeto vazio", () => {
    assert.deepStrictEqual(recolha.parseWeights("não é JSON"), {})
    assert.deepStrictEqual(recolha.parseWeights("{incompleto"), {})
})

test("parseWeights: não-objetos após parse são rejeitados", () => {
    assert.deepStrictEqual(recolha.parseWeights('"uma string"'), {})
    assert.deepStrictEqual(recolha.parseWeights('123'), {})
    assert.deepStrictEqual(recolha.parseWeights('null'), {})
})

test("totalKg: soma todos os pesos", () => {
    const json = '{"Plástico": 2.5, "Papel": 1.0, "Metal": 0.5}'
    assert.strictEqual(recolha.totalKg(json), 4.0)
})

test("totalKg: JSON corrompido devolve 0", () => {
    assert.strictEqual(recolha.totalKg("não é JSON"), 0)
    assert.strictEqual(recolha.totalKg(null), 0)
})

test("totalKg: valores não numéricos são ignorados", () => {
    const json = '{"Plástico": 2.5, "Papel": "abc", "Metal": 0.5}'
    assert.strictEqual(recolha.totalKg(json), 3.0)
})

test("totalCo2e: calcula o CO2e usando os fatores da tabela", () => {
    const json = '{"Plástico": 1, "Vidro": 1}'
    const co2e = recolha.totalCo2e(json)
    // O valor depende dos factores em materials.js, mas deve ser > 0
    assert.strictEqual(typeof co2e, "number")
    assert(co2e > 0)
})

test("totalCo2e: JSON corrompido devolve 0", () => {
    assert.strictEqual(recolha.totalCo2e("não é JSON"), 0)
})

test("flows: devolve os materiais únicos", () => {
    const json = '{"Plástico": 2.5, "Papel": 1.0}'
    const labels = recolha.flows(json)
    assert.deepStrictEqual(labels.sort(), ["Papel", "Plástico"])
})

test("flows: JSON corrompido devolve array vazio", () => {
    assert.deepStrictEqual(recolha.flows("não é JSON"), [])
})

test("loadCollection: carrega um registro de recolha com pesos descodificados", () => {
    const db = freshDb()
    const citizen = addUser(db, "cidadao", "Ana")
    const listing = addListing(db, citizen)
    const recycler = addUser(db, "reciclador", "Eco")
    const json = '{"Plástico": 2.5}'
    db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json, collected_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(listing, recycler, citizen, json, "2026-09-20 10:00")

    const collection = recolha.loadCollection(db, listing)
    assert.strictEqual(collection.listing_id, listing)
    assert.deepStrictEqual(collection.weights, { Plástico: 2.5 })
})

test("loadCollection: id inexistente devolve null", () => {
    const db = freshDb()
    assert.strictEqual(recolha.loadCollection(db, 9999), null)
})

test("loadCollection: JSON corrompido é tolerado", () => {
    const db = freshDb()
    const citizen = addUser(db, "cidadao", "Ana")
    const listing = addListing(db, citizen)
    const recycler = addUser(db, "reciclador", "Eco")
    db.prepare(`
        INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json, collected_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(listing, recycler, citizen, "não é JSON", "2026-09-20 10:00")

    const collection = recolha.loadCollection(db, listing)
    assert.deepStrictEqual(collection.weights, {})
})
