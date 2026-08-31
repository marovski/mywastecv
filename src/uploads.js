// Upload de fotografias dos anúncios: multer em disco, apenas imagens, com limite.
const path = require("node:path")
const fs = require("node:fs")
const crypto = require("node:crypto")
const multer = require("multer")

const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads", "listings")
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

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
    return file ? "/uploads/listings/" + path.basename(file.path) : null
}

module.exports = { listingPhoto, publicPath }
