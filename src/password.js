// Hashing de password com crypto.scrypt (embutido no Node, sem dependências
// nativas). Formato guardado: "<saltHex>:<hashHex>".
const crypto = require("node:crypto")

function hashPassword(plain) {
    const salt = crypto.randomBytes(16)
    const hash = crypto.scryptSync(String(plain), salt, 64)
    return `${salt.toString("hex")}:${hash.toString("hex")}`
}

function verifyPassword(plain, stored) {
    if (!stored || !stored.includes(":")) return false
    const [saltHex, hashHex] = stored.split(":")
    const hash = Buffer.from(hashHex, "hex")
    const test = crypto.scryptSync(String(plain), Buffer.from(saltHex, "hex"), 64)
    return hash.length === test.length && crypto.timingSafeEqual(hash, test)
}

module.exports = { hashPassword, verifyPassword }
