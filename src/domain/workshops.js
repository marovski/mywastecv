// Gestão de workshops pela equipa Nôs Lixu.
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

function signupCount(db, id) {
    return db.prepare(`SELECT COUNT(*) AS total FROM workshop_signups WHERE workshop_id = ?`)
        .get(id).total
}

// Apagar leva as inscrições com ele (ON DELETE CASCADE); devolvemos quantas
// eram para que a confirmação diga exatamente o que se perde.
function remove(db, id) {
    if (!get(db, id)) return notFound()
    const deletedSignups = signupCount(db, id)
    db.prepare(`DELETE FROM workshops WHERE id = ?`).run(id)
    return { ok: true, deletedSignups }
}

module.exports = { get, create, update, remove, signupCount }
