const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    // SSL für MariaDB Cloud / SkySQL
    ssl: {
        rejectUnauthorized: false
    },

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function testDatabase() {
    try {
        const connection = await pool.getConnection();

        console.log("✅ Verbindung zu MariaDB erfolgreich!");

        connection.release();
    } catch (error) {
        console.error("❌ Datenbankverbindung fehlgeschlagen:");
        console.error(error.message);
    }
}

testDatabase();

module.exports = pool;