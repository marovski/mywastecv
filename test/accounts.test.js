const test = require("node:test")
const assert = require("node:assert")
const { freshDb, addUser } = require("./helpers")
const accounts = require("../src/domain/accounts")

const validRegister = {
    name: "Ana Silva",
    email: "ana@exemplo.cv",
    phone: "9876543",
    zone: "Platô",
    password: "password123",
    password2: "password123",
    role: "cidadao"
}

test("register: cria um utilizador cidadão com sucesso", () => {
    const db = freshDb()
    const result = accounts.register(db, validRegister)
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.role, "cidadao")

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.userId)
    assert.strictEqual(user.name, "Ana Silva")
    assert.strictEqual(user.email, "ana@exemplo.cv")
    assert.strictEqual(user.role, "cidadao")
})

test("register: cria um reciclador com profile", () => {
    const db = freshDb()
    const result = accounts.register(db, Object.assign({}, validRegister, { role: "reciclador" }))
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.role, "reciclador")

    const profile = db.prepare(`SELECT * FROM recycler_profiles WHERE user_id = ?`).get(result.userId)
    assert.strictEqual(profile.org_name, "Ana Silva")
})

test("register: nome é obrigatório", () => {
    const db = freshDb()
    const result = accounts.register(db, Object.assign({}, validRegister, { name: "   " }))
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.status, 400)
    assert(result.errors.some(e => e.includes("nome")))
})

test("register: email é obrigatório e válido", () => {
    const db = freshDb()
    for (const bad of ["", "semargoba", "user@dominio"]) {
        const result = accounts.register(db, Object.assign({}, validRegister, { email: bad }))
        assert.strictEqual(result.ok, false, `email=${bad}`)
        assert(result.errors.some(e => e.includes("email") || e.includes("Email")))
    }
})

test("register: zona é obrigatória e válida", () => {
    const db = freshDb()
    const result = accounts.register(db, Object.assign({}, validRegister, { zone: "Lisboa" }))
    assert.strictEqual(result.ok, false)
    assert(result.errors.some(e => e.includes("zona")))
})

test("register: password deve ter pelo menos 8 caracteres", () => {
    const db = freshDb()
    const result = accounts.register(db, Object.assign({}, validRegister, { password: "short" }))
    assert.strictEqual(result.ok, false)
    assert(result.errors.some(e => e.includes("password") || e.includes("caracteres")))
})

test("register: passwords devem coincidir", () => {
    const db = freshDb()
    const result = accounts.register(db, Object.assign({}, validRegister, { password2: "diferente" }))
    assert.strictEqual(result.ok, false)
    assert(result.errors.some(e => e.includes("não coincidem")))
})

test("register: email deve ser único", () => {
    const db = freshDb()
    accounts.register(db, validRegister)
    const result = accounts.register(db, Object.assign({}, validRegister, { name: "Outro" }))
    assert.strictEqual(result.ok, false)
    assert(result.errors.some(e => e.toLowerCase().includes("já existe")))
})

test("register: email é normalizado (lowercase)", () => {
    const db = freshDb()
    const result = accounts.register(db, Object.assign({}, validRegister, { email: "ANA@EXEMPLO.CV" }))
    assert.strictEqual(result.ok, true)

    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get("ana@exemplo.cv")
    assert.ok(user)
})

test("authenticate: login bem-sucedido com password correta", () => {
    const db = freshDb()
    const user = addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: "password123" })
    const throttle = accounts.createThrottle()

    const result = accounts.authenticate(db, "ana@t.cv", "password123", throttle, "127.0.0.1:ana@t.cv")
    assert.strictEqual(result.ok, true)
    assert.strictEqual(result.user.id, user)
})

test("authenticate: falha com password incorreta", () => {
    const db = freshDb()
    addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: "password123" })
    const throttle = accounts.createThrottle()

    const result = accounts.authenticate(db, "ana@t.cv", "errada", throttle, "127.0.0.1:ana@t.cv")
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.status, 401)
})

test("authenticate: falha com email inexistente", () => {
    const db = freshDb()
    const throttle = accounts.createThrottle()

    const result = accounts.authenticate(db, "inexistente@t.cv", "password123", throttle, "127.0.0.1:inexistente@t.cv")
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.status, 401)
})

test("authenticate: throttle bloqueia após 5 tentativas", () => {
    const db = freshDb()
    addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: "password123" })
    const throttle = accounts.createThrottle()
    const key = "127.0.0.1:ana@t.cv"

    // 5 tentativas falhadas
    for (let i = 0; i < 5; i++) {
        const result = accounts.authenticate(db, "ana@t.cv", "errada", throttle, key)
        assert.strictEqual(result.ok, false)
    }

    // 6ª tentativa é bloqueada
    const result = accounts.authenticate(db, "ana@t.cv", "password123", throttle, key)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.status, 429)
})

test("authenticate: throttle limpa na tentativa bem-sucedida", () => {
    const db = freshDb()
    const user = addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: "password123" })
    const throttle = accounts.createThrottle()
    const key = "127.0.0.1:ana@t.cv"

    // Uma tentativa falhada
    accounts.authenticate(db, "ana@t.cv", "errada", throttle, key)

    // Uma tentativa bem-sucedida limpa o throttle
    const result = accounts.authenticate(db, "ana@t.cv", "password123", throttle, key)
    assert.strictEqual(result.ok, true)

    // Agora deve aceitar novamente (não bloqueado)
    const result2 = accounts.authenticate(db, "ana@t.cv", "errada", throttle, key)
    assert.strictEqual(result2.ok, false)
    assert.strictEqual(result2.status, 401)
})

test("createThrottle: diferentes throttles são independentes", () => {
    const db = freshDb()
    addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: "password123" })

    const throttle1 = accounts.createThrottle()
    const throttle2 = accounts.createThrottle()
    const key = "127.0.0.1:ana@t.cv"

    // Bloqueia no throttle1
    for (let i = 0; i < 5; i++) {
        accounts.authenticate(db, "ana@t.cv", "errada", throttle1, key)
    }

    // Mas throttle2 continua a funcionar
    const result = accounts.authenticate(db, "ana@t.cv", "password123", throttle2, key)
    assert.strictEqual(result.ok, true)
})
