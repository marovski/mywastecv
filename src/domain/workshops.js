// Gestão de workshops pela equipa Nôs Lixu.
//
// Consolida: CRUD (workshops.js antes), admin roster (admin.js), e o sign-up público.
// Regra única de capacidade, validação de inscrição, e deteção de duplicados vivem aqui.
//
// A data é guardada como "YYYY-MM-DD HH:MM" porque a página pública compara
// strings com a hora atual no mesmo formato para separar próximos de passados.
// Um input datetime-local envia "YYYY-MM-DDTHH:MM", por isso normalizamos.
const zones = require("../data/praia-zones")

const DATE_FORMAT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/

function normaliseDate(raw) {
    const match = DATE_FORMAT.exec(String(raw || "").trim())
    if (!match) return null
    const [, day, time] = match
    // Rejeita datas com aspeto certo mas impossíveis (2026-13-40 99:99).
    const parsed = new Date(`${day}T${time}:00`)
    if (Number.isNaN(parsed.getTime())) return null
    if (!parsed.toISOString().startsWith(day)) return null
    return `${day} ${time}`
}

function now() {
    return new Date().toISOString().slice(0, 16).replace("T", " ")
}

// Devolve os campos já limpos, ou a lista de erros para o formulário.
function parseFields(fields) {
    const errors = []
    const title = String(fields.title || "").trim()
    if (!title) errors.push("Indique o título do workshop.")

    const date = normaliseDate(fields.date)
    if (!date) errors.push("Indique uma data e hora válidas.")

    const rawZone = String(fields.zone || "").trim()
    if (rawZone && !zones.includes(rawZone)) errors.push("Selecione uma zona da Praia.")

    const capacity = Number(fields.capacity)
    if (!Number.isInteger(capacity) || capacity < 1) {
        errors.push("O número de lugares tem de ser um inteiro maior que zero.")
    }

    if (errors.length) return { errors }
    return {
        values: {
            title,
            description: String(fields.description || "").trim() || null,
            date,
            zone: rawZone || null,
            capacity
        }
    }
}

// Validação de inscrição: nome, email, e sem duplicados.
function parseSignupFields(fields) {
    const errors = []
    const name = String(fields.name || "").trim()
    if (!name) errors.push("Nome é obrigatório.")

    const email = String(fields.email || "").trim()
    if (!email || !/.+@.+\..+/.test(email)) errors.push("Email inválido.")

    if (errors.length) return { errors }
    return { values: { name, email, phone: String(fields.phone || "").trim() || null } }
}

function spotsLeft(workshop, signupCount) {
    return Math.max(workshop.capacity - signupCount, 0)
}

const invalid = (errors) => ({ ok: false, status: 400, errors })
const notFound = () => ({ ok: false, status: 404, message: "Workshop não encontrado.", errors: ["Workshop não encontrado."] })

function get(db, id) {
    return db.prepare(`SELECT * FROM workshops WHERE id = ?`).get(id) || null
}

function create(db, fields) {
    const parsed = parseFields(fields)
    if (parsed.errors) return invalid(parsed.errors)
    const { title, description, date, zone, capacity } = parsed.values
    const info = db.prepare(`
        INSERT INTO workshops (title, description, date, zone, capacity)
        VALUES (?, ?, ?, ?, ?)
    `).run(title, description, date, zone, capacity)
    return { ok: true, id: info.lastInsertRowid }
}

function update(db, id, fields) {
    if (!get(db, id)) return notFound()
    const parsed = parseFields(fields)
    if (parsed.errors) return invalid(parsed.errors)
    const { title, description, date, zone, capacity } = parsed.values
    db.prepare(`
        UPDATE workshops SET title = ?, description = ?, date = ?, zone = ?, capacity = ?
        WHERE id = ?
    `).run(title, description, date, zone, capacity, id)
    return { ok: true }
}

function signupCount(db, workshopId) {
    return db.prepare(`SELECT COUNT(*) AS total FROM workshop_signups WHERE workshop_id = ?`)
        .get(workshopId).total
}

// Apagar leva as inscrições com ele (ON DELETE CASCADE); devolvemos quantas
// eram para que a confirmação diga exatamente o que se perde.
function remove(db, id) {
    if (!get(db, id)) return notFound()
    const deletedSignups = signupCount(db, id)
    db.prepare(`DELETE FROM workshops WHERE id = ?`).run(id)
    return { ok: true, deletedSignups }
}

// Devolve um workshop com spots disponíveis calculados.
function getWithSpots(db, id) {
    const workshop = get(db, id)
    if (!workshop) return null
    const taken = signupCount(db, id)
    return Object.assign({}, workshop, { spotsLeft: spotsLeft(workshop, taken) })
}

// Devolve workshops próximos (data >= now), ordenados por data.
function listUpcoming(db) {
    const current = now()
    return db.prepare(`SELECT * FROM workshops WHERE date >= ? ORDER BY date`).all(current)
}

// Devolve workshops passados (data < now), ordenados por data DESC (recentes primeiro).
function listPast(db) {
    const current = now()
    return db.prepare(`SELECT * FROM workshops WHERE date < ? ORDER BY date DESC`).all(current)
}

// Inscrição: validação, deteção de duplicados, e criação.
// userId pode ser null (anónimo).
function signup(db, workshopId, fields, userId) {
    const workshop = get(db, workshopId)
    if (!workshop) return { ok: false, status: 404, message: "Workshop não encontrado." }

    const parsed = parseSignupFields(fields)
    if (parsed.errors) return { ok: false, status: 400, errors: parsed.errors }

    const { name, email, phone } = parsed.values
    const taken = signupCount(db, workshopId)

    // Checa capacidade.
    if (taken >= workshop.capacity) {
        return { ok: false, status: 400, errors: ["Este workshop já está lotado."] }
    }

    // Checa duplicado: para utilizadores, user_id deve ser único por workshop;
    // para anónimos, email deve ser único por workshop.
    if (userId) {
        const existing = db.prepare(`
            SELECT 1 FROM workshop_signups
            WHERE workshop_id = ? AND user_id = ?
        `).get(workshopId, userId)
        if (existing) {
            return { ok: false, status: 400, errors: ["Já se inscreveu neste workshop."] }
        }
    } else {
        const existing = db.prepare(`
            SELECT 1 FROM workshop_signups
            WHERE workshop_id = ? AND email = ?
        `).get(workshopId, email)
        if (existing) {
            return { ok: false, status: 400, errors: ["Este email já está inscrito neste workshop."] }
        }
    }

    // Insere a inscrição.
    db.prepare(`
        INSERT INTO workshop_signups (workshop_id, user_id, name, email, phone)
        VALUES (?, ?, ?, ?, ?)
    `).run(workshopId, userId || null, name, email, phone)

    return { ok: true }
}

// Roster para admin: workshops com todas as inscrições.
function roster(db) {
    const workshops = db.prepare(`SELECT * FROM workshops ORDER BY date DESC`).all()
    const signups = db.prepare(`
        SELECT * FROM workshop_signups ORDER BY workshop_id, created_at, id
    `).all()

    const byWorkshop = new Map(workshops.map(w => [w.id, []]))
    for (const signup of signups) {
        const list = byWorkshop.get(signup.workshop_id)
        if (list) list.push(signup)
    }

    return workshops.map(workshop => {
        const list = byWorkshop.get(workshop.id)
        return Object.assign({}, workshop, {
            signups: list,
            total: list.length,
            spotsLeft: spotsLeft(workshop, list.length)
        })
    })
}

module.exports = {
    get, create, update, remove,
    signupCount, getWithSpots,
    listUpcoming, listPast,
    signup, roster
}
