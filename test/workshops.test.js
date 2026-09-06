const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser } = require("./helpers")
const workshops = require("../src/domain/workshops")

const valid = {
    title: "Compostagem doméstica",
    description: "Prático.",
    date: "2026-10-05 16:00",
    zone: "Palmarejo",
    capacity: "25"
}
const errorsOf = (r) => (r.errors || []).join(" | ")

test("create: grava e devolve o id", () => {
    const db = freshDb()
    const r = workshops.create(db, valid)
    assert.strictEqual(r.ok, true)
    const row = workshops.get(db, r.id)
    assert.strictEqual(row.title, "Compostagem doméstica")
    assert.strictEqual(row.date, "2026-10-05 16:00")
    assert.strictEqual(row.zone, "Palmarejo")
    assert.strictEqual(row.capacity, 25)
})

test("create: guarda a data no formato que o /workshops compara", () => {
    const db = freshDb()
    // O input datetime-local envia com T; a listagem compara strings com espaço.
    const r = workshops.create(db, Object.assign({}, valid, { date: "2026-10-05T16:00" }))
    assert.strictEqual(workshops.get(db, r.id).date, "2026-10-05 16:00")
})

test("create: título é obrigatório", () => {
    const db = freshDb()
    const r = workshops.create(db, Object.assign({}, valid, { title: "   " }))
    assert.strictEqual(r.status, 400)
    assert.match(errorsOf(r), /título/i)
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM workshops`).get().n, 0)
})

test("create: data inválida é recusada", () => {
    const db = freshDb()
    for (const bad of ["", "amanhã", "2026-13-40 99:99", "2026-10-05"]) {
        const r = workshops.create(db, Object.assign({}, valid, { date: bad }))
        assert.strictEqual(r.status, 400, `date=${bad}`)
        assert.match(errorsOf(r), /data/i)
    }
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM workshops`).get().n, 0)
})

test("create: zona tem de ser uma zona da Praia", () => {
    const db = freshDb()
    const r = workshops.create(db, Object.assign({}, valid, { zone: "Lisboa" }))
    assert.strictEqual(r.status, 400)
    assert.match(errorsOf(r), /zona/i)
})

test("create: zona vazia é aceite (workshop sem local definido)", () => {
    const db = freshDb()
    const r = workshops.create(db, Object.assign({}, valid, { zone: "" }))
    assert.strictEqual(r.ok, true)
    assert.strictEqual(workshops.get(db, r.id).zone, null)
})

test("create: capacidade tem de ser um inteiro positivo", () => {
    const db = freshDb()
    for (const bad of ["0", "-3", "abc", "2.5", ""]) {
        const r = workshops.create(db, Object.assign({}, valid, { capacity: bad }))
        assert.strictEqual(r.status, 400, `capacity=${bad}`)
        assert.match(errorsOf(r), /lugares|capacidade/i)
    }
})

test("create: junta todos os erros de uma vez", () => {
    const db = freshDb()
    const r = workshops.create(db, { title: "", date: "x", zone: "Marte", capacity: "0" })
    assert.strictEqual(r.errors.length, 4)
})

test("update: altera os campos e mantém o id", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    assert.strictEqual(workshops.update(db, id, Object.assign({}, valid, { title: "Novo título", capacity: "40" })).ok, true)
    const row = workshops.get(db, id)
    assert.strictEqual(row.id, id)
    assert.strictEqual(row.title, "Novo título")
    assert.strictEqual(row.capacity, 40)
})

test("update: valida como o create e não grava nada se falhar", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    assert.strictEqual(workshops.update(db, id, Object.assign({}, valid, { title: "" })).status, 400)
    assert.strictEqual(workshops.get(db, id).title, "Compostagem doméstica")
})

test("update/get/remove: id inexistente dá 404", () => {
    const db = freshDb()
    assert.strictEqual(workshops.get(db, 9999), null)
    assert.strictEqual(workshops.update(db, 9999, valid).status, 404)
    assert.strictEqual(workshops.remove(db, 9999).status, 404)
})

test("remove: apaga o workshop e diz quantas inscrições levou consigo", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (?, 'Ana', 'a@t.cv')`).run(id)
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (?, 'Zé', 'z@t.cv')`).run(id)
    assert.deepStrictEqual(workshops.remove(db, id), { ok: true, deletedSignups: 2 })
    assert.strictEqual(workshops.get(db, id), null)
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM workshop_signups`).get().n, 0)
})

test("remove: sem inscrições, deletedSignups é 0", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    assert.deepStrictEqual(workshops.remove(db, id), { ok: true, deletedSignups: 0 })
})

test("signupCount: quantas inscrições um workshop tem, antes de o apagar", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    assert.strictEqual(workshops.signupCount(db, id), 0)
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (?, 'Ana', 'a@t.cv')`).run(id)
    assert.strictEqual(workshops.signupCount(db, id), 1)
})
