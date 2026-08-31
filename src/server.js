const express = require("express")
const cookieSession = require("cookie-session")
const server = express()

const db = require("./database/db")
const zones = require("./data/praia-zones")
const { materials, labels: itemLabels, co2eByLabel } = require("./data/materials")
const { hashPassword, verifyPassword } = require("./password")
const {
    attachUser, requireAuth, requireRole,
    loginBlocked, registerFailedLogin, clearLoginAttempts
} = require("./auth")
const { csrfToken, verifyCsrf } = require("./csrf")
const { listingPhoto, publicPath } = require("./uploads")

const collectItems = itemLabels

const collaborators = [
    "Quercus Cabo Verde",
    "Pilorinho",
    "350 Cabo Verde",
    "MAA"
]

// --- Middleware base ----------------------------------------------------
server.use(express.static("public"))
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
nunjucks.configure("src/views", { express: server, noCache: true })

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
function asArray(v) {
    if (v === undefined || v === null) return []
    return Array.isArray(v) ? v : [v]
}
function keepKnown(arr, allowed) {
    const set = new Set(allowed)
    return [...new Set(asArray(arr).filter(x => set.has(x)))]
}
function parseWeights(body) {
    const out = {}
    for (const label of itemLabels) {
        const kg = parseFloat(body[`weight_${label}`])
        if (kg > 0) out[label] = Math.round(kg * 100) / 100
    }
    return out
}
// Reciclador cujo claim foi aceite (para revelar contactos).
function acceptedRecyclerId(listingId) {
    const row = db.prepare(
        `SELECT recycler_id FROM claims WHERE listing_id = ? AND status = 'aceite'`
    ).get(listingId)
    return row ? row.recycler_id : null
}

// =====================================================================
// Páginas públicas
// =====================================================================
server.get("/", (req, res) => res.render("index.html"))
server.get("/projeto", (req, res) => res.render("projeto.html"))

