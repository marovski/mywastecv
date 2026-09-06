const test = require("node:test")
const assert = require("node:assert")
const match = require("../src/domain/match")

test("parse: CSV vira listas de domínio", () => {
    const p = match.parse({ accepted_items: "Plástico,Vidro", service_zones: "Platô,Palmarejo" })
    assert.deepStrictEqual(p.items, ["Plástico", "Vidro"])
    assert.deepStrictEqual(p.zones, ["Platô", "Palmarejo"])
})

test("parse: campos vazios ou ausentes dão listas vazias", () => {
    assert.deepStrictEqual(match.parse({}).items, [])
    assert.deepStrictEqual(match.parse({ service_zones: "" }).zones, [])
    assert.deepStrictEqual(match.parse(null).zones, [])
})

test("serialise: só guarda valores conhecidos, sem duplicados", () => {
    const s = match.serialise(["Plástico", "Inventado", "Plástico"], ["Platô", "Marte"])
    assert.strictEqual(s.accepted_items, "Plástico")
    assert.strictEqual(s.service_zones, "Platô")
})

test("serialise: aceita um valor único fora de array (form com um só checkbox)", () => {
    assert.strictEqual(match.serialise("Vidro", "Platô").accepted_items, "Vidro")
})

test("servesZone: prefixo não conta como zona", () => {
    const p = { service_zones: "Palmarejo Grande" }
    assert.strictEqual(match.servesZone(p, "Palmarejo"), false)
    assert.strictEqual(match.servesZone(p, "Palmarejo Grande"), true)
})

test("servesZone: sem zonas definidas serve todas", () => {
    assert.strictEqual(match.servesZone({ service_zones: "" }, "Platô"), true)
})

test("accepts: basta um material em comum e a zona servida", () => {
    const p = { accepted_items: "Plástico,Vidro", service_zones: "Platô" }
    assert.strictEqual(match.accepts(p, { items: "Metal / Latas,Vidro", zone: "Platô" }), true)
    assert.strictEqual(match.accepts(p, { items: "Metal / Latas", zone: "Platô" }), false)
    assert.strictEqual(match.accepts(p, { items: "Vidro", zone: "Palmarejo" }), false)
})

test("accepts: perfil por preencher aceita tudo", () => {
    assert.strictEqual(match.accepts({}, { items: "Vidro", zone: "Platô" }), true)
})

test("zoneFilterSql: cláusula que não casa prefixos", () => {
    const { freshDb, addUser, addProfile } = require("./helpers")
    const db = freshDb()
    addProfile(db, addUser(db, "reciclador", "A"), { service_zones: "Palmarejo Grande" })
    addProfile(db, addUser(db, "reciclador", "B"), { service_zones: "Palmarejo,Platô" })
    const rows = db.prepare(
        `SELECT org_name FROM recycler_profiles WHERE ${match.zoneFilterSql("service_zones")}`
    ).all("Palmarejo")
    assert.deepStrictEqual(rows.map(r => r.org_name), ["Org"])
    assert.strictEqual(rows.length, 1)
})

test("knownItems: filtra materiais desconhecidos e devolve uma lista", () => {
    assert.deepStrictEqual(match.knownItems(["Vidro", "Inventado"]), ["Vidro"])
    assert.deepStrictEqual(match.knownItems("Vidro"), ["Vidro"])
    assert.deepStrictEqual(match.knownItems(undefined), [])
})

test("splitByAnnounced: separa anunciados dos restantes, mantendo a ordem de allMaterials", () => {
    const all = [{ label: "Vidro" }, { label: "Plástico" }, { label: "Metal / Latas" }]
    const r = match.splitByAnnounced("Metal / Latas,Vidro", all)
    assert.deepStrictEqual(r.announcedMaterials.map(m => m.label), ["Vidro", "Metal / Latas"])
    assert.deepStrictEqual(r.otherMaterials.map(m => m.label), ["Plástico"])
})

test("splitByAnnounced: sem itens, tudo cai em otherMaterials", () => {
    const all = [{ label: "Vidro" }, { label: "Plástico" }]
    const r = match.splitByAnnounced("", all)
    assert.deepStrictEqual(r.announcedMaterials, [])
    assert.strictEqual(r.otherMaterials.length, 2)
})

test("splitByAnnounced: todos anunciados, otherMaterials fica vazio", () => {
    const all = [{ label: "Vidro" }, { label: "Plástico" }]
    const r = match.splitByAnnounced("Vidro,Plástico", all)
    assert.strictEqual(r.otherMaterials.length, 0)
})
