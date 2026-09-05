const test = require("node:test")
const assert = require("node:assert")
const { withStagedPhoto } = require("../src/uploads")

// Adaptador em memória do armazenamento: o mesmo contrato do disco,
// sem escrever nada. Segundo adaptador da interface de staging.
function memoryStore() {
    const files = new Set()
    return {
        files,
        stage(name) { files.add(name); return { path: `/tmp/${name}`, name } },
        discard(file) { if (file) files.delete(file.name) }
    }
}

test("o caminho feliz mantém o ficheiro", () => {
    const store = memoryStore()
    const file = store.stage("a.jpg")
    const kept = withStagedPhoto(store, file, () => ({ ok: true }))
    assert.deepStrictEqual(kept, { ok: true })
    assert.deepStrictEqual([...store.files], ["a.jpg"])
})

test("um resultado não-ok descarta o ficheiro", () => {
    const store = memoryStore()
    const file = store.stage("a.jpg")
    const r = withStagedPhoto(store, file, () => ({ ok: false, status: 400 }))
    assert.strictEqual(r.ok, false)
    assert.deepStrictEqual([...store.files], [])
})

test("uma exceção descarta o ficheiro e propaga", () => {
    const store = memoryStore()
    store.stage("a.jpg")
    assert.throws(() => withStagedPhoto(store, { name: "a.jpg" }, () => { throw new Error("boom") }), /boom/)
    assert.deepStrictEqual([...store.files], [])
})

test("sem ficheiro não há nada a descartar", () => {
    const store = memoryStore()
    assert.strictEqual(withStagedPhoto(store, null, () => ({ ok: false })).ok, false)
})
