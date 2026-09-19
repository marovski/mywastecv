const test = require("node:test")
const assert = require("node:assert")
const { withApp } = require("./client")
const { addUser, addProfile, addListing } = require("../helpers")
const listings = require("../../src/domain/listings")

const PW = "senha-de-teste"
const ADDRESS = "Rua Secreta, 9"
const PHONE = "9911111"

// Um anúncio da Ana, com dois recicladores verificados; o primeiro reivindica.
function world(db) {
    const ana = addUser(db, "cidadao", "Ana", { email: "ana@t.cv", password: PW, phone: PHONE })
    addUser(db, "cidadao", "Intruso", { email: "intruso@t.cv", password: PW })
    const eco = addProfile(db, addUser(db, "reciclador", "Eco", { email: "eco@t.cv", password: PW, phone: "9922222" }))
    addProfile(db, addUser(db, "reciclador", "Outro", { email: "outro@t.cv", password: PW }))
    const listing = addListing(db, ana, { address: ADDRESS })
    return { ana, eco, listing }
}

async function as(app, email) {
    const c = app.client()
    assert.strictEqual((await c.login(email, PW)).status, 302, email)
    return c
}

const leaks = (body) => body.includes(ADDRESS) || body.includes(PHONE)

test("um anónimo não vê o anúncio: é mandado entrar", async () => {
    await withApp(async (app) => {
        const { listing } = world(app.db)
        const res = await app.client().get(`/anuncios/${listing}`)
        assert.strictEqual(res.status, 302)
        assert.match(res.location, /^\/entrar/)
    })
})

test("antes de haver match, ninguém além do dono vê a morada nem o telefone", async () => {
    await withApp(async (app) => {
        const { listing, eco } = world(app.db)
        listings.claim(app.db, listing, eco)          // pedido pendente, ainda não aceite

        for (const email of ["eco@t.cv", "outro@t.cv", "intruso@t.cv"]) {
            const res = await (await as(app, email)).get(`/anuncios/${listing}`)
            assert.strictEqual(res.status, 200, email)
            assert.ok(!leaks(res.body), `${email} viu dados privados`)
        }
        const owner = await (await as(app, "ana@t.cv")).get(`/anuncios/${listing}`)
        assert.ok(owner.body.includes(ADDRESS), "o dono vê a sua própria morada")
    })
})

test("depois de aceite, só o reciclador escolhido passa a ver morada e telefone", async () => {
    await withApp(async (app) => {
        const { ana, listing, eco } = world(app.db)
        listings.claim(app.db, listing, eco)
        const claimId = app.db.prepare(`SELECT id FROM claims`).get().id
        assert.strictEqual(listings.accept(app.db, listing, claimId, ana).ok, true)

        const chosen = await (await as(app, "eco@t.cv")).get(`/anuncios/${listing}`)
        assert.ok(chosen.body.includes(ADDRESS) && chosen.body.includes(PHONE))

        for (const email of ["outro@t.cv", "intruso@t.cv"]) {
            const res = await (await as(app, email)).get(`/anuncios/${listing}`)
            assert.strictEqual(res.status, 200, email)
            assert.ok(!leaks(res.body), `${email} viu dados privados`)
        }
    })
})

test("o link de WhatsApp só aparece às duas partes do match", async () => {
    await withApp(async (app) => {
        const { ana, listing, eco } = world(app.db)
        listings.claim(app.db, listing, eco)
        listings.accept(app.db, listing, app.db.prepare(`SELECT id FROM claims`).get().id, ana)

        const wa = (body) => /https:\/\/wa\.me\/\d+/.test(body)
        assert.ok(wa((await (await as(app, "ana@t.cv")).get(`/anuncios/${listing}`)).body))
        assert.ok(wa((await (await as(app, "eco@t.cv")).get(`/anuncios/${listing}`)).body))
        assert.ok(!wa((await (await as(app, "outro@t.cv")).get(`/anuncios/${listing}`)).body))
    })
})

test("só as duas partes abrem a confirmação de recolha", async () => {
    await withApp(async (app) => {
        const { ana, listing, eco } = world(app.db)
        listings.claim(app.db, listing, eco)
        listings.accept(app.db, listing, app.db.prepare(`SELECT id FROM claims`).get().id, ana)

        assert.strictEqual((await (await as(app, "ana@t.cv")).get(`/anuncios/${listing}/concluir`)).status, 200)
        assert.strictEqual((await (await as(app, "eco@t.cv")).get(`/anuncios/${listing}/concluir`)).status, 200)
        assert.strictEqual((await (await as(app, "outro@t.cv")).get(`/anuncios/${listing}/concluir`)).status, 403)
        assert.strictEqual((await (await as(app, "intruso@t.cv")).get(`/anuncios/${listing}/concluir`)).status, 403)
    })
})

test("um anúncio inexistente dá 404, não um erro", async () => {
    await withApp(async (app) => {
        world(app.db)
        const res = await (await as(app, "ana@t.cv")).get("/anuncios/9999")
        assert.strictEqual(res.status, 404)
        assert.match(res.body, /não encontrado/i)
    })
})
