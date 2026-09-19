const test = require("node:test")
const assert = require("node:assert")
const { withApp } = require("./client")
const { addUser } = require("../helpers")

test("a aplicação arranca com uma base de dados vazia em memória, sem semear", async () => {
    await withApp(async (app) => {
        const res = await app.client().get("/healthz")
        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.body, "ok")
        assert.strictEqual(app.db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n, 0)
    })
})

test("as páginas públicas desenham-se sem dados", async () => {
    await withApp(async (app) => {
        const c = app.client()
        for (const p of ["/", "/projeto", "/recicladores", "/workshops", "/impacto", "/entrar", "/registar"]) {
            assert.strictEqual((await c.get(p)).status, 200, p)
        }
    })
})

test("duas aplicações no mesmo processo não partilham dados", async () => {
    await withApp(async (a) => {
        await withApp(async (b) => {
            addUser(a.db, "cidadao", "Ana", { email: "ana@t.cv", password: "senha-de-teste" })
            assert.strictEqual((await a.client().login("ana@t.cv", "senha-de-teste")).status, 302)
            // A mesma conta não existe na outra aplicação.
            assert.strictEqual((await b.client().login("ana@t.cv", "senha-de-teste")).status, 401)
        })
    })
})
