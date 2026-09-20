const test = require("node:test")
const assert = require("node:assert")
const { withApp } = require("./client")
const { addUser, addProfile } = require("../helpers")

const PW = "senha-de-teste"

// Um de cada papel, todos com password verdadeira.
function world(db) {
    addUser(db, "admin", "Equipa", { email: "admin@t.cv", password: PW })
    addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: PW })
    addProfile(db, addUser(db, "reciclador", "Eco", { email: "eco@t.cv", password: PW }))
}

async function loggedIn(app, email) {
    const c = app.client()
    const res = await c.login(email, PW)
    assert.strictEqual(res.status, 302, `login de ${email}`)
    return c
}

test("um anónimo é mandado para /entrar, com o destino guardado", async () => {
    await withApp(async (app) => {
        const res = await app.client().get("/painel")
        assert.strictEqual(res.status, 302)
        assert.strictEqual(res.location, "/entrar?next=%2Fpainel")
    })
})

test("depois de entrar, o destino guardado é respeitado", async () => {
    await withApp(async (app) => {
        world(app.db)
        const res = await app.client().post("/entrar", { email: "ana@t.cv", password: PW, next: "/anuncios/novo" })
        assert.strictEqual(res.location, "/anuncios/novo")
    })
})

test("um admin que abre /painel vai parar a /admin, não à dashboard do cidadão", async () => {
    await withApp(async (app) => {
        world(app.db)
        const admin = await loggedIn(app, "admin@t.cv")
        const painel = await admin.get("/painel")
        assert.strictEqual(painel.status, 302)
        assert.strictEqual(painel.location, "/admin")
        assert.strictEqual((await admin.get("/admin")).status, 200)
    })
})

test("cada papel só entra no que é seu", async () => {
    await withApp(async (app) => {
        world(app.db)
        const cases = [
            ["ana@t.cv",   "/anuncios/novo", 200],
            ["ana@t.cv",   "/admin",         403],
            ["ana@t.cv",   "/perfil",        403],
            ["eco@t.cv",   "/perfil",        200],
            ["eco@t.cv",   "/anuncios",      200],
            ["eco@t.cv",   "/anuncios/novo", 403],
            ["eco@t.cv",   "/admin",         403],
            ["admin@t.cv", "/admin",         200],
            ["admin@t.cv", "/perfil",        403],
            ["admin@t.cv", "/anuncios/novo", 403],
        ]
        for (const [email, path, expected] of cases) {
            const c = await loggedIn(app, email)
            assert.strictEqual((await c.get(path)).status, expected, `${email} ${path}`)
        }
    })
})

test("um 403 diz porquê, em português, numa página de erro", async () => {
    await withApp(async (app) => {
        world(app.db)
        const res = await (await loggedIn(app, "ana@t.cv")).get("/admin")
        assert.strictEqual(res.status, 403)
        assert.match(res.body, /Não tem permissão/)
    })
})

test("sair termina a sessão", async () => {
    await withApp(async (app) => {
        world(app.db)
        const c = await loggedIn(app, "ana@t.cv")
        assert.strictEqual((await c.get("/painel")).status, 200)
        const out = await c.post("/sair", {}, { from: "/painel" })
        assert.strictEqual(out.location, "/")
        assert.strictEqual((await c.get("/painel")).status, 302)
    })
})

test("cinco logins falhados bloqueiam o sexto, mesmo com a password certa", async () => {
    await withApp(async (app) => {
        world(app.db)
        const c = app.client()
        for (let i = 0; i < 5; i++) {
            assert.strictEqual((await c.login("ana@t.cv", "errada")).status, 401, `tentativa ${i + 1}`)
        }
        const blocked = await c.login("ana@t.cv", PW)
        assert.strictEqual(blocked.status, 429)
        assert.match(blocked.body, /Demasiadas tentativas/)
    })
})

test("o bloqueio é da aplicação, não do processo: outra instância não o herda", async () => {
    await withApp(async (a) => {
        world(a.db)
        for (let i = 0; i < 5; i++) await a.client().login("ana@t.cv", "errada")
        assert.strictEqual((await a.client().login("ana@t.cv", PW)).status, 429)

        await withApp(async (b) => {
            world(b.db)
            assert.strictEqual((await b.client().login("ana@t.cv", PW)).status, 302)
        })
    })
})

test("o destino depois do login nunca sai do site", async () => {
    await withApp(async (app) => {
        world(app.db)
        // Cada uma é uma forma de fazer o browser ir a outro sítio depois de um
        // login válido: "//host" e "/\host" são relativos ao protocolo, e o
        // browser ignora tabs e quebras de linha dentro de um URL.
        const hostile = [
            "//outro-site.example", "///outro-site.example", "/\\outro-site.example",
            "/\t/outro-site.example", "/\n/outro-site.example",
            "https://outro-site.example", "javascript:alert(1)", "outro-site.example",
        ]
        for (const next of hostile) {
            const res = await app.client().post("/entrar", { email: "ana@t.cv", password: PW, next })
            assert.strictEqual(res.status, 302, JSON.stringify(next))
            assert.strictEqual(res.location, "/painel", `next=${JSON.stringify(next)} redirecionou para ${res.location}`)
        }
    })
})

test("caminhos do próprio site continuam a ser respeitados, com query e fragmento", async () => {
    await withApp(async (app) => {
        world(app.db)
        for (const next of ["/anuncios?todos=1", "/workshops/2?saved=1", "/anuncios/novo"]) {
            const res = await app.client().post("/entrar", { email: "ana@t.cv", password: PW, next })
            assert.strictEqual(res.location, next)
        }
    })
})

test("um login falhado não devolve um destino hostil ao formulário", async () => {
    await withApp(async (app) => {
        world(app.db)
        const res = await app.client().post("/entrar", { email: "ana@t.cv", password: "errada", next: "//outro-site.example" })
        assert.strictEqual(res.status, 401)
        assert.match(res.body, /<input type="hidden" name="next" value="\/painel">/)
        assert.ok(!res.body.includes("outro-site"), "o destino hostil não pode voltar no HTML")
    })
})

test("um destino repetido (next=a&next=b) não é aceite como caminho", async () => {
    await withApp(async (app) => {
        world(app.db)
        const res = await app.client().post("/entrar", { email: "ana@t.cv", password: PW, next: ["/anuncios", "//outro-site.example"] })
        assert.strictEqual(res.location, "/painel")
    })
})
