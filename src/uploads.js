// Upload de fotografias dos anúncios: multer em disco, apenas imagens, com limite.
const path = require("node:path")
const fs = require("node:fs")
const crypto = require("node:crypto")
const multer = require("multer")
const { LISTINGS_UPLOAD_DIR: UPLOAD_DIR } = require("./config")

const PUBLIC_PREFIX = "/uploads/listings/"

const ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype])
})

const upload = multer({
    storage,
    limits: { fileSize: 3 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED[file.mimetype]) return cb(null, true)
        return cb(new Error("BAD_TYPE"))
    }
})

// Middleware que aceita um campo "photo" opcional e converte erros do multer
// numa mensagem amigável em req.uploadError.
function listingPhoto(req, res, next) {
    upload.single("photo")(req, res, (err) => {
        if (err) {
            req.uploadError = err.code === "LIMIT_FILE_SIZE"
                ? "A imagem é demasiado grande (máx. 3 MB)."
                : "Ficheiro inválido. Use uma imagem JPG, PNG ou WEBP."
        }
        next()
    })
}

// Caminho público para guardar em listings.photo_path.
function publicPath(file) {
    return file ? PUBLIC_PREFIX + path.basename(file.path) : null
}

// Apaga o ficheiro já escrito pelo multer quando o pedido acaba por falhar
// (validação inválida ou erro na BD) — caso contrário fica órfão no disco.
function removeUpload(file) {
    if (!file || !file.path) return
    fs.rm(file.path, { force: true }, (err) => {
        if (err) console.error("removeUpload:", err)
    })
}

// Varre a pasta de uploads e apaga o que nenhum anúncio referencia.
// Corre no arranque: recupera órfãos de erros antigos e, no plano free do
// Render, os ficheiros que sobrevivem a uma base de dados recriada.
function sweepOrphans(referencedPaths) {
    const keep = new Set(
        referencedPaths.filter(Boolean).map(p => path.basename(p))
    )
    let files
    try {
        files = fs.readdirSync(UPLOAD_DIR)
    } catch (err) {
        return console.error("sweepOrphans:", err)
    }
    let removed = 0
    for (const name of files) {
        if (keep.has(name)) continue
        try {
            fs.rmSync(path.join(UPLOAD_DIR, name), { force: true })
            removed++
        } catch (err) {
            console.error("sweepOrphans:", err)
        }
    }
    if (removed) console.log(`Uploads órfãos removidos: ${removed}`)
}

module.exports = { listingPhoto, publicPath, removeUpload, sweepOrphans }
