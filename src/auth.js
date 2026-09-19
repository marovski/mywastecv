// Autenticação: carregamento do utilizador da sessão e middlewares de proteção.
// (O hashing de password vive em ./password para evitar ciclos de require.)
//
// Cada aplicação constrói o seu próprio auth com a sua base de dados — e com o
// seu próprio throttle de login, para que duas instâncias (ou dois testes) não
// partilhem tentativas falhadas.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

function createAuth(db) {
    // --- Utilizador da sessão ------------------------------------------------
    function loadUser(req) {
        if (req._user !== undefined) return req._user
        const id = req.session && req.session.userId
        req._user = id
            ? db.prepare(`SELECT id, role, name, email, phone, zone, created_at FROM users WHERE id = ?`).get(id) || null
            : null
        return req._user
    }

    function attachUser(req, res, next) {
        res.locals.currentUser = loadUser(req)
        next()
    }

    // --- Middlewares de proteção -------------------------------------------
    function requireAuth(req, res, next) {
        if (loadUser(req)) return next()
        return res.redirect(`/entrar?next=${encodeURIComponent(req.originalUrl)}`)
    }

    function requireRole(...roles) {
        return (req, res, next) => {
            const user = loadUser(req)
            if (!user) return res.redirect(`/entrar?next=${encodeURIComponent(req.originalUrl)}`)
            if (!roles.includes(user.role)) {
                return res.status(403).render("error.html", { message: "Não tem permissão para aceder a esta página." })
            }
            return next()
        }
    }

    // --- Throttle simples de login (em memória, por instância) -------------
    const attempts = new Map()

    function loginBlocked(key) {
        const rec = attempts.get(key)
        if (!rec) return false
        if (Date.now() - rec.ts > WINDOW_MS) { attempts.delete(key); return false }
        return rec.count >= MAX_ATTEMPTS
    }

    function registerFailedLogin(key) {
        const rec = attempts.get(key)
        if (!rec || Date.now() - rec.ts > WINDOW_MS) {
            attempts.set(key, { count: 1, ts: Date.now() })
        } else {
            rec.count++
        }
    }

    function clearLoginAttempts(key) {
        attempts.delete(key)
    }

    return {
        loadUser,
        attachUser,
        requireAuth,
        requireRole,
        loginBlocked,
        registerFailedLogin,
        clearLoginAttempts
    }
}

module.exports = { createAuth }
