const test = require("node:test")
const assert = require("node:assert")
const { withApp } = require("./client")
const { addUser } = require("../helpers")

const PW = "senha-de-teste"

// O <input> de um material está marcado se `checked` aparece no seu próprio tag.
function isChecked(html, name, label) {
    const tag = new RegExp(`<input[^>]*name="${name}"[^>]*value="${label.replace(/[/]/g, "\\/")}"[^>]*>`).exec(html)
    assert.ok(tag, `não encontrei o campo ${name}=${label}`)
    return /\schecked\b/.test(tag[0])
}

async function citizen(app) {
    addUser(app.db, "cidadao", "Ana", { email: "ana@t.cv", password: PW })
    const c = app.client()
    assert.strictEqual((await c.login("ana@t.cv", PW)).status, 302)
    return c
}

test("login falhado: o email volta preenchido, a password nunca", async () => {
    await withApp(async (app) => {
        addUser(app.db, "cidadao", "Ana", { email: "ana@t.cv", password: PW })
        const res = await app.client().login("ana@t.cv", "senha-errada")
        assert.strictEqual(res.status, 401)
        assert.match(res.body, /<input[^>]*name="email"[^>]*value="ana@t\.cv"/)
        assert.ok(!res.body.includes("senha-errada"), "a password não pode voltar no HTML")
        assert.match(res.body, /role="alert"/)
    })
})

test("anúncio inválido: os materiais escolhidos continuam marcados", async () => {
    await withApp(async (app) => {
        const c = await citizen(app)
        const res = await c.post("/anuncios/novo",
            { items: ["Vidro", "Metal / Latas"], quantity_kg_est: "3", note: "duas caixas" },   // sem zona
            { from: "/anuncios/novo" })
        assert.strictEqual(res.status, 400)
        assert.match(res.body, /Selecione uma zona da Praia/)
        assert.strictEqual(isChecked(res.body, "items", "Vidro"), true)
        assert.strictEqual(isChecked(res.body, "items", "Metal / Latas"), true)
        assert.strictEqual(isChecked(res.body, "items", "Plástico"), false)
        // Os outros campos também voltam.
        assert.match(res.body, /duas caixas/)
    })
})

test("anúncio inválido com um só material (o browser envia string, não lista)", async () => {
    await withApp(async (app) => {
        const c = await citizen(app)
        const res = await c.post("/anuncios/novo", { items: "Vidro" }, { from: "/anuncios/novo" })
        assert.strictEqual(res.status, 400)
        assert.strictEqual(isChecked(res.body, "items", "Vidro"), true)
        assert.strictEqual(isChecked(res.body, "items", "Plástico"), false)
    })
})

test("anúncio inválido sem materiais pede pelo menos um", async () => {
    await withApp(async (app) => {
        const c = await citizen(app)
        const res = await c.post("/anuncios/novo", { zone: "Platô" }, { from: "/anuncios/novo" })
        assert.strictEqual(res.status, 400)
        assert.match(res.body, /pelo menos um material/)
    })
})

test("anúncio válido é gravado e leva ao painel", async () => {
    await withApp(async (app) => {
        const c = await citizen(app)
        const res = await c.post("/anuncios/novo",
            { items: ["Vidro", "Plástico"], zone: "Platô", quantity_kg_est: "4", address: "Rua X, 1" },
            { from: "/anuncios/novo" })
        assert.strictEqual(res.status, 302)
        assert.strictEqual(res.location, "/painel")
        const row = app.db.prepare(`SELECT items, zone, status, quantity_kg_est FROM listings`).get()
        assert.deepStrictEqual({ ...row }, { items: "Vidro,Plástico", zone: "Platô", status: "aberta", quantity_kg_est: 4 })
    })
})

test("registo inválido: nome e email voltam, as passwords não", async () => {
    await withApp(async (app) => {
        const res = await app.client().post("/registar", {
            role: "cidadao", name: "Zé", email: "ze@t.cv", zone: "Platô",
            password: "abcdefgh", password2: "diferente"
        })
        assert.strictEqual(res.status, 400)
        assert.match(res.body, /As passwords não coincidem/)
        assert.match(res.body, /<input[^>]*name="name"[^>]*value="Zé"/)
        assert.match(res.body, /<input[^>]*name="email"[^>]*value="ze@t\.cv"/)
        assert.ok(!res.body.includes("abcdefgh") && !res.body.includes("diferente"))
    })
})

test("registo válido cria a conta, inicia sessão e vai ao sítio certo para cada papel", async () => {
    await withApp(async (app) => {
        const citizenRes = await app.client().post("/registar", {
            role: "cidadao", name: "Zé", email: "ze@t.cv", zone: "Platô", password: "abcdefgh", password2: "abcdefgh"
        })
        assert.strictEqual(citizenRes.location, "/painel")

        const recyclerClient = app.client()
        const recyclerRes = await recyclerClient.post("/registar", {
            role: "reciclador", name: "Eco", email: "eco@t.cv", zone: "Platô", password: "abcdefgh", password2: "abcdefgh"
        })
        assert.strictEqual(recyclerRes.location, "/perfil")
        // O reciclador novo já nasce com perfil por preencher, ainda não verificado.
        const profile = app.db.prepare(`SELECT org_name, verified_at FROM recycler_profiles`).get()
        assert.deepStrictEqual({ ...profile }, { org_name: "Eco", verified_at: null })
        assert.strictEqual((await recyclerClient.get("/perfil")).status, 200)
    })
})

test("um email já registado é recusado, sem criar segunda conta", async () => {
    await withApp(async (app) => {
        addUser(app.db, "cidadao", "Ana", { email: "ana@t.cv", password: PW })
        const res = await app.client().post("/registar", {
            role: "cidadao", name: "Outra", email: "ANA@t.cv", zone: "Platô", password: "abcdefgh", password2: "abcdefgh"
        })
        assert.strictEqual(res.status, 400)
        assert.match(res.body, /Já existe uma conta/)
        assert.strictEqual(app.db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n, 1)
    })
})
