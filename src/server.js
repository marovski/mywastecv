// Ponto de entrada: abre a base de dados, constrói a aplicação e põe-na a ouvir.
//
// Tudo o que só faz sentido num processo real vive aqui — o ficheiro SQLite, o
// seed, as guardas contra erros soltos, as limpezas de arranque e a porta. A
// aplicação em si (app.js) recebe a base de dados e não faz nada ao ser
// importada, por isso os testes podem construí-la sem nada disto.
const { DB_PATH } = require("./config")
const { openDatabase } = require("./database/db")
const { seedIfEmpty } = require("./database/seed")
const { sweepOrphans } = require("./uploads")
const listings = require("./domain/listings")
const { createApp } = require("./app")

const db = openDatabase(DB_PATH)
seedIfEmpty(db)

// Não deixar o processo morrer por um erro isolado num pedido.
process.on("uncaughtException", (err) => console.error("uncaughtException:", err))
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err))

const app = createApp({
    db,
    sessionSecret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    isProd: process.env.NODE_ENV === "production"
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
try {
    listings.sweepExpired(db)
} catch (err) {
    console.error("sweepExpired:", err)
}

const PORT = process.env.PORT || 8001
app.listen(PORT, () => console.log(`Nôs Lixu a correr na porta ${PORT}`))
