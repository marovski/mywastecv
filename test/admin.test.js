const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser, addProfile } = require("./helpers")
const admin = require("../src/domain/admin")

function addWorkshop(db, title, date, capacity = 30) {
    return db.prepare(`INSERT INTO workshops (title, date, capacity) VALUES (?, ?, ?)`)
        .run(title, date, capacity).lastInsertRowid
}
function signUp(db, workshopId, name, email, extra = {}) {
    db.prepare(`INSERT INTO workshop_signups (workshop_id, user_id, name, email, phone) VALUES (?, ?, ?, ?, ?)`)
      .run(workshopId, extra.userId || null, name, email, extra.phone || null)
}

test("pendingRecyclers: só recicladores por verificar, mais antigos primeiro", () => {
    const db = freshDb()
    addProfile(db, addUser(db, "reciclador", "PorVerificar"), { verified_at: null })
    addProfile(db, addUser(db, "reciclador", "Verificado"))
    addUser(db, "cidadao", "Ana")
    const rows = admin.pendingRecyclers(db)
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].name, "PorVerificar")
    assert.ok(rows[0].id, "traz o id do utilizador para o formulário")
})

test("verifiedRecyclers: traz contacto e zonas, não só o nome", () => {
    const db = freshDb()
    addProfile(db, addUser(db, "reciclador", "Eco", { phone: "9911111" }), { service_zones: "Platô" })
    const [row] = admin.verifiedRecyclers(db)
    assert.strictEqual(row.phone, "9911111")
    assert.strictEqual(row.service_zones, "Platô")
    assert.ok(row.id, "traz o id para se poder revogar a partir da lista")
})

test("verify: marca a data e tira da lista de pendentes", () => {
    const db = freshDb()
    const id = addProfile(db, addUser(db, "reciclador", "Eco"), { verified_at: null })
    assert.strictEqual(admin.verify(db, id).ok, true)
    assert.strictEqual(admin.pendingRecyclers(db).length, 0)
    assert.strictEqual(admin.verifiedRecyclers(db).length, 1)
})

test("revoke: devolve à lista de pendentes", () => {
    const db = freshDb()
    const id = addProfile(db, addUser(db, "reciclador", "Eco"))
    assert.strictEqual(admin.revoke(db, id).ok, true)
    assert.strictEqual(admin.verifiedRecyclers(db).length, 0)
    assert.strictEqual(admin.pendingRecyclers(db).length, 1)
})

test("verify/revoke: um id que não é reciclador é recusado", () => {
    const db = freshDb()
    const cidadao = addUser(db, "cidadao", "Ana")
    assert.strictEqual(admin.verify(db, cidadao).status, 404)
    assert.strictEqual(admin.revoke(db, cidadao).status, 404)
    assert.strictEqual(admin.verify(db, 9999).status, 404)
})

test("workshopsWithSignups: inscrições agrupadas, com contagem e lugares", () => {
    const db = freshDb()
    const w = addWorkshop(db, "Compostagem", "2026-10-05 16:00", 2)
    signUp(db, w, "Ana", "ana@t.cv", { phone: "991" })
    signUp(db, w, "Zé", "ze@t.cv")
    const [row] = admin.workshopsWithSignups(db)
    assert.strictEqual(row.title, "Compostagem")
    assert.strictEqual(row.total, 2)
    assert.strictEqual(row.spotsLeft, 0)
    assert.deepStrictEqual(row.signups.map(s => s.name), ["Ana", "Zé"])
    assert.strictEqual(row.signups[0].phone, "991")
})

test("workshopsWithSignups: um workshop sem inscrições aparece na mesma", () => {
    const db = freshDb()
    addWorkshop(db, "Vazio", "2026-10-05 16:00", 10)
    const [row] = admin.workshopsWithSignups(db)
    assert.strictEqual(row.total, 0)
    assert.deepStrictEqual(row.signups, [])
    assert.strictEqual(row.spotsLeft, 10)
})

test("workshopsWithSignups: lugares nunca ficam negativos", () => {
    const db = freshDb()
    const w = addWorkshop(db, "Cheio", "2026-10-05 16:00", 1)
    signUp(db, w, "A", "a@t.cv"); signUp(db, w, "B", "b@t.cv")
    assert.strictEqual(admin.workshopsWithSignups(db)[0].spotsLeft, 0)
})

test("workshopsWithSignups: mais recentes primeiro", () => {
    const db = freshDb()
    addWorkshop(db, "Antigo", "2020-01-01 10:00")
    addWorkshop(db, "Futuro", "2099-01-01 10:00")
    assert.deepStrictEqual(admin.workshopsWithSignups(db).map(w => w.title), ["Futuro", "Antigo"])
})

test("workshopsWithSignups: distingue inscrição de conta e inscrição anónima", () => {
    const db = freshDb()
    const user = addUser(db, "cidadao", "Ana")
    const w = addWorkshop(db, "W", "2026-10-05 16:00")
    signUp(db, w, "Ana", "ana@t.cv", { userId: user })
    signUp(db, w, "Anon", "anon@t.cv")
    const [row] = admin.workshopsWithSignups(db)
    assert.strictEqual(row.signups[0].user_id, user)
    assert.strictEqual(row.signups[1].user_id, null)
})
