const test = require("node:test")
const assert = require("node:assert")
const { safeRedirectPath } = require("../src/auth")

test("safeRedirectPath: caminhos internos passam intactos, com query e fragmento", () => {
    for (const ok of ["/", "/painel", "/anuncios/1", "/anuncios?todos=1", "/workshops/2?saved=1#topo", "/a/b/c"]) {
        assert.strictEqual(safeRedirectPath(ok), ok)
    }
})

test("safeRedirectPath: o que não é uma string cai no valor por omissão", () => {
    for (const bad of [undefined, null, 42, true, {}, ["/painel"], ["/a", "/b"]]) {
        assert.strictEqual(safeRedirectPath(bad), "/painel", JSON.stringify(bad))
    }
})

test("safeRedirectPath: vazio ou sem barra inicial não é um caminho do site", () => {
    for (const bad of ["", "anuncios", "painel", " /painel", "?next=/x"]) {
        assert.strictEqual(safeRedirectPath(bad), "/painel", JSON.stringify(bad))
    }
})

test("safeRedirectPath: URLs absolutos e esquemas são recusados", () => {
    for (const bad of ["https://outro-site.example", "http://outro-site.example/x", "javascript:alert(1)",
                       "data:text/html,x", "mailto:a@b.cv"]) {
        assert.strictEqual(safeRedirectPath(bad), "/painel", bad)
    }
})

test("safeRedirectPath: '//host' e '/\\host' são relativos ao protocolo — o browser vai ao outro site", () => {
    for (const bad of ["//outro-site.example", "///outro-site.example", "////x", "//outro-site.example/painel",
                       "/\\outro-site.example", "/\\/outro-site.example", "\\\\outro-site.example", "\\/outro-site.example"]) {
        assert.strictEqual(safeRedirectPath(bad), "/painel", JSON.stringify(bad))
    }
})

test("safeRedirectPath: o browser ignora tabs e quebras de linha num URL, por isso '/<tab>/host' é '//host'", () => {
    for (const bad of ["/\t/outro-site.example", "/\n/outro-site.example", "/\r/outro-site.example",
                       "/\t\t/outro-site.example", "/x\ty", "/\u0000", "/\u007f", "/x\\y"]) {
        assert.strictEqual(safeRedirectPath(bad), "/painel", JSON.stringify(bad))
    }
})

test("safeRedirectPath: um comprimento absurdo é recusado", () => {
    assert.strictEqual(safeRedirectPath("/" + "a".repeat(3000)), "/painel")
    assert.strictEqual(safeRedirectPath("/" + "a".repeat(200)), "/" + "a".repeat(200))
})

test("safeRedirectPath: o valor por omissão pode ser escolhido por quem chama", () => {
    assert.strictEqual(safeRedirectPath("//outro-site.example", "/entrar"), "/entrar")
    assert.strictEqual(safeRedirectPath(undefined, ""), "")
    assert.strictEqual(safeRedirectPath("/ok", "/entrar"), "/ok")
})
