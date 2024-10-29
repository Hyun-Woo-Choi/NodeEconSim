const mysql = require('mysql2');
require('dotenv').config(); // Load environment variables from .env file

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '1878',
  database: 'cournot',
  waitForConnections: true,
  connectionLimit: 10, // Try reducing to 10 or lower
  maxIdle: 5, // Reduce maxIdle to see if it helps
  idleTimeout: 60000,
  queueLimit: 0
});

const promisePool = pool.promise();
module.exports = promisePool;

// SQL DB connection

/*
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password : process.env.MYSQL_PASSWORD,
  database:  process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 50,
  maxIdle: 50, // max idle connections, the default value is the same as `connectionLimit`
  idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
  queueLimit: 0
});

const promisePool = pool.promise();
module.exports = promisePool; // Export pool with promise support
*/