// --- Diretório público de recicladores (apenas verificados) ----------
server.get("/recicladores", (req, res) => {
    const zone = (req.query.zone || "").trim()
    try {
        const base = `
            SELECT u.name, u.phone, p.*
            FROM recycler_profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.verified_at IS NOT NULL
        `
        const rows = zone
            ? db.prepare(base + ` AND p.service_zones LIKE ? ORDER BY u.name`).all(`%${zone}%`)
            : db.prepare(base + ` ORDER BY u.name`).all()

        return res.render("recicladores.html", { recyclers: rows, total: rows.length, zone })
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
            return res.render("painel-reciclador.html", { profile, claims, collections })
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
    const acceptedItems = keepKnown(req.body.accepted_items, itemLabels)
    const serviceZones = keepKnown(req.body.service_zones, zones)
    try {
        db.prepare(`
            UPDATE recycler_profiles SET
                org_name = ?, description = ?, accepted_items = ?, service_zones = ?,
                does_pickup = ?, does_dropoff = ?, hours = ?, image = ?, address = ?
            WHERE user_id = ?
        `).run(
            (req.body.org_name || user.name).trim(),
            req.body.description || null,
            acceptedItems.join(","),
            serviceZones.join(","),
            req.body.does_pickup ? 1 : 0,
            req.body.does_dropoff ? 1 : 0,
            req.body.hours || null,
            req.body.image || null,
            req.body.address || null,
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
    const items = keepKnown(req.body.items, itemLabels)
    const qty = parseFloat(req.body.quantity_kg_est)

    const errors = []
    if (req.uploadError) errors.push(req.uploadError)
    if (!items.length) errors.push("Selecione pelo menos um material.")
    if (!req.body.zone || !zones.includes(req.body.zone)) errors.push("Selecione uma zona da Praia.")

    if (errors.length) {
        return res.status(400).render("anuncio-novo.html", { errors, values: req.body })
    }

    try {
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
            req.body.available_until || null
        )
        return res.redirect("/painel")
    } catch (err) {
        return serverError(res, err)
    }
})

// Board de anúncios abertos (reciclador)
server.get("/anuncios", requireRole("reciclador"), (req, res) => {
    const user = res.locals.currentUser
    const profile = db.prepare(`SELECT * FROM recycler_profiles WHERE user_id = ?`).get(user.id)
    const showAll = req.query.todos === "1"
    try {
        let rows = db.prepare(`
            SELECT l.*, u.name AS citizen_name
            FROM listings l JOIN users u ON u.id = l.citizen_id
            WHERE l.status = 'aberta' ORDER BY l.created_at DESC
        `).all()

        const myZones = new Set((profile.service_zones || "").split(",").filter(Boolean))
        const myItems = new Set((profile.accepted_items || "").split(",").filter(Boolean))

        if (!showAll && (myZones.size || myItems.size)) {
            rows = rows.filter(l => {
                const zoneOk = !myZones.size || myZones.has(l.zone)
                const itemOk = !myItems.size || l.items.split(",").some(i => myItems.has(i))
                return zoneOk && itemOk
            })
        }

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
    const user = res.locals.currentUser
    try {
        const listing = db.prepare(`
            SELECT l.*, u.name AS citizen_name, u.phone AS citizen_phone
            FROM listings l JOIN users u ON u.id = l.citizen_id
            WHERE l.id = ?
        `).get(req.params.id)
        if (!listing) return res.status(404).render("error.html", { message: "Anúncio não encontrado." })

        const isOwner = user.id === listing.citizen_id
        const acceptedId = acceptedRecyclerId(listing.id)
        const canSeeContact = isOwner || (user.role === "reciclador" && user.id === acceptedId)

        // Privacidade: morada e telefone só são revelados ao dono e ao reciclador aceite.
        if (!canSeeContact) {
            listing.address = null
            listing.citizen_phone = null
        }

        const claims = isOwner
            ? db.prepare(`
                SELECT c.*, u.name AS recycler_name, u.phone AS recycler_phone,
                       p.address AS recycler_address, p.verified_at
                FROM claims c
                JOIN users u ON u.id = c.recycler_id
                LEFT JOIN recycler_profiles p ON p.user_id = c.recycler_id
                WHERE c.listing_id = ? ORDER BY c.created_at
            `).all(listing.id)
            : []

        const myClaim = user.role === "reciclador"
            ? db.prepare(`SELECT * FROM claims WHERE listing_id = ? AND recycler_id = ?`).get(listing.id, user.id)
            : null

        const collection = db.prepare(`SELECT * FROM collection_records WHERE listing_id = ?`).get(listing.id)
        if (collection) {
            try { collection.weights = JSON.parse(collection.weights_json || "{}") } catch { collection.weights = {} }
        }

        return res.render("anuncio.html", {
            listing, isOwner, canSeeContact, claims, myClaim, collection
        })
    } catch (err) {
        return serverError(res, err)
    }
})

// Reciclador reivindica um anúncio
server.post("/anuncios/:id/reivindicar", requireRole("reciclador"), verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    try {
        const profile = db.prepare(`SELECT verified_at FROM recycler_profiles WHERE user_id = ?`).get(user.id)
        if (!profile || !profile.verified_at) {
            return res.status(403).render("error.html", { message: "A sua conta de reciclador ainda não foi verificada pela equipa My Waste." })
        }
        const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(req.params.id)
        if (!listing || listing.status !== "aberta") {
            return res.status(400).render("error.html", { message: "Este anúncio já não está disponível." })
        }
        db.prepare(`
            INSERT OR IGNORE INTO claims (listing_id, recycler_id, message)
            VALUES (?, ?, ?)
        `).run(listing.id, user.id, req.body.message || null)
        return res.redirect(`/anuncios/${listing.id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Reciclador retira o seu interesse
server.post("/claims/:id/retirar", requireRole("reciclador"), verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    try {
        const claim = db.prepare(`SELECT * FROM claims WHERE id = ?`).get(req.params.id)
        if (!claim || claim.recycler_id !== user.id) {
            return res.status(403).render("error.html", { message: "Ação não permitida." })
        }
        db.prepare(`UPDATE claims SET status = 'retirada' WHERE id = ?`).run(claim.id)
        if (claim.status === "aceite") {
            db.prepare(`UPDATE listings SET status = 'aberta' WHERE id = ? AND status = 'reservada'`).run(claim.listing_id)
        }
        return res.redirect(`/anuncios/${claim.listing_id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Cidadão aceita um claim
server.post("/anuncios/:id/claims/:claimId/aceitar", requireRole("cidadao"), verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    try {
        const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(req.params.id)
        if (!listing || listing.citizen_id !== user.id) {
            return res.status(403).render("error.html", { message: "Ação não permitida." })
        }
        const claim = db.prepare(`SELECT * FROM claims WHERE id = ? AND listing_id = ?`).get(req.params.claimId, listing.id)
        if (!claim || claim.status !== "pendente") {
            return res.status(400).render("error.html", { message: "Este pedido já não pode ser aceite." })
        }
        db.prepare(`UPDATE claims SET status = 'aceite' WHERE id = ?`).run(claim.id)
        db.prepare(`UPDATE claims SET status = 'recusada' WHERE listing_id = ? AND id != ? AND status = 'pendente'`)
          .run(listing.id, claim.id)
        db.prepare(`UPDATE listings SET status = 'reservada' WHERE id = ?`).run(listing.id)
        return res.redirect(`/anuncios/${listing.id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// Cidadão expira o anúncio
server.post("/anuncios/:id/expirar", requireRole("cidadao"), verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    try {
        const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(req.params.id)
        if (!listing || listing.citizen_id !== user.id) {
            return res.status(403).render("error.html", { message: "Ação não permitida." })
        }
        db.prepare(`UPDATE listings SET status = 'expirada' WHERE id = ? AND status IN ('aberta','reservada')`).run(listing.id)
        return res.redirect("/painel")
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Confirmar recolha (qualquer uma das partes)
// =====================================================================
server.get("/anuncios/:id/concluir", requireAuth, (req, res) => {
    const user = res.locals.currentUser
    try {
        const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(req.params.id)
        if (!listing) return res.status(404).render("error.html", { message: "Anúncio não encontrado." })

        const acceptedId = acceptedRecyclerId(listing.id)
        const allowed = user.id === listing.citizen_id || user.id === acceptedId
        if (!allowed || listing.status !== "reservada") {
            return res.status(403).render("error.html", { message: "Só é possível concluir um anúncio reservado." })
        }
        return res.render("coleta-confirmar.html", { listing })
    } catch (err) {
        return serverError(res, err)
    }
})

server.post("/anuncios/:id/concluir", requireAuth, verifyCsrf, (req, res) => {
    const user = res.locals.currentUser
    try {
        const listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(req.params.id)
        if (!listing) return res.status(404).render("error.html", { message: "Anúncio não encontrado." })

        const acceptedId = acceptedRecyclerId(listing.id)
        const allowed = user.id === listing.citizen_id || user.id === acceptedId
        if (!allowed || listing.status !== "reservada" || !acceptedId) {
            return res.status(403).render("error.html", { message: "Ação não permitida." })
        }

        const weights = parseWeights(req.body)
        if (!Object.keys(weights).length) {
            return res.status(400).render("coleta-confirmar.html", {
                listing, errors: ["Indique o peso recolhido de pelo menos um material."]
            })
        }

        db.prepare(`
            INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json, collected_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(listing.id, acceptedId, listing.citizen_id, JSON.stringify(weights), now())
        db.prepare(`UPDATE listings SET status = 'recolhida' WHERE id = ?`).run(listing.id)

        return res.redirect(`/anuncios/${listing.id}`)
    } catch (err) {
        return serverError(res, err)
    }
})

// =====================================================================
// Admin — verificação de recicladores
// =====================================================================
server.get("/admin", requireRole("admin"), (req, res) => {
    const pending = db.prepare(`
        SELECT u.id, u.name, u.email, u.phone, u.zone, p.*
        FROM users u JOIN recycler_profiles p ON p.user_id = u.id
        WHERE u.role = 'reciclador' AND p.verified_at IS NULL
        ORDER BY u.created_at
    `).all()
    const verified = db.prepare(`
        SELECT u.name, u.email, p.verified_at
        FROM users u JOIN recycler_profiles p ON p.user_id = u.id
        WHERE p.verified_at IS NOT NULL ORDER BY p.verified_at DESC
    `).all()
    res.render("admin.html", { pending, verified })
})

server.post("/admin/recicladores/:userId/verificar", requireRole("admin"), verifyCsrf, (req, res) => {
    db.prepare(`UPDATE recycler_profiles SET verified_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(req.params.userId)
    res.redirect("/admin")
})

server.post("/admin/recicladores/:userId/recusar", requireRole("admin"), verifyCsrf, (req, res) => {
    db.prepare(`UPDATE recycler_profiles SET verified_at = NULL WHERE user_id = ?`).run(req.params.userId)
    res.redirect("/admin")
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
        const workshopsDone = db.prepare(`SELECT COUNT(*) AS total FROM workshops WHERE date < ?`).get(now()).total

        const recyclersMobilised = db.prepare(`
            SELECT COUNT(*) AS total FROM (
                SELECT user_id FROM recycler_profiles WHERE verified_at IS NOT NULL
                UNION
                SELECT recycler_id FROM collection_records
            )
        `).get().total

        const citizensEngaged = db.prepare(`
            SELECT COUNT(*) AS total FROM (
                SELECT citizen_id AS k FROM collection_records
                UNION
                SELECT COALESCE(CAST(user_id AS TEXT), email) AS k FROM workshop_signups
            )
        `).get().total

        const records = db.prepare(`SELECT recycler_id, weights_json FROM collection_records`).all()
        const flows = new Set()
        let kg = 0
        let co2e = 0
        for (const r of records) {
            let w = {}
            try { w = JSON.parse(r.weights_json || "{}") } catch { w = {} }
            for (const [label, amount] of Object.entries(w)) {
                flows.add(`${r.recycler_id}:${label}`)
                kg += amount
                co2e += amount * (co2eByLabel[label] || 0)
            }
        }

        return res.render("impacto.html", {
            metrics: {
                workshops: workshopsDone,
                flows: flows.size,
                recyclers: recyclersMobilised,
                citizens: citizensEngaged,
                kg: Math.round(kg),
                co2e: Math.round(co2e)
            }
        })
    } catch (err) {
        return serverError(res, err)
    }
})

server.listen(process.env.PORT || 8001)
