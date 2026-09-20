// Materiais de valor acrescentado aceites na plataforma Nôs Lixu.
// co2ePerKg = estimativa indicativa de kg de CO2 equivalente evitados por cada
// kg reciclado (a afinar com a Quercus Cabo Verde / dados locais).
const materials = [
    {
        key: "papel",
        label: "Papéis e Papelão",
        co2ePerKg: 0.9,
        icon: "📦",
        category: "papel",
        instructions: [
            "Separe jornais, revistas, cartões e embalagens",
            "Remova plástico, metal e adesivos",
            "Comprima para poupar espaço",
            "Mantenha seco"
        ],
        tips: "Recolha-se facilmente e pesa pouco"
    },
    {
        key: "plastico",
        label: "Plástico",
        co2ePerKg: 1.5,
        icon: "🍾",
        category: "plastico",
        instructions: [
            "Garrafas, embalagens e sacos plásticos",
            "Limpe antes de descartar",
            "Remova rótulos se possível",
            "Comprima para reduzir volume"
        ],
        tips: "Um dos resíduos mais importantes — produz novo plástico ou combustível"
    },
    {
        key: "vidro",
        label: "Vidro",
        co2ePerKg: 0.3,
        icon: "🍷",
        category: "vidro",
        instructions: [
            "Garrafas, frascos e recipientes de vidro",
            "Limpe e seque bem",
            "Proteja para não partir",
            "Agrupe vidro junto"
        ],
        tips: "Pode ser reciclado infinitamente sem perder qualidade"
    },
    {
        key: "metal",
        label: "Metal / Latas",
        co2ePerKg: 4.0,
        icon: "🥫",
        category: "metal",
        instructions: [
            "Latas de bebida e conservas",
            "Remova rótulos",
            "Limpe o interior",
            "Comprima as latas"
        ],
        tips: "Alto valor de CO₂e evitado — muito importante!"
    },
    {
        key: "eletronicos",
        label: "Resíduos Eletrónicos",
        co2ePerKg: 1.4,
        icon: "📱",
        category: "eletronicos",
        instructions: [
            "Telemóveis, tablets, computadores",
            "Cabos e carregadores",
            "Remova baterias se possível",
            "Separe peças de vidro e metal"
        ],
        tips: "Contêm materiais valiosos — lítio, cobre, ouro"
    },
    {
        key: "pilhas",
        label: "Pilhas e Baterias",
        co2ePerKg: 1.0,
        icon: "🔋",
        category: "pilhas",
        instructions: [
            "Baterias de vários tipos",
            "Pilhas alcalinas",
            "Baterias recarregáveis",
            "Mantenha em local seguro"
        ],
        tips: "Perigoso — contém ácidos e metais pesados"
    },
    {
        key: "lampadas",
        label: "Lâmpadas",
        co2ePerKg: 0.5,
        icon: "💡",
        category: "eletronicos",
        instructions: [
            "Lâmpadas fluorescentes e LED",
            "Incandescentes",
            "Proteja para não partir",
            "Evite contato com o mercúrio"
        ],
        tips: "Perigosas — mantenha separadas"
    },
    {
        key: "organicos",
        label: "Resíduos Orgânicos",
        co2ePerKg: 0.5,
        icon: "🌱",
        category: "organicos",
        instructions: [
            "Restos de comida e plantas",
            "Cascas de frutas e vegetais",
            "Sacos compostáveis",
            "Evite carne e lacticínios se possível"
        ],
        tips: "Pode ser compostado para adubo"
    },
    {
        key: "oleo",
        label: "Óleo de Cozinha",
        co2ePerKg: 2.5,
        icon: "🍳",
        category: "oleo",
        instructions: [
            "Óleo usado de cozinha",
            "Deixe arrefecer",
            "Coloque em garrafa fechada",
            "Nunca despeje na sanita"
        ],
        tips: "Valioso — transforma-se em biodiesel"
    }
]

const labels = materials.map(m => m.label)
const co2eByLabel = Object.fromEntries(materials.map(m => [m.label, m.co2ePerKg]))

module.exports = { materials, labels, co2eByLabel }
