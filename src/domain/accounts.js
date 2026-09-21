// Registo e autenticação de contas.
//
// Consolida validação, hashing, throttle e os dois writes (user + recycler_profile).
// O throttle é construído por instância (não é global) — passa-se à função.
const zones = require("../data/praia-zones")
const { hashPassword, verifyPassword } = require("../password")

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

// Throttle de login em memória, por instância.
function createThrottle() {
    const attempts = new Map()

    function isBlocked(key) {
        const rec = attempts.get(key)
        if (!rec) return false
        if (Date.now() - rec.ts > WINDOW_MS) { attempts.delete(key); return false }
        return rec.count >= MAX_ATTEMPTS
    }

    function recordFailure(key) {
        const rec = attempts.get(key)
        if (!rec || Date.now() - rec.ts > WINDOW_MS) {
            attempts.set(key, { count: 1, ts: Date.now() })
        } else {
            rec.count++
        }
    }

    function clear(key) {
        attempts.delete(key)
    }

    return { isBlocked, recordFailure, clear }
}

// Valida os campos de registo.
function validateRegisterFields(fields) {
    const errors = []
    const name = String(fields.name || "").trim()
    if (!name) errors.push("Indique o seu nome.")

    const email = String(fields.email || "").trim().toLowerCase()
    if (!email || !/.+@.+\..+/.test(email)) errors.push("Email inválido.")

    const zone = String(fields.zone || "").trim()
    if (!zone || !zones.includes(zone)) errors.push("Selecione uma zona da Praia.")

    const password = String(fields.password || "")
    if (!password || password.length < 8) errors.push("A password deve ter pelo menos 8 caracteres.")

    const password2 = String(fields.password2 || "")
    if (password !== password2) errors.push("As passwords não coincidem.")

    if (errors.length) return { errors }
    return {
        values: {
            name,
            email,
            zone,
            phone: String(fields.phone || "").trim() || null,
            password,
            role: fields.role === "reciclador" ? "reciclador" : "cidadao"
        }
    }
}

// Regista uma nova conta (user + recycler_profile se reciclador).
function register(db, fields) {
    const parsed = validateRegisterFields(fields)
    if (parsed.errors) return { ok: false, status: 400, errors: parsed.errors }

    const { name, email, zone, phone, password, role } = parsed.values

    // Checa uniqueness do email.
    if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) {
        return { ok: false, status: 400, errors: ["Já existe uma conta com este email."] }
    }

    try {
        const info = db.prepare(`
            INSERT INTO users (role, name, email, phone, zone, password_hash)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(role, name, email, zone, phone, hashPassword(password))

        const userId = info.lastInsertRowid

        if (role === "reciclador") {
            db.prepare(`INSERT INTO recycler_profiles (user_id, org_name) VALUES (?, ?)`)
                .run(userId, name)
        }

        return { ok: true, userId, role }
    } catch (err) {
        return { ok: false, status: 500, message: "Erro ao criar a conta." }
    }
}

// Autentica um utilizador (verifica password e throttle).
function authenticate(db, email, password, throttle, clientKey) {
    email = String(email || "").trim().toLowerCase()

    if (throttle.isBlocked(clientKey)) {
        return { ok: false, status: 429, message: "Demasiadas tentativas. Aguarde 15 minutos." }
    }

    const user = email ? db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) : null

    if (!user || !verifyPassword(password || "", user.password_hash)) {
        throttle.recordFailure(clientKey)
        return { ok: false, status: 401, message: "Email ou password incorretos." }
    }

    throttle.clear(clientKey)
    return { ok: true, user }
}

module.exports = { createThrottle, register, authenticate }
