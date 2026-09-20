// Lógica de recompensas e pontos dos utilizadores.

function initRewardsForUser(db, userId) {
    const existing = db.prepare(`SELECT id FROM user_rewards WHERE user_id = ?`).get(userId)
    if (!existing) {
        db.prepare(`INSERT INTO user_rewards (user_id, total_points, level) VALUES (?, ?, ?)`).run(userId, 0, 1)
    }
    return { ok: true }
}

function addPoints(db, userId, points, type, relatedId = null) {
    try {
        initRewardsForUser(db, userId)
        db.prepare(`
            INSERT INTO reward_transactions (user_id, points, type, related_id)
            VALUES (?, ?, ?, ?)
        `).run(userId, points, type, relatedId)

        const currentRewards = db.prepare(`SELECT total_points FROM user_rewards WHERE user_id = ?`).get(userId)
        const newTotal = currentRewards.total_points + points
        const newLevel = calculateLevel(newTotal)

        db.prepare(`UPDATE user_rewards SET total_points = ?, level = ? WHERE user_id = ?`).run(newTotal, newLevel, userId)
        return { ok: true, points, newTotal, newLevel }
    } catch (err) {
        return { ok: false, status: 500, message: "Erro ao adicionar pontos" }
    }
}

function calculateLevel(points) {
    if (points < 50) return 1
    if (points < 150) return 2
    if (points < 300) return 3
    return 4
}

function getLevelName(level) {
    const names = { 1: "Bronze", 2: "Prata", 3: "Ouro", 4: "Platina" }
    return names[level] || "Bronze"
}

function getLevelBadge(level) {
    const badges = { 1: "🥉", 2: "🥈", 3: "🥇", 4: "👑" }
    return badges[level] || "🥉"
}

function getUserRewards(db, userId) {
    const rewards = db.prepare(`SELECT * FROM user_rewards WHERE user_id = ?`).get(userId)
    if (!rewards) {
        initRewardsForUser(db, userId)
        return { id: null, user_id: userId, total_points: 0, level: 1 }
    }
    return rewards
}

function getLeaderboard(db, limit = 10) {
    return db.prepare(`
        SELECT
            u.id,
            u.name,
            u.role,
            ur.total_points,
            ur.level,
            (SELECT COUNT(*) FROM collection_records WHERE recycler_id = u.id) AS collections
        FROM user_rewards ur
        JOIN users u ON ur.user_id = u.id
        ORDER BY ur.total_points DESC
        LIMIT ?
    `).all(limit)
}

function getUserStats(db, userId) {
    const rewards = getUserRewards(db, userId)
    const transactions = db.prepare(`
        SELECT type, SUM(points) as total_points, COUNT(*) as count
        FROM reward_transactions
        WHERE user_id = ?
        GROUP BY type
    `).all(userId)

    return {
        rewards,
        levelName: getLevelName(rewards.level),
        levelBadge: getLevelBadge(rewards.level),
        transactions
    }
}

module.exports = {
    initRewardsForUser,
    addPoints,
    calculateLevel,
    getLevelName,
    getLevelBadge,
    getUserRewards,
    getLeaderboard,
    getUserStats
}
