// Proteção CSRF: token sincronizador guardado na sessão (cookie assinado).
const crypto = require("node:crypto")

// Garante um token na sessão e disponibiliza-o aos templates.
function csrfToken(req, res, next) {
    if (!req.session.csrf) {
        req.session.csrf = crypto.randomBytes(24).toString("hex")
    }
    res.locals.csrfToken = req.session.csrf
    next()
}

// Verifica o campo _csrf em pedidos que alteram estado.
// Para formulários multipart, montar DEPOIS do multer (para req.body estar preenchido)
// e colocar o campo _csrf como primeiro campo do formulário.
function verifyCsrf(req, res, next) {
    const sent = (req.body && req.body._csrf) || req.get("x-csrf-token") || ""
    const expected = req.session.csrf || ""
    const a = Buffer.from(String(sent))
    const b = Buffer.from(String(expected))
    if (a.length !== b.length || !expected || !crypto.timingSafeEqual(a, b)) {
        return res.status(403).render("error.html", { message: "Sessão inválida ou expirada. Recarregue a página e tente de novo." })
    }
    return next()
}

module.exports = { csrfToken, verifyCsrf }
