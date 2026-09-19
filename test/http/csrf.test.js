const test = require("node:test")
const assert = require("node:assert")
const { withApp } = require("./client")
const { addUser, addListing } = require("../helpers")

const PW = "senha-de-teste"

function world(db) {
    const ana = addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: PW })
    return { ana, listing: addListing(db, ana) }
}
const statusOfListing = (db, id) => db.prepare(`SELECT status FROM listings WHERE id = ?`).get(id).status

test("um POST sem token é recusado com 403 e não inicia sessão", async () => {
    await withApp(async (app) => {
        world(app.db)
        const c = app.client()
        const res = await c.post("/entrar", { email: "ana@t.cv", password: PW }, { csrf: false })
        assert.strictEqual(res.status, 403)
        assert.match(res.body, /Sessão inválida ou expirada/)
        assert.strictEqual((await c.get("/painel")).status, 302, "não devia ter entrado")
    })
})

test("um token errado também é recusado", async () => {
    await withApp(async (app) => {
        world(app.db)
        const c = app.client()
        await c.get("/entrar")                                  // abre a sessão
        const res = await c.post("/entrar", { email: "ana@t.cv", password: PW }, { csrf: "0".repeat(48) })
        assert.strictEqual(res.status, 403)
    })
})

test("o token de uma sessão não serve noutra", async () => {
    await withApp(async (app) => {
        world(app.db)
        const a = app.client()
        const b = app.client()
        const tokenOfA = await a.token("/entrar")
        await b.get("/entrar")
        const res = await b.post("/entrar", { email: "ana@t.cv", password: PW }, { csrf: tokenOfA })
        assert.strictEqual(res.status, 403)
    })
})

test("sair sem token não termina a sessão", async () => {
    await withApp(async (app) => {
        world(app.db)
        const c = app.client()
        await c.login("ana@t.cv", PW)
        const res = await c.post("/sair", {}, { csrf: false })
        assert.strictEqual(res.status, 403)
        assert.strictEqual((await c.get("/painel")).status, 200, "a sessão devia continuar")
    })
})

test("uma ação que muda estado só corre com token válido", async () => {
    await withApp(async (app) => {
        const { listing } = world(app.db)
        const c = app.client()
        await c.login("ana@t.cv", PW)

        const rejected = await c.post(`/anuncios/${listing}/expirar`, {}, { csrf: false })
        assert.strictEqual(rejected.status, 403)
        assert.strictEqual(statusOfListing(app.db, listing), "aberta")

        const accepted = await c.post(`/anuncios/${listing}/expirar`, {}, { from: `/anuncios/${listing}` })
        assert.strictEqual(accepted.status, 302)
        assert.strictEqual(statusOfListing(app.db, listing), "expirada")
    })
})

test("cada sessão tem o seu token, e ele não muda dentro dela", async () => {
    await withApp(async (app) => {
        const a = app.client()
        const b = app.client()
        assert.notStrictEqual(await a.token("/entrar"), await b.token("/entrar"))
        // E o token de um cliente é estável dentro da sua sessão.
        assert.strictEqual(await a.token("/entrar"), await a.token("/registar"))
    })
})
