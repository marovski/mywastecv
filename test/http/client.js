// Cliente HTTP mínimo para testar a aplicação de ponta a ponta: sobe-a numa
// porta livre, com uma base de dados em memória própria, e fala com ela como um
// browser — guarda cookies, segue o token CSRF que a página lhe dá.
//
// Sem dependências de teste (o projeto não tem nenhuma): fetch do Node, e um
// frasco de cookies de 20 linhas.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

// ATENÇÃO À ORDEM. config.js resolve DATA_DIR e cria a pasta de uploads no
// momento em que é carregado pela primeira vez, e o multer fixa esse caminho.
// Por isso o DATA_DIR de teste tem de estar definido ANTES de qualquer require
// da aplicação — e este ficheiro tem de ser a única porta por onde os testes a
// carregam. Sem isto, os testes criam ./var dentro do repositório.
if (!process.env.DATA_DIR) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nos-lixu-test-"))
    process.env.DATA_DIR = dir
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }))
}

const { createApp } = require("../../src/app")
const { openDatabase } = require("../../src/database/db")

const CSRF_FIELD = /name="_csrf" value="([0-9a-f]+)"/

class Client {
    constructor(base) {
        this.base = base
        this.jar = new Map()
    }

    #storeCookies(res) {
        for (const line of res.headers.getSetCookie()) {
            const [pair, ...attrs] = line.split(";")
            const eq = pair.indexOf("=")
            const name = pair.slice(0, eq)
            const value = pair.slice(eq + 1)
            const expired = attrs.some(a => /^\s*expires=.*1970/i.test(a) || /^\s*max-age=0/i.test(a))
            if (expired || value === "") this.jar.delete(name)
            else this.jar.set(name, value)
        }
    }

    async request(method, pathname, { form, headers = {} } = {}) {
        const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ")
        const init = { method, redirect: "manual", headers: { ...headers } }
        if (cookie) init.headers.cookie = cookie
        if (form) {
            const body = new URLSearchParams()
            for (const [key, value] of Object.entries(form)) {
                for (const v of [].concat(value)) body.append(key, v)
            }
            init.body = body
            init.headers["content-type"] = "application/x-www-form-urlencoded"
        }
        const res = await fetch(this.base + pathname, init)
        this.#storeCookies(res)
        return { status: res.status, location: res.headers.get("location"), body: await res.text() }
    }

    get(pathname) {
        return this.request("GET", pathname)
    }

    // O token CSRF vai dentro de qualquer formulário que a página desenhe.
    async token(fromPath) {
        const res = await this.get(fromPath)
        const found = CSRF_FIELD.exec(res.body)
        if (!found) throw new Error(`sem token CSRF em ${fromPath} (estado ${res.status})`)
        return found[1]
    }

    // POST de formulário. Por omissão obtém o token na própria página `from`
    // (o formulário que o browser teria aberto); `csrf: false` envia sem token,
    // e `csrf: "<valor>"` envia esse valor à letra.
    async post(pathname, fields = {}, { from = pathname, csrf = true } = {}) {
        const token = csrf === true ? await this.token(from) : csrf
        const form = token ? { _csrf: token, ...fields } : fields
        return this.request("POST", pathname, { form })
    }

    async login(email, password) {
        return this.post("/entrar", { email, password })
    }
}

// Sobe uma aplicação nova (base de dados em memória própria) e devolve o que os
// testes precisam: a base de dados, para montar dados, e clientes HTTP, cada um
// com o seu frasco de cookies.
async function startApp({ sessionSecret = "segredo-de-teste", isProd = false } = {}) {
    const db = openDatabase(":memory:")
    const app = createApp({ db, sessionSecret, isProd })
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s))
    })
    const base = `http://127.0.0.1:${server.address().port}`
    return {
        db,
        client: () => new Client(base),
        close: () => new Promise((resolve) => {
            server.closeAllConnections()
            server.close(resolve)
        })
    }
}

// Corre `fn` com uma aplicação nova e fecha-a no fim, passe ou falhe.
async function withApp(fn, options) {
    const app = await startApp(options)
    try {
        return await fn(app)
    } finally {
        await app.close()
    }
}

module.exports = { startApp, withApp, Client }
