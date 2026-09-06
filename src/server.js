const path = require("node:path")
const express = require("express")
const cookieSession = require("cookie-session")
const server = express()

const { UPLOADS_DIR } = require("./config")
const db = require("./database/db")

const isProd = process.env.NODE_ENV === "production"

// Atrás de um proxy (Render, etc.) para que req.secure / cookies "secure" funcionem.
server.set("trust proxy", 1)

// Não deixar o processo morrer por um erro isolado num pedido.
process.on("uncaughtException", (err) => console.error("uncaughtException:", err))
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err))

// Health check leve para o Render (não depende de templates nem da BD).
server.get("/healthz", (req, res) => res.type("text").send("ok"))

const zones = require("./data/praia-zones")
const { materials, labels: itemLabels } = require("./data/materials")
const { hashPassword, verifyPassword } = require("./password")
const {
    attachUser, requireAuth, requireRole,
    loginBlocked, registerFailedLogin, clearLoginAttempts
} = require("./auth")
const { csrfToken, verifyCsrf } = require("./csrf")
const { listingPhoto, publicPath, sweepOrphans, withStagedPhoto, diskStore } = require("./uploads")

// Módulos de domínio: recebem a base de dados, para que os testes lhes possam
// passar um adaptador em memória.
const listings = require("./domain/listings")
const visibility = require("./domain/visibility")
const match = require("./domain/match")
const impacto = require("./domain/impacto")
const ratings = require("./domain/ratings")
const admin = require("./domain/admin")
const adminWorkshops = require("./domain/workshops")
const dashboard = require("./domain/dashboard")
const recyclerProfile = require("./domain/profile")

const collaborators = [
    "Quercus Cabo Verde",
    "Pilorinho",
    "350 Cabo Verde",
    "MAA"
]

// --- Middleware base ----------------------------------------------------
server.use("/uploads", express.static(UPLOADS_DIR))
server.use(express.static(path.join(__dirname, "..", "public")))
server.use(express.urlencoded({ extended: true }))
server.use(cookieSession({
    name: "mw_session",
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000
}))
server.use(attachUser)
server.use(csrfToken)

const nunjucks = require("nunjucks")
const templates = nunjucks.configure(path.join(__dirname, "views"), { express: server, noCache: !isProd })

// Nunjucks não repete strings como o Jinja ("★" * n dá NaN), por isso o
// desenho das estrelas é um filtro.
templates.addFilter("estrelas", (value) => {
    const filled = Math.max(0, Math.min(5, Math.round(Number(value) || 0)))
    return "★".repeat(filled) + "☆".repeat(5 - filled)
})

server.use((req, res, next) => {
    res.locals.collaborators = collaborators
    res.locals.currentPath = req.path
    res.locals.zones = zones
    res.locals.materials = materials
    next()
})

// --- Helpers ----------------------------------------------------------
function now() {
    return new Date().toISOString().slice(0, 16).replace("T", " ")
}
function serverError(res, err) {
    console.log(err)
    return res.status(500).render("error.html", {
        message: "Ocorreu um erro. Tente novamente mais tarde."
    })
}
// Traduz um { ok: false, status, message } de um módulo de domínio numa página.
function renderFail(res, result) {
    return res.status(result.status).render("error.html", { message: result.message })
}
function parseWeights(body) {
    const out = {}
    for (const label of itemLabels) {
        const kg = parseFloat(body[`weight_${label}`])
        if (kg > 0) out[label] = Math.round(kg * 100) / 100
    }
    return out
}
// A varredura corre antes das listagens; nunca deve derrubar o pedido.
function sweepExpired() {
    try {
        listings.sweepExpired(db)
    } catch (err) {
        console.error("sweepExpired:", err)
    }
}

// =====================================================================
// Páginas públicas
// =====================================================================
server.get("/", (req, res) => res.render("index.html"))
server.get("/projeto", (req, res) => res.render("projeto.html"))

