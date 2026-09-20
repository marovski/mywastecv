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

test("getWithSpots: devolve um workshop com spotsLeft calculado", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    const w = workshops.getWithSpots(db, id)
    assert.strictEqual(w.id, id)
    assert.strictEqual(w.capacity, 25)
    assert.strictEqual(w.spotsLeft, 25)
})

test("getWithSpots: spotsLeft respira a capacidade menos as inscrições", () => {
    const db = freshDb()
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "3" }))
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (?, 'A', 'a@t')`).run(id)
    db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (?, 'B', 'b@t')`).run(id)
    const w = workshops.getWithSpots(db, id)
    assert.strictEqual(w.spotsLeft, 1)
})

test("getWithSpots: id inexistente devolve null", () => {
    const db = freshDb()
    assert.strictEqual(workshops.getWithSpots(db, 9999), null)
})

test("listUpcoming: devolve workshops com data >= agora", () => {
    const db = freshDb()
    const future = "2099-12-25 10:00"
    const past = "2000-01-01 10:00"
    const { id: fId } = workshops.create(db, Object.assign({}, valid, { title: "Futuro", date: future }))
    const { id: pId } = workshops.create(db, Object.assign({}, valid, { title: "Passado", date: past }))
    const upcoming = workshops.listUpcoming(db)
    assert(upcoming.some(w => w.id === fId), "futuro deve estar em upcoming")
    assert(!upcoming.some(w => w.id === pId), "passado não deve estar em upcoming")
})

test("listPast: devolve workshops com data < agora", () => {
    const db = freshDb()
    const future = "2099-12-25 10:00"
    const past = "2000-01-01 10:00"
    const { id: fId } = workshops.create(db, Object.assign({}, valid, { title: "Futuro", date: future }))
    const { id: pId } = workshops.create(db, Object.assign({}, valid, { title: "Passado", date: past }))
    const past_ = workshops.listPast(db)
    assert(!past_.some(w => w.id === fId), "futuro não deve estar em past")
    assert(past_.some(w => w.id === pId), "passado deve estar em past")
})

test("signup: inscrição válida grava o registo", () => {
    const db = freshDb()
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "50" }))
    const result = workshops.signup(db, id, { name: "Maria", email: "m@t.cv", phone: "9876543" }, null)
    assert.strictEqual(result.ok, true)
    const signup = db.prepare(`SELECT * FROM workshop_signups WHERE workshop_id = ?`).get(id)
    assert.strictEqual(signup.name, "Maria")
    assert.strictEqual(signup.email, "m@t.cv")
    assert.strictEqual(signup.phone, "9876543")
})

test("signup: nome é obrigatório", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    const r = workshops.signup(db, id, { name: "   ", email: "m@t.cv" }, null)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.status, 400)
    assert.match(errorsOf(r), /nome/i)
})

test("signup: email válido é obrigatório", () => {
    const db = freshDb()
    const { id } = workshops.create(db, valid)
    for (const bad of ["", "semargoba", "user@dominio"]) {
        const r = workshops.signup(db, id, { name: "Maria", email: bad }, null)
        assert.strictEqual(r.ok, false, `email=${bad}`)
        assert.match(errorsOf(r), /email|inválido/i)
    }
})

test("signup: recusa se o workshop está lotado", () => {
    const db = freshDb()
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "1" }))
    workshops.signup(db, id, { name: "Ana", email: "a@t.cv" }, null)
    const r = workshops.signup(db, id, { name: "Zé", email: "z@t.cv" }, null)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.status, 400)
    assert.match(errorsOf(r), /lotado/i)
})

test("signup: duplicado por userId para utilizador registado", () => {
    const db = freshDb()
    const userId = addUser(db, "cidadao", "User", { email: "u@t.cv", password: "teste" })
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "50" }))
    const r1 = workshops.signup(db, id, { name: "User", email: "u@t.cv", phone: "123" }, userId)
    assert.strictEqual(r1.ok, true)
    const r2 = workshops.signup(db, id, { name: "User", email: "u@t.cv", phone: "123" }, userId)
    assert.strictEqual(r2.ok, false)
    assert.strictEqual(r2.status, 400)
    assert.match(errorsOf(r2), /inscreveu/i)
})

test("signup: duplicado por email para anónimo", () => {
    const db = freshDb()
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "50" }))
    const r1 = workshops.signup(db, id, { name: "Ana", email: "a@t.cv", phone: "123" }, null)
    assert.strictEqual(r1.ok, true)
    const r2 = workshops.signup(db, id, { name: "Ana", email: "a@t.cv", phone: "123" }, null)
    assert.strictEqual(r2.ok, false)
    assert.match(errorsOf(r2), /inscrito/i)
})

test("signup: dois utilizadores registados podem ambos inscrever-se no mesmo workshop", () => {
    const db = freshDb()
    const u1 = addUser(db, "cidadao", "User1", { email: "u1@t.cv", password: "teste" })
    const u2 = addUser(db, "cidadao", "User2", { email: "u2@t.cv", password: "teste" })
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "50" }))
    const r1 = workshops.signup(db, id, { name: "U1", email: "u1@t.cv" }, u1)
    const r2 = workshops.signup(db, id, { name: "U2", email: "u2@t.cv" }, u2)
    assert.strictEqual(r1.ok, true)
    assert.strictEqual(r2.ok, true)
    assert.strictEqual(workshops.signupCount(db, id), 2)
})

test("roster: devolve workshops com inscrições e spots agrupadas", () => {
    const db = freshDb()
    const { id } = workshops.create(db, Object.assign({}, valid, { capacity: "5" }))
    for (let i = 0; i < 3; i++) {
        db.prepare(`INSERT INTO workshop_signups (workshop_id, name, email) VALUES (?, ?, ?)`)
            .run(id, `Pessoa${i}`, `p${i}@t.cv`)
    }
    const [w] = workshops.roster(db)
    assert.strictEqual(w.id, id)
    assert.strictEqual(w.signups.length, 3)
    assert.strictEqual(w.total, 3)
    assert.strictEqual(w.spotsLeft, 2)
})
