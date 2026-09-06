const test = require("node:test")
const assert = require("node:assert")
const profile = require("../src/domain/profile")

const base = {
    org_name: "Eco Palmarejo",
    contact_name: "Maria Semedo",
    description: "Recolha de óleo.",
    accepted_items: ["Óleo de Cozinha"],
    service_zones: ["Palmarejo"],
    does_pickup: "1",
    hours: "Seg-Sex 08:00-16:00",
    address: "Avenida OUA",
    image: "https://exemplo.cv/logo.png",
    latitude: "14.9177",
    longitude: "-23.5092"
}
const errorsOf = (r) => (r.errors || []).join(" | ")

test("parseFields: aceita coordenadas válidas", () => {
    const r = profile.parseFields(base)
    assert.strictEqual(r.errors, undefined)
    assert.strictEqual(r.values.latitude, 14.9177)
    assert.strictEqual(r.values.longitude, -23.5092)
    assert.strictEqual(r.values.contact_name, "Maria Semedo")
})

test("parseFields: sem coordenadas é válido (localização não é obrigatória)", () => {
    const r = profile.parseFields(Object.assign({}, base, { latitude: "", longitude: "" }))
    assert.strictEqual(r.errors, undefined)
    assert.strictEqual(r.values.latitude, null)
    assert.strictEqual(r.values.longitude, null)
})

test("parseFields: uma coordenada sem a outra é recusada", () => {
    const r1 = profile.parseFields(Object.assign({}, base, { longitude: "" }))
    assert.match(errorsOf(r1), /latitude e longitude/i)
    const r2 = profile.parseFields(Object.assign({}, base, { latitude: "" }))
    assert.match(errorsOf(r2), /latitude e longitude/i)
})

test("parseFields: latitude fora de -90..90 é recusada", () => {
    for (const bad of ["91", "-91", "abc"]) {
        const r = profile.parseFields(Object.assign({}, base, { latitude: bad }))
        assert.strictEqual(r.errors !== undefined, true, `latitude=${bad}`)
        assert.match(errorsOf(r), /latitude/i)
    }
})

test("parseFields: longitude fora de -180..180 é recusada", () => {
    for (const bad of ["181", "-181", "xyz"]) {
        const r = profile.parseFields(Object.assign({}, base, { longitude: bad }))
        assert.strictEqual(r.errors !== undefined, true, `longitude=${bad}`)
        assert.match(errorsOf(r), /longitude/i)
    }
})

test("parseFields: limites são válidos (90/-180 incluídos)", () => {
    const r = profile.parseFields(Object.assign({}, base, { latitude: "90", longitude: "-180" }))
    assert.strictEqual(r.errors, undefined)
    assert.strictEqual(r.values.latitude, 90)
    assert.strictEqual(r.values.longitude, -180)
})

test("parseFields: campos de texto são aparados, vazios viram null", () => {
    const r = profile.parseFields(Object.assign({}, base, { contact_name: "   ", hours: "" }))
    assert.strictEqual(r.values.contact_name, null)
    assert.strictEqual(r.values.hours, null)
})

test("parseFields: org_name vazio fica null (o chamador decide o valor por omissão)", () => {
    const r = profile.parseFields(Object.assign({}, base, { org_name: "" }))
    assert.strictEqual(r.values.org_name, null)
})

test("parseFields: materiais e zonas passam pelo mesmo filtro do domain/match", () => {
    const r = profile.parseFields(Object.assign({}, base, {
        accepted_items: ["Óleo de Cozinha", "Inventado"],
        service_zones: ["Marte"]
    }))
    assert.strictEqual(r.values.accepted_items, "Óleo de Cozinha")
    assert.strictEqual(r.values.service_zones, "")
})

test("parseFields: does_pickup/does_dropoff são sempre 0 ou 1", () => {
    const r1 = profile.parseFields(Object.assign({}, base, { does_pickup: undefined, does_dropoff: undefined }))
    assert.strictEqual(r1.values.does_pickup, 0)
    assert.strictEqual(r1.values.does_dropoff, 0)
    const r2 = profile.parseFields(Object.assign({}, base, { does_dropoff: "1" }))
    assert.strictEqual(r2.values.does_dropoff, 1)
})

test("parseFields: junta erros de coordenadas com outros erros, se houver", () => {
    const r = profile.parseFields(Object.assign({}, base, { latitude: "abc", longitude: "abc" }))
    assert.strictEqual(r.errors.length, 2)
})