// --- Diretório público de recicladores (apenas verificados) ----------
server.get("/recicladores", (req, res) => {
    // Só aceitamos zonas conhecidas: evita curingas (%, _) no LIKE e filtros inválidos.
    const raw = (req.query.zone || "").trim()
    const zone = zones.includes(raw) ? raw : ""
    try {
        const base = `
            SELECT u.name, u.phone, p.*
            FROM recycler_profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.verified_at IS NOT NULL
        `
        const rows = zone
            ? db.prepare(base + `
                AND ${match.zoneFilterSql("p.service_zones")}
                ORDER BY u.name
            `).all(zone)
            : db.prepare(base + ` ORDER BY u.name`).all()

        return res.render("recicladores.html", {
            recyclers: rows, total: rows.length, zone, ratings: ratings.summaryByUser(db)
        })
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Autenticação
// =====================================================================
server.get("/registar", (req, res) => {
    if (res.locals.currentUser) return res.redirect("/painel")
    const role = req.query.role === "reciclador" ? "reciclador" : "cidadao"
    res.render("registar.html", { role, values: {} })
})

server.post("/registar", verifyCsrf, (req, res) => {
    const { name, email, phone, zone, password, password2 } = req.body
    const role = req.body.role === "reciclador" ? "reciclador" : "cidadao"

    const errors = []
    if (!name || !name.trim()) errors.push("Indique o seu nome.")
    if (!email || !/.+@.+\..+/.test(email)) errors.push("Email inválido.")
    if (!zone || !zones.includes(zone)) errors.push("Selecione uma zona da Praia.")
    if (!password || password.length < 8) errors.push("A password deve ter pelo menos 8 caracteres.")
    if (password !== password2) errors.push("As passwords não coincidem.")
    if (email && db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email.trim().toLowerCase())) {
        errors.push("Já existe uma conta com este email.")
    }

    if (errors.length) {
        return res.status(400).render("registar.html", { role, errors, values: req.body })
    }

    try {
        const info = db.prepare(`
            INSERT INTO users (role, name, email, phone, zone, password_hash)
            VALUES (?, ?, ?, ?, ?, ?);
        `).run(role, name.trim(), email.trim().toLowerCase(), phone || null, zone, hashPassword(password))

        if (role === "reciclador") {
            db.prepare(`INSERT INTO recycler_profiles (user_id, org_name) VALUES (?, ?)`)
              .run(info.lastInsertRowid, name.trim())
        }

        req.session.userId = info.lastInsertRowid
        return res.redirect(role === "reciclador" ? "/perfil" : "/painel")
    } catch (err) {
        return serverError(res, err)
    }
})

server.get("/entrar", (req, res) => {
    if (res.locals.currentUser) return res.redirect("/painel")
    res.render("entrar.html", { next: req.query.next || "" })
})

server.post("/entrar", verifyCsrf, (req, res) => {
    const { email, password } = req.body
    const dest = typeof req.body.next === "string" && req.body.next.startsWith("/") ? req.body.next : "/painel"
    const key = `${req.ip}:${(email || "").toLowerCase()}`

    if (loginBlocked(key)) {
        return res.status(429).render("entrar.html", {
            next: dest, errors: ["Demasiadas tentativas. Aguarde 15 minutos."]
        })
    }

    const user = email
        ? db.prepare(`SELECT * FROM users WHERE email = ?`).get(email.trim().toLowerCase())
        : null

    if (!user || !verifyPassword(password || "", user.password_hash)) {
        registerFailedLogin(key)
        return res.status(401).render("entrar.html", { next: dest, errors: ["Email ou password incorretos."] })
    }

    clearLoginAttempts(key)
    req.session.userId = user.id
    return res.redirect(dest)
})

server.post("/sair", verifyCsrf, (req, res) => {
    req.session = null
    return res.redirect("/")
})

// =====================================================================
// Painel (encaminha por papel)
// =====================================================================
server.get("/painel", requireAuth, (req, res) => {
    sweepExpired()
    const user = res.locals.currentUser
    try {
        if (user.role === "reciclador") {
            const profile = db.prepare(`SELECT * FROM recycler_profiles WHERE user_id = ?`).get(user.id)
            const claims = db.prepare(`
                SELECT c.*, l.items, l.zone, l.status AS listing_status
                FROM claims c JOIN listings l ON l.id = c.listing_id
                WHERE c.recycler_id = ? ORDER BY c.created_at DESC
            `).all(user.id)
            const collections = db.prepare(`
                SELECT * FROM collection_records WHERE recycler_id = ? ORDER BY created_at DESC
            `).all(user.id)
            return res.render("painel-reciclador.html", {
                profile, claims, collections,
                rating: ratings.summaryFor(db, user.id),
                reviews: ratings.listFor(db, user.id)
            })
        }

        const listings = db.prepare(`
            SELECT l.*,
                   (SELECT COUNT(*) FROM claims c WHERE c.listing_id = l.id AND c.status = 'pendente') AS pending_claims
            FROM listings l WHERE l.citizen_id = ? ORDER BY l.created_at DESC
        `).all(user.id)
        return res.render("painel-cidadao.html", { listings })
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Perfil do reciclador
// =====================================================================
server.get("/perfil", requireRole("reciclador"), (req, res) => {
    const profile = db.prepare(`SELECT * FROM recycler_profiles WHERE user_id = ?`).get(res.locals.currentUser.id)
    res.render("perfil-reciclador.html", { profile })
})

server.post("/perfil", requireRole("reciclador"), verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    const parsed = recyclerProfile.parseFields(req.body)
    if (parsed.errors) {
        // Reconstitui um "profile" a partir do que a pessoa escreveu, para o
        // formulário não perder tudo por causa de um único campo inválido. O
        // template espera accepted_items/service_zones como CSV, tal como
        // vêm da BD — não como o array que os checkboxes enviam.
        const { accepted_items, service_zones } = match.serialise(req.body.accepted_items, req.body.service_zones)
        return res.status(400).render("perfil-reciclador.html", {
            profile: Object.assign({}, req.body, { accepted_items, service_zones }),
            errors: parsed.errors
        })
    }
    const values = parsed.values
    try {
        db.prepare(`
            UPDATE recycler_profiles SET
                org_name = ?, contact_name = ?, description = ?, accepted_items = ?, service_zones = ?,
                does_pickup = ?, does_dropoff = ?, hours = ?, image = ?, address = ?,
                latitude = ?, longitude = ?
            WHERE user_id = ?
        `).run(
            values.org_name || user.name,
            values.contact_name,
            values.description,
            values.accepted_items,
            values.service_zones,
            values.does_pickup,
            values.does_dropoff,
            values.hours,
            values.image,
            values.address,
            values.latitude,
            values.longitude,
            user.id
        )
        return res.redirect("/painel")
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Anúncios do cidadão
// =====================================================================
server.get("/anuncios/novo", requireRole("cidadao"), (req, res) => {
    res.render("anuncio-novo.html", { values: {} })
})

server.post("/anuncios/novo", requireRole("cidadao"), listingPhoto, verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    const items = match.knownItems(req.body.items)
    const qty = parseFloat(req.body.quantity_kg_est)

    const errors = []
    if (req.uploadError) errors.push(req.uploadError)
    if (!items.length) errors.push("Selecione pelo menos um material.")
    if (!req.body.zone || !zones.includes(req.body.zone)) errors.push("Selecione uma zona da Praia.")

    // "Disponível até" tem de ser uma data válida e não pode estar no passado —
    // caso contrário o anúncio nasceria já expirado.
    const until = (req.body.available_until || "").trim()
    if (until) {
        const today = new Date().toISOString().slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until))) {
            errors.push("Data de validade inválida.")
        } else if (until < today) {
            errors.push("A data de validade não pode estar no passado.")
        }
    }

    // A foto já está escrita em disco: withStagedPhoto garante que só sobrevive
    // se este bloco correr bem, em vez de cada caminho de falha se lembrar dela
    // (inclui a exceção — descarta o ficheiro e volta a lançar).
    let outcome
    try {
        outcome = withStagedPhoto(diskStore, req.file, () => {
            if (errors.length) return { ok: false }
            db.prepare(`
                INSERT INTO listings (citizen_id, items, quantity_kg_est, zone, address, photo_path, note, available_until)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            `).run(
                user.id,
                items.join(","),
                qty > 0 ? qty : null,
                req.body.zone,
                req.body.address || null,
                publicPath(req.file),
                req.body.note || null,
                until || null
            )
            return { ok: true }
        })
    } catch (err) {
        return serverError(res, err)
    }

    if (!outcome.ok) {
        return res.status(400).render("anuncio-novo.html", { errors, values: req.body })
    }
    return res.redirect("/painel")
})

// Board de anúncios abertos (reciclador)
server.get("/anuncios", requireRole("reciclador"), (req, res) => {
    sweepExpired()
    const user = res.locals.currentUser
    const profile = db.prepare(`SELECT * FROM recycler_profiles WHERE user_id = ?`).get(user.id)
    const showAll = req.query.todos === "1"
    try {
        let rows = db.prepare(`
            SELECT l.*, u.name AS citizen_name
            FROM listings l JOIN users u ON u.id = l.citizen_id
            WHERE l.status = 'aberta' ORDER BY l.created_at DESC
        `).all()

        if (!showAll) rows = rows.filter(l => match.accepts(profile, l))

        const claimed = db.prepare(
            `SELECT listing_id FROM claims WHERE recycler_id = ? AND status IN ('pendente','aceite')`
        ).all(user.id).map(r => r.listing_id)

        return res.render("anuncios-board.html", { listings: rows, showAll, claimed, profile })
    } catch (err) {
        return serverError(res, err)
    }
})

// Detalhe de um anúncio
server.get("/anuncios/:id", requireAuth, (req, res) => {
    sweepExpired()
    try {
        // Uma só pergunta ao módulo de visibilidade: o que é que este visitante
        // pode ver e fazer neste anúncio. A privacidade não se decide aqui.
        const view = visibility.forListing(db, req.params.id, res.locals.currentUser)
        if (!view) return res.status(404).render("error.html", { message: "Anúncio não encontrado." })

        // A avaliação e a moderação vivem noutros módulos, por isso é a rota
        // que junta as respostas todas.
        const user = res.locals.currentUser
        return res.render("anuncio.html", Object.assign(view, {
            canRate: ratings.canRate(db, view.listing.id, user.id).ok,
            myRating: ratings.myRating(db, view.listing.id, user.id),
            isAdmin: user.role === "admin"
        }))
    } catch (err) {
        return serverError(res, err)
    }
})

// Reciclador reivindica um anúncio
server.post("/anuncios/:id/reivindicar", requireRole("reciclador"), verifyCsrf, (req, res) => {
    try {
        const result = listings.claim(db, req.params.id, res.locals.currentUser.id, req.body.message)
        if (!result.ok) return renderFail(res, result)
        return res.redirect(`/anuncios/${req.params.id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Reciclador retira o seu interesse
server.post("/claims/:id/retirar", requireRole("reciclador"), verifyCsrf, (req, res) => {
    try {
        const result = listings.withdraw(db, req.params.id, res.locals.currentUser.id)
        if (!result.ok) return renderFail(res, result)
        return res.redirect(`/anuncios/${result.listingId}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Cidadão aceita um claim
server.post("/anuncios/:id/claims/:claimId/aceitar", requireRole("cidadao"), verifyCsrf, (req, res) => {
    try {
        const result = listings.accept(db, req.params.id, req.params.claimId, res.locals.currentUser.id)
        if (!result.ok) return renderFail(res, result)
        return res.redirect(`/anuncios/${req.params.id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Cidadão expira o anúncio
server.post("/anuncios/:id/expirar", requireRole("cidadao"), verifyCsrf, (req, res) => {
    try {
        const result = listings.expire(db, req.params.id, res.locals.currentUser.id)
        if (!result.ok) return renderFail(res, result)
        return res.redirect("/painel")
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Confirmar recolha (qualquer uma das partes)
// =====================================================================
server.get("/anuncios/:id/concluir", requireAuth, (req, res) => {
    try {
        const view = visibility.forListing(db, req.params.id, res.locals.currentUser)
        if (!view) return res.status(404).render("error.html", { message: "Anúncio não encontrado." })
        if (!view.canConclude) {
            return res.status(403).render("error.html", { message: "Só é possível concluir um anúncio reservado." })
        }
        return res.render("coleta-confirmar.html", { listing: view.listing })
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/anuncios/:id/concluir", requireAuth, verifyCsrf, (req, res) => {
    try {
        const result = listings.conclude(db, req.params.id, res.locals.currentUser.id, parseWeights(req.body))
        if (result.ok) return res.redirect(`/anuncios/${req.params.id}`)

        // Falta de pesos volta ao formulário; o resto é uma página de erro.
        if (result.status !== 400) return renderFail(res, result)
        const view = visibility.forListing(db, req.params.id, res.locals.currentUser)
        return res.status(400).render("coleta-confirmar.html", {
            listing: view.listing, errors: [result.message]
        })
    } catch (err) {
        return serverError(res, err)
    }
})

// Avaliação mútua, depois da recolha
server.post("/anuncios/:id/avaliar", requireAuth, verifyCsrf, (req, res) => {
    try {
        const stars = Number.parseInt(req.body.stars, 10)
        const result = ratings.rate(db, req.params.id, res.locals.currentUser.id,
                                    Number.isNaN(stars) ? null : stars, req.body.comment)
        if (!result.ok) return renderFail(res, result)
        return res.redirect(`/anuncios/${req.params.id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Moderação: a equipa remove um anúncio impróprio, ou restaura um removido
// por engano. Reutiliza a máquina de estados de listings.js.
server.post("/anuncios/:id/moderar", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = listings.moderate(db, req.params.id, req.body.reason)
        if (!result.ok) return renderFail(res, result)
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/anuncios/:id/restaurar", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = listings.restore(db, req.params.id)
        if (!result.ok) return renderFail(res, result)
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Admin — verificação de recicladores
// =====================================================================
server.get("/admin", requireRole("admin"), (req, res) => {
    try {
        sweepExpired()
        return res.render("admin.html", {
            overview: dashboard.overview(db),
            staleAfterDays: dashboard.STALE_AFTER_DAYS,
            pending: admin.pendingRecyclers(db),
            verified: admin.verifiedRecyclers(db),
            workshops: admin.workshopsWithSignups(db),
            moderated: admin.moderatedListings(db)
        })
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/admin/recicladores/:userId/verificar", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = admin.verify(db, req.params.userId)
        if (!result.ok) return renderFail(res, result)
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/admin/recicladores/:userId/recusar", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = admin.revoke(db, req.params.userId)
        if (!result.ok) return renderFail(res, result)
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

// --- Gestão de workshops (admin) -------------------------------------
function renderWorkshopForm(res, status, { workshop, values, errors }) {
    return res.status(status).render("admin-workshop.html", { workshop, values, errors })
}

server.get("/admin/workshops/novo", requireRole("admin"), (req, res) => {
    renderWorkshopForm(res, 200, { workshop: null, values: { capacity: 30 } })
})

server.post("/admin/workshops", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = adminWorkshops.create(db, req.body)
        if (!result.ok) {
            return renderWorkshopForm(res, result.status, { workshop: null, values: req.body, errors: result.errors })
        }
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

server.get("/admin/workshops/:id/editar", requireRole("admin"), (req, res) => {
    try {
        const workshop = adminWorkshops.get(db, req.params.id)
        if (!workshop) return res.status(404).render("error.html", { message: "Workshop não encontrado." })
        return renderWorkshopForm(res, 200, { workshop, values: workshop })
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/admin/workshops/:id", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = adminWorkshops.update(db, req.params.id, req.body)
        if (!result.ok) {
            const workshop = adminWorkshops.get(db, req.params.id)
            if (!workshop) return res.status(404).render("error.html", { message: "Workshop não encontrado." })
            return renderWorkshopForm(res, result.status, { workshop, values: req.body, errors: result.errors })
        }
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/admin/workshops/:id/eliminar", requireRole("admin"), verifyCsrf, (req, res) => {
    try {
        const result = adminWorkshops.remove(db, req.params.id)
        if (!result.ok) return renderFail(res, result)
        return res.redirect("/admin")
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Workshops
// =====================================================================
server.get("/workshops", (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM workshops ORDER BY date`).all()
        const current = now()
        return res.render("workshops.html", {
            upcoming: rows.filter(w => w.date >= current),
            past: rows.filter(w => w.date < current)
        })
    } catch (err) {
        return serverError(res, err)
    }
})

server.get("/workshops/:id", (req, res) => {
    try {
        const workshop = db.prepare(`SELECT * FROM workshops WHERE id = ?`).get(req.params.id)
        if (!workshop) return res.status(404).render("error.html", { message: "Workshop não encontrado." })
        const taken = db.prepare(`SELECT COUNT(*) AS total FROM workshop_signups WHERE workshop_id = ?`).get(workshop.id).total
        return res.render("workshop.html", {
            workshop,
            spotsLeft: Math.max(workshop.capacity - taken, 0),
            saved: req.query.saved === "1"
        })
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/workshops/:id/inscrever", verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    const name = user ? user.name : req.body.name
    const email = user ? user.email : req.body.email
    const phone = user ? user.phone : req.body.phone
    try {
        const workshop = db.prepare(`SELECT * FROM workshops WHERE id = ?`).get(req.params.id)
        if (!workshop) return res.status(404).render("error.html", { message: "Workshop não encontrado." })
        const taken = db.prepare(`SELECT COUNT(*) AS total FROM workshop_signups WHERE workshop_id = ?`).get(workshop.id).total

        const errors = []
        if (!name || !name.trim()) errors.push("Nome é obrigatório.")
        if (!email || !/.+@.+\..+/.test(email)) errors.push("Email inválido.")
        if (taken >= workshop.capacity) errors.push("Este workshop já está lotado.")

        if (errors.length) {
            return res.status(400).render("workshop.html", {
                workshop, spotsLeft: Math.max(workshop.capacity - taken, 0), errors, values: req.body
            })
        }

        db.prepare(`
            INSERT INTO workshop_signups (workshop_id, user_id, name, email, phone)
            VALUES (?, ?, ?, ?, ?);
        `).run(workshop.id, user ? user.id : null, name.trim(), email.trim(), phone || null)

        return res.redirect(`/workshops/${workshop.id}?saved=1`)
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Impacto
// =====================================================================
server.get("/impacto", (req, res) => {
    try {
        return res.render("impacto.html", { metrics: impacto.metrics(db) })
    } catch (err) {
        return serverError(res, err)
    }
})

// Limpeza no arranque: fotos sem anúncio e anúncios fora de validade.
try {
    sweepOrphans(
        db.prepare(`SELECT photo_path FROM listings WHERE photo_path IS NOT NULL`)
          .all().map(r => r.photo_path)
    )
} catch (err) {
    console.error("sweepOrphans:", err)
}
sweepExpired()

const PORT = process.env.PORT || 8001
server.listen(PORT, () => console.log(`Nôs Lixu a correr na porta ${PORT}`))
